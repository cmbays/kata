import type { Command } from 'commander';
import { KnowledgeStore } from '@infra/knowledge/knowledge-store.js';
import { StageRegistry } from '@infra/registries/stage-registry.js';
import { ExecutionHistoryEntrySchema } from '@domain/types/history.js';
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
      const stageRegistry = new StageRegistry(kataDirPath(ctx.kataDir, 'stages'));
      const promptUpdater = new PromptUpdater();

      let accepted = 0;
      let rejected = 0;
      let promptsUpdated = 0;

      const acceptedLearnings: SuggestedLearning[] = [];

      if (localOpts.skipPrompts) {
        // Auto-accept all
        for (const suggestion of suggestions) {
          console.log(formatSuggestedLearning(suggestion));
          console.log('  [Auto-accepted]\n');

          captureLearning(knowledgeStore, suggestion);
          acceptedLearnings.push(suggestion);
          accepted++;
        }
      } else {
        // Interactive review
        const { confirm } = await import('@inquirer/prompts');

        for (const suggestion of suggestions) {
          console.log(formatSuggestedLearning(suggestion));
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
            console.log(formatPromptUpdateDiff(update));
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

      console.log('');
      console.log(formatReviewSummary(accepted, rejected, promptsUpdated));
    }));
}

// ---- Helpers ----

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
