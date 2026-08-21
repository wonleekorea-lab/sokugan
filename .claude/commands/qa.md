---
description: 教材を監督（自分で解いて検証・書き直し）しQA合格させて公開する
---

あなたは **SOKUGAN 3.0 の品質監督者**。Wonが翌朝、壊れた・分かりにくい教材に当たるのを防ぐ最後の砦。**CLAUDE.md の絶対ルールに従うこと。**

## 1. 機械検査
```bash
node qa/harness.js --write-report --note "qa: $(TZ=Asia/Tokyo date +%F)"
```
全PASSなら3へ。FAILがあれば2へ。

## 2. 修復
- チャンク系(A7-A10,B5,B6) → `node qa/repair-chunks.js`
- genre欠落/科学混入(A3/A3b) → ビジネス系ジャンルへ本文ごと書き換え
- AI偏重(A14) → AI中心の記事をWebSearchで非AIの旬な話題に差し替え（本文＋設問＋keyTerms＋takeawayを新規作成）
- keyTerms/takeaway欠落(E1/E2) → 本文から作成
- 設問形式・明快さ(A5/A6/A6b) → 平易に書き直し
- UI描画系(B/C/E4-E6)でコンテンツが正常 → **index.htmlは触らず** notesに申し送り

修復前に `archive/` へバックアップ。再検査し、全PASSまで最大3周。

## 3. 精読監査（毎回必須・機械では測れない部分）
- **観点A**: 全15問を本文だけを根拠に自力で解く。解けない/曖昧/正解キー誤りは書き直す。
- **観点B**: タイトル・本文・設問が一読で分かる自然な日本語か。翻訳調・漢数字の数量表記は修正。
- **観点B-2**: 明快さを1問ずつ1〜5で採点し **clarity-audit.json を必ず更新**（全問≥3かつavg≥4でpass。D系ゲートが検査）。
- **観点C**: 「誰かに話したくなる読み応え」があるか。凡庸なら差し替え。
- **観点D**: keyTermsのplainが本当に12歳に通じるか、takeawayのhookが雑談で使える鋭さか。凡庸なら磨き直す。

## 4. チャンク抜き取り
1〜2本を `chunkText` に通し、語中で切れていないか目視。異常があれば**チャンカーのバグ**としてnotesに記録（index.htmlは改変しない）。

## 5. 公開
全PASS＋精読監査合格後のみ:
```bash
git add -A && git commit -m "qa: $(TZ=Asia/Tokyo date +%F)" && git push origin main
```
変更が無ければpush不要。**FAILが残る状態では絶対にpushしない。**

## 6. 報告
ハーネスPASS数／修復内容／観点A正答数・書換数／clarity avg・書換数／観点C AI本数・差替／観点D 磨き直し数／公開結果／残存問題。
