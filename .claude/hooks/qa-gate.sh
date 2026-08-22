#!/bin/bash
# SOKUGAN QAゲート
# git push が実行される直前に QAハーネスを走らせ、不合格なら push を拒否する。
# CLAUDE.md 絶対ルール1「QA全PASSでなければ公開しない」を機械的に強制する装置。
#
# 重要: PreToolUse フックは matcher で「ツール名」しか絞り込めない。
# コマンド内容による絞り込みは、このスクリプト自身が stdin のJSONを見て行う。
# （そうしないと全部の Bash 呼び出しでQAハーネスが走ってしまう）

# --- 1. stdin のツール入力を読み、git push 以外は素通りさせる ---
PAYLOAD=$(cat)
CMD=$(printf '%s' "$PAYLOAD" | jq -r '.tool_input.command // ""' 2>/dev/null)
[ -z "$CMD" ] && CMD="$PAYLOAD"                      # jqが無い/形が違う場合は生文字列で判定
printf '%s' "$CMD" | grep -q 'git[[:space:]]\+push' || exit 0

PROJ="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$PROJ" || exit 0
[ -f qa/harness.js ] || exit 0                        # ハーネスが無い環境では素通り

# --- 2. node を探す（フックのPATHは対話シェルより狭いことがある） ---
NODE=$(command -v node 2>/dev/null)
if [ -z "$NODE" ]; then
  for c in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.local/bin/node" \
           "$HOME/.volta/bin/node" "$HOME/.nvm/versions/node"/*/bin/node; do
    [ -x "$c" ] && NODE="$c" && break
  done
fi

if [ -z "$NODE" ]; then
  echo "公開(push)を中止しました。理由: QAハーネスが「不合格」だからではなく、【実行できていない】からです。" >&2
  echo "このMacに Node.js が入っていないため node qa/harness.js が動きません。" >&2
  echo "QA未実行のまま公開すると CLAUDE.md 絶対ルール1に違反するため、ゲートは push を止めます。" >&2
  echo "対処: Node.js を導入してから再実行してください（導入後は自動でQAが走ります）。" >&2
  exit 2
fi

# --- 3. QAハーネス実行。不合格なら push を拒否 ---
OUT=$("$NODE" qa/harness.js 2>&1)
STATUS=$?
[ $STATUS -eq 0 ] && exit 0                           # 全PASS → 通常の許可フローへ

SUMMARY=$(printf '%s\n' "$OUT" | grep -E '^=+ QA' | tail -1)
FAILS=$(printf '%s\n' "$OUT" | grep '^FAIL' | head -6)
[ -z "$FAILS" ] && FAILS=$(printf '%s\n' "$OUT" | tail -6)   # FAIL行が無い異常終了時

echo "QAハーネスが不合格のため公開(push)を中止しました。${SUMMARY}" >&2
echo "先に以下を修正し、node qa/harness.js が終了コード0になってから push してください:" >&2
printf '%s\n' "$FAILS" >&2
exit 2
