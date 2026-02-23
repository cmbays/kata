import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Command } from 'commander';
import { StageRegistry } from '@infra/registries/stage-registry.js';
import { withCommandContext, kataDirPath } from '@cli/utils.js';
import { formatStageTable, formatStageDetail, formatStageJson } from '@cli/formatters/stage-formatter.js';
import { createStage } from '@features/stage-create/stage-creator.js';
import { editStage } from '@features/stage-create/stage-editor.js';
import type { Gate, GateCondition } from '@domain/types/gate.js';
import type { Artifact } from '@domain/types/artifact.js';

// ---- Shared interactive helpers ----

/**
 * Interactively collect gate conditions for one gate (entry or exit).
 * Optionally pre-seeds with existing conditions (edit mode).
 */
async function promptGateConditions(
  gateLabel: string,
  existing: GateCondition[],
): Promise<GateCondition[]> {
  const { input, confirm, select } = await import('@inquirer/prompts');
  let conditions: GateCondition[] = [];

  if (existing.length > 0) {
    const keep = await confirm({
      message: `Keep ${existing.length} existing ${gateLabel} gate condition(s) (${existing.map((c) => c.type).join(', ')})?`,
      default: true,
    });
    if (keep) {
      conditions = [...existing];
    }
  }

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
}

/**
 * Interactively collect artifact definitions.
 * Optionally pre-seeds with existing artifacts (edit mode).
 * Enforces name uniqueness across all collected artifacts.
 */
async function promptArtifacts(existing: Artifact[]): Promise<Artifact[]> {
  const { input, confirm } = await import('@inquirer/prompts');
  let artifacts: Artifact[] = [];

  if (existing.length > 0) {
    const keep = await confirm({
      message: `Keep ${existing.length} existing artifact(s) (${existing.map((a) => a.name).join(', ')})?`,
      default: true,
    });
    if (keep) {
      artifacts = [...existing];
    }
  }

  let addArtifact = await confirm({ message: 'Add an artifact?', default: false });
  while (addArtifact) {
    const name = (await input({
      message: '  Artifact name:',
      validate: (v) => {
        const t = v.trim();
        if (!t) return 'Name is required';
        if (artifacts.some((a) => a.name === t)) return `Artifact "${t}" already exists`;
        return true;
      },
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
  return artifacts;
}

/**
 * Build the initial content for a new prompt template .md file.
 * Pre-populates with the stage description and artifact names.
 */
function buildPromptContent(
  type: string,
  flavor: string | undefined,
  description: string | undefined,
  artifacts: Artifact[],
): string {
  const lines: string[] = [
    `# ${type}${flavor ? ` (${flavor})` : ''}`,
    '',
    description ?? '',
    '',
  ];

  if (artifacts.length > 0) {
    lines.push('## Outputs', '');
    for (const a of artifacts) {
      const req = a.required ? 'required' : 'optional';
      const ext = a.extension ? ` [${a.extension}]` : '';
      const desc = a.description ? `: ${a.description}` : '';
      lines.push(`- **${a.name}** (${req})${ext}${desc}`);
    }
    lines.push('');
  }

  lines.push('## Instructions', '', '<!-- Add your prompt instructions here -->', '');
  return lines.join('\n');
}

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
    .option('--from-file <path>', 'Load stage definition from a JSON file (skips interactive prompts)')
    .action(withCommandContext(async (ctx) => {
      const localOpts = ctx.cmd.opts();
      const stagesDir = kataDirPath(ctx.kataDir, 'stages');
      const isJson = ctx.globalOpts.json;

      // --- Non-interactive path: --from-file ---
      if (localOpts.fromFile) {
        const filePath = resolve(localOpts.fromFile as string);
        const raw: unknown = JSON.parse(readFileSync(filePath, 'utf-8'));
        const { stage } = createStage({ stagesDir, input: raw });
        if (isJson) {
          console.log(formatStageJson([stage]));
        } else {
          const label = stage.flavor ? `${stage.type} (${stage.flavor})` : stage.type;
          console.log(`Stage "${label}" created from file.`);
        }
        return;
      }

      // --- Interactive path ---
      const { input, confirm } = await import('@inquirer/prompts');

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
      const descRaw = await input({ message: 'Description (optional):' });
      const description = descRaw.trim() || undefined;

      // --- Artifacts (gap #4: uniqueness validated inside helper) ---
      const artifacts = await promptArtifacts([]);

      // --- Entry gate ---
      const entryConditions = await promptGateConditions('entry', []);
      let entryGate: Gate | undefined;
      if (entryConditions.length > 0) {
        const required = await confirm({ message: 'Is the entry gate required (blocking)?', default: true });
        entryGate = { type: 'entry', conditions: entryConditions, required };
      }

      // --- Exit gate ---
      const exitConditions = await promptGateConditions('exit', []);
      let exitGate: Gate | undefined;
      if (exitConditions.length > 0) {
        const required = await confirm({ message: 'Is the exit gate required (blocking)?', default: true });
        exitGate = { type: 'exit', conditions: exitConditions, required };
      }

      // --- Learning hooks ---
      const hooksRaw = await input({ message: 'Learning hooks (comma-separated, optional):' });
      const learningHooks = hooksRaw
        .split(',')
        .map((h) => h.trim())
        .filter((h) => h.length > 0);

      // --- Prompt template (gap #3: pre-populated with description + artifact names) ---
      let promptTemplate: string | undefined;
      const wantsPrompt = await confirm({
        message: 'Create a prompt template file in .kata/prompts/?',
        default: false,
      });
      if (wantsPrompt) {
        const slug = flavor ? `${type}.${flavor}` : type;
        const promptPath = join(ctx.kataDir, 'prompts', `${slug}.md`);
        mkdirSync(join(ctx.kataDir, 'prompts'), { recursive: true });
        promptTemplate = `../prompts/${slug}.md`;
        if (!existsSync(promptPath)) {
          writeFileSync(promptPath, buildPromptContent(type, flavor, description, artifacts), 'utf-8');
          if (!isJson) {
            console.error(`  Prompt template created at .kata/prompts/${slug}.md`);
          }
        }
      }

      // --- Write stage ---
      const { stage } = createStage({
        stagesDir,
        input: { type, flavor, description, artifacts, entryGate, exitGate, learningHooks, promptTemplate },
      });

      if (isJson) {
        console.log(formatStageJson([stage]));
      } else {
        const label = stage.flavor ? `${stage.type} (${stage.flavor})` : stage.type;
        console.log(`\nStage "${label}" created successfully.`);
        console.log(formatStageDetail(stage));
      }
    }));

  stage
    .command('edit <type>')
    .description('Edit an existing stage definition with current values as defaults')
    .option('--flavor <flavor>', 'Stage flavor to edit')
    .action(withCommandContext(async (ctx, type: string) => {
      const localOpts = ctx.cmd.opts();
      const flavor: string | undefined = localOpts.flavor;
      const stagesDir = kataDirPath(ctx.kataDir, 'stages');
      const isJson = ctx.globalOpts.json;

      // Load existing stage (throws StageNotFoundError if absent)
      const registry = new StageRegistry(stagesDir);
      const existing = registry.get(type, flavor);

      const { input, confirm } = await import('@inquirer/prompts');

      if (!isJson) {
        const label = flavor ? `${type} (${flavor})` : type;
        console.error(`Editing stage: ${label}`);
      }

      // --- Description ---
      const descRaw = await input({
        message: 'Description:',
        default: existing.description ?? '',
      });
      const description = descRaw.trim() || undefined;

      // --- Artifacts (gap #4: uniqueness validated inside helper) ---
      const artifacts = await promptArtifacts(existing.artifacts);

      // --- Entry gate ---
      const entryConditions = await promptGateConditions('entry', existing.entryGate?.conditions ?? []);
      let entryGate: Gate | undefined;
      if (entryConditions.length > 0) {
        const required = await confirm({
          message: 'Is the entry gate required (blocking)?',
          default: existing.entryGate?.required ?? true,
        });
        entryGate = { type: 'entry', conditions: entryConditions, required };
      }

      // --- Exit gate ---
      const exitConditions = await promptGateConditions('exit', existing.exitGate?.conditions ?? []);
      let exitGate: Gate | undefined;
      if (exitConditions.length > 0) {
        const required = await confirm({
          message: 'Is the exit gate required (blocking)?',
          default: existing.exitGate?.required ?? true,
        });
        exitGate = { type: 'exit', conditions: exitConditions, required };
      }

      // --- Learning hooks ---
      const hooksRaw = await input({
        message: 'Learning hooks (comma-separated, optional):',
        default: existing.learningHooks.join(', '),
      });
      const learningHooks = hooksRaw
        .split(',')
        .map((h) => h.trim())
        .filter((h) => h.length > 0);

      // --- Prompt template ---
      // If one already exists, keep it. Otherwise offer to create one.
      let promptTemplate: string | undefined = existing.promptTemplate;
      if (!promptTemplate) {
        const wantsPrompt = await confirm({
          message: 'Create a prompt template file in .kata/prompts/?',
          default: false,
        });
        if (wantsPrompt) {
          const slug = flavor ? `${type}.${flavor}` : type;
          const promptPath = join(ctx.kataDir, 'prompts', `${slug}.md`);
          mkdirSync(join(ctx.kataDir, 'prompts'), { recursive: true });
          promptTemplate = `../prompts/${slug}.md`;
          if (!existsSync(promptPath)) {
            writeFileSync(promptPath, buildPromptContent(type, flavor, description, artifacts), 'utf-8');
            if (!isJson) {
              console.error(`  Prompt template created at .kata/prompts/${slug}.md`);
            }
          }
        }
      }

      // --- Write updated stage ---
      const { stage } = editStage({
        stagesDir,
        type,
        flavor,
        input: {
          type,
          flavor,
          description,
          artifacts,
          entryGate,
          exitGate,
          learningHooks,
          promptTemplate,
          config: existing.config,
        },
      });

      if (isJson) {
        console.log(formatStageJson([stage]));
      } else {
        const label = stage.flavor ? `${stage.type} (${stage.flavor})` : stage.type;
        console.log(`\nStage "${label}" updated successfully.`);
        console.log(formatStageDetail(stage));
      }
    }));
}
