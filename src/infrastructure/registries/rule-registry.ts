import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';
import {
  StageRuleSchema,
  RuleSuggestionSchema,
  type StageRule,
  type RuleSuggestion,
} from '@domain/types/rule.js';
import type { StageCategory } from '@domain/types/stage.js';
import type { IStageRuleRegistry } from '@domain/ports/rule-registry.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { KataError, RuleNotFoundError, SuggestionNotFoundError } from '@shared/lib/errors.js';
import { logger } from '@shared/lib/logger.js';

/**
 * JSON-backed implementation of IStageRuleRegistry.
 *
 * Directory layout under basePath:
 *   {basePath}/{category}/{id}.json   — active rules
 *   {basePath}/suggestions/{id}.json  — rule suggestions
 *
 * Uses an in-memory cache backed by JsonStore for file I/O.
 */
export class RuleRegistry implements IStageRuleRegistry {
  /** Active rules keyed by id. */
  private readonly rules = new Map<string, StageRule>();
  /** Rule suggestions keyed by id. */
  private readonly suggestions = new Map<string, RuleSuggestion>();
  /** Categories whose rules have been loaded from disk. */
  private readonly loadedCategories = new Set<string>();
  /** Whether suggestions have been loaded from disk. */
  private suggestionsLoaded = false;

  constructor(private readonly basePath: string) {}

  loadRules(category: StageCategory): StageRule[] {
    this.ensureRulesLoaded(category);
    return [...this.rules.values()]
      .filter((r) => r.category === category)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  addRule(input: Omit<StageRule, 'id' | 'createdAt'>): StageRule {
    const rule: StageRule = StageRuleSchema.parse({
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    });

    const dir = join(this.basePath, rule.category);
    const filePath = join(dir, `${rule.id}.json`);

    try {
      JsonStore.write(filePath, rule, StageRuleSchema);
    } catch (err) {
      throw new KataError(
        `Failed to persist rule "${rule.id}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.rules.set(rule.id, rule);
    return rule;
  }

  removeRule(id: string): void {
    // Try to find the rule in cache first
    let rule = this.rules.get(id);

    if (!rule) {
      // Not in cache — scan all categories to find it
      for (const category of ['research', 'plan', 'build', 'review'] as StageCategory[]) {
        this.ensureRulesLoaded(category);
      }
      rule = this.rules.get(id);
    }

    if (!rule) {
      throw new RuleNotFoundError(id);
    }

    const filePath = join(this.basePath, rule.category, `${id}.json`);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }

    this.rules.delete(id);
  }

  suggestRule(input: Omit<RuleSuggestion, 'id' | 'createdAt' | 'status'>): RuleSuggestion {
    const suggestion: RuleSuggestion = RuleSuggestionSchema.parse({
      ...input,
      id: randomUUID(),
      status: 'pending',
      createdAt: new Date().toISOString(),
    });

    const dir = join(this.basePath, 'suggestions');
    const filePath = join(dir, `${suggestion.id}.json`);

    try {
      JsonStore.write(filePath, suggestion, RuleSuggestionSchema);
    } catch (err) {
      throw new KataError(
        `Failed to persist rule suggestion "${suggestion.id}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.suggestions.set(suggestion.id, suggestion);
    return suggestion;
  }

  getPendingSuggestions(category?: StageCategory): RuleSuggestion[] {
    this.ensureSuggestionsLoaded();
    let results = [...this.suggestions.values()].filter((s) => s.status === 'pending');

    if (category) {
      results = results.filter((s) => s.suggestedRule.category === category);
    }

    return results.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  acceptSuggestion(id: string, editDelta?: string): StageRule {
    const suggestion = this.getSuggestionOrThrow(id);

    // Promote to active rule first — if this fails, the suggestion stays
    // pending and can be retried (safer than marking accepted without a rule).
    const rule = this.addRule(suggestion.suggestedRule);

    // Mark suggestion as accepted
    const updated: RuleSuggestion = RuleSuggestionSchema.parse({
      ...suggestion,
      status: 'accepted',
      editDelta,
    });
    this.persistSuggestion(updated);

    return rule;
  }

  rejectSuggestion(id: string, reason: string): RuleSuggestion {
    const suggestion = this.getSuggestionOrThrow(id);

    const updated: RuleSuggestion = RuleSuggestionSchema.parse({
      ...suggestion,
      status: 'rejected',
      rejectionReason: reason,
    });
    this.persistSuggestion(updated);

    return updated;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private getSuggestionOrThrow(id: string): RuleSuggestion {
    this.ensureSuggestionsLoaded();
    const suggestion = this.suggestions.get(id);
    if (!suggestion) {
      throw new SuggestionNotFoundError(id);
    }
    return suggestion;
  }

  private persistSuggestion(suggestion: RuleSuggestion): void {
    const filePath = join(this.basePath, 'suggestions', `${suggestion.id}.json`);
    try {
      JsonStore.write(filePath, suggestion, RuleSuggestionSchema);
    } catch (err) {
      throw new KataError(
        `Failed to persist suggestion "${suggestion.id}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    this.suggestions.set(suggestion.id, suggestion);
  }

  private ensureRulesLoaded(category: StageCategory): void {
    if (this.loadedCategories.has(category)) return;
    const dir = join(this.basePath, category);
    try {
      const loaded = JsonStore.list(dir, StageRuleSchema);
      for (const rule of loaded) {
        this.rules.set(rule.id, rule);
      }
      logger.debug('RuleRegistry: loaded rules from disk', {
        category,
        count: loaded.length,
      });
    } catch (err) {
      throw new KataError(
        `Failed to load rules for "${category}" from "${dir}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    this.loadedCategories.add(category);
  }

  private ensureSuggestionsLoaded(): void {
    if (this.suggestionsLoaded) return;
    const dir = join(this.basePath, 'suggestions');
    try {
      const loaded = JsonStore.list(dir, RuleSuggestionSchema);
      for (const suggestion of loaded) {
        this.suggestions.set(suggestion.id, suggestion);
      }
      logger.debug('RuleRegistry: loaded suggestions from disk', {
        count: loaded.length,
      });
    } catch (err) {
      throw new KataError(
        `Failed to load suggestions from "${dir}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    this.suggestionsLoaded = true;
  }
}
