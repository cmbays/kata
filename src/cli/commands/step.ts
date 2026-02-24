import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Command } from 'commander';
import { StepRegistry } from '@infra/registries/step-registry.js';
import { StepNotFoundError } from '@shared/lib/errors.js';
import { withCommandContext, kataDirPath } from '@cli/utils.js';
import { formatStepTable, formatStepDetail, formatStepJson } from '@cli/formatters/step-formatter.js';
import { createStep } from '@features/step-create/step-creator.js';
import { editStep } from '@features/step-create/step-editor.js';
import { deleteStep } from '@features/step-create/step-deleter.js';
import type { Gate } from '@domain/types/gate.js';
import type { Step } from '@domain/types/step.js';
import {
  stepLabel,
  buildPromptContent,
  selectStep,
  promptArtifacts,
  promptGateConditions,
  editFieldLoop,
} from './shared-wizards.js';

// ---- Register commands ----

export function registerStepCommands(parent: Command): void {
  const step = parent
    .command('step')
    .alias('waza')
    .description('Manage steps — atomic methodology units with gates and artifacts (alias: waza)');

  // ---- list ----
  step
    .command('list')
    .description('List available steps')
    .option('--type <step-type>', 'Show only steps of this type (base + all flavors), e.g. --type build')
    .option('--ryu <style>')
    .action(withCommandContext((ctx) => {
      const localOpts = ctx.cmd.opts();
      const filter: string | undefined = localOpts.type ?? localOpts.ryu;
      const registry = new StepRegistry(kataDirPath(ctx.kataDir, 'stages'));
      const stages = filter ? registry.list({ type: filter }) : registry.list();

      if (ctx.globalOpts.json) {
        console.log(formatStepJson(stages));
      } else {
        console.log(formatStepTable(stages));
      }
    }));

  // ---- inspect [type] ----
  step
    .command('inspect [type]')
    .description('Show details of a specific step (omit type for selection wizard)')
    .option('--flavor <flavor>', 'Step flavor to inspect (alias: --ryu)')
    .option('--ryu <style>')
    .action(withCommandContext(async (ctx, type?: string) => {
      const localOpts = ctx.cmd.opts();
      const flavor: string | undefined = localOpts.flavor ?? localOpts.ryu;
      const registry = new StepRegistry(kataDirPath(ctx.kataDir, 'stages'));

      const stepObj = type
        ? registry.get(type, flavor)
        : await selectStep(registry);

      if (ctx.globalOpts.json) {
        console.log(formatStepJson([stepObj]));
      } else {
        console.log(formatStepDetail(stepObj));
      }
    }));

  // ---- create ----
  step
    .command('create')
    .description('Interactively scaffold a custom step definition')
    .option('--from-file <path>', 'Load step definition from a JSON file (skips interactive prompts)')
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
          throw new Error(`Could not read step file "${filePath}": ${e instanceof Error ? e.message : String(e)}`, { cause: e });
        }
        const { step: created } = createStep({ stagesDir, input: raw });
        if (isJson) {
          console.log(formatStepJson([created]));
        } else {
          console.log(`Step "${stepLabel(created.type, created.flavor)}" created from file.`);
        }
        return;
      }

      const { input, confirm } = await import('@inquirer/prompts');

      const type = (await input({
        message: 'Step type (e.g., "validate", "deploy-staging"):',
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

      const { step: created } = createStep({
        stagesDir,
        input: { type, flavor, description, artifacts, entryGate, exitGate, learningHooks, promptTemplate },
      });

      if (isJson) {
        console.log(formatStepJson([created]));
      } else {
        console.log(`\nStep "${stepLabel(created.type, created.flavor)}" created successfully.`);
        console.log(formatStepDetail(created));
      }
    }));

  // ---- edit [type] ----
  step
    .command('edit [type]')
    .description('Edit an existing step definition (omit type for selection wizard)')
    .option('--flavor <flavor>', 'Step flavor to edit (alias: --ryu)')
    .option('--ryu <style>')
    .action(withCommandContext(async (ctx, type?: string) => {
      const localOpts = ctx.cmd.opts();
      const flavor: string | undefined = localOpts.flavor ?? localOpts.ryu;
      const stagesDir = kataDirPath(ctx.kataDir, 'stages');
      const isJson = ctx.globalOpts.json;

      const registry = new StepRegistry(stagesDir);
      const existing = type
        ? registry.get(type, flavor)
        : await selectStep(registry);

      const label = stepLabel(existing.type, existing.flavor);
      if (!isJson) console.log(`Editing step: ${label}`);

      const { step: edited, cancelled } = await editFieldLoop(existing, ctx.kataDir, isJson);

      if (cancelled) {
        if (!isJson) console.log('Edit cancelled.');
        return;
      }

      const { step: saved } = editStep({
        stagesDir,
        type: existing.type,
        flavor: existing.flavor,
        input: edited,
      });

      if (isJson) {
        console.log(formatStepJson([saved]));
      } else {
        console.log(`\nStep "${stepLabel(saved.type, saved.flavor)}" updated successfully.`);
        console.log(formatStepDetail(saved));
      }
    }));

  // ---- delete <type> (alias: wasure) ----
  step
    .command('delete <type>')
    .alias('wasure')
    .description('Delete a step definition (alias: wasure)')
    .option('--flavor <flavor>', 'Step flavor to delete (alias: --ryu)')
    .option('--ryu <style>')
    .option('--force', 'Skip confirmation prompt')
    .action(withCommandContext(async (ctx, type: string) => {
      const localOpts = ctx.cmd.opts();
      const flavor: string | undefined = localOpts.flavor ?? localOpts.ryu;
      const stagesDir = kataDirPath(ctx.kataDir, 'stages');
      const label = stepLabel(type, flavor);

      if (!localOpts.force) {
        const { confirm } = await import('@inquirer/prompts');
        const ok = await confirm({
          message: `Delete step "${label}"? This cannot be undone.`,
          default: false,
        });
        if (!ok) {
          console.log('Cancelled.');
          return;
        }
      }

      const { deleted } = deleteStep({ stagesDir, type, flavor });
      console.log(`Step "${stepLabel(deleted.type, deleted.flavor)}" deleted.`);
    }));

  // ---- rename <type> <new-type> ----
  step
    .command('rename <type> <new-type>')
    .description('Rename a step type (flavor unchanged by default)')
    .option('--flavor <flavor>', 'Which flavor to rename (alias: --ryu)')
    .option('--ryu <style>')
    .option('--new-flavor <flavor>', 'New flavor name (alias: --new-ryu)')
    .option('--new-ryu <style>')
    .action(withCommandContext(async (ctx, type: string, newType: string) => {
      const localOpts = ctx.cmd.opts();
      const flavor: string | undefined = localOpts.flavor ?? localOpts.ryu;
      const newFlavor: string | undefined = localOpts.newFlavor ?? localOpts.newRyu ?? flavor;
      const stagesDir = kataDirPath(ctx.kataDir, 'stages');

      const registry = new StepRegistry(stagesDir);
      const existing = registry.get(type, flavor);

      // Guard: refuse if target already exists (unless renaming to same key)
      const oldKey = flavor ? `${type}:${flavor}` : type;
      const newKey = newFlavor ? `${newType}:${newFlavor}` : newType;
      if (oldKey !== newKey) {
        try {
          registry.get(newType, newFlavor);
          throw new Error(
            `Step "${stepLabel(newType, newFlavor)}" already exists. Delete it first or choose a different name.`
          );
        } catch (e) {
          if (!(e instanceof StepNotFoundError)) throw e;
        }
      }

      // Build updated step with new type+flavor
      let updated: Step = { ...existing, type: newType, flavor: newFlavor };

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

      // Rename prompt file first (before touching step JSONs)
      if (oldPromptPath && newPromptPath && existsSync(oldPromptPath)) {
        renameSync(oldPromptPath, newPromptPath);
      }

      // Write new step then delete old; roll back prompt rename on failure
      try {
        createStep({ stagesDir, input: updated });
        deleteStep({ stagesDir, type, flavor });
      } catch (e) {
        // Roll back newly created step file (best-effort)
        try { deleteStep({ stagesDir, type: newType, flavor: newFlavor }); } catch { /* ignore */ }
        if (newPromptPath && oldPromptPath && existsSync(newPromptPath)) {
          renameSync(newPromptPath, oldPromptPath);
        }
        throw e;
      }

      const fromLabel = stepLabel(type, flavor);
      const toLabel = stepLabel(newType, newFlavor);
      console.log(`Renamed "${fromLabel}" → "${toLabel}"`);
    }));
}
