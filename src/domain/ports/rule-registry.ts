import type { StageCategory } from '@domain/types/stage.js';
import type { StageRule, RuleSuggestion } from '@domain/types/rule.js';

/**
 * Port interface for managing stage-level rules and rule suggestions.
 *
 * Rules influence flavor selection within a stage category. They encode
 * learned preferences discovered by the reflect phase or created manually.
 *
 * Suggestions go through a review workflow (pending → accepted/rejected)
 * before becoming active rules. This is surfaced via `kata bunkai review`.
 */
export interface IStageRuleRegistry {
  /**
   * Load all active rules for a given stage category.
   * @returns Rules sorted by createdAt ascending (oldest first).
   */
  loadRules(category: StageCategory): StageRule[];

  /**
   * Add an active rule. Generates a UUID id and sets createdAt.
   * Persists to `.kata/rules/{category}/{id}.json`.
   * @returns The persisted StageRule with generated id and createdAt.
   */
  addRule(rule: Omit<StageRule, 'id' | 'createdAt'>): StageRule;

  /**
   * Remove an active rule by id.
   * @throws RuleNotFoundError if no rule with that id exists.
   */
  removeRule(id: string): void;

  /**
   * Record a new rule suggestion from the self-improvement loop.
   * Generates a UUID id, sets createdAt, and sets status to 'pending'.
   * Persists to `.kata/rules/suggestions/{id}.json`.
   * @returns The persisted RuleSuggestion.
   */
  suggestRule(suggestion: Omit<RuleSuggestion, 'id' | 'createdAt' | 'status'>): RuleSuggestion;

  /**
   * Get all pending rule suggestions, optionally filtered by category.
   * @returns Suggestions sorted by createdAt ascending (oldest first).
   */
  getPendingSuggestions(category?: StageCategory): RuleSuggestion[];

  /**
   * Accept a pending suggestion: promote it to an active rule.
   * Sets suggestion status to 'accepted', optionally records edit notes.
   * @returns The newly created StageRule.
   * @throws SuggestionNotFoundError if no suggestion with that id exists.
   */
  acceptSuggestion(id: string, editDelta?: string): StageRule;

  /**
   * Reject a pending suggestion with a reason.
   * Sets suggestion status to 'rejected' and records the reason.
   * @returns The updated RuleSuggestion.
   * @throws SuggestionNotFoundError if no suggestion with that id exists.
   */
  rejectSuggestion(id: string, reason: string): RuleSuggestion;
}
