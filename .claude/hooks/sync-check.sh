#!/bin/bash
# セッション開始時にリモート(GitHub)との差分を確認する。
# 毎日18:00/19:00にGitHub Actionsがmainを更新するため、ローカルは放置すると古くなる。
# 作業ツリーがきれいな場合のみ自動でpullし、変更がある場合は警告だけ出す（勝手に触らない）。
PROJ="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$PROJ" || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

# macOSには timeout が無い（GNU coreutils未導入）。あれば使い、無ければ素で叩く。
# ここを timeout 固定にすると常に127で失敗し、同期確認が黙って死ぬ。
if command -v timeout >/dev/null 2>&1; then TO="timeout 20"
elif command -v gtimeout >/dev/null 2>&1; then TO="gtimeout 20"
else TO=""; fi
$TO git fetch --quiet origin main 2>/dev/null || { echo "（GitHubに接続できず同期確認をスキップ）"; exit 0; }

BEHIND=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)
AHEAD=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)
DIRTY=$(git status --porcelain | wc -l | tr -d ' ')

if [ "$BEHIND" = "0" ] && [ "$AHEAD" = "0" ]; then
  [ "$DIRTY" != "0" ] && echo "ℹ️ 未コミットの変更が ${DIRTY} 件あります。"
  exit 0
fi

if [ "$BEHIND" != "0" ] && [ "$DIRTY" = "0" ] && [ "$AHEAD" = "0" ]; then
  git pull --quiet --ff-only origin main 2>/dev/null \
    && echo "🔄 GitHubの最新 ${BEHIND} 件を取り込みました（毎日の教材更新分）。" \
    || echo "⚠️ リモートが ${BEHIND} 件進んでいます。git pull origin main を実行してください。"
  exit 0
fi

echo "⚠️ ローカルとGitHubがずれています（リモート先行 ${BEHIND} / ローカル先行 ${AHEAD} / 未コミット ${DIRTY}）。"
echo "   作業を始める前に整理してください（未コミット分をcommitしてから git pull --rebase origin main）。"
exit 0
