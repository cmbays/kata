import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Command } from 'commander';
import { withCommandContext, kataDirPath } from '@cli/utils.js';
import { JsonlStore } from '@infra/persistence/jsonl-store.js';
import { readRun, readFlavorState, writeFlavorState, runPaths } from '@infra/persistence/run-store.js';
import { ArtifactIndexEntrySchema } from '@domain/types/run-state.js';
import type { StageCategory } from '@domain/types/stage.js';
import { StageCategorySchema } from '@domain/types/stage.js';

export function registerArtifactCommands(parent: Command): void {
  const artifact = parent
    .command('artifact')
    .description('Record artifacts produced during kata runs');

  // kata artifact record <run-id>
  artifact
    .command('record <run-id>')
    .description('Record an artifact file into a run\'s state')
    .requiredOption('--stage <category>', 'Stage category (research|plan|build|review)')
    .requiredOption('--flavor <name>', 'Flavor that produced the artifact')
    .option('--step <name>', 'Step that produced the artifact (omit for synthesis type)')
    .requiredOption('--file <path>', 'Path to the source artifact file')
    .requiredOption('--summary <description>', 'Short summary of the artifact content')
    .option('--type <type>', 'Artifact type: "artifact" (default) or "synthesis"', 'artifact')
    .action(withCommandContext(async (ctx, runId: string) => {
      const localOpts = ctx.cmd.opts();
      const runsDir = kataDirPath(ctx.kataDir, 'runs');

      // Validate stage category
      const stageResult = StageCategorySchema.safeParse(localOpts.stage);
      if (!stageResult.success) {
        throw new Error(
          `Invalid stage category "${localOpts.stage}". Must be one of: research, plan, build, review`,
        );
      }
      const stage = stageResult.data as StageCategory;

      // Validate artifact type
      const artifactType = localOpts.type as string;
      if (artifactType !== 'artifact' && artifactType !== 'synthesis') {
        throw new Error(`Invalid --type "${artifactType}". Must be "artifact" or "synthesis".`);
      }

      // --step is required for artifact type; omitted only for synthesis
      if (artifactType === 'artifact' && !localOpts.step) {
        throw new Error('--step is required when --type is "artifact". Omit --step only for --type synthesis.');
      }

      // Resolve and validate source file
      const sourcePath = isAbsolute(localOpts.file as string)
        ? localOpts.file as string
        : resolve(process.cwd(), localOpts.file as string);

      if (!existsSync(sourcePath)) {
        throw new Error(`Source file not found: ${sourcePath}`);
      }

      // Validate run exists
      const run = readRun(runsDir, runId);
      if (!run.stageSequence.includes(stage)) {
        throw new Error(`Stage "${stage}" is not in run "${runId}"'s stage sequence.`);
      }

      const paths = runPaths(runsDir, runId);
      const flavorDir = paths.flavorDir(stage, localOpts.flavor as string);
      const flavorStateFile = paths.flavorStateJson(stage, localOpts.flavor as string);

      // Ensure flavor directory exists (flavor may not have been explicitly initialized)
      mkdirSync(flavorDir, { recursive: true });

      // Synthesis artifacts are always named synthesis.md regardless of source filename
      const fileName = artifactType === 'synthesis' ? 'synthesis.md' : basename(sourcePath);
      let destPath: string;

      if (artifactType === 'synthesis') {
        // Synthesis artifacts go at the flavor root as synthesis.md
        destPath = paths.flavorSynthesis(stage, localOpts.flavor as string);
      } else {
        // Regular artifacts go in the artifacts/ subdirectory
        const artifactsDir = paths.flavorArtifactsDir(stage, localOpts.flavor as string);
        mkdirSync(artifactsDir, { recursive: true });
        destPath = join(artifactsDir, fileName);
      }

      // Copy the file
      copyFileSync(sourcePath, destPath);

      // Store path relative to run directory root (matches synthesisArtifact convention)
      if (!destPath.startsWith(paths.runDir + '/')) {
        throw new Error(
          `Internal error: destination path "${destPath}" is not within run directory "${paths.runDir}"`,
        );
      }
      const relFilePath = destPath.substring(paths.runDir.length + 1);

      // Build the index entry
      const entry = {
        id: randomUUID(),
        stageCategory: stage,
        flavor: localOpts.flavor as string,
        step: artifactType === 'synthesis' ? null : ((localOpts.step as string | undefined) ?? null),
        fileName,
        filePath: relFilePath,
        summary: localOpts.summary as string,
        type: artifactType as 'artifact' | 'synthesis',
        recordedAt: new Date().toISOString(),
      };

      // Append to flavor-level artifact-index.jsonl
      JsonlStore.append(
        paths.flavorArtifactIndexJsonl(stage, localOpts.flavor as string),
        entry,
        ArtifactIndexEntrySchema,
      );

      // Append to run-level artifact-index.jsonl
      JsonlStore.append(paths.artifactIndexJsonl, entry, ArtifactIndexEntrySchema);

      // Update flavor state.json step artifacts if applicable
      if (artifactType === 'artifact' && existsSync(flavorStateFile)) {
        const flavorState = readFlavorState(runsDir, runId, stage, localOpts.flavor as string);
        const stepName = localOpts.step as string; // non-null validated above
        const stepIndex = flavorState.steps.findIndex((s) => s.type === stepName);

        if (stepIndex === -1) {
          const known = flavorState.steps.map((s) => s.type).join(', ') || '(none)';
          throw new Error(
            `Step "${stepName}" not found in flavor "${localOpts.flavor as string}" state. Known steps: ${known}`,
          );
        }
        flavorState.steps[stepIndex]!.artifacts.push(relFilePath);
        writeFlavorState(runsDir, runId, stage, flavorState);
      }

      if (ctx.globalOpts.json) {
        console.log(JSON.stringify(entry, null, 2));
      } else {
        const label = artifactType === 'synthesis' ? 'synthesis' : `artifact`;
        console.log(`Recorded ${label}: ${fileName}`);
        console.log(`  Stage:  ${stage}`);
        console.log(`  Flavor: ${localOpts.flavor as string}`);
        if (artifactType === 'artifact' && localOpts.step) {
          console.log(`  Step:   ${localOpts.step as string}`);
        }
        console.log(`  Dest:   ${destPath}`);
        console.log(`  ID:     ${entry.id}`);
      }
    }));
}
