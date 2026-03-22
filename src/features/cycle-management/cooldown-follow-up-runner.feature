Feature: Follow-up analysis pipeline during cooldown
  After a cooldown phase completes its core processing, a series of follow-up
  analyses run to improve the knowledge system: predictions are matched to
  outcomes, calibration biases are detected, learnings are promoted through
  the knowledge hierarchy, expired learnings are flagged, and friction
  points are resolved.

  Background:
    Given the follow-up pipeline environment is ready

  # ── Prediction matching ──────────────────────────────────────

  Scenario: predictions are matched to outcomes for each bet run
    Given prediction matching is enabled
    And the cycle has bets with runs "run-1" and "run-2"
    When the follow-up pipeline runs
    Then predictions are matched for run "run-1"
    And predictions are matched for run "run-2"

  Scenario: prediction matching is skipped when not enabled
    Given prediction matching is not enabled
    And the cycle has bets with runs "run-1" and "run-2"
    When the follow-up pipeline runs
    Then no prediction matching occurs

  # ── Calibration detection ────────────────────────────────────

  Scenario: calibration biases are detected for each bet run
    Given calibration detection is enabled
    And the cycle has bets with runs "run-1" and "run-2"
    When the follow-up pipeline runs
    Then calibration is checked for run "run-1"
    And calibration is checked for run "run-2"

  Scenario: calibration detection is skipped when not enabled
    Given calibration detection is not enabled
    And the cycle has bets with runs "run-1" and "run-2"
    When the follow-up pipeline runs
    Then no calibration detection occurs

  # ── Hierarchical promotion ───────────────────────────────────

  Scenario: learnings are promoted through the knowledge hierarchy
    Given hierarchical promotion is enabled
    And the knowledge store contains step-tier learnings
    When the follow-up pipeline runs
    Then step learnings are promoted to flavor tier
    And flavor learnings are promoted to stage tier
    And stage learnings are promoted to category tier

  Scenario: hierarchical promotion failure does not abort the pipeline
    Given hierarchical promotion is enabled
    And hierarchical promotion will fail with an internal error
    When the follow-up pipeline runs
    Then a warning is logged about hierarchical promotion failure
    And cooldown continues normally

  # ── Expiry check ─────────────────────────────────────────────

  Scenario: expired learnings are flagged during cooldown
    Given expiry checking is available
    And learnings have expired
    When the follow-up pipeline runs
    Then expired learnings are flagged

  Scenario: expiry check is skipped when the knowledge store lacks the capability
    Given expiry checking is not available
    When the follow-up pipeline runs
    Then no expiry check occurs

  Scenario: expiry check failure does not abort the pipeline
    Given expiry checking is available
    And the expiry check will fail with an internal error
    When the follow-up pipeline runs
    Then a warning is logged about expiry check failure
    And cooldown continues normally

  # ── Friction analysis ────────────────────────────────────────

  Scenario: friction points are resolved for each bet run
    Given friction analysis is enabled
    And the cycle has bets with runs "run-1" and "run-2"
    When the follow-up pipeline runs
    Then friction is analyzed for run "run-1"
    And friction is analyzed for run "run-2"

  Scenario: friction analysis is skipped when not enabled
    Given friction analysis is not enabled
    And the cycle has bets with runs "run-1" and "run-2"
    When the follow-up pipeline runs
    Then no friction analysis occurs

  # ── Pipeline ordering ─────────────────────────────────────────

  Scenario: calibration runs after prediction matching to use its results
    Given prediction matching is enabled
    And calibration detection is enabled
    And the cycle has bets with runs "run-1"
    When the follow-up pipeline runs
    Then predictions are matched before calibration is checked for run "run-1"

  # ── Per-run error isolation ──────────────────────────────────

  Scenario: a failing run does not prevent other runs from being analyzed
    Given prediction matching is enabled
    And the cycle has bets with runs "run-1" and "run-2"
    And prediction matching will fail for run "run-1"
    When the follow-up pipeline runs
    Then predictions are matched for run "run-2"
    And a warning is logged about the run failure

  Scenario: bets without a run are silently skipped
    Given prediction matching is enabled
    And the cycle has a bet without a run
    When the follow-up pipeline runs
    Then no prediction matching occurs
