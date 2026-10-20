#!/usr/bin/env bash
# Run a codex (gpt-6.1-sol, xhigh, from ~/.codex/config.toml) job non-interactively.
# usage: tools/codex-run.sh <out.md> <prompt-file> [extra `codex exec` args, e.g. -i img.png]
#   The final message goes to <out.md>; the full log to <out>.log. Read-only sandbox by default.
#   For diff reviews use:  codex exec review --base <branch> "<instructions>"
set -euo pipefail
out=$1; prompt=$2; shift 2
cd "$(dirname "$0")/.."
codex exec -s read-only "$@" -o "$out" - < "$prompt" > "${out%.md}.log" 2>&1
