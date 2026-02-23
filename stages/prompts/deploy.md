# Deploy Stage

## Purpose

Safely move verified, reviewed software from the build environment to production. A deploy is not an afterthought — it is a deliberate operation with a plan, a verification strategy, and a rollback capability for when things go wrong.

The goal is zero-surprise deploys: the team knows exactly what will happen, has verified it in staging, has a rollback plan ready, and can detect problems immediately after deployment.

## Expected Inputs

- **review-findings** artifact from the Review stage (gate: must be PASS or PASS_WITH_WARNINGS)
- **test-plan** / **coverage-report** artifacts from the Test stage (if run)
- **security-findings** from the Security Audit stage (if run)
- Access to the deployment environment (staging, production)
- Change management or deployment calendar context

## Process

### Step 1: Pre-Deploy Assessment

Before touching any environment:

1. **Read all upstream artifacts**: What was built? What was reviewed? Are there open Critical/High findings?
2. **Verify all gates are satisfied**: Review must pass. Test must pass. Security audit must pass (or findings accepted with rationale).
3. **Assess deployment complexity**:
   - Database migrations? (High risk — harder to roll back)
   - Infrastructure changes? (Medium risk — test in staging)
   - Code-only changes? (Lower risk — still plan the rollback)
   - Feature flag changes? (Safest — can toggle without redeploy)

**Never deploy if Critical findings from Review, Test, or Security are unresolved.**

### Step 2: Staging Verification

Always deploy to staging before production. No exceptions.

#### Staging Checklist

- [ ] Staging environment matches production configuration (env vars, infra, data shape)
- [ ] Deployment to staging succeeds without errors
- [ ] Smoke tests pass in staging (critical user journeys work)
- [ ] Performance is not degraded compared to baseline
- [ ] Logs show no unexpected errors during staging exercise
- [ ] Database migrations (if any) completed successfully and are reversible

If staging fails: **stop**. Do not proceed to production. Fix, re-test, re-deploy to staging.

### Step 3: Choose a Deployment Strategy

Match the strategy to the risk level of the change:

| Strategy | How | Risk Level | Rollback |
|----------|-----|-----------|----------|
| **Direct deploy** | Replace all instances at once | Low | Redeploy previous version |
| **Rolling deploy** | Replace instances one at a time | Medium | Drain + redeploy previous |
| **Blue/Green** | Switch traffic to new environment | Medium | Switch traffic back instantly |
| **Canary** | Route % of traffic to new version | High | Reduce canary % to 0 |
| **Feature flag** | Deploy dark, enable flag gradually | Very High | Disable flag |

#### Guidelines

- **Database migrations**: Always blue/green or canary. Never direct deploy.
- **User-facing changes with unknown impact**: Canary or feature flag.
- **Backend-only, thoroughly tested**: Rolling deploy is fine.
- **Hotfix for active incident**: Direct deploy with senior engineer eyes on.

### Step 4: Write the Deployment Checklist

Document the exact steps to execute the deployment. Be specific — no step should require guesswork:

#### Template Structure

```
Pre-Deploy (T-30 min):
  □ Verify staging smoke tests pass
  □ Confirm deployment window with team
  □ Notify stakeholders (if user-impacting)
  □ Confirm rollback procedure is documented and tested

Deploy:
  □ Tag the release commit: git tag v[VERSION]
  □ Execute deployment command: [exact command]
  □ Monitor deployment progress: [how]
  □ Confirm all instances updated: [verification step]

Post-Deploy Verification (first 15 min):
  □ Smoke test critical user journeys
  □ Monitor error rate in [logging/monitoring tool]
  □ Check latency metrics vs. baseline
  □ Verify database migrations completed (if applicable)
  □ Confirm no alerts triggered

Stabilization (first 24h):
  □ Monitor error dashboards
  □ Watch for user reports or support tickets
  □ Track latency/throughput vs. pre-deploy baseline
```

### Step 5: Write the Rollback Plan

A rollback plan that doesn't exist when you need it is worthless. Write it before you deploy.

#### Rollback Decision Criteria

Define explicit triggers that require rollback. Do not leave this to judgment in the moment:

- Error rate exceeds [X]% of requests
- P95 latency exceeds [X]ms
- [Critical business metric] drops by [X]%
- Any data loss or data corruption detected
- Any security incident triggered

#### Rollback Procedure

For each deployment strategy, document the exact rollback steps:

| Step | Action | Command | Expected Outcome |
|------|--------|---------|-----------------|
| 1 | Stop traffic to new version | [command] | Old version serving traffic |
| 2 | Verify old version is responding | [command] | Smoke tests pass |
| 3 | Roll back database migration (if applicable) | [command] | Schema at previous state |
| 4 | Notify team of rollback | [channel/command] | Team aware |

#### Rollback Constraints

Document what cannot be rolled back:
- **Additive DB migrations**: Usually safe to leave in place even if feature is rolled back
- **Destructive DB migrations**: Cannot roll back without data loss — this is a blocker
- **External integrations**: API changes visible to partners may be impossible to hide
- **Sent notifications/emails**: Cannot unsend

If a deployment has unrollable side effects, escalate to the team lead before proceeding.

### Step 6: Execute and Verify

Follow the deployment checklist step by step. Do not improvise. After each step:
- Confirm the expected outcome happened
- Check logs for errors
- Do not proceed to the next step if the current step's outcome is unclear

#### Post-Deploy Health Check Protocol

Within 15 minutes of deploy completion:
1. **Error rate**: Compare to 15-minute window before deploy
2. **Latency**: P50, P95, P99 vs. pre-deploy
3. **Throughput**: Requests/sec should be normal (not spiking or dropping)
4. **Business metrics**: Orders, signups, or the KPI most relevant to this change
5. **Logs**: Scan for new `ERROR` or `WARN` lines introduced by this deploy

If any metric is degraded beyond the rollback threshold: execute rollback immediately.

### Step 7: Feature Flags

If the deployment uses feature flags:

- [ ] Flag is off by default — deployment is dark
- [ ] Enable flag for internal users first (team members, beta users)
- [ ] Monitor for [X] hours before enabling for all users
- [ ] Gradual rollout: 1% → 5% → 25% → 100%, monitoring at each step
- [ ] Flag has a kill switch that can disable it in under 60 seconds
- [ ] Cleanup ticket created to remove flag after full rollout

### Step 8: Communicate

After a successful deploy:

1. **Update team channels**: "v[VERSION] deployed to production. Monitoring for 24h."
2. **Update issue tracker**: Close or move the relevant issues/bets
3. **Update changelog**: Add release entry if applicable
4. **Schedule flag cleanup**: If feature flags were used

## Output Format

### deployment-checklist artifact

```markdown
# Deployment Checklist: [Feature/Version]

## Deployment Info

- **Version**: [tag or commit SHA]
- **Environment**: [production / staging / etc.]
- **Strategy**: [direct / rolling / blue-green / canary / feature-flag]
- **Deployment Window**: [date/time and timezone]
- **Deploying Engineer**: [name]
- **Reviewer/Backup**: [name]

## Pre-Deploy Verification

- [x] All upstream gates satisfied (review, test, security)
- [x] Staging deploy successful
- [x] Smoke tests pass in staging
- [ ] [Additional pre-conditions specific to this deploy]

## Deploy Steps

| # | Action | Command | Status |
|---|--------|---------|--------|
| 1 | [Step] | [command] | [ ] |
| 2 | [Step] | [command] | [ ] |
| ... | | | |

## Post-Deploy Verification

| Check | Metric | Threshold | Result |
|-------|--------|-----------|--------|
| Error rate | [X]% | <[Y]% | [ ] |
| P95 latency | [X]ms | <[Y]ms | [ ] |
| Smoke tests | PASS/FAIL | PASS | [ ] |

## Outcome

**Result**: DEPLOYED / ROLLED_BACK
**Notes**: [anything notable]
```

### rollback-plan artifact

```markdown
# Rollback Plan: [Feature/Version]

## Rollback Triggers

Roll back immediately if any of the following occur:
- Error rate exceeds [X]%
- P95 latency exceeds [X]ms
- [Business metric] drops by [X]%

## Rollback Procedure

| Step | Action | Command | Expected Result |
|------|--------|---------|----------------|
| 1 | [Step] | [command] | [outcome] |
| ... | | | |

## Estimated Rollback Time

[X minutes] to revert traffic. [Y minutes] for full rollback including DB if needed.

## Known Constraints

- [What cannot be rolled back and why]

## Escalation

If rollback fails or is not sufficient: contact [name/channel] immediately.
```

## Quality Criteria

The deploy stage is complete when:

- [ ] All upstream gate artifacts exist and are clean (or explicitly accepted)
- [ ] Staging deployment succeeded and smoke tests passed
- [ ] Deployment strategy chosen and rationale documented
- [ ] deployment-checklist artifact produced with every step specified
- [ ] rollback-plan artifact produced with explicit triggers and steps
- [ ] Rollback constraints are identified (especially for DB migrations)
- [ ] Feature flags planned and kill switch confirmed if used
- [ ] Post-deploy health checks documented with thresholds
- [ ] Team notified of deployment outcome
