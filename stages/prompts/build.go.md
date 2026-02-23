# Build Stage — Go

## Purpose

Implement the planned work in a Go codebase. Produce idiomatic, tested Go that compiles cleanly across all packages, passes `go vet`, and follows project conventions.

## Go-Specific Guidance

### Idiomatic Go

- **Error handling is explicit**: Return `(T, error)` from fallible functions. Check every error — never `_`.
- **Interfaces are implicit**: Keep interfaces small (1–3 methods). Define them where they're consumed, not where they're implemented.
- **goroutines need ownership clarity**: Document who owns cleanup. Use `context.Context` for cancellation.
- **Avoid global state**: Use dependency injection via struct fields or function parameters.

### Package Organization

- One concept per package. Avoid `util`, `common`, `helpers` packages — name by what they provide.
- `internal/` packages are unexported. Use them for implementation details.
- `cmd/` contains main packages (entry points). Keep them thin — delegate to library packages.

### Testing

- Tests live in `_test.go` files. Use `package foo_test` for black-box tests.
- Table-driven tests are idiomatic: `tests := []struct{ name, input, want string }{ ... }`.
- Use `t.Helper()` in test helper functions.
- `go test -race ./...` — run with race detector before marking done.

### Common Pitfalls

- **Shadowing `err`**: `err :=` vs `err =` — be explicit about whether you're creating or assigning.
- **Goroutine leaks**: Goroutines without a shutdown path leak. Use `context.Context` cancellation.
- **nil interface vs nil value**: An interface holding a nil pointer is not nil. Explicit `return nil, err` patterns avoid this.
- **init() functions**: Avoid them — they run at import time and make testing hard.

## Process

### Step 1: Verify Prerequisites

1. Read the implementation plan — understand scope
2. Run `go build ./...` to confirm baseline compiles
3. Run `go test ./...` — all existing tests should pass
4. Check `go.mod` for module name and dependencies

### Step 2: Implement

1. **Write tests first** for new functions
2. Implement following existing patterns
3. Run `go vet ./...` after each meaningful change
4. Run `go test ./...` continuously

### Step 3: Build Verification Checklist

Before finalizing:

- [ ] `go build ./...` exits 0
- [ ] `go vet ./...` exits 0
- [ ] `go test ./...` — all tests pass
- [ ] `go test -race ./...` — no race conditions detected
- [ ] All errors are handled (no `_` for error values)
- [ ] Public functions and types have doc comments

### Step 4: Document

Produce a `build-output` artifact:

```markdown
# Build Output: [Session/Task Name]

## What Was Built
- [Package/Component]: [Description]

## Files Created/Modified
- `pkg/path/file.go` — [What it does]
- `pkg/path/file_test.go` — [What these tests cover]

## Tests
- [X] tests passing (`go test ./...`)

## Build Verification
- `go build ./...`: ✓
- `go vet ./...`: ✓
- `go test ./...`: ✓

## Acceptance Criteria Status
- [x] [Criterion 1]

## Architecture Decisions
- [Decision]: [Rationale]

## Deferred Work
- [Item]: [Why deferred]
```

## Suggested Resources

**Tools**
- go build: Compile all packages — `go build ./...`
- go vet: Static analysis — `go vet ./...`
- go test: Run the test suite — `go test ./...`
