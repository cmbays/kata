Feature: Resolve cycle activation names

  Scenario: explicit launch name overrides the cycle and suggestions
    Given a planning cycle named "Existing Cycle" for activation naming
    And the cycle name suggester recommends "Suggested Cycle"
    When activation naming resolves with provided name "Manual Launch Name"
    Then the resolved activation name is "Manual Launch Name"
    And the activation name source is "provided"

  Scenario: unnamed cycle uses the suggested name when no prompt is available
    Given an unnamed planning cycle for activation naming
    And the cycle name suggester recommends "Suggested Cycle"
    When activation naming resolves without a prompt
    Then the resolved activation name is "Suggested Cycle"
    And the activation name source is "llm"

  Scenario: user can edit the suggested cycle name before activation
    Given an unnamed planning cycle for activation naming
    And the cycle name suggester recommends "Suggested Cycle"
    And the activation naming prompt returns "Edited Cycle"
    When activation naming resolves with a prompt
    Then the resolved activation name is "Edited Cycle"
    And the activation name source is "prompted"
