Feature: CycleManager enforces domain rules for state transitions and bet outcomes

  Scenario: transitionState advances a planning cycle to active
    Given a cycle in "planning" state with bet "Ship the feature"
    When the cycle transitions to "active"
    Then the cycle state is "active"

  Scenario: transitionState advances an active cycle to cooldown
    Given a cycle in "active" state with bet "Ship the feature"
    When the cycle transitions to "cooldown"
    Then the cycle state is "cooldown"

  Scenario: transitionState advances a cooldown cycle to complete
    Given a cycle in "cooldown" state with bet "Ship the feature"
    When the cycle transitions to "complete"
    Then the cycle state is "complete"

  Scenario: transitionState rejects an invalid transition
    Given a cycle in "planning" state with bet "Ship the feature"
    When the cycle attempts to transition to "cooldown"
    Then the transition is rejected with an error

  Scenario: transitionState is idempotent for same-state
    Given a cycle in "active" state with bet "Ship the feature"
    When the cycle transitions to "active"
    Then the cycle state is "active"
    And the cycle updatedAt is unchanged

  Scenario: transitionState sets the cycle name at transition time
    Given a cycle in "planning" state with bet "Ship the feature"
    When the cycle transitions to "active" with name "Keiko 12"
    Then the cycle state is "active"
    And the cycle name is "Keiko 12"

  Scenario: transitionState updates the name on same-state transition
    Given a cycle in "active" state with bet "Ship the feature" named "Old Name"
    When the cycle transitions to "active" with name "New Name"
    Then the cycle name is "New Name"

  Scenario: setBetOutcome records outcome on a pending bet
    Given a cycle in "active" state with bet "Ship the feature"
    And the bet starts with outcome "pending"
    When setBetOutcome is called with "complete"
    Then the bet outcome becomes "complete"

  Scenario: setBetOutcome is a no-op when bet is already resolved
    Given a cycle in "active" state with bet "Ship the feature"
    And the bet starts with outcome "complete"
    When setBetOutcome is called with "partial"
    Then the bet outcome becomes "complete"

  Scenario: setBetOutcome throws for unknown bet ID
    Given a cycle in "active" state with bet "Ship the feature"
    When setBetOutcome is called with "complete" for an unknown bet
    Then a bet-not-found error is thrown

  Scenario: removeBet only works on planning cycles
    Given a cycle in "active" state with bet "Ship the feature"
    When removeBet is called for the bet
    Then a state-guard error is thrown

  Scenario: deleteCycle only works on planning cycles
    Given a cycle in "active" state with bet "Ship the feature"
    When deleteCycle is called
    Then a state-guard error is thrown
