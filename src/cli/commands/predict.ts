import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Command } from 'commander';
import { StageCategorySchema } from '@domain/types/stage.js';
import { ObservationSchema, type Observation } from '@domain/types/observation.js';
import {
  appendObservation,
  type ObservationTarget,
} from '@infra/persistence/run-store.js';
import { KATA_DIRS } from '@shared/constants/paths.js';
import { withCommandContext } from '@cli/utils.js';

// ---------------------------------------------------------------------------
// Resolve observation target from CLI options
// ---------------------------------------------------------------------------

function resolveTarget(opts: {
  stage?: string;
  flavor?: string;
  step?: string;
}): ObservationTarget {
  if (opts.step && opts.flavor && opts.stage) {
    const catResult = StageCategorySchema.safeParse(opts.stage);
    if (!catResult.success) throw new Error(`Invalid stage category: "${opts.stage}"`);
    return { level: 'step', category: catResult.data, flavor: opts.flavor, step: opts.step };
  }
  if (opts.flavor && opts.stage) {
    const catResult = StageCategorySchema.safeParse(opts.stage);
    if (!catResult.success) throw new Error(`Invalid stage category: "${opts.stage}"`);
    return { level: 'flavor', category: catResult.data, flavor: opts.flavor };
  }
  if (opts.stage) {
    const catResult = StageCategorySchema.safeParse(opts.stage);
    if (!catResult.success) throw new Error(`Invalid stage category: "${opts.stage}"`);
    return { level: 'stage', category: catResult.data };
  }
  return { level: 'run' };
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

/**
 * Register the `kata predict` command.
 *
 * Records a prediction observation for a given run.
 * Supports optional quantitative fields (--metric, --value, --unit).
 */
export function registerPredictCommand(parent: Command): void {
  parent
    .command('predict')
    .description('Record a prediction observation for a run')
    .argument('<content>', 'Prediction content — what you expect to happen')
    .requiredOption('--run <id>', 'Run ID to attach this prediction to')
    .option('--stage <category>', 'Stage category (research|plan|build|review)')
    .option('--flavor <name>', 'Flavor name (requires --stage)')
    .option('--step <name>', 'Step name (requires --stage and --flavor)')
    .option('--kataka <id>', 'Agent (kataka) ID recording this prediction')
    .option('--timeframe <str>', 'Prediction timeframe (e.g. "1 sprint", "end of day")')
    .option('--metric <name>', 'Metric being predicted (for quantitative prediction)')
    .option('--value <num>', 'Predicted numeric value (for quantitative prediction)')
    .option('--unit <str>', 'Unit for the predicted value (for quantitative prediction)')
    .action(withCommandContext((ctx, contentArg: string) => {
      const localOpts = ctx.cmd.opts();
      const runId = localOpts.run as string;
      const runsDir = join(ctx.kataDir, KATA_DIRS.runs);

      const target = resolveTarget({
        stage: localOpts.stage,
        flavor: localOpts.flavor,
        step: localOpts.step,
      });

      // Build quantitative field if all three flags are present
      let quantitative: { metric: string; predicted: number; unit: string } | undefined;
      if (localOpts.metric && localOpts.value !== undefined && localOpts.unit) {
        const predicted = parseFloat(localOpts.value as string);
        if (isNaN(predicted)) {
          console.error(`Error: --value must be a valid number, got "${localOpts.value}"`);
          process.exitCode = 1;
          return;
        }
        quantitative = {
          metric: localOpts.metric as string,
          predicted,
          unit: localOpts.unit as string,
        };
      }

      const observation: Observation = ObservationSchema.parse({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        content: contentArg,
        type: 'prediction',
        katakaId: localOpts.kataka,
        timeframe: localOpts.timeframe,
        quantitative,
      });

      appendObservation(runsDir, runId, observation, target);

      if (ctx.globalOpts.json) {
        console.log(JSON.stringify(observation, null, 2));
      } else {
        const levelLabel = target.level;
        console.log(`Prediction recorded at ${levelLabel} level`);
        console.log(`  id: ${observation.id}`);
        if (quantitative) {
          console.log(`  quantitative: ${quantitative.predicted} ${quantitative.unit} (${quantitative.metric})`);
        }
      }
    }));
}
