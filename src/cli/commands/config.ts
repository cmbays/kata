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
import { JsonStore } from '@infra/persistence/json-store.js';
import { SavedKataSchema } from '@domain/types/saved-kata.js';
import { StageCategorySchema } from '@domain/types/stage.js';
import { editFieldLoop, stepLabel } from '@cli/commands/shared-wizards.js';

export function registerConfigCommand(parent: Command): void {
  parent
    .command('config')
    .alias('dojo')
    .description('Interactive methodology editor TUI — steps, flavors, kata patterns (dojo setup)')
    .action(
      withCommandContext(async (ctx) => {
        const stepsDir = kataDirPath(ctx.kataDir, 'stages');
        const flavorsDir = kataDirPath(ctx.kataDir, 'flavors');
        const katasDir = kataDirPath(ctx.kataDir, 'katas');

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
            }),
          );

          await waitUntilExit();

          if (!pendingAction) break; // user pressed q — truly exit

          // Drain any stdin bytes buffered during the Ink session (e.g. the
          // keypress that triggered onAction) so they don't bleed into the
          // first Inquirer prompt and cause an immediate ExitPromptError.
          {
            let chunk;
            while ((chunk = process.stdin.read()) !== null) {
              void chunk;
            }
          }
          await new Promise<void>((resolve) => setImmediate(resolve));
          {
            let chunk;
            while ((chunk = process.stdin.read()) !== null) {
              void chunk;
            }
          }

          await runConfigAction(pendingAction, {
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

async function runConfigAction(action: ConfigAction, ctx: ActionCtx): Promise<void> {
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
}

// ── Step handlers ─────────────────────────────────────────────────────────────

async function handleStepCreate(ctx: ActionCtx): Promise<void> {
  const { input, confirm } = await import('@inquirer/prompts');

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

  const descRaw = (await input({ message: 'Description (optional):' })).trim();
  const description = descRaw || undefined;

  const { step: created } = createStep({
    stagesDir: ctx.stepsDir,
    input: { type, flavor, description, artifacts: [], learningHooks: [] },
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
  const { input, confirm, select } = await import('@inquirer/prompts');

  console.log('\n── Create Flavor ─────────────────────────────────────────────');

  const stageCategory = await select({
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
      message: 'Synthesis artifact name:',
      validate: (v) => v.trim().length > 0 || 'Synthesis artifact is required',
    })
  ).trim();

  const steps: { stepName: string; stepType: string }[] = [];
  let addStep = true;
  while (addStep) {
    const stepName = (
      await input({
        message: `Step ${steps.length + 1} name:`,
        validate: (v) => {
          const t = v.trim();
          if (!t) return 'Step name is required';
          if (steps.some((s) => s.stepName === t)) return `Step "${t}" already added`;
          return true;
        },
      })
    ).trim();
    const stepType = (
      await input({
        message: `Step "${stepName}" type:`,
        validate: (v) => v.trim().length > 0 || 'Step type is required',
      })
    ).trim();
    steps.push({ stepName, stepType });
    addStep = await confirm({ message: 'Add another step?', default: false });
  }

  const registry = new FlavorRegistry(ctx.flavorsDir);
  const flavor = FlavorSchema.parse({ name, description, stageCategory, steps, synthesisArtifact });
  registry.register(flavor);

  console.log(`\nFlavor "${name}" created for stage "${stageCategory}".`);
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

// ── Kata handlers ─────────────────────────────────────────────────────────────

async function handleKataCreate(ctx: ActionCtx): Promise<void> {
  const { input, checkbox } = await import('@inquirer/prompts');

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

  const stages = await checkbox({
    message: 'Select stages (they run in the order listed):',
    choices: StageCategorySchema.options.map((c) => ({ name: c, value: c })),
  });

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
