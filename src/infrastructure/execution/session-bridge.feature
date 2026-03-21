Feature: Session bridge prepares in-session execution runs

  Scenario: Preparing a default bet creates a running bridge run
    Given an active cycle with a default build-stage bet "Fix the login bug"
    When the session bridge prepares the bet for execution
    Then the prepared run uses the default stage sequence
    And the prepared run uses worktree isolation
    And a running run record exists for the prepared run
    And the bridge metadata is marked "in-progress"

  Scenario: Agent context falls back to the prepared kata dir outside a worktree
    Given an active cycle with a default build-stage bet "Fix the login bug"
    And the session bridge has prepared the bet for execution
    And launch mode is "agent" outside a git worktree
    When the session bridge formats the agent context
    Then the agent context includes the prepared kata dir as the resolved kata dir
    And the agent context warns that kata commands should use "--cwd"
    And the agent context includes git worktree instructions

  Scenario: Preparing a planning cycle activates it and writes one bridge run per pending bet
    Given a planning cycle named "Launch Cycle" with pending bets "Fix the login bug, Tighten tests"
    When the session bridge prepares the cycle for execution
    Then the cycle is marked "active"
    And the prepared cycle includes 2 runs
    And each pending bet has exactly one bridge run
    And each prepared cycle run has a running run record

  Scenario: Preparing an unnamed planning cycle is rejected
    Given a planning cycle without a name and with pending bets "Fix the login bug"
    When the session bridge tries to prepare the cycle for execution
    Then preparing the cycle is rejected because the cycle has no name

  Scenario: Preparing an unnamed planning cycle with a provided name activates it
    Given a planning cycle without a name and with pending bets "Fix the login bug"
    When the session bridge prepares the cycle for execution with name "Launch Cycle"
    Then the cycle is marked "active"
    And the cycle name becomes "Launch Cycle"
    And the prepared cycle includes 1 run

  Scenario: Preparing the same cycle twice reuses the existing bridge runs
    Given a planning cycle named "Launch Cycle" with pending bets "Fix the login bug, Tighten tests"
    When the session bridge prepares the cycle for execution
    And the session bridge prepares the same cycle again
    Then the prepared cycle includes 2 runs
    And the repeated prepare reuses the existing run ids
    And each pending bet has exactly one bridge run

  Scenario: Cycle status distinguishes prepared bets from untouched bets
    Given an active cycle named "Status Cycle" with pending bets "Fix the login bug, Tighten tests"
    And the session bridge prepares the bet "Fix the login bug" for execution
    When the session bridge reads the cycle execution status
    Then the cycle status for bet "Fix the login bug" is "in-progress"
    And the cycle status for bet "Fix the login bug" has a run id
    And the cycle status for bet "Tighten tests" is "pending"

  Scenario: Cycle status reflects completed and failed bridge runs
    Given an active cycle named "Terminal Status Cycle" with pending bets "Fix the login bug, Tighten tests"
    And the session bridge prepares the cycle for execution
    And the prepared run for bet "Fix the login bug" completes successfully with 15 total tokens
    And the prepared run for bet "Tighten tests" fails with 9 total tokens
    When the session bridge reads the cycle execution status
    Then the cycle status for bet "Fix the login bug" is "complete"
    And the cycle status for bet "Tighten tests" is "failed"

  Scenario: Completing a prepared cycle preserves persisted token usage for downstream reporting
    Given an active cycle named "Completion Cycle" with pending bets "Fix the login bug, Tighten tests"
    And the session bridge prepares the cycle for execution
    And the prepared run for bet "Fix the login bug" completes successfully with 15 total tokens
    When the session bridge completes the cycle
    Then the cycle summary reports 2 total bets and 2 completed bets
    And the cycle summary reports 15 total tokens
    And the cycle history contains 2 entries for the cycle
    And the cycle bet outcomes are "complete, complete"
    And the cycle is marked "active"

  Scenario: Cooldown reporting consumes the completed bridge-run data
    Given an active cycle named "Cooldown Cycle" with pending bets "Fix the login bug, Tighten tests"
    And the session bridge prepares the cycle for execution
    And the prepared run for bet "Fix the login bug" completes successfully with 15 total tokens
    And the prepared run for bet "Tighten tests" fails with 9 total tokens
    When cooldown runs for the prepared cycle
    Then the cooldown report shows 50 percent completion
    And the cooldown report shows 24 total tokens used
    And the cycle is marked "complete"
