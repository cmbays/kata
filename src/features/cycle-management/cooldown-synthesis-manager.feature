Feature: Cooldown Synthesis Manager

  The synthesis manager handles reading and writing synthesis data during cooldown.
  It collects observations and learnings for the synthesis engine, applies accepted
  proposals back to the knowledge store, and cleans up stale input files.
  All operations are non-critical — failures log warnings and never abort cooldown.

  Background:
    Given the synthesis manager environment is ready

  # --- Writing synthesis input ---

  Scenario: Writes synthesis input with observations and learnings
    Given the synthesis directory is configured
    And the cycle has bets with completed runs
    And the knowledge store has existing learnings
    When synthesis input is written for the cycle
    Then a synthesis input file is created in the synthesis directory
    And the input contains observations from the completed runs
    And the input contains the stored learnings
    And cooldown continues normally

  Scenario: Writes synthesis input with observations but no learnings
    Given the synthesis directory is configured
    And the cycle has bets with completed runs
    And the knowledge store has no learnings
    When synthesis input is written for the cycle
    Then a synthesis input file is created in the synthesis directory
    And the input contains observations from the completed runs
    And the input contains no learnings
    And cooldown continues normally

  Scenario: Skips writing when synthesis directory is not configured
    Given the synthesis directory is not configured
    When synthesis input is written for the cycle
    Then no synthesis input file is created
    And cooldown continues normally

  Scenario: Cleans up stale input files for the same cycle before writing
    Given the synthesis directory is configured
    And a stale synthesis input file exists for the same cycle
    When synthesis input is written for the cycle
    Then the stale input file is removed
    And a new synthesis input file is created in the synthesis directory
    And cooldown continues normally

  Scenario: Preserves input files belonging to other cycles during cleanup
    Given the synthesis directory is configured
    And a synthesis input file exists for a different cycle
    When synthesis input is written for the cycle
    Then the other cycle input file is preserved
    And cooldown continues normally

  # --- Collecting observations ---

  Scenario: Collects observations across all bets in the cycle
    Given the synthesis directory is configured
    And the cycle has two bets with observations from their runs
    When synthesis input is written for the cycle
    Then the input contains observations from both bets
    And cooldown continues normally

  Scenario: Skips bets without a run identifier
    Given the synthesis directory is configured
    And the cycle has a bet without a run identifier
    When synthesis input is written for the cycle
    Then no observations are collected for that bet
    And cooldown continues normally

  Scenario: Collects observations for indirectly linked bets
    Given the synthesis directory is configured
    And the cycle has a bet linked indirectly to its run
    When synthesis input is written for the cycle
    Then observations are collected for that bet
    And cooldown continues normally

  # --- Reading and applying synthesis results ---

  Scenario: Reads and applies accepted synthesis proposals
    Given the synthesis directory is configured
    And a synthesis result file exists with proposals
    And specific proposals are marked as accepted
    When synthesis results are read and applied
    Then only the accepted proposals are applied to the knowledge store
    And the applied proposals are returned
    And cooldown continues normally

  Scenario: Applies all proposals when no acceptance filter is provided
    Given the synthesis directory is configured
    And a synthesis result file exists with proposals
    When synthesis results are read without an acceptance filter
    Then all proposals are applied to the knowledge store
    And cooldown continues normally

  Scenario: Returns nothing when no synthesis result file exists
    Given the synthesis directory is configured
    When synthesis results are read for a nonexistent input
    Then no proposals are returned
    And cooldown continues normally

  Scenario: Returns nothing when synthesis directory is not configured
    Given the synthesis directory is not configured
    When synthesis results are read and applied
    Then no proposals are returned
    And cooldown continues normally

  # --- Proposal application types ---

  Scenario: Applies a new-learning proposal to the knowledge store
    Given the synthesis directory is configured
    And a synthesis result contains a new-learning proposal
    When synthesis results are read and applied
    Then a new learning is captured in the knowledge store
    And cooldown continues normally

  Scenario: Applies an update-learning proposal with confidence adjustment
    Given the synthesis directory is configured
    And a synthesis result contains an update-learning proposal
    When synthesis results are read and applied
    Then the existing learning content is updated
    And the learning confidence is adjusted by the proposal delta
    And cooldown continues normally

  Scenario: Applies a promote proposal to advance a learning tier
    Given the synthesis directory is configured
    And a synthesis result contains a promote proposal
    When synthesis results are read and applied
    Then the learning is promoted to the target tier
    And cooldown continues normally

  Scenario: Applies an archive proposal to retire a learning
    Given the synthesis directory is configured
    And a synthesis result contains an archive proposal
    When synthesis results are read and applied
    Then the learning is archived with the provided reason
    And cooldown continues normally

  Scenario: Logs a methodology recommendation without modifying the knowledge store
    Given the synthesis directory is configured
    And a synthesis result contains a methodology-recommendation proposal
    When synthesis results are read and applied
    Then the recommendation is logged
    And no learning is modified in the knowledge store
    And cooldown continues normally

  # --- Error handling ---

  Scenario: Logs a warning when observation reading fails for a run
    Given the synthesis directory is configured
    And a run observation file is corrupted
    When synthesis input is written for the cycle
    Then a warning is logged about the observation failure
    And synthesis input is still written with available data
    And cooldown continues normally

  Scenario: Logs a warning when a proposal fails to apply
    Given the synthesis directory is configured
    And a synthesis result contains a proposal that will fail to apply
    When synthesis results are read and applied
    Then a warning is logged about the proposal failure
    And the remaining proposals are still processed
    And cooldown continues normally

  Scenario: Logs a warning when the synthesis result file is malformed
    Given the synthesis directory is configured
    And the synthesis result file cannot be parsed
    When synthesis results are read and applied
    Then a warning is logged about the result read failure
    And no proposals are returned
    And cooldown continues normally
