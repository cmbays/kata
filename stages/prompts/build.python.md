# Build Stage — Python

## Purpose

Implement the planned work in a Python codebase. Produce tested, type-annotated Python that passes the test suite, linter, and type checker. Follow the project's packaging conventions.

## Python-Specific Guidance

### Type Annotations

- All function signatures should have type annotations (parameters and return type).
- Use `from __future__ import annotations` for forward references in older Python versions.
- Prefer specific types over `Any`. Use `Union[A, B]` (or `A | B` in Python 3.10+) for alternatives.
- Use `TypedDict` for structured dict types; use `dataclass` or `pydantic.BaseModel` for domain objects.

### Error Handling

- Raise specific, narrow exception types — not bare `Exception`.
- Catch specific exceptions — not bare `except:` or `except Exception:`.
- Use `contextlib.suppress()` only when truly intentional suppression is needed.
- Define domain exception classes in a dedicated `exceptions.py` module.

### Testing

- Use `pytest` with fixtures for shared setup.
- Use `pytest.mark.parametrize` for table-driven tests.
- Mock at the boundary (I/O, HTTP, time) — not inside domain logic.
- Aim for 80%+ coverage on new code.

### Common Pitfalls

- **Mutable default arguments**: `def f(items=[])` is a classic bug. Use `None` as default and initialize inside.
- **Global state**: Avoid module-level mutable state. Use dependency injection.
- **Import cycles**: Python resolves these at runtime in ways that can silently break. Restructure if imports feel circular.
- **`__init__.py` exports**: Keep them explicit — don't export everything with `*`.

## Process

### Step 1: Verify Prerequisites

1. Read the implementation plan — understand scope
2. Activate the project's virtual environment (`.venv`, `poetry shell`, `pipenv shell`, etc.)
3. Run `python -m pytest` to confirm existing tests pass
4. Check `pyproject.toml` or `setup.cfg` for project structure

### Step 2: Implement

1. **Write tests first** where feasible
2. Implement following existing patterns
3. Run `ruff check .` or `flake8` after each meaningful change
4. Run `python -m pytest` continuously

### Step 3: Build Verification Checklist

Before finalizing:

- [ ] `python -m pytest` — all tests pass
- [ ] `ruff check .` (or `flake8`) — no lint errors
- [ ] `mypy .` — no type errors (or project-configured equivalent)
- [ ] No bare `except:` clauses
- [ ] No mutable default arguments
- [ ] All public functions/methods have type annotations and docstrings

### Step 4: Document

Produce a `build-output` artifact:

```markdown
# Build Output: [Session/Task Name]

## What Was Built
- [Module/Component]: [Description]

## Files Created/Modified
- `src/path/module.py` — [What it does]
- `tests/test_module.py` — [What these tests cover]

## Tests
- [X] tests passing (`python -m pytest`)
- Coverage: [X]%

## Build Verification
- `python -m pytest`: ✓
- `ruff check .`: ✓
- `mypy .`: ✓ (or N/A — not configured)

## Acceptance Criteria Status
- [x] [Criterion 1]

## Architecture Decisions
- [Decision]: [Rationale]

## Deferred Work
- [Item]: [Why deferred]
```

## Suggested Resources

**Tools**
- pytest: Run the test suite — `python -m pytest`
- ruff: Fast linting and formatting — `ruff check . && ruff format --check .`
- mypy: Static type checking — `mypy .`
