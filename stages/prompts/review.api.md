# Review Stage — API

## Purpose

Review the API implementation for correctness, security, contract completeness, and long-term maintainability. Produce a structured `api-review` artifact covering all critical dimensions.

## Review Dimensions

### 1. Endpoint Contracts

For each endpoint, verify:

- **URL structure**: RESTful naming (`/resources/{id}` not `/getResource?id=`)
- **HTTP methods**: Correct verb semantics (GET is safe/idempotent, POST creates, PUT replaces, PATCH updates)
- **Status codes**: Correct codes for all outcomes (200, 201, 204, 400, 401, 403, 404, 409, 422, 500)
- **Consistency**: Same patterns across all endpoints (error shapes, pagination, filtering)

### 2. Authentication & Authorization

- [ ] Authentication is required on all non-public endpoints
- [ ] Auth tokens are validated on every request (not just at login)
- [ ] Authorization checks verify the caller owns/can access the resource (not just "is logged in")
- [ ] No sensitive data in URLs (tokens, passwords — use headers or body)
- [ ] Rate limiting is in place for sensitive endpoints

### 3. Input Validation

- [ ] All user-supplied input is validated before use
- [ ] Validation happens at the boundary (not deep in business logic)
- [ ] Error messages are informative but don't leak internals
- [ ] File uploads (if any) validate type, size, and filename
- [ ] Numeric inputs have min/max bounds

### 4. Error Responses

- [ ] Consistent error schema across all endpoints: `{ "error": "...", "code": "..." }`
- [ ] No stack traces or internal paths in error responses
- [ ] Validation errors identify which field failed and why
- [ ] 4xx vs 5xx is used correctly (4xx = client's fault, 5xx = server's fault)

### 5. Schema Completeness

- [ ] Request bodies have complete type definitions (TypeScript types, Zod schemas, OpenAPI spec, Pydantic models, etc.)
- [ ] Response types are fully defined — no `any` or untyped returns
- [ ] Optional fields are explicitly marked as optional
- [ ] Enum values are exhaustive and documented

### 6. API Design Patterns

- [ ] Pagination is consistent (cursor-based or offset, not mixed)
- [ ] Filtering and sorting are consistent across list endpoints
- [ ] Versioning strategy is clear (URL prefix, header, or content negotiation)
- [ ] Breaking changes are flagged

## Common API Pitfalls

- **IDOR** (Insecure Direct Object Reference): Endpoint fetches `/users/123` without checking the caller owns user 123
- **Mass assignment**: Creating/updating records by spreading user input directly onto the model
- **Verbose errors in prod**: Stack traces help attackers understand your architecture
- **Missing idempotency**: Retried POST requests create duplicate resources (use idempotency keys for payments, etc.)
- **Timing attacks on auth**: Use constant-time comparison for tokens

## Output Format

Produce a `api-review` artifact at `.kata/artifacts/review-api.md`:

```markdown
# API Review: [Feature/Component Name]

## Summary
[2–3 sentence overview of findings]

## Endpoint Inventory
| Method | Path | Auth Required | Status |
|--------|------|---------------|--------|
| GET    | /... | Yes           | ✓ OK   |

## Findings

### Critical
- [Finding]: [Description and remediation]

### Major
- [Finding]: [Description and remediation]

### Minor / Suggestions
- [Finding]: [Description]

## Schema Assessment
[Are request/response types complete and correct?]

## Authorization Assessment
[Is auth correct for all endpoints?]

## Recommendations
- [Priority action 1]
- [Priority action 2]
```

## Suggested Resources

**Agents** (spawn when appropriate using the Task tool)
- everything-claude-code:security-reviewer — when reviewing authentication or user input handling

**Skills** (invoke when appropriate using the Skill tool)
- pr-review-toolkit:type-design-analyzer — when evaluating request/response type design
