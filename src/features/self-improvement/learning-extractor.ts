import type { ExecutionHistoryEntry } from '@domain/types/history.js';
import type { Learning } from '@domain/types/learning.js';
import type { Stage } from '@domain/types/stage.js';

/**
 * A recurring pattern detected across execution history entries.
 */
export interface Pattern {
  id: string;
  stageType: string;
  description: string;
  evidence: Array<{
    historyEntryId: string;
    pipelineId: string;
    observation: string;
  }>;
  frequency: number;
  consistency: number; // 0-1
}

/**
 * A learning suggestion derived from a detected pattern.
 */
export interface SuggestedLearning {
  tier: 'stage' | 'category';
  category: string;
  content: string;
  stageType?: string;
  confidence: number;
  evidenceCount: number;
  pattern: Pattern;
}

/**
 * A proposed update to a stage prompt template.
 */
export interface PromptUpdate {
  stageType: string;
  currentPromptPath?: string;
  section: string;
  suggestion: string;
  rationale: string;
  basedOnLearnings: string[];
}

/** Minimum number of consistent observations to form a pattern. */
const PATTERN_THRESHOLD = 3;

/**
 * LearningExtractor — pattern detection engine that analyzes execution history
 * to find recurring patterns and suggest learnings and prompt updates.
 */
export class LearningExtractor {
  /**
   * Analyze execution history to find recurring patterns across pipeline runs.
   *
   * Detects four pattern types:
   * - Gate failure patterns: stages that consistently fail entry/exit gates
   * - High token usage patterns: stages with unusually high token consumption
   * - Artifact combination patterns: stages that consistently produce specific artifact sets
   * - Skip patterns: stages that are frequently skipped (gate failures without completion)
   */
  analyze(history: ExecutionHistoryEntry[]): Pattern[] {
    if (history.length === 0) return [];

    const patterns: Pattern[] = [];

    patterns.push(...this.detectGateFailurePatterns(history));
    patterns.push(...this.detectHighTokenUsagePatterns(history));
    patterns.push(...this.detectArtifactPatterns(history));
    patterns.push(...this.detectSkipPatterns(history));

    return patterns;
  }

  /**
   * Convert detected patterns into learning suggestions with tier, category,
   * and confidence scoring based on evidence count and consistency.
   */
  suggestLearnings(patterns: Pattern[]): SuggestedLearning[] {
    return patterns.map((pattern) => {
      const confidence = this.calculateConfidence(pattern);
      const { tier, category } = this.classifyPattern(pattern);

      return {
        tier,
        category,
        content: pattern.description,
        stageType: pattern.stageType,
        confidence,
        evidenceCount: pattern.evidence.length,
        pattern,
      };
    });
  }

  /**
   * Propose prompt template changes based on accumulated learnings.
   * For each stage with relevant learnings, suggest additions to the prompt
   * that incorporate the learned patterns.
   */
  suggestPromptUpdates(learnings: Learning[], stages: Stage[]): PromptUpdate[] {
    const updates: PromptUpdate[] = [];

    // Group learnings by stageType
    const learningsByStage = new Map<string, Learning[]>();
    for (const learning of learnings) {
      if (!learning.stageType) continue;
      const existing = learningsByStage.get(learning.stageType) ?? [];
      existing.push(learning);
      learningsByStage.set(learning.stageType, existing);
    }

    for (const stage of stages) {
      const stageLearnings = learningsByStage.get(stage.type);
      if (!stageLearnings || stageLearnings.length === 0) continue;

      // Group learnings by category for this stage
      const byCategory = new Map<string, Learning[]>();
      for (const l of stageLearnings) {
        const catList = byCategory.get(l.category) ?? [];
        catList.push(l);
        byCategory.set(l.category, catList);
      }

      for (const [category, catLearnings] of byCategory) {
        const suggestions = catLearnings
          .map((l) => `- ${l.content}`)
          .join('\n');

        updates.push({
          stageType: stage.type,
          currentPromptPath: stage.promptTemplate,
          section: category,
          suggestion: `## Learned Patterns (${category})\n\n${suggestions}`,
          rationale: `${catLearnings.length} learning(s) accumulated for "${category}" in the "${stage.type}" stage.`,
          basedOnLearnings: catLearnings.map((l) => l.id),
        });
      }
    }

    return updates;
  }

  // ---- Private pattern detection methods ----

  private detectGateFailurePatterns(history: ExecutionHistoryEntry[]): Pattern[] {
    const patterns: Pattern[] = [];

    // Group by stageType
    const byStage = this.groupByStageType(history);

    for (const [stageType, entries] of byStage) {
      // Entry gate failures
      const entryFailures = entries.filter((e) => e.entryGatePassed === false);
      if (entryFailures.length >= PATTERN_THRESHOLD) {
        const totalWithGate = entries.filter((e) => e.entryGatePassed !== undefined).length;
        const consistency = totalWithGate > 0 ? entryFailures.length / totalWithGate : 0;

        patterns.push({
          id: `gate-entry-fail-${stageType}`,
          stageType,
          description: `Stage "${stageType}" frequently fails entry gate checks (${entryFailures.length}/${totalWithGate} executions). Prerequisites may need review.`,
          evidence: entryFailures.map((e) => ({
            historyEntryId: e.id,
            pipelineId: e.pipelineId,
            observation: `Entry gate failed at stage index ${e.stageIndex}`,
          })),
          frequency: entryFailures.length,
          consistency,
        });
      }

      // Exit gate failures
      const exitFailures = entries.filter((e) => e.exitGatePassed === false);
      if (exitFailures.length >= PATTERN_THRESHOLD) {
        const totalWithGate = entries.filter((e) => e.exitGatePassed !== undefined).length;
        const consistency = totalWithGate > 0 ? exitFailures.length / totalWithGate : 0;

        patterns.push({
          id: `gate-exit-fail-${stageType}`,
          stageType,
          description: `Stage "${stageType}" frequently fails exit gate checks (${exitFailures.length}/${totalWithGate} executions). Output quality may need attention.`,
          evidence: exitFailures.map((e) => ({
            historyEntryId: e.id,
            pipelineId: e.pipelineId,
            observation: `Exit gate failed at stage index ${e.stageIndex}`,
          })),
          frequency: exitFailures.length,
          consistency,
        });
      }
    }

    return patterns;
  }

  private detectHighTokenUsagePatterns(history: ExecutionHistoryEntry[]): Pattern[] {
    const patterns: Pattern[] = [];

    // Calculate overall average token usage
    const entriesWithTokens = history.filter((e) => e.tokenUsage?.total !== undefined && e.tokenUsage.total > 0);
    if (entriesWithTokens.length === 0) return patterns;

    const overallAvg =
      entriesWithTokens.reduce((sum, e) => sum + (e.tokenUsage?.total ?? 0), 0) /
      entriesWithTokens.length;

    // Group by stageType
    const byStage = this.groupByStageType(entriesWithTokens);

    for (const [stageType, entries] of byStage) {
      if (entries.length < PATTERN_THRESHOLD) continue;

      const stageAvg =
        entries.reduce((sum, e) => sum + (e.tokenUsage?.total ?? 0), 0) / entries.length;

      // Flag if stage average is more than 2x the overall average
      if (stageAvg > overallAvg * 2) {
        const consistency = Math.min(1, stageAvg / (overallAvg * 3));

        patterns.push({
          id: `high-tokens-${stageType}`,
          stageType,
          description: `Stage "${stageType}" consistently uses high token counts (avg ${Math.round(stageAvg)} vs overall avg ${Math.round(overallAvg)}). Consider breaking into smaller steps or optimizing prompts.`,
          evidence: entries.map((e) => ({
            historyEntryId: e.id,
            pipelineId: e.pipelineId,
            observation: `Used ${e.tokenUsage?.total ?? 0} tokens (${((e.tokenUsage?.total ?? 0) / overallAvg).toFixed(1)}x average)`,
          })),
          frequency: entries.length,
          consistency,
        });
      }
    }

    return patterns;
  }

  private detectArtifactPatterns(history: ExecutionHistoryEntry[]): Pattern[] {
    const patterns: Pattern[] = [];

    const byStage = this.groupByStageType(history);

    for (const [stageType, entries] of byStage) {
      if (entries.length < PATTERN_THRESHOLD) continue;

      // Find the most common artifact set
      const artifactSets = new Map<string, ExecutionHistoryEntry[]>();
      for (const entry of entries) {
        if (entry.artifactNames.length === 0) continue;
        const key = [...entry.artifactNames].sort().join(',');
        const existing = artifactSets.get(key) ?? [];
        existing.push(entry);
        artifactSets.set(key, existing);
      }

      for (const [artifactKey, matchingEntries] of artifactSets) {
        if (matchingEntries.length < PATTERN_THRESHOLD) continue;

        const entriesWithArtifacts = entries.filter((e) => e.artifactNames.length > 0);
        const consistency =
          entriesWithArtifacts.length > 0
            ? matchingEntries.length / entriesWithArtifacts.length
            : 0;

        // Only surface patterns with significant consistency (>50%)
        if (consistency < 0.5) continue;

        const artifacts = artifactKey.split(',');
        patterns.push({
          id: `artifacts-${stageType}-${artifactKey.replace(/,/g, '-')}`,
          stageType,
          description: `Stage "${stageType}" consistently produces artifacts: ${artifacts.join(', ')} (${matchingEntries.length}/${entriesWithArtifacts.length} executions).`,
          evidence: matchingEntries.map((e) => ({
            historyEntryId: e.id,
            pipelineId: e.pipelineId,
            observation: `Produced artifacts: ${e.artifactNames.join(', ')}`,
          })),
          frequency: matchingEntries.length,
          consistency,
        });
      }
    }

    return patterns;
  }

  private detectSkipPatterns(history: ExecutionHistoryEntry[]): Pattern[] {
    const patterns: Pattern[] = [];

    const byStage = this.groupByStageType(history);

    for (const [stageType, entries] of byStage) {
      // A "skip" is when entry gate fails — the stage was attempted but not executed
      const skipped = entries.filter(
        (e) => e.entryGatePassed === false && e.exitGatePassed === undefined,
      );

      if (skipped.length < PATTERN_THRESHOLD) continue;

      const consistency = entries.length > 0 ? skipped.length / entries.length : 0;

      // Only flag if majority of executions are skipped
      if (consistency < 0.5) continue;

      patterns.push({
        id: `skip-${stageType}`,
        stageType,
        description: `Stage "${stageType}" is frequently skipped (${skipped.length}/${entries.length} executions). Consider if this stage is necessary or if its prerequisites should be adjusted.`,
        evidence: skipped.map((e) => ({
          historyEntryId: e.id,
          pipelineId: e.pipelineId,
          observation: `Stage skipped — entry gate failed`,
        })),
        frequency: skipped.length,
        consistency,
      });
    }

    return patterns;
  }

  // ---- Helpers ----

  private groupByStageType(
    entries: ExecutionHistoryEntry[],
  ): Map<string, ExecutionHistoryEntry[]> {
    const groups = new Map<string, ExecutionHistoryEntry[]>();
    for (const entry of entries) {
      const existing = groups.get(entry.stageType) ?? [];
      existing.push(entry);
      groups.set(entry.stageType, existing);
    }
    return groups;
  }

  private calculateConfidence(pattern: Pattern): number {
    // Base: consistency weighted by evidence count
    const evidenceFactor = Math.min(1, pattern.evidence.length / 10);
    return Math.round(pattern.consistency * 0.6 * 100 + evidenceFactor * 0.4 * 100) / 100;
  }

  private classifyPattern(pattern: Pattern): { tier: 'stage' | 'category'; category: string } {
    if (pattern.id.startsWith('gate-entry-fail') || pattern.id.startsWith('gate-exit-fail')) {
      return { tier: 'stage', category: 'gate-management' };
    }
    if (pattern.id.startsWith('high-tokens')) {
      return { tier: 'stage', category: 'token-efficiency' };
    }
    if (pattern.id.startsWith('artifacts')) {
      return { tier: 'stage', category: 'artifact-patterns' };
    }
    if (pattern.id.startsWith('skip')) {
      return { tier: 'category', category: 'stage-relevance' };
    }
    return { tier: 'category', category: 'general' };
  }
}
