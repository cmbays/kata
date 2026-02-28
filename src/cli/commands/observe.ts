import { randomUUID } from 'node:crypto';
import type { Command } from 'commander';
import { StageCategorySchema } from '@domain/types/stage.js';
import {
  ObservationSchema,
  FrictionTaxonomy,
  GapSeverity,
  type Observation,
} from '@domain/types/observation.js';
import {
  appendObservation,
  readObservations,
  type ObservationTarget,
} from '@infra/persistence/run-store.js';
import { KATA_DIRS } from '@shared/constants/paths.js';
import { withCommandContext } from '@cli/utils.js';
import { getLexicon } from '@cli/lexicon.js';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Formatter helpers
// ---------------------------------------------------------------------------

function formatObservation(obs: Observation, plain?: boolean): string {
  const lex = getLexicon(plain);
  const lines: string[] = [];
  lines.push(`${lex.observation}: [${obs.type}] ${obs.content}`);
  lines.push(`  id: ${obs.id}`);
  lines.push(`  at: ${obs.timestamp}`);
  if (obs.katakaId) lines.push(`  ${lex.agent}: ${obs.katakaId}`);

  if (obs.type === 'friction') {
    lines.push(`  taxonomy: ${obs.taxonomy}`);
    if (obs.contradicts) lines.push(`  contradicts: ${obs.contradicts}`);
  }
  if (obs.type === 'gap') {
    lines.push(`  severity: ${obs.severity}`);
  }
  if (obs.type === 'prediction') {
    if (obs.timeframe) lines.push(`  timeframe: ${obs.timeframe}`);
    if (obs.quantitative) {
      lines.push(`  quantitative: ${obs.quantitative.predicted} ${obs.quantitative.unit} (${obs.quantitative.metric})`);
    }
    if (obs.qualitative) {
      lines.push(`  qualitative: ${obs.qualitative.expected}`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Resolve the target from CLI options
// ---------------------------------------------------------------------------

function resolveTarget(opts: {
  runId: string;
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
 * Register the `kata observe` command group (alias: `kata kansatsu`).
 *
 * Subcommands:
 *   kata observe record  — record a new observation during execution
 *   kata observe list    — list observations for a run
 */
export function registerObserveCommands(parent: Command): void {
  const observe = parent
    .command('observe')
    .alias('kansatsu')
    .description('Record and list kansatsu (observations) captured during execution (alias: kansatsu)');

  // ---------------------------------------------------------------------------
  // kata observe record
  // ---------------------------------------------------------------------------
  observe
    .command('record')
    .description('Record a new observation')
    .argument('<type>', `Observation type: decision | prediction | friction | gap | outcome | assumption | insight`)
    .argument('<content>', 'Observation content (what was observed)')
    .requiredOption('--run <id>', 'Run ID to attach this observation to')
    .option('--stage <category>', 'Stage category (research|plan|build|review) — scope this to a stage')
    .option('--flavor <name>', 'Flavor name — scope this to a flavor (requires --stage)')
    .option('--step <name>', 'Step name — scope this to a step (requires --stage and --flavor)')
    .option('--kataka <id>', 'Kataka (agent) ID recording this observation')
    // Friction-specific
    .option('--taxonomy <type>', `Friction taxonomy: ${FrictionTaxonomy.options.join(' | ')}`)
    .option('--contradicts <ref>', 'What this friction contradicts')
    // Gap-specific
    .option('--severity <level>', `Gap severity: ${GapSeverity.options.join(' | ')}`)
    // Prediction-specific
    .option('--timeframe <str>', 'Prediction timeframe (e.g. "1 sprint")')
    .action(withCommandContext((ctx, typeArg: string, contentArg: string) => {
      const localOpts = ctx.cmd.opts();
      const lex = getLexicon(ctx.globalOpts.plain);

      const runId = localOpts.run as string;
      const runsDir = join(ctx.kataDir, KATA_DIRS.runs);

      const target = resolveTarget({
        runId,
        stage: localOpts.stage,
        flavor: localOpts.flavor,
        step: localOpts.step,
      });

      // Build the observation object for the given type
      const baseFields = {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        content: contentArg,
        katakaId: localOpts.kataka,
      };

      let observation: Observation;

      switch (typeArg) {
        case 'friction': {
          if (!localOpts.taxonomy) {
            console.error(`Error: friction observations require --taxonomy (${FrictionTaxonomy.options.join(', ')})`);
            process.exitCode = 1;
            return;
          }
          const taxResult = FrictionTaxonomy.safeParse(localOpts.taxonomy);
          if (!taxResult.success) {
            console.error(`Error: invalid taxonomy "${localOpts.taxonomy}". Valid: ${FrictionTaxonomy.options.join(', ')}`);
            process.exitCode = 1;
            return;
          }
          observation = ObservationSchema.parse({
            ...baseFields,
            type: 'friction',
            taxonomy: taxResult.data,
            contradicts: localOpts.contradicts,
          });
          break;
        }
        case 'gap': {
          if (!localOpts.severity) {
            console.error(`Error: gap observations require --severity (${GapSeverity.options.join(', ')})`);
            process.exitCode = 1;
            return;
          }
          const sevResult = GapSeverity.safeParse(localOpts.severity);
          if (!sevResult.success) {
            console.error(`Error: invalid severity "${localOpts.severity}". Valid: ${GapSeverity.options.join(', ')}`);
            process.exitCode = 1;
            return;
          }
          observation = ObservationSchema.parse({
            ...baseFields,
            type: 'gap',
            severity: sevResult.data,
          });
          break;
        }
        case 'prediction': {
          observation = ObservationSchema.parse({
            ...baseFields,
            type: 'prediction',
            timeframe: localOpts.timeframe,
          });
          break;
        }
        case 'decision':
        case 'outcome':
        case 'assumption':
        case 'insight': {
          observation = ObservationSchema.parse({ ...baseFields, type: typeArg });
          break;
        }
        default: {
          console.error(`Error: unknown observation type "${typeArg}". Valid types: decision, prediction, friction, gap, outcome, assumption, insight`);
          process.exitCode = 1;
          return;
        }
      }

      appendObservation(runsDir, runId, observation, target);

      if (ctx.globalOpts.json) {
        console.log(JSON.stringify(observation, null, 2));
      } else {
        const levelLabel = target.level === 'run' ? 'run' : target.level;
        console.log(`✓ ${lex.observation} recorded [${typeArg}] at ${levelLabel} level`);
        console.log(`  id: ${observation.id}`);
      }
    }));

  // ---------------------------------------------------------------------------
  // kata observe list
  // ---------------------------------------------------------------------------
  observe
    .command('list')
    .description('List observations for a run')
    .requiredOption('--run <id>', 'Run ID')
    .option('--stage <category>', 'Filter to stage-level observations')
    .option('--flavor <name>', 'Filter to flavor-level observations (requires --stage)')
    .option('--step <name>', 'Filter to step-level observations (requires --stage and --flavor)')
    .option('--type <type>', 'Filter by observation type')
    .action(withCommandContext((ctx) => {
      const localOpts = ctx.cmd.opts();
      const lex = getLexicon(ctx.globalOpts.plain);
      const runsDir = join(ctx.kataDir, KATA_DIRS.runs);

      const target = resolveTarget({
        runId: localOpts.run as string,
        stage: localOpts.stage,
        flavor: localOpts.flavor,
        step: localOpts.step,
      });

      let observations = readObservations(runsDir, localOpts.run as string, target);

      if (localOpts.type) {
        observations = observations.filter((o) => o.type === localOpts.type);
      }

      if (ctx.globalOpts.json) {
        console.log(JSON.stringify(observations, null, 2));
        return;
      }

      if (observations.length === 0) {
        console.log(`No ${lex.observation} found.`);
        return;
      }

      console.log(`${lex.observation.charAt(0).toUpperCase() + lex.observation.slice(1)} (${observations.length}):\n`);
      for (const obs of observations) {
        console.log(formatObservation(obs, ctx.globalOpts.plain));
        console.log('');
      }
    }));
}
