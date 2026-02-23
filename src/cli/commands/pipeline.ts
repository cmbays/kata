import { join } from 'node:path';
import type { Command } from 'commander';
import { withCommandContext, kataDirPath } from '@cli/utils.js';
import { PipelineSchema, PipelineType, type Pipeline } from '@domain/types/pipeline.js';
import { KataConfigSchema } from '@domain/types/config.js';
import { PipelineComposer } from '@domain/services/pipeline-composer.js';
import { ManifestBuilder } from '@domain/services/manifest-builder.js';
import { StageRegistry } from '@infra/registries/stage-registry.js';
import { KnowledgeStore } from '@infra/knowledge/knowledge-store.js';
import { AdapterResolver } from '@infra/execution/adapter-resolver.js';
import { TokenTracker } from '@infra/tracking/token-tracker.js';
import { RefResolver } from '@infra/config/ref-resolver.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { loadPipelineTemplates } from '@infra/persistence/pipeline-template-store.js';
import { PipelineRunner } from '@features/pipeline-run/pipeline-runner.js';
import { ResultCapturer } from '@features/pipeline-run/result-capturer.js';
import {
  formatPipelineStatus,
  formatPipelineList,
  formatPipelineResult,
  formatPipelineStatusJson,
  formatPipelineListJson,
  formatPipelineResultJson,
} from '@cli/formatters/pipeline-formatter.js';

/**
 * Register pipeline commands on the given parent Command.
 */
export function registerPipelineCommands(program: Command): void {
  const pipeline = program
    .command('pipeline')
    .alias('flow')
    .description('Manage pipelines — ordered compositions of stages (alias: flow)');

  // kata pipeline start <type> [--cycle <cycle-id>] [--focus <bet-id>] [--yolo]
  pipeline
    .command('start <type>')
    .description('Start a new pipeline from a template type')
    .option('--cycle <cycle-id>', 'Link to a cycle')
    .option('--focus <bet-id>', 'Link to a bet within an enbu')
    .option('--yolo', 'Bypass all gate checks including exit gates (entry, exit, artifact, human-approved) — use only in dev/test')
    .action(withCommandContext(async (ctx, type: string) => {
      const localOpts = ctx.cmd.opts();
      const pipelineDir = kataDirPath(ctx.kataDir, 'pipelines');
      const stagesDir = kataDirPath(ctx.kataDir, 'stages');
      const templateDir = kataDirPath(ctx.kataDir, 'templates');

      // Initialize services
      const stageRegistry = new StageRegistry(stagesDir);
      const knowledgeStore = new KnowledgeStore(kataDirPath(ctx.kataDir, 'knowledge'));
      const adapterResolver = AdapterResolver;
      const resultCapturer = new ResultCapturer(ctx.kataDir);
      const tokenTracker = new TokenTracker(kataDirPath(ctx.kataDir, 'tracking'));

      // Load config
      const configPath = kataDirPath(ctx.kataDir, 'config');
      const config = JsonStore.exists(configPath)
        ? JsonStore.read(configPath, KataConfigSchema)
        : undefined;

      // Load template or create from type
      const templates = loadPipelineTemplates(templateDir);
      const template = templates.find((t) => t.type === type || t.name === type);

      let pipeline: Pipeline;
      if (template) {
        const metadata = {
          issueRefs: [] as string[],
          cycleId: localOpts.cycle,
          betId: localOpts.focus,
        };
        pipeline = PipelineComposer.instantiate(template, metadata);
      } else {
        const validTypes = PipelineType.options;
        console.error(
          `No template found for "${type}". ` +
          `Available types: ${validTypes.join(', ')}. ` +
          `Create a template at ${templateDir}/${type}.json or use "kata pipeline prep".`,
        );
        process.exitCode = 1;
        return;
      }

      // Persist the pipeline first
      JsonStore.write(
        join(pipelineDir, `${pipeline.id}.json`),
        pipeline,
        PipelineSchema,
      );

      // Run the pipeline
      const runner = new PipelineRunner({
        stageRegistry,
        knowledgeStore,
        adapterResolver,
        resultCapturer,
        tokenTracker,
        manifestBuilder: ManifestBuilder,
        persistPipeline: (p) =>
          JsonStore.write(join(pipelineDir, `${p.id}.json`), p, PipelineSchema),
        stagesDir,
        refResolver: RefResolver,
        yolo: localOpts.yolo === true,
      });

      const result = await runner.run(pipeline, config);

      if (ctx.globalOpts.json) {
        console.log(formatPipelineResultJson(result));
      } else {
        console.log(formatPipelineResult(result));
      }

      if (!result.success) {
        process.exitCode = 1;
      }
    }));

  // kata pipeline approve <pipeline-id>
  pipeline
    .command('approve <pipeline-id>')
    .description('Approve the current stage in a pipeline awaiting human review')
    .action(withCommandContext((ctx, pipelineId: string) => {
      const pipelineDir = kataDirPath(ctx.kataDir, 'pipelines');
      const filePath = join(pipelineDir, `${pipelineId}.json`);

      if (!JsonStore.exists(filePath)) {
        console.error(`Pipeline not found: ${pipelineId}`);
        process.exitCode = 1;
        return;
      }

      const p = JsonStore.read(filePath, PipelineSchema);

      if (p.state === 'complete' || p.state === 'abandoned') {
        console.error(`Cannot approve: pipeline is already in terminal state "${p.state}".`);
        process.exitCode = 1;
        return;
      }

      const stageState = p.stages[p.currentStageIndex];

      if (!stageState) {
        console.error('No current stage to approve.');
        process.exitCode = 1;
        return;
      }

      if (stageState.state === 'complete' || stageState.state === 'failed' || stageState.state === 'skipped') {
        console.error(`Cannot approve: stage "${stageState.stageRef.type}" is already in terminal state "${stageState.state}".`);
        process.exitCode = 1;
        return;
      }

      if (stageState.humanApprovedAt) {
        console.warn(`Warning: stage "${stageState.stageRef.type}" was already approved at ${stageState.humanApprovedAt}. Re-approving.`);
      }

      stageState.humanApprovedAt = new Date().toISOString();
      p.updatedAt = new Date().toISOString();
      JsonStore.write(filePath, p, PipelineSchema);

      console.log(
        `Stage "${stageState.stageRef.type}" approved for pipeline ${pipelineId}.`,
      );
      console.log('Run `kata pipeline start` again (or resume) to continue execution.');
    }));

  // kata pipeline status [id]
  pipeline
    .command('status [id]')
    .description('Show pipeline status (single or all)')
    .action(withCommandContext((ctx, id: string | undefined) => {
      const pipelineDir = kataDirPath(ctx.kataDir, 'pipelines');

      if (id) {
        // Show single pipeline
        const filePath = join(pipelineDir, `${id}.json`);
        if (!JsonStore.exists(filePath)) {
          console.error(`Pipeline not found: ${id}`);
          process.exitCode = 1;
          return;
        }

        const p = JsonStore.read(filePath, PipelineSchema);
        if (ctx.globalOpts.json) {
          console.log(formatPipelineStatusJson(p));
        } else {
          console.log(formatPipelineStatus(p));
        }
      } else {
        // List all pipelines
        const pipelines = JsonStore.list(pipelineDir, PipelineSchema);
        if (ctx.globalOpts.json) {
          console.log(formatPipelineListJson(pipelines));
        } else {
          console.log(formatPipelineList(pipelines));
        }
      }
    }));

  // kata pipeline prep <name> <stages...>
  pipeline
    .command('prep <name> <stages...>')
    .description('Prepare a custom pipeline from stage type names')
    .action(withCommandContext((ctx, name: string, stages: string[]) => {
      const stagesDir = kataDirPath(ctx.kataDir, 'stages');
      const pipelineDir = kataDirPath(ctx.kataDir, 'pipelines');

      // Validate that all stages exist in the registry
      const stageRegistry = new StageRegistry(stagesDir);
      const stageRefs = stages.map((s) => {
        const parts = s.split(':');
        const type = parts[0] as string;
        const flavor = parts[1];

        // Validate stage exists
        stageRegistry.get(type, flavor);

        return { type, flavor };
      });

      // Create the pipeline
      const pipeline = PipelineComposer.define(
        name,
        PipelineType.parse('custom'),
        stageRefs,
      );

      // Validate
      const validation = PipelineComposer.validate(pipeline, stageRegistry);
      if (!validation.valid) {
        console.error('Pipeline validation failed:');
        for (const error of validation.errors) {
          console.error(`  - ${error}`);
        }
        process.exitCode = 1;
        return;
      }

      // Persist
      JsonStore.write(
        join(pipelineDir, `${pipeline.id}.json`),
        pipeline,
        PipelineSchema,
      );

      if (ctx.globalOpts.json) {
        console.log(formatPipelineStatusJson(pipeline));
      } else {
        console.log(`Pipeline "${name}" prepped with ${stageRefs.length} stages.`);
        console.log(`ID: ${pipeline.id}`);
      }
    }));
}
