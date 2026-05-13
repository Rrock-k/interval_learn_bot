#!/usr/bin/env bash
# Claude/Codex Stop hook: remind agents to publish finished work.

set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

cat >/dev/null || true

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

branch="$(git branch --show-current 2>/dev/null || true)"
[ -n "$branch" ] || branch="detached"

dirty_count="$(git status --porcelain=v1 | wc -l | tr -d ' ')"
upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
ahead="0"
behind="0"

if [ -n "$upstream" ]; then
  counts="$(git rev-list --left-right --count HEAD..."$upstream" 2>/dev/null || true)"
  if [ -n "$counts" ]; then
    ahead="$(printf '%s' "$counts" | awk '{print $1}')"
    behind="$(printf '%s' "$counts" | awk '{print $2}')"
  fi
fi

if [ "$dirty_count" = "0" ] && [ -n "$upstream" ] && [ "$ahead" = "0" ]; then
  exit 0
fi

reason="[push-reminder] Local work is not fully published.

State:
- branch: $branch
- upstream: ${upstream:-none}
- uncommitted changes: $dirty_count
- unpushed commits: ${ahead:-0}
- upstream-only commits: ${behind:-0}

Before stopping, commit and push finished code when it is safe to publish.
If the remaining step is destructive or mutates external data (production DB, Railway env, data migrations/rewrite, deploy-time data operation), do not perform it automatically. Ask the user for explicit approval and state that push/publish is deferred pending consent."

REASON="$reason" node -e '
const reason = process.env.REASON || "";
console.log(JSON.stringify({
  continue: false,
  stopReason: "push reminder",
  systemMessage: reason,
  decision: "block",
  reason
}));
'
