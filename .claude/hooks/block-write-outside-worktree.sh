#!/bin/bash
# PreToolUse hook — block file mutations outside KATA_WORKTREE_PATH.
#
# Only activates when KATA_WORKTREE_PATH env var is set, which indicates
# the agent was launched with isolation:worktree. When active, any Edit,
# Write, or MultiEdit call targeting a path outside the worktree is denied.
# Bash commands that appear to write outside the worktree are also blocked
# on a best-effort basis (shell commands are opaque; we scan for common
# write-operation patterns combined with out-of-tree absolute paths).
#
# Known bypass vectors NOT caught by this hook:
#   - Relative paths after an out-of-tree `cd` (e.g. `cd /main && echo x > f`)
#   - Variable-expanded paths (e.g. OUT=/main/f; echo x > "$OUT")
#   - Writes via subshells, called scripts, or opaque binaries
# Full coverage requires OS-level sandboxing (e.g. macOS sandbox-exec).
# This hook catches the common, accidental cases agents actually hit.
#
# Input (stdin): JSON with keys:
#   .tool_name                       — "Edit", "Write", "MultiEdit", "Bash"
#   .tool_input.file_path            — for Edit and Write
#   .tool_input.edits[].file_path    — for MultiEdit
#   .tool_input.command              — for Bash
#
# Output: JSON with hookSpecificOutput.permissionDecision = "deny"
#         to block the call, or exit 0 with no output to allow it.
#
# Reference: https://docs.anthropic.com/en/docs/claude-code/hooks

# ── guard: only enforce when KATA_WORKTREE_PATH is set ────────────────────────
if [[ -z "$KATA_WORKTREE_PATH" ]]; then
  exit 0
fi

# Normalise the worktree root (remove trailing slash so prefix-matching works)
WORKTREE="${KATA_WORKTREE_PATH%/}"

# ── read stdin once ───────────────────────────────────────────────────────────
INPUT=$(cat /dev/stdin)
TOOL_NAME=$(printf '%s' "$INPUT" | jq -r '.tool_name // ""')

# ── helper: deny with a clear message ─────────────────────────────────────────
deny() {
  local path="$1"
  local reason
  reason="Blocked: path is outside the worktree. Attempted: ${path} | Allowed prefix: ${WORKTREE} | All file writes must stay within KATA_WORKTREE_PATH. If you need to modify a file in the main repo, do it from outside an agent run context."
  jq -n \
    --arg reason "$reason" \
    '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: $reason
      }
    }'
  exit 0
}

# ── helper: portable path resolution ─────────────────────────────────────────
# Tries realpath -m (GNU), then realpath (macOS BSD), then Python3 fallback.
# Only absolute paths are reliably detected — relative paths after an out-of-tree
# `cd` cannot be caught without shell-level introspection.
resolve_path() {
  local raw="$1"
  local resolved
  if resolved=$(realpath -m "$raw" 2>/dev/null); then
    printf '%s' "$resolved"
  elif resolved=$(realpath "$raw" 2>/dev/null); then
    printf '%s' "$resolved"
  elif resolved=$(python3 -c "import os,sys; print(os.path.realpath(sys.argv[1]))" "$raw" 2>/dev/null); then
    printf '%s' "$resolved"
  else
    printf '%s' "$raw"
  fi
}

# ── helper: test whether a path is inside the worktree ───────────────────────
# Returns 0 (true) when OUTSIDE, 1 (false) when inside.
is_outside_worktree() {
  local raw_path="$1"
  local resolved
  resolved=$(resolve_path "$raw_path")
  if [[ "$resolved" == "$WORKTREE" || "$resolved" == "$WORKTREE"/* ]]; then
    return 1  # inside — allow
  fi
  return 0  # outside — block
}

# ── Edit / Write ──────────────────────────────────────────────────────────────
if [[ "$TOOL_NAME" == "Edit" || "$TOOL_NAME" == "Write" ]]; then
  FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // ""')
  if [[ -n "$FILE_PATH" ]] && is_outside_worktree "$FILE_PATH"; then
    deny "$FILE_PATH"
  fi
  exit 0
fi

# ── MultiEdit ─────────────────────────────────────────────────────────────────
if [[ "$TOOL_NAME" == "MultiEdit" ]]; then
  # Collect all unique file paths from the edits array
  PATHS=$(printf '%s' "$INPUT" | jq -r '.tool_input.edits[]?.file_path // empty')
  while IFS= read -r p; do
    if [[ -n "$p" ]] && is_outside_worktree "$p"; then
      deny "$p"
    fi
  done <<< "$PATHS"
  exit 0
fi

# ── Bash (best-effort) ────────────────────────────────────────────────────────
# Bash commands are opaque — we cannot parse arbitrary shell reliably.
# We apply a heuristic: scan for common write-producing patterns that also
# contain a path string clearly outside the worktree.
#
# Patterns caught (write-indicating tokens):
#   - Redirection: > /path  or  >> /path
#   - tee, cp, mv, touch, mkdir, sed -i, truncate, dd, install
#   - ln (hard/soft links create filesystem entries)
#   - chmod, chown (metadata writes)
#
# Patterns NOT caught (known bypass vectors — see header):
#   - Relative paths after out-of-tree cd
#   - Variable-expanded paths (F="$OUT"; echo x > "$F")
#   - Writes via subshells or opaque binaries
#
# Read-only commands (cat, head, ls, grep, etc.) are never blocked.
if [[ "$TOOL_NAME" == "Bash" ]]; then
  COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // ""')

  # Extract candidate paths — anything that looks like an absolute path
  # starting with / and is NOT under WORKTREE.
  while IFS= read -r candidate; do
    [[ -z "$candidate" ]] && continue
    # Skip paths inside the worktree
    is_outside_worktree "$candidate" || continue

    # Check if a write-adjacent keyword appears near the path in the command.
    # We use a loose grep for write-indicating tokens in the overall command;
    # if a write token exists AND an out-of-tree absolute path exists, block.
    if printf '%s' "$COMMAND" | grep -qE \
        '(>>?|tee |cp |mv |touch |mkdir |ln |chmod |chown |sed -i|truncate |dd |install )'; then
      deny "$candidate"
    fi
  done < <(printf '%s' "$COMMAND" | grep -oE '/[A-Za-z0-9_/.\-]+' | sort -u)

  exit 0
fi

# All other tools: allow by default
exit 0
