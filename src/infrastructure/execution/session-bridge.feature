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
