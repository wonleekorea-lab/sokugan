# SOKUGAN — エージェント運用規約

このファイルは Codex（CLI / Cloud / launchd無人実行）向け。
**ドメイン規約・教材の質の基準・設計の根拠は `CLAUDE.md` が正本**。作業前に必ず全文を読む。ここには重複させない。

## 目的

日本語速読トレーニングアプリの教材と実装を、品質を落とさずに毎日更新し続けること。
壊れた教材が配信されないことが、更新が滞らないことより常に優先する。

## 絶対にやらないこと

- **QAハーネス不合格のまま公開（push）する**。`node qa/harness.js` の終了コード0が唯一の合格条件。偽装PASS・検査の書き換えによる通過は禁止。
- **`force push` / `git reset --hard` / ブランチ削除 / 履歴の書き換え**。
- **他者の未コミット変更を上書きする**。作業ツリーに差分があれば、消さずに退避してから進める。
- **`chunks` を自分で書く**。`index.html` 内の決定論チャンカーが生成する（CLAUDE.md 絶対ルール2）。
- **秘密情報をリポジトリに置く**。`.gitignore` は許可リスト方式で、既定は全無視。`厳秘_*` や `private-imports/` を追跡対象に加えてはならない。`sokugan-config.js` に置けるのは anon key だけ。
- **`.github/workflows/` の cron やゲートを、失敗を回避する目的で緩める**。
- **QA不合格のものを `production`（公開リポジトリ）へ push する**。`production` は出口専用で、そこで作業しない。

## 止まって人間に渡す条件

次に当たったら、推測で進めずに原因と必要な人間操作を明示して終了する。

- 認証で失敗した（push権限、`CLAUDE_CODE_OAUTH_TOKEN`、Supabase）。
- `git pull --rebase` が衝突した。
- QAハーネスが同じ項目で2回修正しても通らない。
- 教材10本の要件（5系統×2本、AI中心2本以下、archive30日と重複なし）を満たす素材が集まらない。

## リポジトリは2つある

| remote | リポジトリ | 公開性 | 役割 |
|---|---|---|---|
| `origin` | `sokugan-workspace` | PRIVATE | 作業の正本 |
| `production` | `sokugan` | PUBLIC | 公開専用（`main` 直下が GitHub Pages） |

公開の順序は **`origin` → QAハーネス合格 → `production`**。詳細は `CLAUDE.md`。

## 実行環境ごとの前提

| 環境 | 主体 | 公開まで到達できるか |
|---|---|---|
| launchd 無人実行 | `codex exec`（`~/.codex/launchd/`） | **できる（現在の日次担当）**。両remoteへpush可 |
| GitHub Actions | `anthropics/claude-code-action` | **できない**。cron停止中。`GITHUB_TOKEN` がリポジトリを跨げない |
| Codex Cloud | クラウドコンテナ | `origin` まで。依存ゼロなので setup script 不要 |
| 対話 | Codex CLI / Claude Code | `.claude/commands/` のコマンドに従う |

いずれの環境でも、作業の起点は **`origin/main` の最新**。古いローカルの上に実装を重ねない。
