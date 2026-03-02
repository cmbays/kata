#!/bin/bash
# PreToolUse hook — block git commit to main when in a kata agent run.
#
# Claude Code sends tool input as JSON on stdin. We extract the command,
# check if it is a git commit on the main branch, and deny if KATA_RUN_ID
# is set (indicating an agent context spawned by SessionExecutionBridge).
#
# Returns a JSON permissionDecision so Claude Code surfaces the error.
# exit 0 (with no output or non-deny output) allows the command.

COMMAND=$(cat /dev/stdin | jq -r '.tool_input.command // ""')

# Only intercept git commit commands
if ! echo "$COMMAND" | grep -q 'git commit'; then
  exit 0
fi

# Only block when we are in an agent run context (KATA_RUN_ID is set)
if [[ -z "$KATA_RUN_ID" ]]; then
  exit 0
fi

# Check current branch
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
if [[ "$BRANCH" != "main" ]]; then
  exit 0
fi

# Block: agent is on main and trying to commit
RUN_PREFIX="${KATA_RUN_ID:0:8}"
jq -n \
  --arg reason "Kata agent: you are on the \`main\` branch. Commit to a feature branch instead.

Create one first:
  git checkout -b keiko-agent/${RUN_PREFIX}

Then re-run your commit. The sensei will merge via PR." \
  '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
