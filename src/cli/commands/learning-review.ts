import type { Command } from 'commander';
import { KnowledgeStore } from '@infra/knowledge/knowledge-store.js';
import { StepRegistry } from '@infra/registries/step-registry.js';
import { RuleRegistry } from '@infra/registries/rule-registry.js';
import { ExecutionHistoryEntrySchema } from '@domain/types/history.js';
import type { RuleSuggestion } from '@domain/types/rule.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { LearningExtractor } from '@features/self-improvement/learning-extractor.js';
import type { SuggestedLearning } from '@features/self-improvement/learning-extractor.js';
import { PromptUpdater } from '@features/self-improvement/prompt-updater.js';
import { withCommandContext, kataDirPath } from '@cli/utils.js';
import {
  formatSuggestedLearning,
  formatPromptUpdateDiff,
  formatReviewSummary,
  formatSuggestedLearningJson,
} from '@cli/formatters/learning-formatter.js';

/**
 * Register the `knowledge review` subcommand on an existing knowledge command group.
 */
export function registerLearningReviewCommand(knowledge: Command): void {
  knowledge
    .command('review')
    .description('Interactive review of patterns extracted from execution history')
    .option('--stage <type>', 'Filter patterns by stage type')
    .option('--min-confidence <n>', 'Minimum confidence threshold', parseFloat)
    .option('--skip-prompts', 'Skip interactive prompts — auto-accept all suggestions')
    .action(withCommandContext(async (ctx) => {
      const localOpts = ctx.cmd.opts();

      // Load execution history
      const historyDir = kataDirPath(ctx.kataDir, 'history');
      const history = JsonStore.list(historyDir, ExecutionHistoryEntrySchema);

      if (history.length === 0) {
        console.log('No execution history found. Run some flows first to generate patterns.');
        return;
      }

      // Analyze patterns
      const extractor = new LearningExtractor();
      let patterns = extractor.analyze(history);

      // Filter by stage type if specified
      if (localOpts.stage) {
        patterns = patterns.filter((p) => p.stageType === localOpts.stage);
      }

      // Generate learning suggestions
      let suggestions = extractor.suggestLearnings(patterns);

      // Filter by confidence threshold if specified
      if (localOpts.minConfidence !== undefined) {
        suggestions = suggestions.filter((s) => s.confidence >= localOpts.minConfidence);
      }

      if (suggestions.length === 0) {
        console.log('No patterns found meeting the criteria. More execution history may be needed.');
        return;
      }

      // JSON output mode
      if (ctx.globalOpts.json) {
        console.log(formatSuggestedLearningJson(suggestions));
        return;
      }

      console.log(`Found ${suggestions.length} pattern(s) to review.\n`);

      // Interactive or auto-accept mode
      const knowledgeStore = new KnowledgeStore(kataDirPath(ctx.kataDir, 'knowledge'));
      const stageRegistry = new StepRegistry(kataDirPath(ctx.kataDir, 'stages'));
      const promptUpdater = new PromptUpdater();

      let accepted = 0;
      let rejected = 0;
      let promptsUpdated = 0;

      const acceptedLearnings: SuggestedLearning[] = [];

      if (localOpts.skipPrompts) {
        // Auto-accept all
        for (const suggestion of suggestions) {
          console.log(formatSuggestedLearning(suggestion, ctx.globalOpts.plain));
          console.log('  [Auto-accepted]\n');

          captureLearning(knowledgeStore, suggestion);
          acceptedLearnings.push(suggestion);
          accepted++;
        }
      } else {
        // Interactive review
        const { confirm } = await import('@inquirer/prompts');

        for (const suggestion of suggestions) {
          console.log(formatSuggestedLearning(suggestion, ctx.globalOpts.plain));
          console.log('');

          const accept = await confirm({
            message: 'Accept this learning?',
            default: true,
          });

          if (accept) {
            captureLearning(knowledgeStore, suggestion);
            acceptedLearnings.push(suggestion);
            accepted++;
            console.log('  Captured!\n');
          } else {
            rejected++;
            console.log('  Skipped.\n');
          }
        }
      }

      // Suggest prompt updates for accepted learnings
      if (acceptedLearnings.length > 0) {
        const allLearnings = knowledgeStore.query({});
        const stages = stageRegistry.list();
        const promptUpdates = extractor.suggestPromptUpdates(allLearnings, stages);

        if (promptUpdates.length > 0) {
          console.log(`\n${promptUpdates.length} prompt update(s) suggested:\n`);

          for (const update of promptUpdates) {
            console.log(formatPromptUpdateDiff(update, ctx.globalOpts.plain));
            console.log('');

            let applyUpdate = localOpts.skipPrompts;
            if (!localOpts.skipPrompts) {
              const { confirm } = await import('@inquirer/prompts');
              applyUpdate = await confirm({
                message: 'Apply this prompt update?',
                default: false,
              });
            }

            if (applyUpdate) {
              const result = promptUpdater.apply(ctx.kataDir, update, stageRegistry);
              if (result.applied) {
                promptsUpdated++;
                console.log(`  Applied! Backup at: ${result.backupPath}\n`);
              } else {
                console.log(`  Failed: ${result.error}\n`);
              }
            } else {
              console.log('  Skipped.\n');
            }
          }
        }
      }

      // Rule suggestion review
      let rulesAccepted = 0;
      let rulesRejected = 0;
      const ruleRegistry = new RuleRegistry(
        kataDirPath(ctx.kataDir, 'rules'),
      );
      const pendingSuggestions = ruleRegistry.getPendingSuggestions();

      if (pendingSuggestions.length > 0) {
        console.log(`\n${pendingSuggestions.length} rule suggestion(s) to review:\n`);

        if (localOpts.skipPrompts) {
          for (const suggestion of pendingSuggestions) {
            try {
              console.log(formatRuleSuggestion(suggestion, ctx.globalOpts.plain));
              ruleRegistry.acceptSuggestion(suggestion.id);
              console.log('  [Auto-accepted]\n');
              rulesAccepted++;
            } catch (err) {
              console.error(`  Failed to accept rule suggestion: ${err instanceof Error ? err.message : String(err)}\n`);
            }
          }
        } else {
          const { select, input } = await import('@inquirer/prompts');

          for (const suggestion of pendingSuggestions) {
            try {
              console.log(formatRuleSuggestion(suggestion, ctx.globalOpts.plain));
              console.log('');

              const action = await select({
                message: 'Action for this rule suggestion?',
                choices: [
                  { name: 'Accept', value: 'accept' },
                  { name: 'Accept with notes', value: 'accept-edit' },
                  { name: 'Reject', value: 'reject' },
                  { name: 'Skip', value: 'skip' },
                ],
              });

              if (action === 'accept') {
                ruleRegistry.acceptSuggestion(suggestion.id);
                rulesAccepted++;
                console.log('  Promoted to active rule!\n');
              } else if (action === 'accept-edit') {
                const editDelta = await input({
                  message: 'Edit notes (what you changed):',
                });
                ruleRegistry.acceptSuggestion(suggestion.id, editDelta);
                rulesAccepted++;
                console.log('  Promoted to active rule (with edits)!\n');
              } else if (action === 'reject') {
                const reason = await input({
                  message: 'Rejection reason:',
                });
                ruleRegistry.rejectSuggestion(suggestion.id, reason);
                rulesRejected++;
                console.log('  Rejected.\n');
              } else {
                console.log('  Skipped.\n');
              }
            } catch (err) {
              console.error(`  Failed to process rule suggestion: ${err instanceof Error ? err.message : String(err)}\n`);
            }
          }
        }
      }

      console.log('');
      console.log(formatReviewSummary(accepted, rejected, promptsUpdated, ctx.globalOpts.plain));
      if (rulesAccepted > 0 || rulesRejected > 0) {
        console.log('');
        console.log(`  Rules accepted:      ${rulesAccepted}`);
        console.log(`  Rules rejected:      ${rulesRejected}`);
      }
    }));
}

// ---- Helpers ----

function formatRuleSuggestion(suggestion: RuleSuggestion, plain?: boolean): string {
  void plain; // reserved for future localisation
  const rule = suggestion.suggestedRule;
  const lines: string[] = [];
  lines.push('=== Rule Suggestion ===');
  lines.push('');
  lines.push(`  Category:     ${rule.category}`);
  lines.push(`  Name:         ${rule.name}`);
  lines.push(`  Condition:    ${rule.condition}`);
  lines.push(`  Effect:       ${rule.effect} (magnitude: ${rule.magnitude.toFixed(2)})`);
  lines.push(`  Confidence:   ${rule.confidence.toFixed(2)}`);
  lines.push(`  Source:       ${rule.source}`);
  lines.push(`  Observations: ${suggestion.observationCount}`);
  lines.push('');
  lines.push(`  Reasoning:`);
  lines.push(`    ${suggestion.reasoning}`);
  if (rule.evidence.length > 0) {
    lines.push('');
    lines.push('  Evidence:');
    for (const e of rule.evidence.slice(0, 3)) {
      lines.push(`    - ${e}`);
    }
    if (rule.evidence.length > 3) {
      lines.push(`    ... and ${rule.evidence.length - 3} more`);
    }
  }
  return lines.join('\n');
}

function captureLearning(store: KnowledgeStore, suggestion: SuggestedLearning): void {
  store.capture({
    tier: suggestion.tier,
    category: suggestion.category,
    content: suggestion.content,
    stageType: suggestion.stageType,
    confidence: suggestion.confidence,
    evidence: suggestion.pattern.evidence.map((e) => ({
      pipelineId: e.pipelineId,
      stageType: suggestion.stageType ?? suggestion.pattern.stageType,
      observation: e.observation,
      recordedAt: new Date().toISOString(),
    })),
  });
}
