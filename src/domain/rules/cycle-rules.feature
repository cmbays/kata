Feature: Cycle state machine enforces linear transitions

  The cycle state machine allows only forward transitions:
  planning → active → cooldown → complete.
  No backward transitions, no skipping states.

  Scenario Outline: Allowed forward transitions
    Given a cycle in "<from>" state
    When checking if transition to "<to>" is allowed
    Then the transition is allowed

    Examples:
      | from     | to       |
      | planning | active   |
      | active   | cooldown |
      | cooldown | complete |

  Scenario Outline: Rejected backward transitions
    Given a cycle in "<from>" state
    When checking if transition to "<to>" is allowed
    Then the transition is rejected

    Examples:
      | from     | to       |
      | active   | planning |
      | cooldown | active   |
      | complete | cooldown |

  Scenario Outline: Rejected skip transitions
    Given a cycle in "<from>" state
    When checking if transition to "<to>" is allowed
    Then the transition is rejected

    Examples:
      | from     | to       |
      | planning | cooldown |
      | planning | complete |
      | active   | complete |

  Scenario: Same-state transition is rejected
    Given a cycle in "active" state
    When checking if transition to "active" is allowed
    Then the transition is rejected

  Scenario: Complete state has no outbound transitions
    Given a cycle in "complete" state
    When checking if transition to "planning" is allowed
    Then the transition is rejected
