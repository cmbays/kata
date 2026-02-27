import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GateConditionSchema } from '@domain/types/gate.js';
import type { GateCondition } from '@domain/types/gate.js';
import type { Artifact } from '@domain/types/artifact.js';
import type { Step, StepResources } from '@domain/types/step.js';
import { StepRegistry } from '@infra/registries/step-registry.js';

// ---- Preset agent/skill lists for resources ----

export const PRESET_AGENTS: { name: string; when: string }[] = [
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

export const PRESET_SKILLS: string[] = [
  'everything-claude-code:e2e',
  'everything-claude-code:tdd',
  'everything-claude-code:plan',
  'everything-claude-code:security-review',
  'pr-review-toolkit:review-pr',
  'pr-review-toolkit:type-design-analyzer',
];

/**
 * Preset learning hooks with descriptions.
 * Learning hooks are event tags that the self-improvement system watches for.
 * When a step completes with one of these events, Kata captures a pattern entry
 * that surfaces as improvement suggestions during cooldown sessions.
 */
export const PRESET_LEARNING_HOOKS: { value: string; description: string }[] = [
  { value: 'gate-failure', description: 'Track gate condition failures — helps refine gate definitions over time' },
  { value: 'high-token-usage', description: 'Track high token usage — identifies steps needing more efficient prompts' },
  { value: 'skip', description: 'Track when this step is skipped — detects under-used or misconfigured steps' },
  { value: 'artifact-missing', description: 'Track missing expected outputs — catches incomplete executions' },
  { value: 'retry', description: 'Track execution retries — identifies unstable or unreliable steps' },
];

// ---- Shared helpers ----

/**
 * Validates an artifact name: must be non-empty, have a file extension,
 * and contain only safe filename characters.
 * Returns an error string on failure, or `true` on success.
 */
export function validateArtifactName(value: string): string | true {
  const name = value.trim();
  if (!name) return 'Name is required';
  if (!/^[a-zA-Z0-9_\-./]+$/.test(name)) {
    return 'Only letters, numbers, hyphens, underscores, dots, and "/" are allowed';
  }
  const dotIdx = name.lastIndexOf('.');
  if (dotIdx <= 0) {
    return 'A file extension is required (e.g., "research.md", "config.json")';
  }
  const ext = name.slice(dotIdx + 1);
  if (ext.length === 0 || ext.length > 10) {
    return 'Extension must be 1–10 characters';
  }
  return true;
}

export function stepLabel(type: string, flavor?: string): string {
  return flavor ? `${type} (${flavor})` : type;
}

export function buildPromptContent(
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

export function buildStepChoiceLabel(s: Step): string {
  const indent = s.flavor ? '  ' : '';
  const label = stepLabel(s.type, s.flavor);
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

// ---- Interactive: step selection wizard ----

export async function selectStep(registry: StepRegistry): Promise<Step> {
  const { select } = await import('@inquirer/prompts');
  const all = registry.list();
  if (all.length === 0) throw new Error('No steps found. Run "kata step create" first.');

  const sorted = [...all].sort((a, b) => {
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    if (!a.flavor && b.flavor) return -1;
    if (a.flavor && !b.flavor) return 1;
    return (a.flavor ?? '').localeCompare(b.flavor ?? '');
  });

  return select({
    message: 'Select a step:',
    choices: sorted.map((s) => ({ name: buildStepChoiceLabel(s), value: s })),
  });
}

// ---- Interactive: output artifact picker ----

/**
 * Prompts the user to manage output artifacts for a step.
 *
 * Output artifacts are FILES this step will PRODUCE during execution.
 * The executing agent is instructed to create these files.
 *
 * To REQUIRE an input file before this step starts, use an Entry Gate
 * with a "File exists" condition instead.
 */
export async function promptArtifacts(existing: Artifact[]): Promise<Artifact[]> {
  const { checkbox, confirm, input } = await import('@inquirer/prompts');

  console.log('\n── Output Artifacts ───────────────────────────────────────────────────────────');
  console.log('Output artifacts are FILES this step will PRODUCE during execution.');
  console.log('The agent is instructed to create these files. Examples: "research.md", "plan.json"');
  console.log('→ To require an INPUT file before this step starts, use Entry Gate → File Exists.\n');

  let artifacts: Artifact[] = [];
  if (existing.length > 0) {
    artifacts = await checkbox({
      message: 'Select output artifacts to keep (uncheck to remove):',
      choices: existing.map((a) => ({
        name: `${a.name} (${a.required ? 'required output' : 'optional output'})${a.extension ? ' ' + a.extension : ''}${a.description ? ': ' + a.description : ''}`,
        value: a,
        checked: true,
      })),
    });
  }

  let addMore = await confirm({ message: 'Add an output artifact?', default: false });
  while (addMore) {
    const name = (await input({
      message: '  Output file name (the file this step will produce, e.g., "research.md"):',
      validate: (v) => {
        const check = validateArtifactName(v);
        if (check !== true) return check;
        const t = v.trim();
        if (artifacts.some((a) => a.name === t)) return `Artifact "${t}" already exists`;
        return true;
      },
    })).trim();
    const artifactDesc = (await input({ message: '  Description (what is this file? optional):' })).trim();
    const required = await confirm({ message: '  Is this output required (must always be produced)?', default: true });
    const dotIdx = name.lastIndexOf('.');
    const extension = dotIdx > 0 ? name.slice(dotIdx) : undefined;
    artifacts.push({ name, description: artifactDesc || undefined, extension, required });
    addMore = await confirm({ message: 'Add another output artifact?', default: false });
  }
  return artifacts;
}

// ---- Interactive: gate condition picker ----

/**
 * Prompts the user to manage gate conditions.
 *
 * Entry gate: conditions checked BEFORE the step starts — all must pass.
 * Exit gate:  conditions checked AFTER the step finishes — all must pass to allow the next step.
 *
 * NOTE: "predecessor-complete" is not offered here. Steps within a flavor always run
 * sequentially in DAG order — the predecessor finishing is always guaranteed by the runtime.
 */
export async function promptGateConditions(gateLabel: string, existing: GateCondition[]): Promise<GateCondition[]> {
  const { checkbox, confirm, input, select } = await import('@inquirer/prompts');

  if (gateLabel === 'entry') {
    console.log('\n── Entry Gate ─────────────────────────────────────────────────────────────────');
    console.log('Conditions checked BEFORE this step can start. All must pass for execution to');
    console.log('proceed. Leave empty if this step can always run without preconditions.\n');
  } else {
    console.log('\n── Exit Gate ──────────────────────────────────────────────────────────────────');
    console.log('Conditions checked AFTER this step finishes. All must pass before the next step');
    console.log('in the flavor can start. Use to verify the step produced its expected outputs.\n');
  }

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
      message: '  What type of condition?',
      choices: [
        {
          name: 'File exists',
          value: 'artifact-exists' as const,
          description: 'A named file must exist on disk. Use to check that a required input or prior output is present.',
        },
        {
          name: 'Schema valid',
          value: 'schema-valid' as const,
          description: 'A JSON or YAML file must parse and validate successfully. Use to verify structured output files are well-formed.',
        },
        {
          name: 'Human approved  ★',
          value: 'human-approved' as const,
          description: 'A human must explicitly approve before execution continues. Use for review checkpoints or high-stakes decisions (shown in amber).',
        },
        {
          name: 'Command passes',
          value: 'command-passes' as const,
          description: 'A shell command must exit with code 0. Use for tests (npm test), lint (eslint), or build checks (tsc --noEmit).',
        },
      ],
    });
    const condDesc = (await input({ message: '  Short note describing this condition (optional):' })).trim();
    let artifactName: string | undefined;
    let command: string | undefined;
    if (condType === 'artifact-exists') {
      artifactName = (await input({
        message: '  File name to check (e.g., "research.md"):',
        validate: (v) => {
          if (!v.trim()) return 'File name is required';
          return validateArtifactName(v);
        },
      })).trim() || undefined;
    } else if (condType === 'schema-valid') {
      artifactName = (await input({
        message: '  JSON/YAML file to validate (e.g., "config.json"):',
        validate: (v) => {
          if (!v.trim()) return 'File name is required';
          return validateArtifactName(v);
        },
      })).trim() || undefined;
    } else if (condType === 'command-passes') {
      command = (await input({
        message: '  Shell command (must exit 0 to pass):',
        validate: (v) => v.trim().length > 0 || 'Shell command is required',
      })).trim();
    }
    conditions.push(GateConditionSchema.parse({
      type: condType,
      ...(condDesc ? { description: condDesc } : {}),
      ...(artifactName ? { artifactName } : {}),
      ...(command ? { command } : {}),
    }));
    addCond = await confirm({ message: `Add another ${gateLabel} gate condition?`, default: false });
  }
  return conditions;
}

// ---- Interactive: resources picker ----

export async function promptResources(existing: StepResources | undefined): Promise<StepResources | undefined> {
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

  let addTool = await confirm({ message: 'Add a tool hint?', default: false });
  while (addTool) {
    const toolName = (await input({
      message: '  Tool name (e.g., "tsc"):',
      validate: (v) => v.trim().length > 0 || 'Tool name is required',
    })).trim();
    const toolPurpose = (await input({
      message: '  Purpose (why is this tool useful for this step?):',
      validate: (v) => v.trim().length > 0 || 'Purpose is required',
    })).trim();
    const toolCmd = (await input({ message: '  Invocation example (optional, e.g., "tsc --noEmit"):' })).trim();
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
    ? await checkbox({ message: 'Select agents (check to include — these are spawned as sub-agents):', choices: agentChoices })
    : [];

  let addAgent = await confirm({ message: 'Add a custom agent?', default: false });
  while (addAgent) {
    const agentName = (await input({ message: '  Agent name (e.g., "my-team:my-agent"):' })).trim();
    const agentWhen = (await input({ message: '  When to use (optional, e.g., "when tests fail"):' })).trim();
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
    ? await checkbox({ message: 'Select skills (check to include — these are invoked via the Skill tool):', choices: skillChoices })
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

export type EditField = 'description' | 'artifacts' | 'entryGate' | 'exitGate' | 'learningHooks' | 'promptTemplate' | 'resources' | 'save' | 'cancel';

export async function editFieldLoop(
  existing: Step,
  kataDir: string,
  isJson: boolean,
): Promise<{ step: Step; cancelled: boolean }> {
  const { Separator, select, input, confirm, checkbox, editor } = await import('@inquirer/prompts');
  let draft = { ...existing };
  let firstLoop = true;

  while (true) {
    if (firstLoop) {
      if (!isJson) console.log('All fields are optional — configure only what this step needs, then Save.\n');
      firstLoop = false;
    }

    const descPreview = draft.description
      ? `"${draft.description.slice(0, 40)}${draft.description.length > 40 ? '...' : ''}"`
      : '(none)';
    const artPreview = draft.artifacts.length > 0
      ? `${draft.artifacts.length}: ${draft.artifacts.map((a) => `${a.name}(${a.required ? 'req' : 'opt'})`).join(', ')}`
      : '(none)';
    const entryPreview = draft.entryGate
      ? `${draft.entryGate.conditions.length} cond${draft.entryGate.conditions.length !== 1 ? 's' : ''}`
      : '(none)';
    const exitPreview = draft.exitGate
      ? `${draft.exitGate.conditions.length} cond${draft.exitGate.conditions.length !== 1 ? 's' : ''}`
      : '(none)';
    const hooksPreview = draft.learningHooks.length > 0 ? draft.learningHooks.join(', ') : '(none)';
    const promptPreview = draft.promptTemplate ?? '(none)';
    const resPreview = draft.resources
      ? `tools:${draft.resources.tools.length} agents:${draft.resources.agents.length} skills:${draft.resources.skills.length}`
      : '(none)';

    const choice = await select<EditField>({
      message: 'What would you like to edit?',
      choices: [
        {
          name: `Description [${descPreview}]`,
          value: 'description' as EditField,
          description: 'A short summary of what this step does — shown in lists to help identify steps at a glance.',
        },
        {
          name: `Output artifacts [${artPreview}]`,
          value: 'artifacts' as EditField,
          description: 'Files this step will PRODUCE. The agent is expected to write these files during execution. (Input requirements → Entry Gate → File Exists)',
        },
        {
          name: `Entry gate [${entryPreview}]`,
          value: 'entryGate' as EditField,
          description: 'Conditions checked BEFORE this step starts — file checks, human approval, shell commands. All must pass.',
        },
        {
          name: `Exit gate [${exitPreview}]`,
          value: 'exitGate' as EditField,
          description: 'Conditions checked AFTER this step finishes — ensures the step produced its expected outputs before the next step starts.',
        },
        {
          name: `Prompt template [${promptPreview}]`,
          value: 'promptTemplate' as EditField,
          description: 'The Markdown file containing agent instructions for this step. The agent reads this to understand what to do, what to produce, and what tools to use.',
        },
        {
          name: `Resources [${resPreview}]`,
          value: 'resources' as EditField,
          description: 'Suggested tools (CLI), agents (sub-agents to spawn), and skills (Claude Code skills). These are appended to the agent\'s prompt as a "Suggested Resources" section.',
        },
        {
          name: `Learning hooks [${hooksPreview}]`,
          value: 'learningHooks' as EditField,
          description: 'Events this step tracks for Kata\'s self-improvement system. When these events occur during execution, patterns are captured and surface as improvement suggestions.',
        },
        new Separator(),
        { name: 'Save and exit', value: 'save' as EditField },
        { name: 'Cancel (discard changes)', value: 'cancel' as EditField },
      ],
    });

    if (choice === 'save') return { step: draft, cancelled: false };
    if (choice === 'cancel') return { step: existing, cancelled: true };

    if (choice === 'description') {
      const raw = await input({ message: 'Description:', default: draft.description ?? '' });
      draft = { ...draft, description: raw.trim() || undefined };

    } else if (choice === 'artifacts') {
      draft = { ...draft, artifacts: await promptArtifacts(draft.artifacts) };

    } else if (choice === 'entryGate') {
      const conditions = await promptGateConditions('entry', draft.entryGate?.conditions ?? []);
      draft =
        conditions.length > 0
          ? { ...draft, entryGate: { type: 'entry', conditions, required: true } }
          : { ...draft, entryGate: undefined };

    } else if (choice === 'exitGate') {
      const conditions = await promptGateConditions('exit', draft.exitGate?.conditions ?? []);
      draft =
        conditions.length > 0
          ? { ...draft, exitGate: { type: 'exit', conditions, required: true } }
          : { ...draft, exitGate: undefined };

    } else if (choice === 'learningHooks') {
      if (!isJson) {
        console.log('\n── Learning Hooks ─────────────────────────────────────────────────────────────');
        console.log('Learning hooks tell Kata\'s self-improvement system which events from this step');
        console.log('to analyze. When these events occur in execution runs, patterns are captured');
        console.log('and surface as improvement suggestions during cooldown sessions.\n');
      }

      const existingHookSet = new Set(draft.learningHooks);
      const customHooks = draft.learningHooks.filter(
        (h) => !PRESET_LEARNING_HOOKS.some((p) => p.value === h),
      );
      const hookChoices = [
        ...PRESET_LEARNING_HOOKS.map((h) => ({
          name: `${h.value.padEnd(22)}  ${h.description}`,
          value: h.value,
          checked: existingHookSet.has(h.value),
        })),
        ...customHooks.map((h) => ({ name: h, value: h, checked: true })),
      ];

      const selected: string[] = await checkbox<string>({
        message: 'Select learning hooks to enable (space to toggle):',
        choices: hookChoices,
      });

      const addCustom = await confirm({ message: 'Add a custom hook name?', default: false });
      if (addCustom) {
        const customHook = (await input({
          message: 'Custom hook name (e.g., "validation-error"):',
          validate: (v) => v.trim().length > 0 || 'Required',
        })).trim();
        if (customHook && !selected.includes(customHook)) selected.push(customHook);
      }

      draft = { ...draft, learningHooks: selected };

    } else if (choice === 'promptTemplate') {
      if (!isJson) {
        console.log('\n── Prompt Template ────────────────────────────────────────────────────────────');
        console.log('The Markdown (.md) file containing the agent\'s instructions for this step.');
        console.log('When this step executes, the agent reads these instructions to understand');
        console.log('what to do, what to produce, and what tools and resources to use.\n');
      }

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
      if (!isJson) {
        console.log('\n── Resources ──────────────────────────────────────────────────────────────────');
        console.log('Resources are appended to the step\'s prompt as a "Suggested Resources" section.');
        console.log('They tell the executing agent what tools and agents are available for this step:');
        console.log('  Tools:  CLI tool hints (e.g., "tsc", "npx jest --coverage")');
        console.log('  Agents: Sub-agents to spawn for specialized subtasks (via the Task tool)');
        console.log('  Skills: Claude Code skills to invoke (e.g., "everything-claude-code:tdd")\n');
      }
      draft = { ...draft, resources: await promptResources(draft.resources) };
    }
  }
}
