import type { Command } from 'commander';
import { StageCategorySchema, type StageCategory } from '@domain/types/stage.js';
import { FlavorRegistry } from '@infra/registries/flavor-registry.js';
import { StepRegistry } from '@infra/registries/step-registry.js';
import { withCommandContext, kataDirPath } from '@cli/utils.js';
import { formatFlavorTable, formatFlavorDetail, formatFlavorJson } from '@cli/formatters/flavor-formatter.js';

/**
 * Register the `kata flavor` / `kata ryu` commands.
 *
 * Flavors are named compositions of Steps within a Stage category.
 * Second tier of the hierarchy: Stage -> Flavor -> Step.
 */
export function registerFlavorCommands(parent: Command): void {
  const flavor = parent
    .command('flavor')
    .alias('ryu')
    .description('Manage flavors — named compositions of steps within a stage (alias: ryu)');

  // ---- list ----
  flavor
    .command('list')
    .description('List available flavors')
    .option('--stage <category>', 'Filter by stage category (research, plan, build, review)')
    .action(withCommandContext((ctx) => {
      const localOpts = ctx.cmd.opts();
      const registry = new FlavorRegistry(kataDirPath(ctx.kataDir, 'flavors'));

      let stageFilter: StageCategory | undefined;
      if (localOpts.stage) {
        const parseResult = StageCategorySchema.safeParse(localOpts.stage);
        if (!parseResult.success) {
          const valid = StageCategorySchema.options.join(', ');
          console.error(`Invalid stage category: "${localOpts.stage}". Valid categories: ${valid}`);
          process.exitCode = 1;
          return;
        }
        stageFilter = parseResult.data;
      }

      const flavors = stageFilter ? registry.list(stageFilter) : registry.list();

      if (ctx.globalOpts.json) {
        console.log(formatFlavorJson(flavors));
      } else {
        console.log(formatFlavorTable(flavors));
      }
    }));

  // ---- inspect <name> ----
  flavor
    .command('inspect <name>')
    .description('Show flavor details (step list, overrides, synthesis artifact)')
    .option('--stage <category>', 'Stage category to look up the flavor in')
    .action(withCommandContext((ctx, name: string) => {
      const localOpts = ctx.cmd.opts();
      const registry = new FlavorRegistry(kataDirPath(ctx.kataDir, 'flavors'));

      if (localOpts.stage) {
        const parseResult = StageCategorySchema.safeParse(localOpts.stage);
        if (!parseResult.success) {
          const valid = StageCategorySchema.options.join(', ');
          console.error(`Invalid stage category: "${localOpts.stage}". Valid categories: ${valid}`);
          process.exitCode = 1;
          return;
        }
        const flavorObj = registry.get(parseResult.data, name);
        if (ctx.globalOpts.json) {
          console.log(formatFlavorJson([flavorObj]));
        } else {
          console.log(formatFlavorDetail(flavorObj));
        }
        return;
      }

      // No --stage: search all categories
      const allFlavors = registry.list();
      const match = allFlavors.find((f) => f.name === name);
      if (!match) {
        console.error(`Flavor "${name}" not found. Use --stage <category> to specify, or check "kata flavor list".`);
        process.exitCode = 1;
        return;
      }
      if (ctx.globalOpts.json) {
        console.log(formatFlavorJson([match]));
      } else {
        console.log(formatFlavorDetail(match));
      }
    }));

  // ---- create ----
  flavor
    .command('create')
    .description('Interactively create a new flavor definition')
    .option('--from-file <path>', 'Load flavor definition from a JSON file')
    .action(withCommandContext(async (ctx) => {
      const localOpts = ctx.cmd.opts();
      const registry = new FlavorRegistry(kataDirPath(ctx.kataDir, 'flavors'));
      const isJson = ctx.globalOpts.json;

      if (localOpts.fromFile) {
        const { readFileSync } = await import('node:fs');
        const { resolve } = await import('node:path');
        const filePath = resolve(localOpts.fromFile as string);
        let raw: unknown;
        try {
          raw = JSON.parse(readFileSync(filePath, 'utf-8'));
        } catch (e) {
          throw new Error(`Could not read flavor file "${filePath}": ${e instanceof Error ? e.message : String(e)}`, { cause: e });
        }
        const { FlavorSchema } = await import('@domain/types/flavor.js');
        const flavor = FlavorSchema.parse(raw);
        registry.register(flavor);
        if (isJson) {
          console.log(formatFlavorJson([flavor]));
        } else {
          console.log(`Flavor "${flavor.name}" created for stage "${flavor.stageCategory}".`);
        }
        return;
      }

      const { input, select } = await import('@inquirer/prompts');

      const stageCategory = await select({
        message: 'Stage category:',
        choices: StageCategorySchema.options.map((c) => ({ name: c, value: c })),
      });

      const name = (await input({
        message: 'Flavor name (e.g., "typescript-tdd"):',
        validate: (v) => v.trim().length > 0 || 'Name is required',
      })).trim();

      const descRaw = (await input({ message: 'Description (optional):' })).trim();
      const description = descRaw || undefined;

      const synthesisArtifact = (await input({
        message: 'Synthesis artifact name:',
        validate: (v) => v.trim().length > 0 || 'Synthesis artifact is required',
      })).trim();

      // Collect steps
      const steps: { stepName: string; stepType: string }[] = [];
      let addStep = true;
      while (addStep) {
        const stepName = (await input({
          message: `Step ${steps.length + 1} name:`,
          validate: (v) => {
            const t = v.trim();
            if (!t) return 'Step name is required';
            if (steps.some((s) => s.stepName === t)) return `Step "${t}" already added`;
            return true;
          },
        })).trim();
        const stepType = (await input({
          message: `Step "${stepName}" type:`,
          validate: (v) => v.trim().length > 0 || 'Step type is required',
        })).trim();
        steps.push({ stepName, stepType });

        const { confirm } = await import('@inquirer/prompts');
        addStep = await confirm({ message: 'Add another step?', default: false });
      }

      const { FlavorSchema } = await import('@domain/types/flavor.js');
      const flavor = FlavorSchema.parse({
        name,
        description,
        stageCategory,
        steps,
        synthesisArtifact,
      });
      registry.register(flavor);

      if (isJson) {
        console.log(formatFlavorJson([flavor]));
      } else {
        console.log(`\nFlavor "${name}" created for stage "${stageCategory}".`);
        console.log(formatFlavorDetail(flavor));
      }
    }));

  // ---- delete <name> ----
  flavor
    .command('delete <name>')
    .alias('wasure')
    .description('Delete a flavor definition (alias: wasure)')
    .option('--stage <category>', 'Stage category (required)')
    .option('--force', 'Skip confirmation prompt')
    .action(withCommandContext(async (ctx, name: string) => {
      const localOpts = ctx.cmd.opts();

      if (!localOpts.stage) {
        console.error('--stage <category> is required for flavor delete.');
        process.exitCode = 1;
        return;
      }

      const parseResult = StageCategorySchema.safeParse(localOpts.stage);
      if (!parseResult.success) {
        const valid = StageCategorySchema.options.join(', ');
        console.error(`Invalid stage category: "${localOpts.stage}". Valid categories: ${valid}`);
        process.exitCode = 1;
        return;
      }

      const registry = new FlavorRegistry(kataDirPath(ctx.kataDir, 'flavors'));

      if (!localOpts.force) {
        const { confirm } = await import('@inquirer/prompts');
        const ok = await confirm({
          message: `Delete flavor "${name}" from stage "${parseResult.data}"? This cannot be undone.`,
          default: false,
        });
        if (!ok) {
          console.log('Cancelled.');
          return;
        }
      }

      const deleted = registry.delete(parseResult.data, name);
      console.log(`Flavor "${deleted.name}" deleted from stage "${deleted.stageCategory}".`);
    }));

  // ---- validate <name> ----
  flavor
    .command('validate <name>')
    .description('Run DAG validation on a flavor')
    .option('--stage <category>', 'Stage category (required)')
    .action(withCommandContext((ctx, name: string) => {
      const localOpts = ctx.cmd.opts();

      if (!localOpts.stage) {
        console.error('--stage <category> is required for flavor validate.');
        process.exitCode = 1;
        return;
      }

      const parseResult = StageCategorySchema.safeParse(localOpts.stage);
      if (!parseResult.success) {
        const valid = StageCategorySchema.options.join(', ');
        console.error(`Invalid stage category: "${localOpts.stage}". Valid categories: ${valid}`);
        process.exitCode = 1;
        return;
      }

      const flavorRegistry = new FlavorRegistry(kataDirPath(ctx.kataDir, 'flavors'));
      const flavorObj = flavorRegistry.get(parseResult.data, name);

      // Use StepRegistry as step resolver for DAG validation
      const stepRegistry = new StepRegistry(kataDirPath(ctx.kataDir, 'stages'));
      const stepResolver = (_stepName: string, stepType: string) => {
        try { return stepRegistry.get(stepType, undefined); } catch { return undefined; }
      };

      const result = flavorRegistry.validate(flavorObj, stepResolver);

      if (ctx.globalOpts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (result.valid) {
        console.log(`Flavor "${name}" is valid.`);
      } else {
        console.log(`Flavor "${name}" has validation errors:`);
        for (const error of result.errors) {
          console.log(`  - ${error}`);
        }
        process.exitCode = 1;
      }
    }));
}
