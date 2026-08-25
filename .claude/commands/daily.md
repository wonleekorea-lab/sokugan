---
description: 翌日分の教材10本を生成し、QA合格させて公開する
---

SOKUGAN 3.0 の教材を生成する。**CLAUDE.md の絶対ルールに従うこと。**

## 1. 対象日の決定
`TZ=Asia/Tokyo date "+%Y-%m-%d %H:%M"` を実行。
- **JST14:00以降** → `target_date` = 翌日（先回り生成）
- **JST14:00より前** → `target_date` = 当日（前夜の取りこぼしを埋める）

既存 `daily-content.json` の date が target_date と同じで、`node qa/harness.js` がPASSするなら「生成不要」と報告して終了。

## 2. 素材集め（WebSearch）
直近12〜72時間から10本。ジャンルを2本ずつ:
①スタートアップ・新規事業 ②社会・価値観 ③市場・経済・地政学 ④経営・リーダーシップ ⑤未来の兆し

**選定基準は「Wonが読んだその日、誰かに『実は…』と話したくなるか」。** 意外な数字・常識の反転・構造の発見を優先し、ありきたりの追認記事は捨てる。AI中心は最大2本、非AIは8本以上。芸能・スポーツ・天気は除外。`archive/` の直近30日分からタイトル・主要論点・source URLを抽出し、同じ出来事や同じ主張の言い換えを候補から外す。

## 3. 執筆
各450〜650字、「事実→構造→含意」、常体、翻訳調禁止、タイトル単独で意味が通ること、数字は算用数字。④⑤は①〜③より抽象度を一段上げる。

**日本語の品質ゲート（形式QAより優先）**
- Webで読んだ一次記事の事実だけを書く。情報が足りないときに、もっともらしい因果・固有名詞・数字を補わない。
- 各文を「誰が／何をした／なぜ重要か」が一読で分かる形にし、主語と述語がねじれた文、直訳調、名詞の連結、途中で意味が切れた句をゼロにする。
- 書いた後、タイトル・本文・設問・選択肢を声に出して読み、意味が取れない一文でもあれば**その文だけを言い換えるのでなく、根拠記事から段落ごと書き直す**。
- 選択肢はすべて自然な日本語にする。「明らかに変な日本語」を誤答として混ぜて正解を当てやすくしない。

各パッセージに以下を付ける:
- `questions` 3問（8型から異なる3型・4択・22〜32字・単独最長=正解禁止・rationale 50〜90字・30問でans分布を均等に）
- `keyTerms` 2〜3語: 日本の学校で習う類の用語（利回り・系統連系・福利厚生など）を `{term, plain, lures:[3], note?}` で。**plainは12歳にわかる説明15字以上**
- `takeaway`: `{hook, detail}`。hookは10〜70字の「実は…」ネタ（数字入り推奨）

`chunks` は書かない（アプリが自動生成）。

## 4. 書き込み
既存を `archive/{既存date}.json` に退避してから `daily-content.json` を上書き。

## 5. 明快さ自己監査 → clarity-audit.json（必須）
全30問を自分で解き、①一読で分かる ②論理が一意 ③選択肢が具体的 ④日本語が自然で根拠記事に忠実 を1〜5で採点。4未満は平易に書き直す。
`{date, status, checked_at, auditor, avgScore, total:30, rewritten, items:[30件], rubric}` を `clarity-audit.json` に出力。全問≥3かつavg≥4で `pass`（偽装禁止）。

## 6. QA → 公開
```bash
node qa/harness.js --write-report --note "daily: $(TZ=Asia/Tokyo date +%F)"
```
**全PASS（終了コード0）になるまで完了しない。** チャンク破損は `node qa/repair-chunks.js`。
全PASS後にのみ:
```bash
git add -A && git commit -m "daily: $(TZ=Asia/Tokyo date +%F)" && git push origin main
```

## 7. 報告
target_date（当日/翌日の理由）／10本のタイトル・genre・出典／AI中心の本数／archive重複検査／keyTerms計・takeaway 10本／ans分布／clarity avg／ハーネス PASS数／公開結果。
