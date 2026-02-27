import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { withCommandContext, kataDirPath } from '@cli/utils.js';
import {
  readRun,
  readStageState,
  writeStageState,
  runPaths,
} from '@infra/persistence/run-store.js';
import { StageCategorySchema } from '@domain/types/stage.js';
import { PendingGateSchema } from '@domain/types/run-state.js';
import { getLexicon } from '@cli/lexicon.js';

export function registerGateCommands(parent: Command): void {
  const gate = parent
    .command('gate')
    .alias('mon')
    .description('Manage run gates');

  // ---- set <run-id> ----
  gate
    .command('set <run-id>')
    .description('Set a pending gate on a running stage, blocking execution until approved')
    .requiredOption('--stage <category>', 'Stage category (research, plan, build, review)')
    .requiredOption('--gate-id <id>', 'Gate identifier used with "kata approve <gate-id>"')
    .option('--type <gate-type>', 'Gate type descriptor', 'human-approved')
    .action(withCommandContext(async (ctx, runId: string) => {
      const localOpts = ctx.cmd.opts();
      const runsDir = kataDirPath(ctx.kataDir, 'runs');

      const stageResult = StageCategorySchema.safeParse(localOpts.stage);
      if (!stageResult.success) {
        throw new Error(`Invalid stage category: "${localOpts.stage}". Valid: ${StageCategorySchema.options.join(', ')}`);
      }
      const stage = stageResult.data;
      const gateId = localOpts.gateId as string;
      const gateType = localOpts.type as string;

      // Verify run exists and stage is part of its sequence
      const run = readRun(runsDir, runId);
      if (!run.stageSequence.includes(stage)) {
        throw new Error(
          `Stage "${stage}" is not in the sequence for run "${runId}". Sequence: ${run.stageSequence.join(', ')}.`
        );
      }

      // Check that the stage directory was initialized before reading
      // (avoids masking real I/O errors with a misleading "not initialized" message)
      const statePath = runPaths(runsDir, runId).stateJson(stage);
      if (!existsSync(statePath)) {
        throw new Error(`Stage "${stage}" is not initialized for run "${runId}".`);
      }
      const stageState = readStageState(runsDir, runId, stage);

      // Stage must be running
      if (stageState.status !== 'running') {
        throw new Error(
          `Stage "${stage}" is not running (current status: "${stageState.status}"). Only running stages can have gates set.`
        );
      }

      // Pending gate already set
      if (stageState.pendingGate) {
        throw new Error(
          `Stage "${stage}" already has a pending gate "${stageState.pendingGate.gateId}". Run "kata approve ${stageState.pendingGate.gateId}" first.`
        );
      }

      // Warn if gate was already approved (allow but warn)
      const alreadyApproved = stageState.approvedGates.some((g) => g.gateId === gateId);
      if (alreadyApproved && !ctx.globalOpts.json) {
        console.warn(`Warning: gate "${gateId}" was already approved for this stage. Setting it again.`);
      }

      const pendingGate = PendingGateSchema.parse({
        gateId,
        gateType,
        requiredBy: 'stage',
      });

      stageState.pendingGate = pendingGate;
      writeStageState(runsDir, runId, stageState);

      const result = { gateId, gateType, stage, runId };
      if (ctx.globalOpts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        const lex = getLexicon(ctx.globalOpts.plain);
        console.log(`${lex.gate} "${gateId}" (${gateType}) set on ${lex.stage} "${stage}" in run ${runId.slice(0, 8)}.`);
        console.log(`Run "kata approve ${gateId}" to unblock.`);
      }
    }));
}
