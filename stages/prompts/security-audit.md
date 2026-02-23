# Security Audit Stage

## Purpose

Find and remediate security vulnerabilities before they reach production. Systematically evaluate the build for OWASP Top 10 risks, dependency vulnerabilities, secrets exposure, and trust boundary violations. Produce a threat model and security findings that give the team an honest picture of the risk posture.

Security is not a checklist. It requires adversarial thinking: ask "how could an attacker abuse this?" at every surface.

## Expected Inputs

- **build-output** artifact from the Build stage
- Access to the code changes (diff/PR)
- Architecture documentation (trust boundaries, data flows)
- Dependency manifest (package.json, Cargo.toml, go.mod, etc.)

## Process

### Step 1: Understand the Attack Surface

Before reviewing code:

1. **Read the build-output artifact**: What changed? What new surfaces were added?
2. **Identify trust boundaries**: Where does data cross from untrusted to trusted contexts?
3. **Identify sensitive assets**: What data does this code handle? (credentials, PII, payment info, auth tokens)
4. **Map data flows**: Where does user input enter? Where does it leave? What transforms it?

The attack surface is everything a malicious actor could interact with. Enumerate it before auditing.

### Step 2: OWASP Top 10 Audit

Systematically check each category relevant to the changes:

#### A01 — Broken Access Control
- [ ] All endpoints require appropriate authentication
- [ ] Authorization is checked server-side, not just on the client
- [ ] Users cannot access other users' resources (IDOR)
- [ ] Privilege escalation paths are blocked
- [ ] Directory traversal is not possible via user-controlled file paths

#### A02 — Cryptographic Failures
- [ ] Sensitive data is encrypted at rest (PII, secrets, credentials)
- [ ] Sensitive data is encrypted in transit (TLS enforced, no plaintext fallback)
- [ ] Weak algorithms not used: no MD5, SHA1, DES, RC4
- [ ] Secret keys are not hardcoded or committed
- [ ] Random values use a cryptographically secure source

#### A03 — Injection
- [ ] SQL queries use parameterized statements or ORM
- [ ] Shell commands do not use user-controlled strings unsanitized
- [ ] LDAP, XPath, NoSQL queries are parameterized
- [ ] Template engines sanitize user input before render
- [ ] Log statements do not inject user-controlled data into log format strings

#### A04 — Insecure Design
- [ ] Security requirements were considered during design (not bolted on)
- [ ] Threat modeling was done for new features
- [ ] Rate limiting is in place for sensitive operations
- [ ] Multi-step workflows validate state at each step

#### A05 — Security Misconfiguration
- [ ] Default credentials are changed
- [ ] Unnecessary features/endpoints/ports are disabled
- [ ] Error messages do not leak stack traces or internal paths to users
- [ ] Security headers are set (CSP, HSTS, X-Frame-Options, etc.) for web surfaces
- [ ] Debug/development flags are off in production code paths

#### A06 — Vulnerable and Outdated Components
- [ ] `npm audit` / `cargo audit` / `govulncheck` run with no critical/high findings
- [ ] Dependencies are at reasonably current versions
- [ ] Known CVEs in transitive dependencies are assessed and mitigated
- [ ] Unpinned/floating version ranges are reviewed for risk

#### A07 — Identification and Authentication Failures
- [ ] Passwords are hashed with bcrypt, Argon2, or scrypt (not MD5/SHA)
- [ ] Session tokens have sufficient entropy
- [ ] Session tokens are invalidated on logout
- [ ] Account lockout or rate limiting exists for login attempts
- [ ] Sensitive flows require re-authentication

#### A08 — Software and Data Integrity Failures
- [ ] Deserialization of untrusted data is avoided or validated
- [ ] CI/CD pipeline cannot be manipulated by external contributors
- [ ] Third-party code is pinned to verified versions
- [ ] Auto-update mechanisms verify integrity before applying

#### A09 — Security Logging and Monitoring Failures
- [ ] Security-relevant events are logged (auth, access control failures, validation failures)
- [ ] Logs include enough context for forensics (timestamp, user, IP, action)
- [ ] Logs do not capture sensitive values (passwords, tokens, PII)
- [ ] Log injection (CRLF, format string) is not possible via user input

#### A10 — Server-Side Request Forgery (SSRF)
- [ ] URLs supplied by users are not fetched server-side without validation
- [ ] Outbound HTTP requests use an allowlist of destinations
- [ ] Metadata endpoints (e.g., cloud IMDS at 169.254.169.254) are blocked from user-controlled requests
- [ ] Redirects on outbound requests are limited or disabled

### Step 3: Secrets Detection

Scan for hardcoded secrets:

1. **Patterns to look for**: `password`, `secret`, `token`, `api_key`, `private_key`, `Bearer ` in string literals
2. **Check `.env.example`** — does it contain real values (it should not)?
3. **Check test files** — real credentials are often accidentally committed in test fixtures
4. **Verify `.gitignore`** — sensitive files (`.env`, `*.pem`, `*.key`) are excluded

If any secrets are found — even in test code or old commits — treat it as Critical. Rotate immediately.

### Step 4: Dependency Audit

Run the dependency scanner for the project's package manager:

```bash
# Node.js
npm audit --audit-level=high

# Rust
cargo audit

# Go
govulncheck ./...

# Python
pip-audit
```

For each finding:
- **Critical/High**: Must fix before proceeding. No exceptions.
- **Moderate**: Assess exploitability in context. Fix if the vulnerable code path is reachable.
- **Low**: Document and track. Fix in follow-up.

### Step 5: Threat Modeling

Produce a lightweight threat model (STRIDE-inspired):

For each major data flow or new surface identified in Step 1:

| Threat | Type | Asset | Vector | Likelihood | Impact | Mitigation |
|--------|------|-------|--------|------------|--------|------------|
| [Description] | S/T/R/I/D/E | [What's at risk] | [How] | Low/Med/High | Low/Med/High | [Control in place or needed] |

**STRIDE**:
- **S**poofing — attacker impersonates a user or system
- **T**ampering — attacker modifies data in transit or at rest
- **R**epudiation — attacker denies actions with no audit trail
- **I**nformation Disclosure — attacker reads data they shouldn't
- **D**enial of Service — attacker makes the system unavailable
- **E**levation of Privilege — attacker gains more access than intended

### Step 6: Classify Findings

For each issue found:

| Severity | CVSS Range | Action Required |
|----------|-----------|-----------------|
| **Critical** | 9.0–10.0 | Block merge. Fix and re-audit. |
| **High** | 7.0–8.9 | Block merge. Fix before deploy. |
| **Medium** | 4.0–6.9 | Fix before deploy or accept with documented rationale. |
| **Low** | 0.1–3.9 | Track as follow-up. |
| **Info** | N/A | Observation or improvement suggestion. |

### Step 7: Gate Decision

- **PASS**: No Critical or High findings. Medium findings documented with mitigation plan.
- **CONDITIONAL**: Medium findings present — accepted with rationale and follow-up tracking.
- **FAIL**: Any Critical or High finding. Must fix before proceeding to Deploy.

## Output Format

### security-findings artifact

```markdown
# Security Findings: [Build Session/Task Name]

## Executive Summary

- **Gate Decision**: [PASS / CONDITIONAL / FAIL]
- **Audit Date**: [date]
- **Findings**: [X critical, Y high, Z medium, W low, V info]
- **Dependencies Scanned**: [tool + output summary]
- **Secrets Found**: [Yes/No]

## OWASP Top 10 Results

| Category | Status | Notes |
|----------|--------|-------|
| A01 Broken Access Control | PASS / PARTIAL / FAIL | |
| A02 Cryptographic Failures | PASS / PARTIAL / FAIL | |
| A03 Injection | PASS / PARTIAL / FAIL | |
| ... | | |

## Findings

### Critical
| # | Location | Finding | CVSS | Remediation |
|---|----------|---------|------|-------------|

### High
| # | Location | Finding | CVSS | Remediation |
|---|----------|---------|------|-------------|

### Medium
| # | Location | Finding | CVSS | Remediation | Accepted? |
|---|----------|---------|------|-------------|-----------|

### Low / Info
| # | Location | Finding | Action |
|---|----------|---------|--------|

## Dependency Audit Results

| Package | Version | CVE | Severity | Reachable | Action |
|---------|---------|-----|----------|-----------|--------|

## Secrets Scan

- **Result**: Clean / [N secrets found]
- **Details**: [if secrets found, describe and confirm rotation]
```

### threat-model artifact

```markdown
# Threat Model: [Feature/System Name]

## Scope

[What is being modeled — which features, surfaces, or data flows]

## Assets

| Asset | Description | Sensitivity |
|-------|-------------|-------------|
| [Asset name] | [What it is] | High / Medium / Low |

## Trust Boundaries

[Diagram or description of where trust transitions occur]

## Data Flows

| Flow | Source | Destination | Data | Crosses Boundary? |
|------|--------|-------------|------|-------------------|

## Threat Analysis (STRIDE)

| Threat | Type | Asset | Vector | Likelihood | Impact | Mitigation |
|--------|------|-------|--------|------------|--------|------------|

## Mitigations In Place

- [Control 1: Description]
- [Control 2: Description]

## Residual Risk

[What risk remains after mitigations, and why it's accepted]
```

## Quality Criteria

The security audit is complete when:

- [ ] All OWASP Top 10 categories relevant to the changes have been assessed
- [ ] Dependency audit ran with no unresolved Critical/High findings
- [ ] Secrets scan performed — result is clean or rotation is confirmed
- [ ] Threat model covers all new trust boundaries and data flows
- [ ] Every finding has a severity, location, and remediation path
- [ ] Gate decision is clearly stated with rationale
- [ ] security-findings artifact is produced
- [ ] threat-model artifact is produced
- [ ] All Critical and High findings are resolved before gate passes
