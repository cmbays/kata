import { randomUUID } from 'node:crypto';
import type { Command } from 'commander';
import { withCommandContext, kataDirPath } from '@cli/utils.js';
import { JsonlStore } from '@infra/persistence/jsonl-store.js';
import { readRun, readStageState, writeStageState, runPaths } from '@infra/persistence/run-store.js';
import {
  DecisionEntrySchema,
  DecisionOutcomeEntrySchema,
} from '@domain/types/run-state.js';
import { StageCategorySchema } from '@domain/types/stage.js';
import type { StageCategory } from '@domain/types/stage.js';
import { DecisionTypeSchema } from '@domain/types/decision.js';
import { logger } from '@shared/lib/logger.js';

export function registerDecisionCommands(parent: Command): void {
  const decision = parent
    .command('decision')
    .description('Record and update decisions made during kata runs');

  // kata decision record <run-id>
  decision
    .command('record <run-id>')
    .description('Append a decision to a run\'s decision log')
    .requiredOption('--stage <category>', 'Stage category where the decision was made')
    .option('--flavor <name>', 'Flavor context of the decision (omit for stage-level decisions)')
    .option('--step <name>', 'Step context of the decision (omit for flavor/stage-level decisions)')
    .requiredOption('--type <decision-type>', 'Type of decision (e.g. flavor-selection, execution-mode)')
    .requiredOption('--context <json>', 'JSON object of contextual information at decision time')
    .requiredOption('--options <json>', 'JSON array of available options the orchestrator considered')
    .requiredOption('--selected <option>', 'The option that was chosen')
    .requiredOption('--confidence <number>', 'Confidence in the selection [0-1]', parseFloat)
    .requiredOption('--reasoning <text>', 'Orchestrator\'s reasoning for the selection')
    .action(withCommandContext(async (ctx, runId: string) => {
      const localOpts = ctx.cmd.opts();
      const runsDir = kataDirPath(ctx.kataDir, 'runs');

      // Validate stage category
      const stageResult = StageCategorySchema.safeParse(localOpts.stage);
      if (!stageResult.success) {
        throw new Error(
          `Invalid stage category "${localOpts.stage}". Must be one of: research, plan, build, review`,
        );
      }
      const stage = stageResult.data as StageCategory;

      // Validate confidence
      const confidence = localOpts.confidence as number;
      if (Number.isNaN(confidence) || confidence < 0 || confidence > 1) {
        throw new Error(`--confidence must be a number between 0 and 1, got: ${localOpts.confidence as string}`);
      }

      // Parse context JSON
      let context: Record<string, unknown>;
      try {
        context = JSON.parse(localOpts.context as string) as Record<string, unknown>;
        if (typeof context !== 'object' || Array.isArray(context) || context === null) {
          throw new Error('must be a JSON object');
        }
      } catch (e) {
        throw new Error(`--context must be a valid JSON object: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
      }

      // Parse options JSON
      let options: string[];
      try {
        const parsed: unknown = JSON.parse(localOpts.options as string);
        if (!Array.isArray(parsed) || parsed.some((o) => typeof o !== 'string')) {
          throw new Error('must be a JSON array of strings');
        }
        options = parsed as string[];
      } catch (e) {
        throw new Error(`--options must be a valid JSON array of strings: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
      }

      // Cross-validate --selected against --options when options are provided
      // Empty options is valid for gap-assessment decisions
      const selected = localOpts.selected as string;
      if (options.length > 0 && !options.includes(selected)) {
        throw new Error(
          `--selected "${selected}" is not in --options. Available: ${options.join(', ')}`,
        );
      }

      // Validate decision type (warn on unknown, do not reject)
      const decisionType = localOpts.type as string;
      const knownTypeResult = DecisionTypeSchema.safeParse(decisionType);
      if (!knownTypeResult.success) {
        logger.warn(`Unknown decision type "${decisionType}". Known types: ${DecisionTypeSchema.options.join(', ')}`);
      }

      // Validate run exists
      readRun(runsDir, runId);

      const paths = runPaths(runsDir, runId);
      const id = randomUUID();
      const now = new Date().toISOString();

      const entry = {
        id,
        stageCategory: stage,
        flavor: (localOpts.flavor as string | undefined) ?? null,
        step: (localOpts.step as string | undefined) ?? null,
        decisionType,
        context,
        options,
        selection: selected,
        reasoning: localOpts.reasoning as string,
        confidence,
        decidedAt: now,
      };

      // Append to run-level decisions.jsonl
      JsonlStore.append(paths.decisionsJsonl, entry, DecisionEntrySchema);

      // Update stage state decisions array
      try {
        const stageState = readStageState(runsDir, runId, stage);
        stageState.decisions.push(id);
        writeStageState(runsDir, runId, stageState);
      } catch {
        // Stage state file may not exist yet (e.g. run just started); that's ok
        logger.warn(`Could not update stage state decisions for run "${runId}", stage "${stage}"`);
      }

      if (ctx.globalOpts.json) {
        console.log(JSON.stringify(entry, null, 2));
      } else {
        console.log(`Decision recorded: ${decisionType}`);
        console.log(`  ID:         ${id}`);
        console.log(`  Stage:      ${stage}`);
        if (entry.flavor) console.log(`  Flavor:     ${entry.flavor}`);
        if (entry.step) console.log(`  Step:       ${entry.step}`);
        console.log(`  Selected:   ${selected}`);
        console.log(`  Confidence: ${confidence}`);
      }
    }));

  // kata decision update <run-id> <decision-id>
  decision
    .command('update <run-id> <decision-id>')
    .description('Record a post-facto outcome for a decision')
    .requiredOption('--outcome <value>', 'Outcome quality: good | partial | poor | unknown')
    .option('--notes <text>', 'Free-text notes about the outcome')
    .option('--user-overrides <json>', 'JSON string of user overrides applied to the decision')
    .action(withCommandContext(async (ctx, runId: string, decisionId: string) => {
      const localOpts = ctx.cmd.opts();
      const runsDir = kataDirPath(ctx.kataDir, 'runs');

      // Validate outcome
      const validOutcomes = ['good', 'partial', 'poor', 'unknown'] as const;
      if (!validOutcomes.includes(localOpts.outcome as typeof validOutcomes[number])) {
        throw new Error(
          `Invalid outcome "${localOpts.outcome as string}". Must be one of: ${validOutcomes.join(', ')}`,
        );
      }

      // Validate run exists
      readRun(runsDir, runId);

      const paths = runPaths(runsDir, runId);

      // Validate decision ID exists in decisions.jsonl
      const decisions = JsonlStore.readAll(paths.decisionsJsonl, DecisionEntrySchema);
      const decision = decisions.find((d) => d.id === decisionId);
      if (!decision) {
        throw new Error(
          `Decision "${decisionId}" not found in run "${runId}". ` +
          `Use "kata run status ${runId}" to list decision IDs.`,
        );
      }

      const entry = {
        decisionId,
        outcome: localOpts.outcome as 'good' | 'partial' | 'poor' | 'unknown',
        notes: localOpts.notes as string | undefined,
        userOverrides: localOpts.userOverrides as string | undefined,
        updatedAt: new Date().toISOString(),
      };

      // Append to decision-outcomes.jsonl
      JsonlStore.append(paths.decisionOutcomesJsonl, entry, DecisionOutcomeEntrySchema);

      if (ctx.globalOpts.json) {
        console.log(JSON.stringify(entry, null, 2));
      } else {
        console.log(`Decision outcome recorded.`);
        console.log(`  Decision: ${decisionId}`);
        console.log(`  Outcome:  ${entry.outcome}`);
        if (entry.notes) console.log(`  Notes:    ${entry.notes}`);
      }
    }));
}
