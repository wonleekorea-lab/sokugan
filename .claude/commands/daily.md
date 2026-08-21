---
description: 翌日分の教材5本を生成し、QA合格させて公開する
---

SOKUGAN 3.0 の教材を生成する。**CLAUDE.md の絶対ルールに従うこと。**

## 1. 対象日の決定
`TZ=Asia/Tokyo date "+%Y-%m-%d %H:%M"` を実行。
- **JST14:00以降** → `target_date` = 翌日（先回り生成）
- **JST14:00より前** → `target_date` = 当日（前夜の取りこぼしを埋める）

既存 `daily-content.json` の date が target_date と同じで、`node qa/harness.js` がPASSするなら「生成不要」と報告して終了。

## 2. 素材集め（WebSearch）
直近12〜48時間から5本。ジャンル1本ずつ:
①スタートアップ・新規事業 ②社会・価値観 ③市場・経済・地政学 ④経営・リーダーシップ ⑤未来の兆し

**選定基準は「Wonが読んだその日、誰かに『実は…』と話したくなるか」。** 意外な数字・常識の反転・構造の発見を優先し、ありきたりの追認記事は捨てる。AI中心は最大1本（上限2）。芸能・スポーツ・天気は除外。`git log --oneline -7` で直近の話題と重複しないか確認。

## 3. 執筆
各450〜650字、「事実→構造→含意」、常体、翻訳調禁止、タイトル単独で意味が通ること、数字は算用数字。④⑤は①〜③より抽象度を一段上げる。

各パッセージに以下を付ける:
- `questions` 3問（8型から異なる3型・4択・22〜32字・単独最長=正解禁止・rationale 50〜90字・15問でans分布を均等に）
- `keyTerms` 2〜3語: 日本の学校で習う類の用語（利回り・系統連系・福利厚生など）を `{term, plain, lures:[3], note?}` で。**plainは12歳にわかる説明15字以上**
- `takeaway`: `{hook, detail}`。hookは10〜70字の「実は…」ネタ（数字入り推奨）

`chunks` は書かない（アプリが自動生成）。

## 4. 書き込み
既存を `archive/{既存date}.json` に退避してから `daily-content.json` を上書き。

## 5. 明快さ自己監査 → clarity-audit.json（必須）
全15問を自分で解き、①一読で分かる ②論理が一意 ③選択肢が具体的 を1〜5で採点。4未満は平易に書き直す。
`{date, status, checked_at, auditor, avgScore, total:15, rewritten, items:[15件], rubric}` を `clarity-audit.json` に出力。全問≥3かつavg≥4で `pass`（偽装禁止）。

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
target_date（当日/翌日の理由）／5本のタイトル・genre・出典／AI中心の本数／keyTerms計・takeaway 5本／ans分布／clarity avg／ハーネス PASS数／公開結果。
