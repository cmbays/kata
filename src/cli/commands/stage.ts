import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Command } from 'commander';
import { StageRegistry } from '@infra/registries/stage-registry.js';
import { StageNotFoundError } from '@shared/lib/errors.js';
import { withCommandContext, kataDirPath } from '@cli/utils.js';
import { formatStageTable, formatStageDetail, formatStageJson } from '@cli/formatters/stage-formatter.js';
import { createStage } from '@features/stage-create/stage-creator.js';
import { editStage } from '@features/stage-create/stage-editor.js';
import { deleteStage } from '@features/stage-create/stage-deleter.js';
import type { Gate, GateCondition } from '@domain/types/gate.js';
import type { Artifact } from '@domain/types/artifact.js';
import type { Stage, StageResources } from '@domain/types/stage.js';

// ---- Preset agent/skill lists for resources ----

const PRESET_AGENTS: { name: string; when: string }[] = [
  { name: 'everything-claude-code:build-error-resolver', when: 'when build fails' },
  { name: 'everything-claude-code:tdd-guide', when: 'for test-first development' },
  { name: 'everything-claude-code:code-reviewer', when: 'after writing code' },
  { name: 'everything-claude-code:e2e-runner', when: 'for end-to-end testing' },
  { name: 'everything-claude-code:architect', when: 'for architectural decisions' },
  { name: 'everything-claude-code:refactor-cleaner', when: 'for cleanup and refactoring' },
  { name: 'everything-claude-code:security-reviewer', when: 'for security review' },
  { name: 'pr-review-toolkit:code-reviewer', when: 'before creating a PR' },
  { name: 'pr-review-toolkit:pr-test-analyzer', when: 'to review test coverage' },
];

const PRESET_SKILLS: string[] = [
  'everything-claude-code:e2e',
  'everything-claude-code:tdd',
  'everything-claude-code:plan',
  'everything-claude-code:security-review',
  'pr-review-toolkit:review-pr',
];

// ---- Shared helpers ----

function stageLabel(type: string, flavor?: string): string {
  return flavor ? `${type} (${flavor})` : type;
}

function buildPromptContent(
  type: string,
  flavor: string | undefined,
  description: string | undefined,
  artifacts: Artifact[],
): string {
  const lines: string[] = [`# ${type}${flavor ? ` (${flavor})` : ''}`, '', description ?? '', ''];
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

function buildStageChoiceLabel(s: Stage): string {
  const indent = s.flavor ? '  ' : '';
  const label = stageLabel(s.type, s.flavor);
  const artCount = s.artifacts.length;
  const artSummary = artCount > 0 ? `${artCount} artifact${artCount > 1 ? 's' : ''}` : 'no artifacts';
  const gateParts: string[] = [];
  if (s.entryGate) gateParts.push(`entry(${s.entryGate.conditions.length},${s.entryGate.required ? 'req' : 'opt'})`);
  if (s.exitGate) gateParts.push(`exit(${s.exitGate.conditions.length},${s.exitGate.required ? 'req' : 'opt'})`);
  const gateSummary = gateParts.length > 0 ? `, ${gateParts.join(' ')}` : '';
  const extras: string[] = [];
  if (s.promptTemplate) extras.push('prompt ✓');
  if (s.resources && (s.resources.tools.length + s.resources.agents.length + s.resources.skills.length > 0)) {
    extras.push('resources ✓');
  }
  const extSummary = extras.length > 0 ? `, ${extras.join(', ')}` : '';
  return `${indent}${label} — ${artSummary}${gateSummary}${extSummary}`;
}

// ---- Interactive: stage selection wizard ----

async function selectStage(registry: StageRegistry): Promise<Stage> {
  const { select } = await import('@inquirer/prompts');
  const all = registry.list();
  if (all.length === 0) throw new Error('No stages found. Run "kata stage create" first.');

  const sorted = [...all].sort((a, b) => {
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    if (!a.flavor && b.flavor) return -1;
    if (a.flavor && !b.flavor) return 1;
    return (a.flavor ?? '').localeCompare(b.flavor ?? '');
  });

  return select({
    message: 'Select a stage:',
    choices: sorted.map((s) => ({ name: buildStageChoiceLabel(s), value: s })),
  });
}

// ---- Interactive: artifact picker (checkbox keep/remove + add loop) ----

async function promptArtifacts(existing: Artifact[]): Promise<Artifact[]> {
  const { checkbox, confirm, input } = await import('@inquirer/prompts');

  let artifacts: Artifact[] = [];
  if (existing.length > 0) {
    artifacts = await checkbox({
      message: 'Select artifacts to keep (uncheck to remove):',
      choices: existing.map((a) => ({
        name: `${a.name} (${a.required ? 'required' : 'optional'})${a.extension ? ' ' + a.extension : ''}${a.description ? ': ' + a.description : ''}`,
        value: a,
        checked: true,
      })),
    });
  }

  let addMore = await confirm({ message: 'Add a new artifact?', default: false });
  while (addMore) {
    const name = (await input({
      message: '  Artifact name:',
      validate: (v) => {
        const t = v.trim();
        if (!t) return 'Name is required';
        if (artifacts.some((a) => a.name === t)) return `Artifact "${t}" already exists`;
        return true;
      },
    })).trim();
    const artifactDesc = (await input({ message: '  Description (optional):' })).trim();
    const ext = (await input({ message: '  File extension (optional, e.g., ".md"):' })).trim();
    const required = await confirm({ message: '  Required?', default: true });
    artifacts.push({ name, description: artifactDesc || undefined, extension: ext || undefined, required });
    addMore = await confirm({ message: 'Add another artifact?', default: false });
  }
  return artifacts;
}

// ---- Interactive: gate condition picker (checkbox keep/remove + add loop) ----

async function promptGateConditions(gateLabel: string, existing: GateCondition[]): Promise<GateCondition[]> {
  const { checkbox, confirm, input, select } = await import('@inquirer/prompts');

  let conditions: GateCondition[] = [];
  if (existing.length > 0) {
    conditions = await checkbox({
      message: `Select ${gateLabel} gate conditions to keep (uncheck to remove):`,
      choices: existing.map((c) => ({
        name: `[${c.type}] ${c.description ?? c.artifactName ?? c.predecessorType ?? c.command ?? ''}`,
        value: c,
        checked: true,
      })),
    });
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
    const condDesc = (await input({ message: '  Description (optional):' })).trim();
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
      ...(condDesc ? { description: condDesc } : {}),
      ...(artifactName ? { artifactName } : {}),
      ...(predecessorType ? { predecessorType } : {}),
      ...(command ? { command } : {}),
    } as GateCondition);
    addCond = await confirm({ message: `Add another ${gateLabel} gate condition?`, default: false });
  }
  return conditions;
}

// ---- Interactive: resources picker ----

async function promptResources(existing: StageResources | undefined): Promise<StageResources | undefined> {
  const { checkbox, confirm, input } = await import('@inquirer/prompts');

  // Tools
  const existingTools = existing?.tools ?? [];
  const tools = existingTools.length > 0
    ? await checkbox({
        message: 'Select tools to keep (uncheck to remove):',
        choices: existingTools.map((t) => ({
          name: `${t.name}: ${t.purpose}${t.command ? ` (${t.command})` : ''}`,
          value: t,
          checked: true,
        })),
      })
    : [...existingTools];

  let addTool = await confirm({ message: 'Add a tool?', default: false });
  while (addTool) {
    const toolName = (await input({
      message: '  Tool name (e.g., "tsc"):',
      validate: (v) => v.trim().length > 0 || 'Tool name is required',
    })).trim();
    const toolPurpose = (await input({
      message: '  Purpose:',
      validate: (v) => v.trim().length > 0 || 'Purpose is required',
    })).trim();
    const toolCmd = (await input({ message: '  Invocation hint (optional):' })).trim();
    tools.push({ name: toolName, purpose: toolPurpose, command: toolCmd || undefined });
    addTool = await confirm({ message: 'Add another tool?', default: false });
  }

  // Agents (presets + existing custom)
  const existingAgents = existing?.agents ?? [];
  const existingAgentNames = new Set(existingAgents.map((a) => a.name));
  const customAgents = existingAgents.filter((a) => !PRESET_AGENTS.some((p) => p.name === a.name));
  const agentChoices = [
    ...PRESET_AGENTS.map((a) => ({ name: `${a.name} — ${a.when}`, value: a, checked: existingAgentNames.has(a.name) })),
    ...customAgents.map((a) => ({ name: `${a.name}${a.when ? ` — ${a.when}` : ''}`, value: a, checked: true })),
  ];
  const agents: { name: string; when?: string }[] = agentChoices.length > 0
    ? await checkbox({ message: 'Select agents (check to include):', choices: agentChoices })
    : [];

  let addAgent = await confirm({ message: 'Add a custom agent?', default: false });
  while (addAgent) {
    const agentName = (await input({ message: '  Agent name (e.g., "my-team:my-agent"):' })).trim();
    const agentWhen = (await input({ message: '  When to use (optional):' })).trim();
    if (agentName) agents.push({ name: agentName, when: agentWhen || undefined });
    addAgent = await confirm({ message: 'Add another custom agent?', default: false });
  }

  // Skills (presets + existing custom)
  const existingSkills = existing?.skills ?? [];
  const existingSkillNames = new Set(existingSkills.map((s) => s.name));
  const customSkills = existingSkills.filter((s) => !PRESET_SKILLS.includes(s.name));
  const skillChoices = [
    ...PRESET_SKILLS.map((name) => ({ name, value: { name, when: undefined as string | undefined }, checked: existingSkillNames.has(name) })),
    ...customSkills.map((s) => ({ name: `${s.name}${s.when ? ` — ${s.when}` : ''}`, value: s, checked: true })),
  ];
  const skills: { name: string; when?: string }[] = skillChoices.length > 0
    ? await checkbox({ message: 'Select skills (check to include):', choices: skillChoices })
    : [];

  let addSkill = await confirm({ message: 'Add a custom skill?', default: false });
  while (addSkill) {
    const skillName = (await input({ message: '  Skill name:' })).trim();
    const skillWhen = (await input({ message: '  When to use (optional):' })).trim();
    if (skillName) skills.push({ name: skillName, when: skillWhen || undefined });
    addSkill = await confirm({ message: 'Add another custom skill?', default: false });
  }

  if (tools.length === 0 && agents.length === 0 && skills.length === 0) return undefined;
  return { tools, agents, skills };
}

// ---- Field-level edit menu loop ----

type EditField = 'description' | 'artifacts' | 'entryGate' | 'exitGate' | 'learningHooks' | 'promptTemplate' | 'resources' | 'save' | 'cancel';

async function editFieldLoop(
  existing: Stage,
  kataDir: string,
  isJson: boolean,
): Promise<{ stage: Stage; cancelled: boolean }> {
  const { Separator, select, input, confirm, editor } = await import('@inquirer/prompts');
  let draft = { ...existing };

  while (true) {
    const descPreview = draft.description
      ? `"${draft.description.slice(0, 40)}${draft.description.length > 40 ? '…' : ''}"`
      : '(none)';
    const artPreview = draft.artifacts.length > 0
      ? `${draft.artifacts.length}: ${draft.artifacts.map((a) => `${a.name}(${a.required ? 'req' : 'opt'})`).join(', ')}`
      : '(none)';
    const entryPreview = draft.entryGate
      ? `${draft.entryGate.conditions.length} cond, ${draft.entryGate.required ? 'required' : 'optional'}`
      : '(none)';
    const exitPreview = draft.exitGate
      ? `${draft.exitGate.conditions.length} cond, ${draft.exitGate.required ? 'required' : 'optional'}`
      : '(none)';
    const hooksPreview = draft.learningHooks.length > 0 ? draft.learningHooks.join(', ') : '(none)';
    const promptPreview = draft.promptTemplate ?? '(none)';
    const resPreview = draft.resources
      ? `tools:${draft.resources.tools.length} agents:${draft.resources.agents.length} skills:${draft.resources.skills.length}`
      : '(none)';

    const choice = await select<EditField>({
      message: 'What would you like to edit?',
      choices: [
        { name: `Description [${descPreview}]`, value: 'description' },
        { name: `Artifacts [${artPreview}]`, value: 'artifacts' },
        { name: `Entry gate [${entryPreview}]`, value: 'entryGate' },
        { name: `Exit gate [${exitPreview}]`, value: 'exitGate' },
        { name: `Learning hooks [${hooksPreview}]`, value: 'learningHooks' },
        { name: `Prompt template [${promptPreview}]`, value: 'promptTemplate' },
        { name: `Resources [${resPreview}]`, value: 'resources' },
        new Separator(),
        { name: 'Save and exit', value: 'save' },
        { name: 'Cancel (discard changes)', value: 'cancel' },
      ],
    });

    if (choice === 'save') return { stage: draft, cancelled: false };
    if (choice === 'cancel') return { stage: existing, cancelled: true };

    if (choice === 'description') {
      const raw = await input({ message: 'Description:', default: draft.description ?? '' });
      draft = { ...draft, description: raw.trim() || undefined };

    } else if (choice === 'artifacts') {
      draft = { ...draft, artifacts: await promptArtifacts(draft.artifacts) };

    } else if (choice === 'entryGate') {
      const conditions = await promptGateConditions('entry', draft.entryGate?.conditions ?? []);
      if (conditions.length > 0) {
        const required = await confirm({
          message: 'Is the entry gate required (blocking)?',
          default: draft.entryGate?.required ?? true,
        });
        draft = { ...draft, entryGate: { type: 'entry', conditions, required } };
      } else {
        draft = { ...draft, entryGate: undefined };
      }

    } else if (choice === 'exitGate') {
      const conditions = await promptGateConditions('exit', draft.exitGate?.conditions ?? []);
      if (conditions.length > 0) {
        const required = await confirm({
          message: 'Is the exit gate required (blocking)?',
          default: draft.exitGate?.required ?? true,
        });
        draft = { ...draft, exitGate: { type: 'exit', conditions, required } };
      } else {
        draft = { ...draft, exitGate: undefined };
      }

    } else if (choice === 'learningHooks') {
      const raw = await input({
        message: 'Learning hooks (comma-separated):',
        default: draft.learningHooks.join(', '),
      });
      draft = {
        ...draft,
        learningHooks: raw.split(',').map((h) => h.trim()).filter((h) => h.length > 0),
      };

    } else if (choice === 'promptTemplate') {
      const slug = draft.flavor ? `${draft.type}.${draft.flavor}` : draft.type;
      const promptPath = join(kataDir, 'prompts', `${slug}.md`);
      mkdirSync(join(kataDir, 'prompts'), { recursive: true });

      if (draft.promptTemplate && existsSync(promptPath)) {
        const current = readFileSync(promptPath, 'utf-8');
        const updated = await editor({
          message: `Editing .kata/prompts/${slug}.md`,
          default: current,
        });
        writeFileSync(promptPath, updated, 'utf-8');
        if (!isJson) console.log(`  Prompt template saved at .kata/prompts/${slug}.md`);
        draft = { ...draft, promptTemplate: `../prompts/${slug}.md` };
      } else {
        const wantsPrompt = await confirm({
          message: `Create a prompt template at .kata/prompts/${slug}.md?`,
          default: true,
        });
        if (wantsPrompt) {
          if (!existsSync(promptPath)) {
            writeFileSync(promptPath, buildPromptContent(draft.type, draft.flavor, draft.description, draft.artifacts), 'utf-8');
          }
          if (!isJson) console.log(`  Prompt template created at .kata/prompts/${slug}.md`);
          draft = { ...draft, promptTemplate: `../prompts/${slug}.md` };
        }
      }

    } else if (choice === 'resources') {
      draft = { ...draft, resources: await promptResources(draft.resources) };
    }
  }
}

// ---- Register commands ----

export function registerStageCommands(parent: Command): void {
  const stage = parent
    .command('stage')
    .alias('form')
    .description('Manage stages — reusable methodology steps (alias: form)');

  // ---- list ----
  stage
    .command('list')
    .description('List available stages')
    .option('--flavor <flavor>', 'Show only stages of this type (base + all flavors), e.g. --flavor build')
    .option('--ryu <style>')
    .action(withCommandContext((ctx) => {
      const localOpts = ctx.cmd.opts();
      const flavor: string | undefined = localOpts.flavor ?? localOpts.ryu;
      const registry = new StageRegistry(kataDirPath(ctx.kataDir, 'stages'));
      const stages = flavor ? registry.list({ type: flavor }) : registry.list();

      if (ctx.globalOpts.json) {
        console.log(formatStageJson(stages));
      } else {
        console.log(formatStageTable(stages));
      }
    }));

  // ---- inspect [type] ----
  stage
    .command('inspect [type]')
    .description('Show details of a specific stage (omit type for selection wizard)')
    .option('--flavor <flavor>', 'Stage flavor to inspect (alias: --ryu — 流 ryū, school/style)')
    .option('--ryu <style>')
    .action(withCommandContext(async (ctx, type?: string) => {
      const localOpts = ctx.cmd.opts();
      const flavor: string | undefined = localOpts.flavor ?? localOpts.ryu;
      const registry = new StageRegistry(kataDirPath(ctx.kataDir, 'stages'));

      const stageObj = type
        ? registry.get(type, flavor)
        : await selectStage(registry);

      if (ctx.globalOpts.json) {
        console.log(formatStageJson([stageObj]));
      } else {
        console.log(formatStageDetail(stageObj));
      }
    }));

  // ---- create ----
  stage
    .command('create')
    .description('Interactively scaffold a custom stage definition')
    .option('--from-file <path>', 'Load stage definition from a JSON file (skips interactive prompts)')
    .action(withCommandContext(async (ctx) => {
      const localOpts = ctx.cmd.opts();
      const stagesDir = kataDirPath(ctx.kataDir, 'stages');
      const isJson = ctx.globalOpts.json;

      if (localOpts.fromFile) {
        const filePath = resolve(localOpts.fromFile as string);
        let raw: unknown;
        try {
          raw = JSON.parse(readFileSync(filePath, 'utf-8'));
        } catch (e) {
          throw new Error(`Could not read stage file "${filePath}": ${e instanceof Error ? e.message : String(e)}`, { cause: e });
        }
        const { stage } = createStage({ stagesDir, input: raw });
        if (isJson) {
          console.log(formatStageJson([stage]));
        } else {
          console.log(`Stage "${stageLabel(stage.type, stage.flavor)}" created from file.`);
        }
        return;
      }

      const { input, confirm } = await import('@inquirer/prompts');

      const type = (await input({
        message: 'Stage type (e.g., "validate", "deploy-staging"):',
        validate: (v) => v.trim().length > 0 || 'Type is required',
      })).trim();

      const flavorRaw = (await input({
        message: 'Flavor (optional, e.g., "rust", "nextjs") — leave blank to skip:',
      })).trim();
      const flavor = flavorRaw || undefined;

      const descRaw = (await input({ message: 'Description (optional):' })).trim();
      const description = descRaw || undefined;

      const artifacts = await promptArtifacts([]);

      const entryConditions = await promptGateConditions('entry', []);
      let entryGate: Gate | undefined;
      if (entryConditions.length > 0) {
        const required = await confirm({ message: 'Is the entry gate required (blocking)?', default: true });
        entryGate = { type: 'entry', conditions: entryConditions, required };
      }

      const exitConditions = await promptGateConditions('exit', []);
      let exitGate: Gate | undefined;
      if (exitConditions.length > 0) {
        const required = await confirm({ message: 'Is the exit gate required (blocking)?', default: true });
        exitGate = { type: 'exit', conditions: exitConditions, required };
      }

      const hooksRaw = (await input({ message: 'Learning hooks (comma-separated, optional):' })).trim();
      const learningHooks = hooksRaw ? hooksRaw.split(',').map((h) => h.trim()).filter(Boolean) : [];

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
          if (!isJson) console.log(`  Prompt template created at .kata/prompts/${slug}.md`);
        }
      }

      const { stage } = createStage({
        stagesDir,
        input: { type, flavor, description, artifacts, entryGate, exitGate, learningHooks, promptTemplate },
      });

      if (isJson) {
        console.log(formatStageJson([stage]));
      } else {
        console.log(`\nStage "${stageLabel(stage.type, stage.flavor)}" created successfully.`);
        console.log(formatStageDetail(stage));
      }
    }));

  // ---- edit [type] ----
  stage
    .command('edit [type]')
    .description('Edit an existing stage definition (omit type for selection wizard)')
    .option('--flavor <flavor>', 'Stage flavor to edit (alias: --ryu — 流 ryū, school/style)')
    .option('--ryu <style>')
    .action(withCommandContext(async (ctx, type?: string) => {
      const localOpts = ctx.cmd.opts();
      const flavor: string | undefined = localOpts.flavor ?? localOpts.ryu;
      const stagesDir = kataDirPath(ctx.kataDir, 'stages');
      const isJson = ctx.globalOpts.json;

      const registry = new StageRegistry(stagesDir);
      const existing = type
        ? registry.get(type, flavor)
        : await selectStage(registry);

      const label = stageLabel(existing.type, existing.flavor);
      if (!isJson) console.log(`Editing stage: ${label}`);

      const { stage, cancelled } = await editFieldLoop(existing, ctx.kataDir, isJson);

      if (cancelled) {
        if (!isJson) console.log('Edit cancelled.');
        return;
      }

      const { stage: saved } = editStage({
        stagesDir,
        type: existing.type,
        flavor: existing.flavor,
        input: stage,
      });

      if (isJson) {
        console.log(formatStageJson([saved]));
      } else {
        console.log(`\nStage "${stageLabel(saved.type, saved.flavor)}" updated successfully.`);
        console.log(formatStageDetail(saved));
      }
    }));

  // ---- delete <type> (alias: wasure — 忘れる, to forget) ----
  stage
    .command('delete <type>')
    .alias('wasure')
    .description('Delete a stage definition (alias: wasure — 忘れる, to forget)')
    .option('--flavor <flavor>', 'Stage flavor to delete (alias: --ryu)')
    .option('--ryu <style>')
    .option('--force', 'Skip confirmation prompt')
    .action(withCommandContext(async (ctx, type: string) => {
      const localOpts = ctx.cmd.opts();
      const flavor: string | undefined = localOpts.flavor ?? localOpts.ryu;
      const stagesDir = kataDirPath(ctx.kataDir, 'stages');
      const label = stageLabel(type, flavor);

      if (!localOpts.force) {
        const { confirm } = await import('@inquirer/prompts');
        const ok = await confirm({
          message: `Delete stage "${label}"? This cannot be undone.`,
          default: false,
        });
        if (!ok) {
          console.log('Cancelled.');
          return;
        }
      }

      const { deleted } = deleteStage({ stagesDir, type, flavor });
      console.log(`Stage "${stageLabel(deleted.type, deleted.flavor)}" deleted.`);
    }));

  // ---- rename <type> <new-type> ----
  stage
    .command('rename <type> <new-type>')
    .description('Rename a stage type (flavor unchanged by default)')
    .option('--flavor <flavor>', 'Which flavor to rename (alias: --ryu)')
    .option('--ryu <style>')
    .option('--new-flavor <flavor>', 'New flavor name (alias: --new-ryu)')
    .option('--new-ryu <style>')
    .action(withCommandContext(async (ctx, type: string, newType: string) => {
      const localOpts = ctx.cmd.opts();
      const flavor: string | undefined = localOpts.flavor ?? localOpts.ryu;
      const newFlavor: string | undefined = localOpts.newFlavor ?? localOpts.newRyu ?? flavor;
      const stagesDir = kataDirPath(ctx.kataDir, 'stages');

      const registry = new StageRegistry(stagesDir);
      const existing = registry.get(type, flavor);

      // Guard: refuse if target already exists (unless renaming to same key)
      const oldKey = `${type}:${flavor ?? ''}`;
      const newKey = `${newType}:${newFlavor ?? ''}`;
      if (oldKey !== newKey) {
        try {
          registry.get(newType, newFlavor);
          throw new Error(
            `Stage "${stageLabel(newType, newFlavor)}" already exists. Delete it first or choose a different name.`
          );
        } catch (e) {
          if (!(e instanceof StageNotFoundError)) throw e;
        }
      }

      // Build updated stage with new type+flavor
      let updated: Stage = { ...existing, type: newType, flavor: newFlavor };

      // Plan prompt template file rename (but don't do it yet)
      let oldPromptPath: string | undefined;
      let newPromptPath: string | undefined;
      if (existing.promptTemplate) {
        const oldSlug = existing.flavor ? `${existing.type}.${existing.flavor}` : existing.type;
        const newSlug = newFlavor ? `${newType}.${newFlavor}` : newType;
        const promptsDir = join(ctx.kataDir, 'prompts');
        oldPromptPath = join(promptsDir, `${oldSlug}.md`);
        newPromptPath = join(promptsDir, `${newSlug}.md`);
        updated = { ...updated, promptTemplate: `../prompts/${newSlug}.md` };
      }

      // Rename prompt file first (before touching stage JSONs)
      if (oldPromptPath && newPromptPath && existsSync(oldPromptPath)) {
        renameSync(oldPromptPath, newPromptPath);
      }

      // Write new stage then delete old; roll back prompt rename on failure
      try {
        createStage({ stagesDir, input: updated });
        deleteStage({ stagesDir, type, flavor });
      } catch (e) {
        if (newPromptPath && oldPromptPath && existsSync(newPromptPath)) {
          renameSync(newPromptPath, oldPromptPath);
        }
        throw e;
      }

      const fromLabel = stageLabel(type, flavor);
      const toLabel = stageLabel(newType, newFlavor);
      console.log(`Renamed "${fromLabel}" → "${toLabel}"`);
    }));
}
