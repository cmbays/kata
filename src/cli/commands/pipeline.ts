import { join } from 'node:path';
import type { Command } from 'commander';
import { resolveKataDir, getGlobalOptions } from '@cli/utils.js';
import { PipelineSchema, PipelineType, type Pipeline } from '@domain/types/pipeline.js';
import { KataConfigSchema } from '@domain/types/config.js';
import { PipelineComposer } from '@domain/services/pipeline-composer.js';
import { ManifestBuilder } from '@domain/services/manifest-builder.js';
import { StageRegistry } from '@infra/registries/stage-registry.js';
import { KnowledgeStore } from '@infra/knowledge/knowledge-store.js';
import { AdapterResolver } from '@infra/execution/adapter-resolver.js';
import { TokenTracker } from '@infra/tracking/token-tracker.js';
import { JsonStore } from '@infra/persistence/json-store.js';
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
 * Register flow (pipeline) commands on the given parent Command.
 */
export function registerPipelineCommands(program: Command): void {
  const flow = program
    .command('flow')
    .description('Manage flows — ordered compositions of forms');

  // kata flow start <type> [--enbu <cycle-id>] [--focus <bet-id>]
  flow
    .command('start <type>')
    .description('Start a new flow from a template type')
    .option('--enbu <cycle-id>', 'Link to an enbu (cycle)')
    .option('--focus <bet-id>', 'Link to a bet within an enbu')
    .action(async (type: string, opts: { enbu?: string; focus?: string }, cmd: Command) => {
      const globals = getGlobalOptions(cmd);

      try {
        const kataDir = resolveKataDir(globals.cwd);
        const pipelineDir = join(kataDir, 'pipelines');
        const stagesDir = join(kataDir, 'stages');
        const templateDir = join(kataDir, 'templates');

        // Initialize services
        const stageRegistry = new StageRegistry(stagesDir);
        const knowledgeStore = new KnowledgeStore(join(kataDir, 'knowledge'));
        const adapterResolver = new AdapterResolver();
        const resultCapturer = new ResultCapturer(kataDir);
        const tokenTracker = new TokenTracker(join(kataDir, 'tracking'));

        // Load config
        const configPath = join(kataDir, 'config.json');
        const config = JsonStore.exists(configPath)
          ? JsonStore.read(configPath, KataConfigSchema)
          : undefined;

        // Load template or create from type
        const templates = PipelineComposer.loadTemplates(templateDir);
        const template = templates.find((t) => t.type === type || t.name === type);

        let pipeline: Pipeline;
        if (template) {
          const metadata = {
            issueRefs: [] as string[],
            cycleId: opts.enbu,
            betId: opts.focus,
          };
          pipeline = PipelineComposer.instantiate(template, metadata);
        } else {
          const validTypes = PipelineType.options;
          console.error(
            `No template found for "${type}". ` +
            `Available types: ${validTypes.join(', ')}. ` +
            `Create a template at ${templateDir}/${type}.json or use "kata flow prep".`,
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
          pipelineDir,
        });

        const result = await runner.run(pipeline, config);

        if (globals.json) {
          console.log(formatPipelineResultJson(result));
        } else {
          console.log(formatPipelineResult(result));
        }

        if (!result.success) {
          process.exitCode = 1;
        }
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  // kata flow status [id]
  flow
    .command('status [id]')
    .description('Show flow status (single or all)')
    .action((id: string | undefined, _opts: unknown, cmd: Command) => {
      const globals = getGlobalOptions(cmd);

      try {
        const kataDir = resolveKataDir(globals.cwd);
        const pipelineDir = join(kataDir, 'pipelines');

        if (id) {
          // Show single pipeline
          const filePath = join(pipelineDir, `${id}.json`);
          if (!JsonStore.exists(filePath)) {
            console.error(`Flow not found: ${id}`);
            process.exitCode = 1;
            return;
          }

          const pipeline = JsonStore.read(filePath, PipelineSchema);
          if (globals.json) {
            console.log(formatPipelineStatusJson(pipeline));
          } else {
            console.log(formatPipelineStatus(pipeline));
          }
        } else {
          // List all pipelines
          const pipelines = JsonStore.list(pipelineDir, PipelineSchema);
          if (globals.json) {
            console.log(formatPipelineListJson(pipelines));
          } else {
            console.log(formatPipelineList(pipelines));
          }
        }
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  // kata flow prep <name> <stages...>
  flow
    .command('prep <name> <stages...>')
    .description('Prepare a custom flow from form type names')
    .action((name: string, stages: string[], _opts: unknown, cmd: Command) => {
      const globals = getGlobalOptions(cmd);

      try {
        const kataDir = resolveKataDir(globals.cwd);
        const stagesDir = join(kataDir, 'stages');
        const pipelineDir = join(kataDir, 'pipelines');

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

        if (globals.json) {
          console.log(formatPipelineStatusJson(pipeline));
        } else {
          console.log(`Flow "${name}" prepped with ${stageRefs.length} forms.`);
          console.log(`ID: ${pipeline.id}`);
        }
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });
}
