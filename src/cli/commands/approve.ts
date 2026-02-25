import { readdirSync } from 'node:fs';
import type { Command } from 'commander';
import { withCommandContext, kataDirPath } from '@cli/utils.js';
import {
  readRun,
  readStageState,
  writeStageState,
} from '@infra/persistence/run-store.js';
import { ApprovedGateSchema } from '@domain/types/run-state.js';
import type { PendingGate } from '@domain/types/run-state.js';
import type { StageCategory } from '@domain/types/stage.js';

interface PendingGateEntry {
  runId: string;
  stage: StageCategory;
  gate: PendingGate;
}

/**
 * Scan all run directories for pending gates.
 * Optionally scoped to a single runId.
 */
function findPendingGates(runsDir: string, scopeRunId?: string): PendingGateEntry[] {
  let runIds: string[];

  if (scopeRunId) {
    runIds = [scopeRunId];
  } else {
    let entries: string[];
    try {
      entries = readdirSync(runsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch (err) {
      // Runs directory doesn't exist yet — no pending gates
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    runIds = entries;
  }

  const pending: PendingGateEntry[] = [];

  for (const runId of runIds) {
    let run;
    try {
      run = readRun(runsDir, runId);
    } catch {
      // Not a valid run directory
      continue;
    }

    for (const stage of run.stageSequence) {
      let stageState;
      try {
        stageState = readStageState(runsDir, runId, stage);
      } catch {
        continue;
      }

      if (stageState.pendingGate) {
        pending.push({ runId, stage, gate: stageState.pendingGate });
      }
    }
  }

  return pending;
}

export function registerApproveCommand(parent: Command): void {
  parent
    .command('approve [gate-id]')
    .description('Approve a pending gate (human or agent approval)')
    .option('--run <run-id>', 'Scope to a specific run')
    .option('--agent', 'Approve as agent (default: human)')
    .action(withCommandContext(async (ctx, gateId: string | undefined) => {
      const localOpts = ctx.cmd.opts();
      const runsDir = kataDirPath(ctx.kataDir, 'runs');
      const approver: 'human' | 'agent' = localOpts.agent ? 'agent' : 'human';

      const allPending = findPendingGates(runsDir, localOpts.run as string | undefined);

      let toApprove: PendingGateEntry[];

      if (gateId) {
        // Find by specific gate ID
        toApprove = allPending.filter((e) => e.gate.gateId === gateId);
        if (toApprove.length === 0) {
          const scope = localOpts.run ? ` in run "${localOpts.run as string}"` : '';
          throw new Error(`Gate "${gateId}" not found${scope} or is not in pending state.`);
        }
      } else if (allPending.length === 0) {
        if (ctx.globalOpts.json) {
          console.log(JSON.stringify([], null, 2));
        } else {
          console.log('No pending gates.');
        }
        return;
      } else {
        // Interactive selection
        const { checkbox } = await import('@inquirer/prompts');
        const choices = allPending.map((e) => ({
          name: `[${e.runId.slice(0, 8)}] ${e.stage} — ${e.gate.gateType} (${e.gate.gateId})`,
          value: e,
          checked: true,
        }));

        toApprove = await checkbox({
          message: 'Select gates to approve:',
          choices,
        }) as PendingGateEntry[];

        if (toApprove.length === 0) {
          console.log('No gates selected.');
          return;
        }
      }

      const now = new Date().toISOString();
      const approved: Array<{
        gateId: string;
        gateType: string;
        approvedAt: string;
        approver: 'human' | 'agent';
        runId: string;
        stage: StageCategory;
      }> = [];

      for (const entry of toApprove) {
        const stageState = readStageState(runsDir, entry.runId, entry.stage);

        if (!stageState.pendingGate || stageState.pendingGate.gateId !== entry.gate.gateId) {
          // Gate was already cleared (race condition or stale data)
          continue;
        }

        const approvedGate = ApprovedGateSchema.parse({
          gateId: entry.gate.gateId,
          gateType: entry.gate.gateType,
          requiredBy: entry.gate.requiredBy,
          approvedAt: now,
          approver,
        });

        stageState.approvedGates.push(approvedGate);
        stageState.pendingGate = undefined;

        writeStageState(runsDir, entry.runId, stageState);

        approved.push({
          gateId: entry.gate.gateId,
          gateType: entry.gate.gateType,
          approvedAt: now,
          approver,
          runId: entry.runId,
          stage: entry.stage,
        });
      }

      if (ctx.globalOpts.json) {
        console.log(JSON.stringify(approved, null, 2));
      } else {
        if (approved.length === 0) {
          console.log('No gates were approved (already cleared).');
        } else {
          for (const g of approved) {
            console.log(`✓ Approved gate "${g.gateId}" (${g.gateType}) in run ${g.runId.slice(0, 8)} stage "${g.stage}" as ${g.approver}`);
          }
        }
      }
    }));
}

