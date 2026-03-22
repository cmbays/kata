Feature: Belt and agent confidence computation during cooldown
  After a cooldown phase completes, the practitioner's belt level is
  recalculated and per-agent confidence profiles are updated so that
  progress tracking always reflects the latest cycle outcomes.

  Background:
    Given the cooldown environment is ready

  # ── Belt evaluation ────────────────────────────────────────────

  Scenario: belt advances when the practitioner levels up
    Given belt evaluation is enabled
    And the practitioner has earned advancement from "go-kyu" to "yon-kyu"
    When belt evaluation runs
    Then the belt result shows a level-up to "yon-kyu"
    And belt advancement is logged

  Scenario: belt stays steady when no level-up occurs
    Given belt evaluation is enabled
    And the practitioner remains steady at "go-kyu"
    When belt evaluation runs
    Then the belt result shows steady at "go-kyu"
    And no belt advancement is logged

  Scenario: belt evaluation is skipped when not enabled
    Given belt evaluation is not enabled
    When belt evaluation runs
    Then no belt result is returned

  Scenario: belt evaluation is skipped when project state is unavailable
    Given belt evaluation is enabled without project state
    When belt evaluation runs
    Then no belt result is returned

  Scenario: belt evaluation failure does not abort cooldown
    Given belt evaluation is enabled
    And belt evaluation will fail with an internal error
    When belt evaluation runs
    Then no belt result is returned
    And a warning is logged about belt computation failure
    And cooldown continues normally

  # ── Agent confidence tracking ──────────────────────────────────

  Scenario: confidence is computed for each registered agent
    Given agent confidence tracking is enabled
    And agents "Alpha" and "Beta" are registered
    When agent confidence computation runs
    Then confidence is computed for agent "Alpha"
    And confidence is computed for agent "Beta"

  Scenario: agent confidence is skipped when tracking is not enabled
    Given agent confidence tracking is not enabled
    When agent confidence computation runs
    Then no confidence computations occur

  Scenario: agent confidence is skipped when no agent registry is available
    Given agent confidence tracking is enabled without an agent registry
    When agent confidence computation runs
    Then no confidence computations occur

  Scenario: agent confidence failure does not abort cooldown
    Given agent confidence tracking is enabled
    And the agent registry contains invalid data
    When agent confidence computation runs
    Then a warning is logged about agent confidence failure
    And cooldown continues normally
