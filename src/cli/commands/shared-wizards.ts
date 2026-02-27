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

// ---- Interactive: artifact picker (checkbox keep/remove + add loop) ----

export async function promptArtifacts(existing: Artifact[]): Promise<Artifact[]> {
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
      message: '  Artifact name (include extension, e.g., "research.md"):',
      validate: (v) => {
        const check = validateArtifactName(v);
        if (check !== true) return check;
        const t = v.trim();
        if (artifacts.some((a) => a.name === t)) return `Artifact "${t}" already exists`;
        return true;
      },
    })).trim();
    const artifactDesc = (await input({ message: '  Description (optional):' })).trim();
    const required = await confirm({ message: '  Required?', default: true });
    // Auto-extract file extension (e.g. "research.md" → ".md")
    const dotIdx = name.lastIndexOf('.');
    const extension = dotIdx > 0 ? name.slice(dotIdx) : undefined;
    artifacts.push({ name, description: artifactDesc || undefined, extension, required });
    addMore = await confirm({ message: 'Add another artifact?', default: false });
  }
  return artifacts;
}

// ---- Interactive: gate condition picker (checkbox keep/remove + add loop) ----

export async function promptGateConditions(gateLabel: string, existing: GateCondition[]): Promise<GateCondition[]> {
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
        { name: 'File exists          — a named artifact/file must exist on disk', value: 'artifact-exists' as const },
        { name: 'Schema valid         — a JSON/YAML file must have valid contents', value: 'schema-valid' as const },
        { name: 'Human approved       — requires explicit human sign-off before continuing', value: 'human-approved' as const },
        { name: 'Predecessor done     — a specific step type must have run earlier in this session', value: 'predecessor-complete' as const },
        { name: 'Command passes       — a shell command must exit with code 0', value: 'command-passes' as const },
      ],
    });
    const condDesc = (await input({ message: '  Description / note (optional):' })).trim();
    let artifactName: string | undefined;
    let predecessorType: string | undefined;
    let command: string | undefined;
    if (condType === 'artifact-exists') {
      artifactName = (await input({
        message: '  Artifact/file name (e.g., "research.md"):',
        validate: (v) => {
          if (!v.trim()) return 'Artifact name is required for file-exists conditions';
          return validateArtifactName(v);
        },
      })).trim() || undefined;
    } else if (condType === 'schema-valid') {
      artifactName = (await input({
        message: '  Artifact file to validate (JSON/YAML, e.g., "config.json"):',
        validate: (v) => {
          if (!v.trim()) return 'Artifact name is required for schema-valid conditions';
          return validateArtifactName(v);
        },
      })).trim() || undefined;
    } else if (condType === 'predecessor-complete') {
      predecessorType = (await input({ message: '  Step type that must have already run (e.g., "research"):' })).trim() || undefined;
    } else if (condType === 'command-passes') {
      command = (await input({ message: '  Shell command to run (must exit with code 0):' })).trim() || undefined;
    }
    conditions.push(GateConditionSchema.parse({
      type: condType,
      ...(condDesc ? { description: condDesc } : {}),
      ...(artifactName ? { artifactName } : {}),
      ...(predecessorType ? { predecessorType } : {}),
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

export type EditField = 'description' | 'artifacts' | 'entryGate' | 'exitGate' | 'learningHooks' | 'promptTemplate' | 'resources' | 'save' | 'cancel';

export async function editFieldLoop(
  existing: Step,
  kataDir: string,
  isJson: boolean,
): Promise<{ step: Step; cancelled: boolean }> {
  const { Separator, select, input, confirm, editor } = await import('@inquirer/prompts');
  let draft = { ...existing };

  while (true) {
    const descPreview = draft.description
      ? `"${draft.description.slice(0, 40)}${draft.description.length > 40 ? '...' : ''}"`
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
