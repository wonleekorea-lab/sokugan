#!/bin/bash
# SOKUGAN QAゲート
# git push が実行される直前に QAハーネスを走らせ、不合格なら push を拒否する。
# CLAUDE.md 絶対ルール1「QA全PASSでなければ公開しない」を機械的に強制する装置。
PROJ="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$PROJ" || exit 0
[ -f qa/harness.js ] || exit 0        # ハーネスが無い環境では素通り

OUT=$(node qa/harness.js 2>&1)
if [ $? -eq 0 ]; then
  exit 0                              # 全PASS → 通常の許可フローへ
fi

FAILS=$(printf '%s\n' "$OUT" | grep '^FAIL' | head -6)
SUMMARY=$(printf '%s\n' "$OUT" | grep -E '^=+ QA' | tail -1)
node -e '
const fails = process.argv[1] || "(詳細不明)";
const summary = process.argv[2] || "";
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason:
      "QAハーネスが不合格のため公開(push)を中止しました。" + summary + "\n" +
      "先に以下を修正し、node qa/harness.js が終了コード0になってから push してください:\n" + fails
  }
}));
' "$FAILS" "$SUMMARY"
