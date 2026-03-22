Feature: Cooldown Diary Writer

  The diary writer records cooldown activity into the dojo diary and optionally
  generates a dojo session. It is called during both one-shot cooldown (run) and
  two-phase cooldown (prepare/complete). Writing failures are logged as warnings
  and never abort the cooldown.

  Background:
    Given the diary writer environment is ready

  # --- Run diary writing ---

  Scenario: Run diary records bet outcomes with descriptions
    Given the dojo directory is configured
    And the cycle has bets with descriptions "Redesign login" and "Fix caching"
    And bet outcomes are provided for the cycle
    When a run diary is written
    Then the diary entry contains descriptions "Redesign login" and "Fix caching"

  Scenario: Run diary includes human perspective when provided
    Given the dojo directory is configured
    And a human perspective "Team felt rushed" is provided
    When a run diary is written
    Then the diary entry includes the human perspective "Team felt rushed"

  # --- Complete diary writing ---

  Scenario: Complete diary records outcomes from cycle bets
    Given the dojo directory is configured
    And the cycle has completed and abandoned bets
    When a complete diary is written
    Then the diary entry contains outcomes for the completed and abandoned bets

  Scenario: Complete diary includes agent perspective from synthesis proposals
    Given the dojo directory is configured
    And synthesis proposals are available
    When a complete diary is written
    Then the diary entry includes an agent perspective summary

  # --- Diary entry error handling ---

  Scenario: Diary entry failure is logged as a warning
    Given the dojo directory is configured
    And the diary writer will fail with an internal error
    When a diary entry is written
    Then a warning is logged about diary write failure
    And cooldown continues normally

  # --- Bet outcome enrichment ---

  Scenario: Bet outcomes are enriched with descriptions from the cycle
    Given the cycle has a bet "bet-1" with description "Ship dashboard"
    And a bet outcome exists for "bet-1" without a description
    When bet outcomes are enriched
    Then the enriched outcome for "bet-1" has description "Ship dashboard"

  Scenario: Existing bet descriptions are preserved during enrichment
    Given a bet outcome for "bet-2" already has description "Pre-existing note"
    When bet outcomes are enriched
    Then the enriched outcome for "bet-2" has description "Pre-existing note"

  # --- Dojo session generation ---

  Scenario: Dojo session is generated when both dojo directory and builder are configured
    Given the dojo directory is configured
    And the dojo session builder is configured
    When a dojo session is requested
    Then a dojo session is built from aggregated cycle data

  Scenario: Dojo session is skipped when dojo directory is not configured
    Given the dojo directory is not configured
    When a dojo session is requested
    Then no dojo session is generated

  Scenario: Dojo session is skipped when session builder is not configured
    Given the dojo directory is configured
    And the dojo session builder is not configured
    When a dojo session is requested
    Then no dojo session is generated

  Scenario: Dojo session failure is logged as a warning
    Given the dojo directory is configured
    And the dojo session builder is configured
    And the dojo session builder will fail with an internal error
    When a dojo session is requested
    Then a warning is logged about dojo session failure
    And cooldown continues normally

  # --- Optional deps guarding ---

  Scenario: Run diary is skipped when dojo directory is not configured
    Given the dojo directory is not configured
    When a run diary is written
    Then no diary entry is written

  Scenario: Complete diary is skipped when dojo directory is not configured
    Given the dojo directory is not configured
    When a complete diary is written
    Then no diary entry is written
