import React from 'react';
import { render } from 'ink';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import type { Command } from 'commander';
import { withCommandContext, kataDirPath } from '@cli/utils.js';
import ConfigApp from '@cli/tui/ConfigApp.js';
import type { ConfigAction } from '@cli/tui/ConfigApp.js';
import { createStep } from '@features/step-create/step-creator.js';
import { editStep } from '@features/step-create/step-editor.js';
import { deleteStep } from '@features/step-create/step-deleter.js';
import { FlavorRegistry } from '@infra/registries/flavor-registry.js';
import { FlavorSchema } from '@domain/types/flavor.js';
import type { Flavor } from '@domain/types/flavor.js';
import { StepRegistry } from '@infra/registries/step-registry.js';
import type { Step } from '@domain/types/step.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { SavedKataSchema } from '@domain/types/saved-kata.js';
import { StageCategorySchema } from '@domain/types/stage.js';
import type { StageCategory } from '@domain/types/stage.js';
import { editFieldLoop, stepLabel, buildStepChoiceLabel } from '@cli/commands/shared-wizards.js';

/** State passed to the next ConfigApp render to restore navigation position. */
interface RelaunchState {
  sectionIndex?: number;
  flavorName?: string;
}

export function registerConfigCommand(parent: Command): void {
  parent
    .command('config')
    .alias('seido')
    .description('Interactive methodology editor TUI — steps, flavors, kata patterns (dojo setup)')
    .action(
      withCommandContext(async (ctx) => {
        const stepsDir = kataDirPath(ctx.kataDir, 'stages');
        const flavorsDir = kataDirPath(ctx.kataDir, 'flavors');
        const katasDir = kataDirPath(ctx.kataDir, 'katas');

        let relaunchState: RelaunchState | null = null;

        while (true) {
          let pendingAction: ConfigAction | null = null;

          const { waitUntilExit } = render(
            React.createElement(ConfigApp, {
              stepsDir,
              flavorsDir,
              katasDir,
              onAction: (a) => {
                pendingAction = a;
              },
              initialSectionIndex: relaunchState?.sectionIndex,
              initialFlavorName: relaunchState?.flavorName,
              plain: ctx.globalOpts.plain,
            }),
          );

          await waitUntilExit();

          if (!pendingAction) break; // user pressed q — truly exit

          // Ink calls stdin.unref() on exit. If nothing else holds the event
          // loop open, Node.js can reach "process exit" between Ink teardown
          // and Inquirer startup, which fires signal-exit and immediately
          // rejects every Inquirer prompt with ExitPromptError("0 null").
          // Re-ref stdin to keep the process anchored until Inquirer takes over.
          process.stdin.ref();

          relaunchState = await runConfigAction(pendingAction, {
            stepsDir,
            flavorsDir,
            katasDir,
            kataDir: ctx.kataDir,
          });
        }
      }),
    );
}

// ── Action context ────────────────────────────────────────────────────────────

interface ActionCtx {
  stepsDir: string;
  flavorsDir: string;
  katasDir: string;
  kataDir: string;
}

// ── Prompt cancellation detection ─────────────────────────────────────────────

/**
 * Returns true when the user force-closes an Inquirer prompt (Ctrl+C / Esc).
 * Inquirer v9+ throws ExitPromptError; we detect it by name + message pattern
 * so we don't need a direct import from @inquirer/core.
 */
function isPromptCancelled(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  return (
    e.name === 'ExitPromptError' ||
    e.name === 'AbortPromptError' ||
    e.message.includes('User force closed')
  );
}

// ── Action dispatcher ─────────────────────────────────────────────────────────

/**
 * Determines where to return after an action completes (or is cancelled).
 * Computed before the action runs so cancellation still navigates correctly.
 */
function getRelaunchState(action: ConfigAction): RelaunchState | null {
  switch (action.type) {
    case 'step:edit': {
      const fromFlavorName = (action as { type: 'step:edit'; step: Step; fromFlavorName?: string }).fromFlavorName;
      return fromFlavorName ? { sectionIndex: 1, flavorName: fromFlavorName } : null;
    }
    case 'flavor:create':
    case 'flavor:delete':
      return { sectionIndex: 1 };
    case 'flavor:edit':
      return { sectionIndex: 1, flavorName: action.flavor.name };
    case 'kata:create':
    case 'kata:delete':
      return { sectionIndex: 2 };
    default:
      return null;
  }
}

async function runConfigAction(action: ConfigAction, ctx: ActionCtx): Promise<RelaunchState | null> {
  // Resolve relaunch target upfront so Ctrl+C cancellation still returns to the right place
  const relaunchState = getRelaunchState(action);

  try {
    switch (action.type) {
      case 'step:create':
        await handleStepCreate(ctx);
        break;
      case 'step:edit':
        await handleStepEdit(action.step, ctx);
        break;
      case 'step:delete':
        await handleStepDelete(action.step, ctx);
        break;
      case 'flavor:create':
        await handleFlavorCreate(ctx);
        break;
      case 'flavor:edit':
        await handleFlavorEdit(action.flavor, ctx);
        break;
      case 'flavor:delete':
        await handleFlavorDelete(action.flavor, ctx);
        break;
      case 'kata:create':
        await handleKataCreate(ctx);
        break;
      case 'kata:delete':
        await handleKataDelete(action.kata, ctx);
        break;
    }
  } catch (e) {
    if (isPromptCancelled(e)) {
      console.log('\nCancelled — returning to editor.');
    } else {
      throw e;
    }
  }

  // Brief pause so users can read the outcome before the TUI reappears
  await new Promise<void>((resolve) => setTimeout(resolve, 900));
  console.clear();
  return relaunchState;
}

// ── Step handlers ─────────────────────────────────────────────────────────────

async function handleStepCreate(ctx: ActionCtx): Promise<void> {
  const { input, confirm, select } = await import('@inquirer/prompts');

  console.log('\n── Create Step ───────────────────────────────────────────────');

  const type = (
    await input({
      message: 'Step type (e.g., "validate", "deploy-staging"):',
      validate: (v) => v.trim().length > 0 || 'Type is required',
    })
  ).trim();

  const flavorRaw = (
    await input({
      message: 'Flavor (optional, e.g., "rust", "nextjs") — leave blank to skip:',
    })
  ).trim();
  const flavor = flavorRaw || undefined;

  const categoryPick = await select<string>({
    message: 'Stage category:',
    choices: [
      { name: '(none)', value: '' },
      ...StageCategorySchema.options.map((c) => ({ name: c, value: c })),
    ],
  });
  const stageCategory = categoryPick ? (categoryPick as StageCategory) : undefined;

  const descRaw = (await input({ message: 'Description (optional):' })).trim();
  const description = descRaw || undefined;

  const { step: created } = createStep({
    stagesDir: ctx.stepsDir,
    input: { type, flavor, stageCategory, description, artifacts: [], learningHooks: [] },
  });

  console.log(`\nStep "${stepLabel(created.type, created.flavor)}" created.`);

  const editNow = await confirm({
    message: 'Edit further (add artifacts, gates, resources, prompt template)?',
    default: false,
  });

  if (editNow) {
    const { step: edited, cancelled } = await editFieldLoop(created, ctx.kataDir, false);
    if (!cancelled) {
      editStep({ stagesDir: ctx.stepsDir, type: created.type, flavor: created.flavor, input: edited });
      console.log(`Step "${stepLabel(edited.type, edited.flavor)}" updated.`);
    }
  }
}

async function handleStepEdit(
  step: Extract<ConfigAction, { type: 'step:edit' }>['step'],
  ctx: ActionCtx,
): Promise<void> {
  console.log(`\n── Edit Step: ${stepLabel(step.type, step.flavor)} ${'─'.repeat(40)}`);

  const { step: edited, cancelled } = await editFieldLoop(step, ctx.kataDir, false);
  if (!cancelled) {
    editStep({ stagesDir: ctx.stepsDir, type: step.type, flavor: step.flavor, input: edited });
    console.log(`\nStep "${stepLabel(edited.type, edited.flavor)}" saved.`);
  } else {
    console.log('Edit cancelled.');
  }
}

async function handleStepDelete(
  step: Extract<ConfigAction, { type: 'step:delete' }>['step'],
  ctx: ActionCtx,
): Promise<void> {
  const { confirm } = await import('@inquirer/prompts');
  const label = stepLabel(step.type, step.flavor);

  const ok = await confirm({
    message: `Delete step "${label}"? This cannot be undone.`,
    default: false,
  });

  if (ok) {
    deleteStep({ stagesDir: ctx.stepsDir, type: step.type, flavor: step.flavor });
    console.log(`Step "${label}" deleted.`);
  } else {
    console.log('Cancelled.');
  }
}

// ── Flavor handlers ───────────────────────────────────────────────────────────

async function handleFlavorCreate(ctx: ActionCtx): Promise<void> {
  const { input, select } = await import('@inquirer/prompts');

  console.log('\n── Create Flavor ─────────────────────────────────────────────');

  const stageCategory = await select<StageCategory>({
    message: 'Stage category:',
    choices: StageCategorySchema.options.map((c) => ({ name: c, value: c })),
  });

  const name = (
    await input({
      message: 'Flavor name (e.g., "typescript-tdd"):',
      validate: (v) => v.trim().length > 0 || 'Name is required',
    })
  ).trim();

  const descRaw = (await input({ message: 'Description (optional):' })).trim();
  const description = descRaw || undefined;

  const synthesisArtifact = (
    await input({
      message: 'Synthesis artifact name (e.g., "research.md"):',
      validate: (v) => v.trim().length > 0 || 'Synthesis artifact is required',
    })
  ).trim();

  const steps = await promptFlavorSteps([], stageCategory, ctx);
  if (!steps) {
    console.log('Cancelled — at least one step is required.');
    return;
  }

  const registry = new FlavorRegistry(ctx.flavorsDir);
  const flavor = FlavorSchema.parse({ name, description, stageCategory, steps, synthesisArtifact });
  registry.register(flavor);

  console.log(`\nFlavor "${name}" created for stage "${stageCategory}".`);
}

// ── Flavor step library picker ─────────────────────────────────────────────────

/**
 * Interactive loop to build an ordered step list for a flavor.
 * Shows steps already registered for the given stage category as a library.
 * Supports inline step creation and undo (remove last).
 * Returns null if cancelled before any step was added.
 */
async function promptFlavorSteps(
  existing: { stepName: string; stepType: string }[],
  stageCategory: StageCategory,
  ctx: ActionCtx,
): Promise<{ stepName: string; stepType: string }[] | null> {
  const { confirm, input, select, Separator } = await import('@inquirer/prompts');

  const stepReg = new StepRegistry(ctx.stepsDir);
  const availableSteps = stepReg.list().filter((s) => s.stageCategory === stageCategory);
  const flavorSteps: { stepName: string; stepType: string }[] = [...existing];

  console.log(`\nPick steps for this flavor from the "${stageCategory}" stage library:`);

  while (true) {
    if (flavorSteps.length > 0) {
      console.log('\nSteps so far:');
      flavorSteps.forEach((s, i) => { console.log(`  ${i + 1}. ${s.stepName} (→ ${s.stepType})`); });
    }

    // Build choices list (Step | string values; Separator is not selectable so no value needed)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const choices: any[] = [];
    for (const s of availableSteps) {
      choices.push({ name: buildStepChoiceLabel(s), value: s });
    }
    if (availableSteps.length > 0) choices.push(new Separator());
    choices.push({ name: '+ Create a new step for this stage', value: '_new' });
    if (flavorSteps.length > 0) {
      choices.push({ name: '↩  Remove last step', value: '_undo' });
      choices.push({ name: '✓  Done', value: '_done' });
    }

    const pick = await select<Step | string>({
      message: `Add step ${flavorSteps.length + 1}:`,
      choices,
    });

    if (pick === '_done') break;
    if (pick === '_undo') { flavorSteps.pop(); continue; }

    if (pick === '_new') {
      // Inline step creation — same flow as standalone 'kata step create'
      const newType = (
        await input({ message: '  New step type:', validate: (v) => v.trim().length > 0 || 'Required' })
      ).trim();
      const newFlavor = (await input({ message: '  Flavor (optional):' })).trim() || undefined;
      const newDesc = (await input({ message: '  Description (optional):' })).trim() || undefined;
      const { step: newStep } = createStep({
        stagesDir: ctx.stepsDir,
        input: { type: newType, flavor: newFlavor, stageCategory, description: newDesc, artifacts: [], learningHooks: [] },
      });
      console.log(`  Step "${stepLabel(newType, newFlavor)}" created.`);

      const editNow = await confirm({
        message: '  Edit further (add artifacts, gates, resources, prompt template)?',
        default: false,
      });
      let finalStep = newStep;
      if (editNow) {
        const { step: edited, cancelled } = await editFieldLoop(newStep, ctx.kataDir, false);
        if (!cancelled) {
          editStep({ stagesDir: ctx.stepsDir, type: newStep.type, flavor: newStep.flavor, input: edited });
          finalStep = edited;
          console.log(`  Step "${stepLabel(edited.type, edited.flavor)}" updated.`);
        }
      }

      availableSteps.push(finalStep);
      const defaultName = stepLabel(finalStep.type, finalStep.flavor);
      const sName = (
        await input({
          message: `  Name for this step in the flavor:`,
          default: defaultName,
          validate: (v) => {
            const t = v.trim();
            if (!t) return 'Required';
            if (flavorSteps.some((s) => s.stepName === t)) return `"${t}" already used in this flavor`;
            return true;
          },
        })
      ).trim();
      flavorSteps.push({ stepName: sName, stepType: finalStep.type });
      continue;
    }

    const selectedStep = pick as Step;
    const defaultName = stepLabel(selectedStep.type, selectedStep.flavor);
    const sName = (
      await input({
        message: `  Name for this step in the flavor:`,
        default: defaultName,
        validate: (v) => {
          const t = v.trim();
          if (!t) return 'Required';
          if (flavorSteps.some((s) => s.stepName === t)) return `"${t}" already used in this flavor`;
          return true;
        },
      })
    ).trim();
    flavorSteps.push({ stepName: sName, stepType: selectedStep.type });
  }

  return flavorSteps.length > 0 ? flavorSteps : null;
}

async function handleFlavorDelete(
  flavor: Extract<ConfigAction, { type: 'flavor:delete' }>['flavor'],
  ctx: ActionCtx,
): Promise<void> {
  const { confirm } = await import('@inquirer/prompts');

  const ok = await confirm({
    message: `Delete flavor "${flavor.name}" from stage "${flavor.stageCategory}"? This cannot be undone.`,
    default: false,
  });

  if (ok) {
    const registry = new FlavorRegistry(ctx.flavorsDir);
    registry.delete(flavor.stageCategory, flavor.name);
    console.log(`Flavor "${flavor.name}" deleted.`);
  } else {
    console.log('Cancelled.');
  }
}

// ── Flavor edit handler ────────────────────────────────────────────────────────

async function handleFlavorEdit(flavor: Flavor, ctx: ActionCtx): Promise<void> {
  const { input, select, Separator } = await import('@inquirer/prompts');

  console.log(`\n── Edit Flavor: ${flavor.name} (${flavor.stageCategory}) ${'─'.repeat(40)}`);

  type FlavorField = 'description' | 'synthesisArtifact' | 'steps' | 'save' | 'cancel';
  let draft = { ...flavor };

  while (true) {
    const stepsLabel = draft.steps.map((s) => s.stepName).join(', ') || '(none)';
    const choice = await select<FlavorField>({
      message: 'What to edit?',
      choices: [
        { name: `Description [${draft.description ?? '(none)'}]`, value: 'description' },
        { name: `Synthesis artifact [${draft.synthesisArtifact}]`, value: 'synthesisArtifact' },
        { name: `Steps [${draft.steps.length}: ${stepsLabel}]`, value: 'steps' },
        new Separator(),
        { name: 'Save', value: 'save' },
        { name: 'Cancel (discard changes)', value: 'cancel' },
      ],
    });

    if (choice === 'save') break;
    if (choice === 'cancel') { console.log('Edit cancelled.'); return; }

    if (choice === 'description') {
      const raw = await input({ message: 'Description:', default: draft.description ?? '' });
      draft = { ...draft, description: raw.trim() || undefined };
    } else if (choice === 'synthesisArtifact') {
      const raw = await input({
        message: 'Synthesis artifact name:',
        default: draft.synthesisArtifact,
        validate: (v) => v.trim().length > 0 || 'Required',
      });
      draft = { ...draft, synthesisArtifact: raw.trim() };
    } else if (choice === 'steps') {
      const newSteps = await promptFlavorSteps(draft.steps, draft.stageCategory, ctx);
      if (newSteps) draft = { ...draft, steps: newSteps };
    }
  }

  const parsed = FlavorSchema.parse(draft);
  const registry = new FlavorRegistry(ctx.flavorsDir);
  registry.register(parsed);
  console.log(`\nFlavor "${parsed.name}" saved.`);
}

// ── Kata handlers ─────────────────────────────────────────────────────────────

async function handleKataCreate(ctx: ActionCtx): Promise<void> {
  const { input, select } = await import('@inquirer/prompts');

  console.log('\n── Create Kata Pattern ───────────────────────────────────────');

  const name = (
    await input({
      message: 'Kata name (e.g., "full-feature"):',
      validate: (v) => {
        const t = v.trim();
        if (!t) return 'Name is required';
        if (!/^[a-z0-9-]+$/.test(t)) return 'Use lowercase letters, numbers, and hyphens only';
        return true;
      },
    })
  ).trim();

  // Build the stage sequence with an ordered loop — same stage may appear multiple times
  const stages: StageCategory[] = [];
  console.log('\nBuild your stage sequence — you can add the same stage multiple times.');

  while (true) {
    if (stages.length > 0) {
      console.log(`\nCurrent: ${stages.join(' → ')}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stageChoices: any[] = StageCategorySchema.options.map((c) => ({ name: c, value: c }));
    if (stages.length > 0) {
      stageChoices.push({ name: '↩  Remove last stage', value: '_undo' });
      stageChoices.push({ name: '✓  Done — save this sequence', value: '_done' });
    }
    const pick = await select<string>({ message: 'Add stage:', choices: stageChoices });
    if (pick === '_done') break;
    if (pick === '_undo') { stages.pop(); continue; }
    stages.push(pick as StageCategory);
  }

  if (stages.length === 0) {
    console.log('Cancelled — at least one stage is required.');
    return;
  }

  const descRaw = (await input({ message: 'Description (optional):' })).trim();
  const description = descRaw || undefined;

  const kata = SavedKataSchema.parse({ name, stages, description });
  const filePath = join(ctx.katasDir, `${name}.json`);
  JsonStore.write(filePath, kata, SavedKataSchema);

  console.log(`\nKata pattern "${name}" saved (${stages.join(' → ')}).`);
}

async function handleKataDelete(
  kata: Extract<ConfigAction, { type: 'kata:delete' }>['kata'],
  ctx: ActionCtx,
): Promise<void> {
  const { confirm } = await import('@inquirer/prompts');

  const ok = await confirm({
    message: `Delete kata pattern "${kata.name}"? This cannot be undone.`,
    default: false,
  });

  if (ok) {
    try {
      unlinkSync(join(ctx.katasDir, `${kata.name}.json`));
      console.log(`Kata pattern "${kata.name}" deleted.`);
    } catch (e) {
      console.error(`Failed to delete: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    console.log('Cancelled.');
  }
}
