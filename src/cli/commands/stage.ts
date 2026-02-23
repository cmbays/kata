import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { StageRegistry } from '@infra/registries/stage-registry.js';
import { withCommandContext, kataDirPath } from '@cli/utils.js';
import { formatStageTable, formatStageDetail, formatStageJson } from '@cli/formatters/stage-formatter.js';
import { createStage } from '@features/stage-create/stage-creator.js';
import type { Gate, GateCondition } from '@domain/types/gate.js';
import type { Artifact } from '@domain/types/artifact.js';

/**
 * Register the `kata stage` subcommands.
 */
export function registerStageCommands(parent: Command): void {
  const stage = parent
    .command('stage')
    .alias('form')
    .description('Manage stages — reusable methodology steps (alias: form)');

  stage
    .command('list')
    .description('List available stages')
    .option('--flavor <stage-type>', 'Show only stages of this type (base + all flavors), e.g. --flavor build')
    .action(withCommandContext((ctx) => {
      const localOpts = ctx.cmd.opts();
      const registry = new StageRegistry(kataDirPath(ctx.kataDir, 'stages'));
      const stages = localOpts.flavor
        ? registry.list({ type: localOpts.flavor })
        : registry.list();

      if (ctx.globalOpts.json) {
        console.log(formatStageJson(stages));
      } else {
        console.log(formatStageTable(stages));
      }
    }));

  stage
    .command('inspect <type>')
    .description('Show details of a specific stage')
    .option('--flavor <flavor>', 'Stage flavor to inspect')
    .action(withCommandContext((ctx, type: string) => {
      const localOpts = ctx.cmd.opts();
      const registry = new StageRegistry(kataDirPath(ctx.kataDir, 'stages'));
      const stageObj = registry.get(type, localOpts.flavor);

      if (ctx.globalOpts.json) {
        console.log(formatStageJson([stageObj]));
      } else {
        console.log(formatStageDetail(stageObj));
      }
    }));

  stage
    .command('create')
    .description('Interactively scaffold a custom stage definition')
    .action(withCommandContext(async (ctx) => {
      const stagesDir = kataDirPath(ctx.kataDir, 'stages');
      const promptsDir = join(ctx.kataDir, 'prompts');
      const isJson = ctx.globalOpts.json;

      const { input, confirm, select } = await import('@inquirer/prompts');

      // --- Type ---
      const type = (await input({
        message: 'Stage type (e.g., "validate", "deploy-staging"):',
        validate: (v) => v.trim().length > 0 || 'Type is required',
      })).trim();

      // --- Flavor ---
      const flavorRaw = await input({
        message: 'Flavor (optional, e.g., "rust", "nextjs") — leave blank to skip:',
      });
      const flavor = flavorRaw.trim() || undefined;

      // --- Description ---
      const descRaw = await input({
        message: 'Description (optional):',
      });
      const description = descRaw.trim() || undefined;

      // --- Artifacts ---
      const artifacts: Artifact[] = [];
      let addArtifact = await confirm({
        message: 'Add an artifact?',
        default: false,
      });
      while (addArtifact) {
        const name = (await input({
          message: '  Artifact name:',
          validate: (v) => v.trim().length > 0 || 'Name is required',
        })).trim();
        const artifactDesc = await input({ message: '  Description (optional):' });
        const ext = await input({ message: '  File extension (optional, e.g., ".md"):' });
        const required = await confirm({ message: '  Required?', default: true });
        artifacts.push({
          name,
          description: artifactDesc.trim() || undefined,
          extension: ext.trim() || undefined,
          required,
        });
        addArtifact = await confirm({ message: 'Add another artifact?', default: false });
      }

      // --- Gate builder helper ---
      const buildGateConditions = async (gateLabel: string): Promise<GateCondition[]> => {
        const conditions: GateCondition[] = [];
        let addCond = await confirm({ message: `Add a ${gateLabel} gate condition?`, default: false });
        while (addCond) {
          const condType = await select({
            message: '  Condition type:',
            choices: [
              { name: 'artifact-exists', value: 'artifact-exists' as const },
              { name: 'schema-valid', value: 'schema-valid' as const },
              { name: 'human-approved', value: 'human-approved' as const },
              { name: 'predecessor-complete', value: 'predecessor-complete' as const },
              { name: 'command-passes', value: 'command-passes' as const },
            ],
          });
          const condDesc = await input({ message: '  Description (optional):' });

          let artifactName: string | undefined;
          let predecessorType: string | undefined;
          let command: string | undefined;

          if (condType === 'artifact-exists' || condType === 'schema-valid') {
            artifactName = (await input({ message: '  Artifact name:' })).trim() || undefined;
          } else if (condType === 'predecessor-complete') {
            predecessorType = (await input({ message: '  Predecessor stage type:' })).trim() || undefined;
          } else if (condType === 'command-passes') {
            command = (await input({ message: '  Shell command to run:' })).trim() || undefined;
          }

          conditions.push({
            type: condType,
            description: condDesc.trim() || undefined,
            artifactName,
            predecessorType,
            command,
          });
          addCond = await confirm({ message: `Add another ${gateLabel} gate condition?`, default: false });
        }
        return conditions;
      };

      // --- Entry gate ---
      const entryConditions = await buildGateConditions('entry');
      let entryGate: Gate | undefined;
      if (entryConditions.length > 0) {
        const required = await confirm({ message: 'Is the entry gate required (blocking)?', default: true });
        entryGate = { type: 'entry', conditions: entryConditions, required };
      }

      // --- Exit gate ---
      const exitConditions = await buildGateConditions('exit');
      let exitGate: Gate | undefined;
      if (exitConditions.length > 0) {
        const required = await confirm({ message: 'Is the exit gate required (blocking)?', default: true });
        exitGate = { type: 'exit', conditions: exitConditions, required };
      }

      // --- Learning hooks ---
      const hooksRaw = await input({
        message: 'Learning hooks (comma-separated, optional):',
      });
      const learningHooks = hooksRaw
        .split(',')
        .map((h) => h.trim())
        .filter((h) => h.length > 0);

      // --- Prompt template ---
      let promptTemplate: string | undefined;
      const wantsPrompt = await confirm({
        message: 'Create a prompt template file in .kata/prompts/?',
        default: false,
      });
      if (wantsPrompt) {
        const slug = flavor ? `${type}.${flavor}` : type;
        const promptPath = join(promptsDir, `${slug}.md`);
        mkdirSync(promptsDir, { recursive: true });
        // promptTemplate is relative from .kata/stages/ to .kata/prompts/
        promptTemplate = `../prompts/${slug}.md`;
        if (!existsSync(promptPath)) {
          const defaultContent = `# ${type}${flavor ? ` (${flavor})` : ''}\n\n${description ?? ''}\n\n## Instructions\n\n<!-- Add your prompt instructions here -->\n`;
          writeFileSync(promptPath, defaultContent, 'utf-8');
          if (!isJson) {
            console.error(`  Prompt template created at .kata/prompts/${slug}.md`);
          }
        }
      }

      // --- Write stage ---
      const { stage } = createStage({
        stagesDir,
        input: {
          type,
          flavor,
          description,
          artifacts,
          entryGate,
          exitGate,
          learningHooks,
          promptTemplate,
        },
      });

      if (isJson) {
        console.log(formatStageJson([stage]));
      } else {
        const label = stage.flavor ? `${stage.type} (${stage.flavor})` : stage.type;
        console.log(`\nStage "${label}" created successfully.`);
        console.log(formatStageDetail(stage));
      }
    }));
}
