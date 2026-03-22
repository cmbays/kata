Feature: Bet outcome reconciliation during cooldown
  During cooldown, bet outcomes are reconciled with bridge-run metadata
  so that the cycle always reflects the true completion state of each bet,
  even when the caller provides no explicit outcomes.

  Background:
    Given a cycle with bets that have been launched as runs

  # ── Outcome reconciliation ──────────────────────────────────

  Scenario: pending bets are auto-resolved from completed bridge-run metadata
    Given bet "scope-parser" is pending with a bridge-run that completed
    When outcomes are reconciled for the cycle
    Then bet "scope-parser" outcome is recorded as "complete"

  Scenario: pending bets with a failed bridge-run are marked partial
    Given bet "scope-parser" is pending with a bridge-run that failed
    When outcomes are reconciled for the cycle
    Then bet "scope-parser" outcome is recorded as "partial"

  Scenario: multiple bets in different states are reconciled independently
    Given bet "scope-parser" is pending with a bridge-run that completed
    And bet "ui-refactor" is pending with a bridge-run that failed
    And bet "docs-update" already has outcome "complete"
    When outcomes are reconciled for the cycle
    Then bet "scope-parser" outcome is recorded as "complete"
    And bet "ui-refactor" outcome is recorded as "partial"
    And bet "docs-update" is not re-synced

  Scenario: bets already resolved are not re-synced
    Given bet "scope-parser" already has outcome "complete"
    And a bridge-run exists for bet "scope-parser"
    When outcomes are reconciled for the cycle
    Then no outcomes are recorded

  Scenario: bets without a run ID are skipped during reconciliation
    Given bet "scope-parser" is pending but has no run ID
    When outcomes are reconciled for the cycle
    Then no outcomes are recorded

  Scenario: missing bridge-run file does not abort reconciliation
    Given bet "scope-parser" is pending with a run ID
    But no bridge-run file exists for that run
    When outcomes are reconciled for the cycle
    Then no outcomes are recorded
    And cooldown continues normally

  Scenario: corrupt bridge-run file is silently skipped
    Given bet "scope-parser" is pending with a run ID
    And the bridge-run file for that run contains invalid JSON
    When outcomes are reconciled for the cycle
    Then no outcomes are recorded
    And cooldown continues normally

  # ── Incomplete run detection ────────────────────────────────

  Scenario: in-progress bridge-run is reported as incomplete
    Given bet "scope-parser" has a bridge-run with status "in-progress"
    When cooldown checks for incomplete runs
    Then bet "scope-parser" run is reported as incomplete with status "running"

  Scenario: pending run file is reported as incomplete
    Given bet "scope-parser" has a run file with status "pending"
    And no bridge-run file exists for that run
    When cooldown checks for incomplete runs
    Then bet "scope-parser" run is reported as incomplete with status "pending"

  Scenario: failed bridge-run is not reported as incomplete
    Given bet "scope-parser" has a bridge-run with status "failed"
    When cooldown checks for incomplete runs
    Then no incomplete runs are reported

  Scenario: completed bridge-run is not reported as incomplete
    Given bet "scope-parser" has a bridge-run with status "complete"
    When cooldown checks for incomplete runs
    Then no incomplete runs are reported

  Scenario: bridge-run status takes precedence over run file status
    Given bet "scope-parser" has a bridge-run with status "complete"
    And the same bet has a run file with status "running"
    When cooldown checks for incomplete runs
    Then no incomplete runs are reported

  Scenario: bets without a run ID are excluded from incomplete check
    Given bet "scope-parser" has no run ID
    When cooldown checks for incomplete runs
    Then no incomplete runs are reported

  # ── Reconciliation safety ───────────────────────────────────

  Scenario: reconciliation is safely skipped when run metadata is unavailable
    Given no run metadata directories are configured
    When outcomes are reconciled for the cycle
    Then no outcomes are recorded
    And no incomplete runs are reported

  # ── Bridge-run ID lookup ────────────────────────────────────

  Scenario: bridge-run IDs are loaded by scanning metadata files
    Given bridge-run metadata files exist linking bets to runs for this cycle
    When bridge-run IDs are loaded by bet
    Then a mapping from bet ID to run ID is returned

  Scenario: bridge-run files for other cycles are excluded from lookup
    Given bridge-run metadata files exist for a different cycle
    When bridge-run IDs are loaded by bet
    Then the mapping is empty

  Scenario: unreadable bridge-runs directory returns empty map
    Given the bridge-runs directory does not exist on disk
    When bridge-run IDs are loaded by bet
    Then the mapping is empty

  # ── Outcome recording ───────────────────────────────────────

  Scenario: outcomes are applied to the cycle via the cycle manager
    Given bet outcomes to record for the cycle
    When bet outcomes are recorded
    Then the cycle manager receives the outcome updates

  Scenario: unmatched bet IDs produce a warning but do not fail
    Given bet outcomes referencing a bet ID that does not exist in the cycle
    When bet outcomes are recorded
    Then a warning is logged for the unmatched bet IDs
    And cooldown continues normally
