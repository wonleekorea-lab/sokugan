---
description: 翌日分のビッグイシュー2本と復習教材3本を作り、QA合格させて公開する
---

SOKUGAN 4.0 の教材を生成する。**CLAUDE.md の絶対ルールに従うこと。**

4.0で変わったこと。**1日に出すのは5本まで**。内訳は **ビッグイシュー2本（公開）＋ 復習3本（非公開）**。
一覧には未読が新しい順に5本まで並び、1本読み終えるごとに控えから繰り上がる。
10本を毎日入れ替えていた頃は、選ぶことが重くなり、在庫が滞留して質も落ちていた。

## 1. 対象日の決定
`TZ=Asia/Tokyo date "+%Y-%m-%d %H:%M"` を実行。
- **JST14:00以降** → `target_date` = 翌日（先回り生成）
- **JST14:00より前** → `target_date` = 当日（前夜の取りこぼしを埋める）

既存 `daily-content.json` の date が target_date と同じで、`node qa/harness.js` がPASSするなら日次分は「生成不要」と報告し、**手順3（復習）だけ実行して終了**する。

---

## 2. ビッグイシュー2本（公開・`daily-content.json`）

### 素材集め（sources.json → WebSearch の順）

**WebSearchから始めない。** 検索は鮮度で並ぶため、鮮度が最高のプレスリリースと公式発表が必ず上に来る。

1. `sources.json` を読み、`analysis` / `analysis_ja` / `letters` / `research` / `community` を巡回する（WebFetch）。**直近21日**の新着から候補を拾う。洞察は腐らないので72時間に縛らない
   - Substackは本体ページがJavaScriptで描かれ、WebFetchでは中身が取れない。**`<URL>/feed` を読む**
2. 足りないときだけ WebSearch で補う。ここで拾うのは直近72時間の `media` か `official`
3. **2本のうち official（公式発表・PRワイヤー・統計リリース・企業ニュースルーム）は最大1本、洞察系は1本以上**（A18b）
4. `daily-content.json` の最上位に `"sourcePolicy": "4.0"` と `"slots": 5` を書く（A2c/A18c）

**2本は別ジャンル**にする（A14c）。5系統から毎日2つ選ぶ:
①スタートアップ・新規事業 ②社会・価値観 ③市場・経済・地政学 ④経営・リーダーシップ ⑤未来の兆し

素材を探す前に、PCローカルの評価プロファイルを取得する。本人の読後・設問評価の集計だけで、本文・タイトル・ユーザーIDは出力しない。

```bash
set -a; . /Users/wota/Documents/ChatGPT/AI\ Engineering/sokugan-work/.sokugan-private.env; set +a
node /Users/wota/Documents/ChatGPT/AI\ Engineering/sokugan-work/tools/export-content-feedback-profile.js
```

- `picks[ジャンル]` は**一覧に並んだうち実際に選ばれた割合（選択率）**。押す手間がなく毎日必ず溜まるので、読後評価より優先して読む。`prioritize`（選択率28%以上）の切り口を他ジャンルへ広げ、`change_angle`（10%以下）は本数を減らさず題材の角度を変える
- `genres[ジャンル].instruction=prioritize` は、そのジャンル内で評価の高かった切り口を候補比較で優先する。`vary_angle` は低評価だった話題・構図の繰り返しを避ける
- `questionFit.instruction=increase_inference` なら、根拠が一意な因果・比較・応用の設問を各本文に1問以上含める。`questionFit.instruction=make_clearer` なら、問題文を短くし、代名詞と曖昧な比較対象を避け、本文の明示情報だけで解ける設問にする
- `notes[]` は本人が読後に書いた自由記述。**要約せず、書かれた題材・角度を2本のどちらかに反映する**。ただし関心の表明であって事実ではないので、裏取りは免除されない
- `samples` / `shown` が足りないときは判断材料にしない。取得に失敗したら通常基準で生成し、失敗理由だけを報告する
- 評価プロファイルや個人情報を `daily-content.json`、公開リポジトリ、報告へ保存しない

**選定基準は「Wonが読んだその日、誰かに『実は…』と話したくなるか」。**
読み手は水処理スタートアップの経営責任者で、現場の運用・設備・組織・規制の間で意思決定している。
**2本しか出せないので、当たり障りのない記事を1本でも混ぜると、その日は半分死ぬ。**

- **発表もの（「〜が〜を発表した」で始まる記事）は最大1本**（A17b）。もう1本は次のどれかにする
  - **構造の発見**: 個別の出来事ではなく、そうなる仕組みを説明できる話
  - **数字の裏側**: 見出しの数字と実態がずれている話
  - **現場の変化**: 誰かの仕事の進め方が実際に変わった話
- AI中心は最大1本。芸能・スポーツ・天気は除外
- `archive/` の直近30日からタイトル・論点・出典URLを抽出し、同じ出来事や言い換えを候補から外す（A15）

---

## 3. 復習3本（非公開・Obsidianのリサーチから）

公開リポジトリには入れない。本人のYouTubeリサーチは題材が私的なものを含むので、
**Supabaseの本人ライブラリへだけ届ける**（`personalLibrary`）。

### 3-1. どの論点を復習に回すか（ツールが決める。自分で選ばない）

```bash
node tools/build-review-briefs.js --count 3 --date <target_date>
```

`private-imports/review-briefs/<date>.json` に3件のブリーフが出る。選定の優先順は決定論で、

1. 本人が `==ハイライト==` を引いた論点
2. ハイライトのあるノートの他の論点
3. 新しいノートの論点
4. 最後に出してから45日以上たった論点（間隔をあけた復習）

同じノートから2本以上は出ない。**この順番を手で上書きしない。**

### 3-2. ブリーフ → 教材への変換

ブリーフには `claim`（その人の主張）、`body`（論点の本文）、`quotes`（本人の言葉）、
`highlights`（本人が線を引いた箇所）、`speaker`、`videoUrl`、`backToQuestion` が入っている。

**変換の型**（450〜650字・常体・4段）:

1. **場面** — 誰が、どういう人に向けて話しているか。1〜2文
2. **主張** — その人の結論を、言い切りで1文
3. **なぜ** — 理由と、本人が出した具体例・数字・言葉。2〜5文
4. **含意** — それを読むと、明日の何が変わるか。1〜2文

**守ること**（`qa/insight-lint.js` が機械で落とす）:

- 一文60字以内、平均40字前後。読点なしで45字を超えない
- 「話者」「〜と述べている」「〜としている」「〜することが重要」は使わない。**名前で呼び、言い切る**
- 「の」の多重連結、抽象語の羅列を作らない
- 同じ文末を3連続させない
- **なぜそう言えるか**の接続（なぜなら／そのため／だから／つまり）を必ず1つ以上入れる
- **具体**（数字・例・本人の言葉）を必ず1つ以上入れる
- `author` は `{name, role}` 必須。ブリーフの `speaker` をそのまま使い、推測で人名を作らない
- **本人が線を引いた箇所（highlights）のどれかを必ず本文に残す**。線を引いた場所が、その人にとっての核
- `source` は元動画のURLを含める。`id` は `review-` で始める
- `genre` は短い日本語（学び方／読み方／休み方／撮り方 など）
- ブリーフの `claim` の要点語が本文に残っていること（被覆45%以上）

**要約ではない。** ノートを短くするのではなく、**その論点1つを、読み直して腹に落ちる形に書き直す**。
元の動画に無いことを足さない。分からない箇所には触れない。

出力先: `private-imports/review-<target_date>.json`

```json
{ "schema": "sokugan-private-review-v1", "date": "<target_date>", "availableOn": "<target_date>",
  "passages": [ { "id": "review-...", "kind": "review", "addedOn": "...", "availableOn": "...",
                  "genre": "...", "title": "...", "source": "... https://www.youtube.com/watch?v=...",
                  "sourceUrl": "...", "text": "...", "author": {"name":"...","role":"..."},
                  "keyTerms": [...], "takeaway": {"hook":"...","detail":"..."},
                  "questions": [3問], "brief": { ブリーフから claim/highlights/speaker/videoUrl を転記 } } ] }
```

### 3-3. 検査して届ける

```bash
node qa/insight-lint.js private-imports/review-<target_date>.json
set -a; . .sokugan-private.env; set +a
node tools/publish-private-youtube.js private-imports/review-<target_date>.json
```

リンターが1本でも落ちたら、**その本文を書き直してから**届ける。Supabaseへ入れば、次にアプリを開いた時点で同期される。

---

## 4. 執筆（ビッグイシュー2本）

各450〜650字、「事実→構造→含意」、常体、翻訳調禁止、数字は算用数字。
**復習3本と同じ変換の型・同じリンター（`qa/insight-lint.js`）が日次にもかかる**（A20）。

**2本の本文で、同じ言い回しを使い回さない**（A21）。以前は10本すべての末尾に同じ一般論が付いていた。

**タイトル（ここが読むかどうかを決める）**

タイトルの仕事は要約ではない。**具体的な事実を1つ置き、その事実が持つ意外な含意を同じ一文に収める**こと。

- 18〜36字。1文。読点は最大1つ
- 主語と述語が1組で対応する。ねじれ・主語の消失・修飾の宙づりを作らない
- **数量は日本語として読める形に**。1万以上は万・億（桁区切りの生数字を置かない）
- 未知の固有名詞は1つまで。2つ以上並ぶと読む前に降りられる
- 抽象名詞（〜こと／〜化／〜性／〜という点）で終わらない。助詞で終わらない
- 「AではなくB」「AよりB」の比較構文を型として使い回さない

**人名は本文ではカタカナで書く**。ラテン文字の姓名は1つの長いチャンクになり、速読の訓練にならない（A10c2/A10d）。
`author.name` には原綴を残してよい。

各パッセージに付けるもの:
- `kind: "issue"` と `addedOn`（＝target_date）。一覧を新しい順に並べるための鍵（A2b）
- `author`: `{name, role}` 必須（A19）
- `questions` 3問（アプリが出すのは2問）。`Take-away:` → `Strong evidence:` → `Scenario:`
  - 4択・単独最長=正解禁止・rationale 50〜90字・選択肢はすべて自然な日本語
- `keyTerms` 2〜3語: `{term, plain, lures:[3]}`。**plainは12歳にわかる説明15字以上**
- `takeaway`: `{hook, detail}`。hookは10〜70字の言い切り

`chunks` は書かない（アプリが自動生成）。

## 5. 書き込み
既存 `daily-content.json` を `archive/{既存date}.json` へ退避してから上書きする。

## 6. 明快さ自己監査 → clarity-audit.json（必須）
全6問を自分で解き、①一読で分かる ②論理が一意 ③選択肢が具体的 ④日本語が自然で根拠記事に忠実 を1〜5で採点。
4未満は平易に書き直す。`{date, status, checked_at, auditor, avgScore, total, rewritten, items, rubric}` を出力。
全問≥3かつavg≥4で `pass`（偽装禁止）。

## 7. QA → 公開
```bash
node qa/harness.js --write-report --note "daily: $(TZ=Asia/Tokyo date +%F)"
```
**全PASS（終了コード0）になるまで完了しない。** チャンク破損は `node qa/repair-chunks.js`。
全PASS後にのみ:
```bash
git add -A && git commit -m "daily: $(TZ=Asia/Tokyo date +%F)" && git push origin main && git push production main
```

## 8. 報告
target_date（当日/翌日の理由）／ビッグイシュー2本のタイトル・genre・出典・種類／復習3本のタイトルと元ノート（ハイライト有無）／archive重複検査／リンター結果／clarity avg／ハーネス PASS数／公開結果。
