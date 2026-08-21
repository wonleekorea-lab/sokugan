#!/bin/bash
# SOKUGAN — Claude Code ヘッドレス実行（launchd等から呼ぶ用）
# 使い方: ./scripts/run-claude.sh daily   /   ./scripts/run-claude.sh qa
set -euo pipefail
CMD="${1:-qa}"
PROJ="$HOME/Documents/reading-trainer"
LOG="$PROJ/logs"; mkdir -p "$LOG"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
cd "$PROJ"
echo "=== $(date '+%F %T') /$CMD 開始 ===" >> "$LOG/$CMD.log"
claude -p "/$CMD" --permission-mode acceptEdits >> "$LOG/$CMD.log" 2>&1
echo "=== $(date '+%F %T') /$CMD 終了 (exit $?) ===" >> "$LOG/$CMD.log"
