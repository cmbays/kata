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
import type { Step, StepResources } from '@domain/types/step.js';
import { FlavorRegistry } from '@infra/registries/flavor-registry.js';
import { ManifestBuilder } from '@domain/services/manifest-builder.js';
import {
  stepLabel,
  buildPromptContent,
  selectStep,
  promptArtifacts,
  promptGateConditions,
  editFieldLoop,
} from './shared-wizards.js';
import {
  readRun,
  readStageState,
  readFlavorState,
  writeFlavorState,
  runPaths,
} from '@infra/persistence/run-store.js';
import { JsonlStore } from '@infra/persistence/jsonl-store.js';
import { ArtifactIndexEntrySchema, type FlavorState } from '@domain/types/run-state.js';
import { StageCategorySchema } from '@domain/types/stage.js';

// ---- Register commands ----

export function registerStepCommands(parent: Command): void {
  const step = parent
    .command('step')
    .alias('waza')
    .description('Manage steps — atomic methodology units with gates and artifacts (alias: waza)');

  // ---- next <run-id> ----
  step
    .command('next <run-id>')
    .description('Query the next step to execute for a run')
    .action(withCommandContext(async (ctx, runId: string) => {
      const runsDir = kataDirPath(ctx.kataDir, 'runs');
      const stagesDir = kataDirPath(ctx.kataDir, 'stages');

      const run = readRun(runsDir, runId);

      // Completed / failed runs
      if (run.status === 'completed') {
        const result = { status: 'complete' as const };
        if (ctx.globalOpts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log('Run is complete.');
        }
        return;
      }

      if (run.status === 'failed') {
        const result = { status: 'failed' as const, message: run.completedAt ?? 'Run failed' };
        if (ctx.globalOpts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`Run failed${run.completedAt ? ` at ${run.completedAt}` : ''}.`);
        }
        return;
      }

      const currentStage = run.currentStage ?? run.stageSequence[0];
      if (!currentStage) {
        const result = { status: 'complete' as const, message: 'No stages in run' };
        if (ctx.globalOpts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log('No stages in run.');
        }
        return;
      }

      // Read stage state — createRunTree always writes state.json so this should always succeed.
      const stageState = readStageState(runsDir, runId, currentStage);

      // Blocked by a gate?
      if (stageState.pendingGate) {
        const result = {
          status: 'waiting' as const,
          gate: stageState.pendingGate,
          message: `Gate "${stageState.pendingGate.gateId}" requires approval (${stageState.pendingGate.gateType}). Run "kata approve" to unblock.`,
        };
        if (ctx.globalOpts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`Waiting — gate: ${stageState.pendingGate.gateId} (${stageState.pendingGate.gateType})`);
          console.log(`  Run "kata approve ${stageState.pendingGate.gateId}" to unblock.`);
        }
        return;
      }

      // No flavors selected yet
      if (stageState.selectedFlavors.length === 0) {
        const result = {
          status: 'waiting' as const,
          message: 'No flavors selected yet. Orchestrator needs to select flavors for this stage.',
        };
        if (ctx.globalOpts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log('Waiting — no flavors selected yet for this stage.');
        }
        return;
      }

      // Find the active flavor (first not completed/skipped)
      const paths = runPaths(runsDir, runId);
      let activeFlavor: string | undefined;
      for (const flavorName of stageState.selectedFlavors) {
        const flavorState = readFlavorState(runsDir, runId, currentStage, flavorName, { allowMissing: true });
        const status = flavorState?.status ?? 'pending';
        if (status !== 'completed' && status !== 'skipped') {
          activeFlavor = flavorName;
          break;
        }
      }

      if (!activeFlavor) {
        const result = { status: 'complete' as const, message: 'All flavors in this stage are complete' };
        if (ctx.globalOpts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log('All flavors complete for this stage.');
        }
        return;
      }

      const flavorState = readFlavorState(runsDir, runId, currentStage, activeFlavor, { allowMissing: true });

      // Find the next pending/running step
      let nextStepType: string | undefined;
      const stepRuns = flavorState?.steps ?? [];
      const pendingStepRun = stepRuns.find((s) => s.status === 'pending' || s.status === 'running');
      if (pendingStepRun) {
        nextStepType = pendingStepRun.type;
      } else if (stepRuns.length === 0) {
        // No step records yet — get first step from registry
        const registry = new StepRegistry(stagesDir);
        const steps = registry.list({ type: activeFlavor });
        nextStepType = steps[0]?.type;
      }

      if (!nextStepType) {
        const result = { status: 'complete' as const, message: 'All steps in active flavor are complete' };
        if (ctx.globalOpts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log('All steps complete for the active flavor.');
        }
        return;
      }

      // Resolve full step definition
      const registry = new StepRegistry(stagesDir);
      let stepDef: Step | undefined;
      try {
        stepDef = registry.get(nextStepType);
      } catch {
        // Step definition not found — return minimal info
      }

      // Aggregate flavor-level resources — step definitions win on name conflicts
      let mergedResources: StepResources | undefined = stepDef?.resources;
      try {
        const flavorsDir = kataDirPath(ctx.kataDir, 'flavors');
        const flavorReg = new FlavorRegistry(flavorsDir);
        const flavor = flavorReg.get(currentStage, activeFlavor);
        mergedResources = ManifestBuilder.aggregateFlavorResources(flavor, registry.list());
      } catch {
        // Flavor not registered — keep step-only resources
      }

      // Resolve prompt
      let prompt = stepDef?.description ?? '';
      if (stepDef?.promptTemplate) {
        const promptPath = resolve(stagesDir, stepDef.promptTemplate);
        if (existsSync(promptPath)) {
          const raw = readFileSync(promptPath, 'utf-8');
          prompt = raw.replace(/\{\{\s*betPrompt\s*\}\}/g, run.betPrompt);
        }
      }

      // Prior artifacts for this flavor
      const priorArtifacts = JsonlStore.readAll(
        paths.flavorArtifactIndexJsonl(currentStage, activeFlavor),
        ArtifactIndexEntrySchema,
      );

      // Prior stage syntheses
      const priorStageSyntheses: Array<{ stage: string; filePath: string }> = [];
      for (const prevStage of run.stageSequence) {
        if (prevStage === currentStage) break;
        let prevStageState;
        try {
          prevStageState = readStageState(runsDir, runId, prevStage);
        } catch {
          continue;
        }
        if (prevStageState.status === 'completed') {
          priorStageSyntheses.push({
            stage: prevStage,
            filePath: paths.stageSynthesis(prevStage),
          });
        }
      }

      const result = {
        runId,
        stage: currentStage,
        flavor: activeFlavor,
        step: nextStepType,
        prompt,
        resources: mergedResources ?? {},
        gates: {
          entry: stepDef?.entryGate ? [stepDef.entryGate] : [],
          exit: stepDef?.exitGate ? [stepDef.exitGate] : [],
        },
        priorArtifacts,
        betPrompt: run.betPrompt,
        priorStageSyntheses,
      };

      if (ctx.globalOpts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Next step: ${nextStepType}`);
        console.log(`  Run:    ${runId}`);
        console.log(`  Stage:  ${currentStage}`);
        console.log(`  Flavor: ${activeFlavor}`);
        if (prompt) {
          const preview = prompt.length > 200 ? `${prompt.slice(0, 200)}...` : prompt;
          console.log(`  Prompt: ${preview}`);
        }
        if (result.gates.entry.length > 0) {
          console.log(`  Entry gate: ${result.gates.entry.map((g) => g.conditions.map((c) => c.type).join(', ')).join('; ')}`);
        }
        if (result.gates.exit.length > 0) {
          console.log(`  Exit gate: ${result.gates.exit.map((g) => g.conditions.map((c) => c.type).join(', ')).join('; ')}`);
        }
      }
    }));

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

  // ---- complete <run-id> ----
  step
    .command('complete <run-id>')
    .description('Mark a step as completed within a flavor, advancing run state')
    .requiredOption('--stage <category>', 'Stage category (research, plan, build, review)')
    .requiredOption('--flavor <name>', 'Flavor name (directory under stages/<cat>/flavors/)')
    .requiredOption('--step <type>', 'Step type to mark as completed')
    .action(withCommandContext(async (ctx, runId: string) => {
      const localOpts = ctx.cmd.opts();
      const runsDir = kataDirPath(ctx.kataDir, 'runs');

      const stageResult = StageCategorySchema.safeParse(localOpts.stage);
      if (!stageResult.success) {
        throw new Error(`Invalid stage category: "${localOpts.stage}". Valid: ${StageCategorySchema.options.join(', ')}`);
      }
      const stage = stageResult.data;
      const flavorName = localOpts.flavor as string;
      const stepType = localOpts.step as string;

      // Verify run exists
      readRun(runsDir, runId);

      // Read existing flavor state or create a minimal one
      const existing = readFlavorState(runsDir, runId, stage, flavorName, { allowMissing: true });

      const now = new Date().toISOString();
      let steps = existing?.steps ?? [];

      const stepIdx = steps.findIndex((s) => s.type === stepType);
      if (stepIdx >= 0) {
        if (steps[stepIdx]!.status === 'completed') {
          // Idempotent: already completed — emit and return without re-writing state
          const result = { stage, flavor: flavorName, step: stepType, status: 'completed' as const };
          if (ctx.globalOpts.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.warn(`Warning: step "${stepType}" in flavor "${flavorName}" is already completed. No changes made.`);
          }
          return;
        }
        steps = steps.map((s) =>
          s.type === stepType
            ? { ...s, status: 'completed' as const, completedAt: now }
            : s
        );
      } else {
        steps = [...steps, {
          type: stepType,
          status: 'completed' as const,
          artifacts: [],
          startedAt: now,
          completedAt: now,
        }];
      }

      // Flavor is complete only when no steps remain pending or running
      const hasPending = steps.some((s) => s.status === 'pending' || s.status === 'running');
      const flavorStatus = hasPending ? 'running' : 'completed';

      const flavorState: FlavorState = {
        name: flavorName,
        stageCategory: stage,
        status: flavorStatus,
        steps,
        currentStep: null,
      };

      writeFlavorState(runsDir, runId, stage, flavorState);

      const result = { stage, flavor: flavorName, step: stepType, status: 'completed' as const };
      if (ctx.globalOpts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Step "${stepType}" in flavor "${flavorName}" (stage: ${stage}) marked as completed.`);
      }
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
