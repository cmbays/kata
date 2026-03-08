#!/bin/bash
# PreToolUse hook — block file mutations outside the current git worktree.
#
# Activates when either:
#   (a) KATA_WORKTREE_PATH env var is set (explicit isolation path), OR
#   (b) The current directory is detected as a linked git worktree via
#       "git rev-parse --git-dir" — same detection as session-context.ts
#       detectWorktree(). Linked worktrees have --git-dir pointing into
#       .git/worktrees/<name>/ rather than returning ".git".
#
# When active, Edit/Write/MultiEdit calls targeting paths outside the worktree
# are denied. Bash commands are blocked on a best-effort heuristic (shell
# commands are opaque; only absolute paths are detected).
#
# Known bypass vectors NOT caught by this hook:
#   - Relative paths after an out-of-tree `cd` (e.g. `cd /main && echo x > f`)
#   - Variable-expanded paths (e.g. OUT=/main/f; echo x > "$OUT")
#   - Writes via subshells, called scripts, or opaque binaries
# Full coverage requires OS-level sandboxing (e.g. macOS sandbox-exec).
#
# Input (stdin): JSON with keys:
#   .tool_name                       — "Edit", "Write", "MultiEdit", "Bash"
#   .tool_input.file_path            — for Edit and Write
#   .tool_input.edits[].file_path    — for MultiEdit
#   .tool_input.command              — for Bash
#
# Output: JSON with hookSpecificOutput.permissionDecision = "deny" to block,
#         or exit 0 with no output to allow.
#
# Reference: https://docs.anthropic.com/en/docs/claude-code/hooks

# ── dependency check ──────────────────────────────────────────────────────────
# jq is required to parse tool input. If missing, deny all writes to be safe
# rather than silently allowing everything.
if ! command -v jq >/dev/null 2>&1; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"block-write-outside-worktree.sh: jq not found on PATH — cannot parse tool input; denying to be safe"}}\n'
  exit 0
fi

# ── helper: portable path resolution ─────────────────────────────────────────
# Tries realpath -m (GNU), then realpath (macOS BSD), then Python3 fallback.
# Falls back to the raw value when none are available.
# Only absolute paths are reliably normalized — relative paths after an
# out-of-tree `cd` cannot be caught without shell-level introspection.
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

# ── detect worktree ───────────────────────────────────────────────────────────
# KATA_WORKTREE_PATH takes precedence when set (future: kata will export it on
# agent dispatch via kata kiai context). When absent, fall back to git detection:
# a linked worktree has --git-dir pointing into .git/worktrees/<name>/, whereas
# the main worktree returns the relative string ".git".
if [[ -n "$KATA_WORKTREE_PATH" ]]; then
  # Canonicalize the explicit path so symlinks and .. are resolved before any
  # prefix-matching in is_outside_worktree()
  WORKTREE=$(resolve_path "${KATA_WORKTREE_PATH%/}")
else
  GIT_DIR=$(git rev-parse --git-dir 2>/dev/null) || exit 0
  # In a linked worktree: GIT_DIR is an absolute path containing "worktrees/"
  # In the main worktree: GIT_DIR is the relative string ".git"
  if [[ "$GIT_DIR" == ".git" || "$GIT_DIR" != *worktrees* ]]; then
    exit 0  # not in a linked worktree — hook is a no-op
  fi
  SHOW_TOP=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
  WORKTREE=$(resolve_path "$SHOW_TOP")
fi

[[ -z "$WORKTREE" ]] && exit 0

# ── read stdin once ───────────────────────────────────────────────────────────
INPUT=$(cat /dev/stdin)
TOOL_NAME=$(printf '%s' "$INPUT" | jq -r '.tool_name // ""')

# ── helper: deny with a clear message ────────────────────────────────────────
deny() {
  local path="$1"
  local reason
  reason="Blocked: path is outside the worktree. Attempted: ${path} | Allowed prefix: ${WORKTREE} | All file writes must stay within the worktree root. To modify main-repo files, do so from outside an agent run context."
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

# ── helper: test whether a path is outside the worktree ──────────────────────
# Returns 0 (true) when OUTSIDE, 1 (false) when inside.
is_outside_worktree() {
  local resolved
  resolved=$(resolve_path "$1")
  [[ "$resolved" == "$WORKTREE" || "$resolved" == "$WORKTREE"/* ]] && return 1
  return 0
}

# ── Edit / Write ──────────────────────────────────────────────────────────────
if [[ "$TOOL_NAME" == "Edit" || "$TOOL_NAME" == "Write" ]]; then
  FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // ""')
  [[ -n "$FILE_PATH" ]] && is_outside_worktree "$FILE_PATH" && deny "$FILE_PATH"
  exit 0
fi

# ── MultiEdit ─────────────────────────────────────────────────────────────────
if [[ "$TOOL_NAME" == "MultiEdit" ]]; then
  while IFS= read -r p; do
    [[ -n "$p" ]] && is_outside_worktree "$p" && deny "$p"
  done <<< "$(printf '%s' "$INPUT" | jq -r '.tool_input.edits[]?.file_path // empty')"
  exit 0
fi

# ── Bash (best-effort) ────────────────────────────────────────────────────────
# Shell commands are opaque — we cannot parse arbitrary shell reliably.
# Heuristic: scan for write-indicating tokens co-occurring with an absolute
# path that is outside the worktree.
#
# Tokens that indicate a write (and trigger blocking):
#   >>/>,  tee, cp, mv, touch, mkdir, ln, chmod, chown, sed -i, truncate,
#   dd, install
#
# NOT caught (known bypass vectors — see header comment):
#   - Relative paths after cd              e.g. cd /main && echo x > f
#   - Variable-expanded paths              e.g. F="$OUT"; echo x > "$F"
#   - Writes via subshells / opaque tools
#
# Read-only commands (cat, head, ls, grep…) are never blocked — reads are safe.
if [[ "$TOOL_NAME" == "Bash" ]]; then
  COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // ""')

  # Allow git-only commands (optionally preceded by env-var exports like
  # "export KATA_RUN_ID=...; git commit ..."). Git writes only to .git/
  # internals — branch names containing '/' are not filesystem paths.
  # Only bypasses when the remaining command after exports is a single git
  # invocation with no shell chaining (no ; && || |).
  _cmd_after_exports=$(printf '%s' "$COMMAND" \
    | sed -E 's/^([[:space:]]*(export [A-Za-z_][A-Za-z0-9_]*=[^;]*;[[:space:]]*)*)//')
  if printf '%s' "$_cmd_after_exports" | grep -qE '^git[[:space:]]' && \
     ! printf '%s' "$_cmd_after_exports" | grep -qE '[;&|]'; then
    exit 0
  fi

  while IFS= read -r candidate; do
    [[ -z "$candidate" ]] && continue
    # Exclude /dev/* — device files (e.g. /dev/null) are never real write targets
    [[ "$candidate" == /dev/* ]] && continue
    is_outside_worktree "$candidate" || continue
    # Write tokens: >> and > (but NOT >& which is fd duplication like 2>&1)
    if printf '%s' "$COMMAND" | grep -qE \
        '(>>|>[^&>]|tee |cp |mv |touch |mkdir |ln |chmod |chown |sed -i|truncate |dd |install )'; then
      deny "$candidate"
    fi
  done < <(printf '%s' "$COMMAND" | grep -oE '/[A-Za-z0-9_/.\-]+' | sort -u)
  exit 0
fi

# All other tools: allow by default
exit 0
