# Review Stage — Security

## Purpose

Perform a structured security review of the codebase or feature. Identify vulnerabilities, check dependency advisories, verify secrets handling, and produce a `security-report` artifact with prioritized findings and remediations.

## OWASP Top 10 Checklist

Work through each category systematically:

### A01: Broken Access Control
- [ ] Every endpoint verifies the caller owns/can access the requested resource (IDOR check)
- [ ] Admin-only endpoints are protected by role checks, not just authentication
- [ ] Directory traversal is prevented (no user-controlled paths used with `fs` operations)

### A02: Cryptographic Failures
- [ ] Sensitive data (passwords, tokens, PII) is encrypted at rest
- [ ] HTTPS-only — no HTTP fallbacks for sensitive endpoints
- [ ] Passwords are hashed with bcrypt/argon2/scrypt (never SHA256, never MD5)
- [ ] Secrets are never logged or included in error messages

### A03: Injection
- [ ] SQL queries use parameterized statements or an ORM — never string concatenation
- [ ] Shell commands don't incorporate user input (command injection)
- [ ] Template engines escape output by default (XSS via templates)
- [ ] XML/YAML parsing has entity expansion disabled (XXE)

### A04: Insecure Design
- [ ] No business logic bypasses (e.g., price = user-supplied value)
- [ ] Sensitive workflows have rate limiting (login, password reset, OTP)
- [ ] Sensitive operations require re-authentication (delete account, change email)

### A05: Security Misconfiguration
- [ ] No debug mode or verbose errors in production
- [ ] CORS is restricted to known origins (not `*`)
- [ ] Security headers are set (CSP, X-Frame-Options, HSTS)
- [ ] Default credentials changed, unused features disabled

### A06: Vulnerable and Outdated Components
- [ ] Dependency audit run (`npm audit`, `cargo audit`, `pip-audit`, `govulncheck`)
- [ ] Critical/high severity findings addressed or documented with justification

### A07: Identification and Authentication Failures
- [ ] Session tokens are random, long, and invalidated on logout
- [ ] Password reset links are single-use and time-limited
- [ ] Multi-factor authentication available for sensitive accounts
- [ ] Account lockout after repeated failures

### A08: Software and Data Integrity Failures
- [ ] Dependencies are pinned with lockfiles committed
- [ ] CI verifies lockfile integrity (not just "npm install")
- [ ] Deserialization of untrusted data is avoided or hardened

### A09: Security Logging and Monitoring Failures
- [ ] Auth failures are logged (with timestamp, IP, user)
- [ ] Logs don't contain passwords, tokens, or PII
- [ ] Alerts exist for suspicious patterns (brute force, unusual access times)

### A10: Server-Side Request Forgery (SSRF)
- [ ] User-supplied URLs are validated against an allowlist before fetching
- [ ] Internal metadata endpoints (169.254.169.254, etc.) are blocked

## Secrets & Credentials

- [ ] No hardcoded secrets, API keys, or passwords in source code
- [ ] `.env` files are gitignored
- [ ] Secrets are loaded from environment variables or a secrets manager
- [ ] Check git history for accidentally committed secrets (`git log -p | grep -i 'api_key\|secret\|password'`)

## Dependency Audit

Run the appropriate tool for the project's ecosystem:

```bash
# Node.js
npm audit --audit-level=moderate

# Rust
cargo audit

# Python
pip-audit

# Go
govulncheck ./...
```

Document all findings, even if accepted. Provide justification for any "accepted" risks.

## Output Format

Produce a `security-report` artifact at `.kata/artifacts/security-report.md`:

```markdown
# Security Report: [Feature/Component Name]

## Executive Summary
[2–3 sentences on overall security posture and most critical findings]

## Scope
[What was reviewed — files, endpoints, features]

## Findings

### Critical (fix before merge)
- **[OWASP Category]** [Title]: [Description]
  - **Location**: `src/path/to/file.ts:42`
  - **Remediation**: [Specific fix]

### High
- [Same format]

### Medium
- [Same format]

### Low / Informational
- [Same format]

## Dependency Audit Results
- Tool used: `npm audit --audit-level=moderate`
- Critical: [N]
- High: [N]
- Accepted risks: [List with justification]

## Secrets Scan
- [ ] No hardcoded secrets found
- [ ] Git history clean

## Recommendations
1. [Priority 1 action]
2. [Priority 2 action]

## Accepted Risks
| Finding | Justification | Owner | Review Date |
|---------|--------------|-------|-------------|
```

## Suggested Resources

**Tools**
- npm audit: Scan npm dependencies — `npm audit --audit-level=moderate`
- cargo audit: Scan Rust dependencies — `cargo audit`

**Agents** (spawn when appropriate using the Task tool)
- everything-claude-code:security-reviewer — for deep OWASP analysis and vulnerability detection

**Skills** (invoke when appropriate using the Skill tool)
- everything-claude-code:security-review — for comprehensive security checklist and patterns
