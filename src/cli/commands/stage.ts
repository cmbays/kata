import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Command } from 'commander';
import { StageCategorySchema, type StageCategory } from '@domain/types/stage.js';
import { StageVocabularySchema, type StageVocabulary } from '@domain/types/vocabulary.js';
import { FlavorRegistry } from '@infra/registries/flavor-registry.js';
import { RuleRegistry } from '@infra/registries/rule-registry.js';
import { DecisionRegistry } from '@infra/registries/decision-registry.js';
import { withCommandContext, kataDirPath } from '@cli/utils.js';
import { KATA_DIRS } from '@shared/constants/paths.js';
import {
  readRun,
  writeRun,
  readStageState,
  writeStageState,
  runPaths,
} from '@infra/persistence/run-store.js';
import {
  formatStageCategoryTable,
  formatStageCategoryDetail,
  formatStageCategoryJson,
} from '@cli/formatters/stage-formatter.js';

/**
 * Register the `kata stage` / `kata gyo` commands.
 *
 * Stages are the 4 fixed macro-level work modes (research, plan, build, review).
 * Each stage has an orchestrator config, available flavors, and rules.
 * For atomic step CRUD, see `kata step` / `kata waza`.
 */
export function registerStageCommands(parent: Command): void {
  const stage = parent
    .command('stage')
    .alias('gyo')
    .description('Manage stages — the 4 fixed work modes: research, plan, build, review (alias: gyo)');

  // ---- list ----
  stage
    .command('list')
    .description('List all stage categories with flavor counts')
    .action(withCommandContext((ctx) => {
      const categories = StageCategorySchema.options;
      const flavorRegistry = new FlavorRegistry(kataDirPath(ctx.kataDir, 'flavors'));
      const ruleRegistry = new RuleRegistry(kataDirPath(ctx.kataDir, 'rules'));

      const entries = categories.map((cat) => {
        const flavors = flavorRegistry.list(cat);
        const rules = ruleRegistry.loadRules(cat);
        return { category: cat, flavorCount: flavors.length, ruleCount: rules.length };
      });

      if (ctx.globalOpts.json) {
        console.log(formatStageCategoryJson(entries));
      } else {
        console.log(formatStageCategoryTable(entries, ctx.globalOpts.plain));
      }
    }));

  // ---- complete <run-id> ----
  stage
    .command('complete <run-id>')
    .description('Mark a stage as completed, copy synthesis, and advance the run')
    .requiredOption('--stage <category>', 'Stage category to complete (research, plan, build, review)')
    .option('--synthesis <file-path>', 'Path to the synthesis file to copy into the run directory')
    .action(withCommandContext(async (ctx, runId: string) => {
      const localOpts = ctx.cmd.opts();
      const runsDir = kataDirPath(ctx.kataDir, 'runs');

      const stageResult = StageCategorySchema.safeParse(localOpts.stage);
      if (!stageResult.success) {
        throw new Error(`Invalid stage category: "${localOpts.stage}". Valid: ${StageCategorySchema.options.join(', ')}`);
      }
      const stageCategory = stageResult.data;

      const run = readRun(runsDir, runId);

      // Validate stage is part of this run's sequence before any mutation
      const currentIdx = run.stageSequence.indexOf(stageCategory);
      if (currentIdx === -1) {
        throw new Error(
          `Stage "${stageCategory}" is not in the sequence for run "${runId}". Sequence: ${run.stageSequence.join(', ')}.`
        );
      }

      const stageState = readStageState(runsDir, runId, stageCategory);
      const paths = runPaths(runsDir, runId);
      const now = new Date().toISOString();

      // Copy synthesis file if provided
      let synthesisArtifact: string | undefined;
      if (localOpts.synthesis) {
        const srcPath = resolve(localOpts.synthesis as string);
        if (!existsSync(srcPath)) {
          throw new Error(
            `Synthesis file not found: "${srcPath}". Stage "${stageCategory}" was NOT marked as completed.`
          );
        }
        const destPath = paths.stageSynthesis(stageCategory);
        try {
          copyFileSync(srcPath, destPath);
        } catch (err) {
          throw new Error(
            `Failed to copy synthesis file to run directory: ${err instanceof Error ? err.message : String(err)}. Stage "${stageCategory}" was NOT marked as completed.`,
            { cause: err }
          );
        }
        synthesisArtifact = `stages/${stageCategory}/synthesis.md`;
      }

      // Update stage state
      stageState.status = 'completed';
      stageState.completedAt = now;
      if (synthesisArtifact) stageState.synthesisArtifact = synthesisArtifact;
      writeStageState(runsDir, runId, stageState);

      // Advance run: next stage or complete
      const nextStage = run.stageSequence[currentIdx + 1] ?? null;

      if (nextStage) {
        run.currentStage = nextStage;
      } else {
        run.status = 'completed';
        run.completedAt = now;
      }
      writeRun(runsDir, run);

      const result = { stage: stageCategory, status: 'completed' as const, nextStage };
      if (ctx.globalOpts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (nextStage) {
        console.log(`Stage "${stageCategory}" completed. Next stage: ${nextStage}`);
      } else {
        console.log(`Stage "${stageCategory}" completed. Run ${runId.slice(0, 8)} is now complete.`);
      }
    }));

  // ---- inspect <category> ----
  stage
    .command('inspect <category>')
    .description('Show stage details: flavors, rules, recent decisions')
    .action(withCommandContext((ctx, category: string) => {
      const parseResult = StageCategorySchema.safeParse(category);
      if (!parseResult.success) {
        const valid = StageCategorySchema.options.join(', ');
        console.error(`Invalid stage category: "${category}". Valid categories: ${valid}`);
        process.exitCode = 1;
        return;
      }
      const stageCategory: StageCategory = parseResult.data;
      const flavorRegistry = new FlavorRegistry(kataDirPath(ctx.kataDir, 'flavors'));
      const ruleRegistry = new RuleRegistry(kataDirPath(ctx.kataDir, 'rules'));
      const decisionRegistry = new DecisionRegistry(kataDirPath(ctx.kataDir, 'history'));

      const flavors = flavorRegistry.list(stageCategory);
      const rules = ruleRegistry.loadRules(stageCategory);
      const decisions = decisionRegistry.list({ stageCategory });
      const recentDecisions = decisions.slice(-5);

      if (ctx.globalOpts.json) {
        console.log(JSON.stringify({
          category: stageCategory,
          flavorCount: flavors.length,
          flavors: flavors.map((f) => f.name),
          ruleCount: rules.length,
          rules: rules.map((r) => ({ name: r.name, effect: r.effect, magnitude: r.magnitude })),
          recentDecisions: recentDecisions.length,
        }, null, 2));
      } else {
        console.log(formatStageCategoryDetail({
          category: stageCategory,
          flavors,
          rules,
          recentDecisions,
        }, ctx.globalOpts.plain));
      }
    }));

  // ---- vocab ----
  const vocab = stage
    .command('vocab')
    .description('Manage stage vocabulary — keywords used by orchestration scoring');

  vocab
    .command('seed [category] [keywords...]')
    .description('Add keywords to a stage vocabulary (persisted to .kata/vocabularies/)')
    .option('--from-json <path>', 'Bulk seed from JSON file ("-" reads stdin): { "research": [...], "build": [...] }')
    .action(withCommandContext(async (ctx, category?: string, keywords?: string[]) => {
      const localOpts = ctx.cmd.opts();
      const vocabDir = join(ctx.kataDir, KATA_DIRS.vocabularies);
      mkdirSync(vocabDir, { recursive: true });

      if (localOpts.fromJson) {
        // Bulk mode: JSON object { category: keyword[] }
        let text: string;
        const src = localOpts.fromJson as string;
        if (src === '-') {
          try { text = readFileSync('/dev/stdin', 'utf-8'); }
          catch (e) { throw new Error(`Could not read from stdin: ${e instanceof Error ? e.message : String(e)}`, { cause: e }); }
        } else {
          const filePath = resolve(src);
          try { text = readFileSync(filePath, 'utf-8'); }
          catch (e) { throw new Error(`Could not read file "${resolve(src)}": ${e instanceof Error ? e.message : String(e)}`, { cause: e }); }
        }
        let raw: unknown;
        try { raw = JSON.parse(text); }
        catch (e) { throw new Error(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`, { cause: e }); }

        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          throw new Error('--from-json expects an object mapping category names to keyword arrays.');
        }
        const input = raw as Record<string, unknown>;
        // Validate all entries before writing any (all-or-nothing)
        type VocabEntry = { category: StageCategory; keywords: string[] };
        const vocabEntries: VocabEntry[] = [];
        for (const [cat, kws] of Object.entries(input)) {
          const catResult = StageCategorySchema.safeParse(cat);
          if (!catResult.success) {
            throw new Error(`Unknown category "${cat}". Valid: ${StageCategorySchema.options.join(', ')}`);
          }
          if (!Array.isArray(kws) || !kws.every((k) => typeof k === 'string')) {
            throw new Error(`Keywords for "${cat}" must be an array of strings.`);
          }
          vocabEntries.push({ category: catResult.data, keywords: kws as string[] });
        }
        // All valid — write all
        const results: Array<{ category: StageCategory; added: number; total: number }> = [];
        for (const { category, keywords } of vocabEntries) {
          const { added, total } = seedVocabKeywords(vocabDir, category, keywords);
          results.push({ category, added, total });
        }
        if (ctx.globalOpts.json) {
          console.log(JSON.stringify(results, null, 2));
        } else {
          for (const r of results) {
            console.log(`${r.category}: added ${r.added} keyword${r.added === 1 ? '' : 's'} (${r.total} total)`);
          }
        }
        return;
      }

      // Single-category mode
      if (!category) {
        throw new Error('Usage: kata stage vocab seed <category> <keyword...> [or --from-json <file>]');
      }
      const catResult = StageCategorySchema.safeParse(category);
      if (!catResult.success) {
        throw new Error(`Unknown category "${category}". Valid: ${StageCategorySchema.options.join(', ')}`);
      }
      const kws = keywords ?? [];
      if (kws.length === 0) {
        throw new Error('At least one keyword is required.');
      }
      const { added, total } = seedVocabKeywords(vocabDir, catResult.data, kws);
      const result = { category: catResult.data, added, total };
      if (ctx.globalOpts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`${catResult.data}: added ${added} keyword${added === 1 ? '' : 's'} (${total} total)`);
      }
    }));
}

/**
 * Merge new keywords into the vocabulary file for a category.
 * Creates the file if it doesn't exist. Deduplicates keywords.
 * Returns the count of newly added and total keywords.
 */
function seedVocabKeywords(vocabDir: string, category: StageCategory, newKeywords: string[]): { added: number; total: number } {
  const vocabPath = join(vocabDir, `${category}.json`);
  let existing: StageVocabulary | undefined;
  if (existsSync(vocabPath)) {
    try {
      const raw = JSON.parse(readFileSync(vocabPath, 'utf-8'));
      existing = StageVocabularySchema.parse(raw);
    } catch {
      // File exists but is corrupt — warn and start fresh
      console.warn(`Warning: vocabulary file "${vocabPath}" is corrupt and will be overwritten.`);
      existing = undefined;
    }
  }
  const baseKeywords = existing?.keywords ?? [];
  const existingSet = new Set(baseKeywords);
  const toAdd = newKeywords.filter((k) => k.trim() && !existingSet.has(k.trim())).map((k) => k.trim());
  const merged = [...baseKeywords, ...toAdd];
  const vocab: StageVocabulary = StageVocabularySchema.parse({
    ...(existing ?? {}),
    category,
    keywords: merged,
  });
  writeFileSync(vocabPath, JSON.stringify(vocab, null, 2), 'utf-8');
  return { added: toAdd.length, total: merged.length };
}
