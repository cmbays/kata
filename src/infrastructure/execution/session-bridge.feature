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

  Scenario: Preparing the same cycle twice reuses the existing bridge runs
    Given a planning cycle named "Launch Cycle" with pending bets "Fix the login bug, Tighten tests"
    When the session bridge prepares the cycle for execution
    And the session bridge prepares the same cycle again
    Then the prepared cycle includes 2 runs
    And the repeated prepare reuses the existing run ids
    And each pending bet has exactly one bridge run
