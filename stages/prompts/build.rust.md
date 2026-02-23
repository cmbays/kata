# Build Stage — Rust

## Purpose

Implement the planned work in a Rust codebase. Produce safe, idiomatic Rust that compiles cleanly in release mode, passes all tests, and satisfies Clippy without suppressed warnings.

## Rust-Specific Guidance

### Ownership & Borrowing

- If you find yourself fighting the borrow checker, step back — the design may need adjustment. Common solutions:
  - Clone when performance isn't critical and simplicity matters
  - Use `Arc<Mutex<T>>` for shared mutable state across threads
  - Restructure to avoid holding borrows across await points in async code
- Prefer `&str` over `&String` in function parameters; prefer `&[T]` over `&Vec<T>`.

### Error Handling

- Use `?` for propagation. Return `Result<T, E>` from fallible functions.
- Define domain-specific error types with `thiserror` (not `Box<dyn Error>` in library code).
- For CLI/binary code, `anyhow::Result` is acceptable.
- Never silently swallow errors with `let _ = fallible_call();` — log or propagate.

### Async

- Use `tokio` or the project's established async runtime — don't mix runtimes.
- Avoid `block_on` inside async contexts.
- Spawn tasks for CPU-heavy work (`tokio::task::spawn_blocking`).

### Common Pitfalls

- **`unwrap()` in production code**: Replace with `?` or explicit error handling. `unwrap()` is OK in tests.
- **Clippy warnings**: Run `cargo clippy -- -D warnings`. Treat all warnings as errors.
- **Lifetime annotations**: If you need explicit lifetimes, add a comment explaining the constraint.
- **Feature flags**: Don't introduce new feature flags without updating `Cargo.toml` and documentation.

## Process

### Step 1: Verify Prerequisites

1. Read the implementation plan — understand scope
2. Run `cargo build` to confirm baseline compiles
3. Run `cargo test` — all existing tests should pass
4. Check `Cargo.toml` for workspace structure and feature flags

### Step 2: Implement

1. **Write tests first** where feasible (unit tests inline with `#[cfg(test)]`)
2. Implement following existing patterns
3. Run `cargo clippy -- -D warnings` after each meaningful change
4. Run `cargo test` continuously

### Step 3: Build Verification Checklist

Before finalizing:

- [ ] `cargo build --release` exits 0
- [ ] `cargo test` — all tests pass
- [ ] `cargo clippy -- -D warnings` exits 0 (no suppressed warnings without justification)
- [ ] No `unwrap()` in non-test code without a safety comment
- [ ] `unsafe` blocks (if any) have a `// SAFETY:` comment
- [ ] Public API items have doc comments (`///`)

### Step 4: Document

Produce a `build-output` artifact:

```markdown
# Build Output: [Session/Task Name]

## What Was Built
- [Component]: [Description]

## Files Created/Modified
- `src/path/to/file.rs` — [What it does]

## Tests
- [X] tests passing (`cargo test`)

## Build Verification
- `cargo build --release`: ✓
- `cargo clippy -- -D warnings`: ✓
- `cargo test`: ✓

## Acceptance Criteria Status
- [x] [Criterion 1]

## Architecture Decisions
- [Decision]: [Rationale]

## Deferred Work
- [Item]: [Why deferred]
```

## Suggested Resources

**Tools**
- cargo build: Compile the project — `cargo build --release`
- cargo test: Run the test suite — `cargo test`
- cargo clippy: Lint for common mistakes — `cargo clippy -- -D warnings`

**Agents** (spawn when appropriate using the Task tool)
- everything-claude-code:build-error-resolver — when cargo build fails or compilation errors occur
