import { useState, useCallback } from 'react';
import { Box, Text, useApp } from 'ink';
import { spawn } from 'node:child_process';
import { useRunWatcher } from './use-run-watcher.js';
import GlobalView from './GlobalView.js';
import DetailView from './DetailView.js';
import { getLexicon } from '@cli/lexicon.js';

export interface WatchAppProps {
  runsDir: string;
  cycleId?: string;
  plain?: boolean;
}

type ViewState = { mode: 'global'; selectedIndex: number } | { mode: 'detail'; runId: string };

export default function WatchApp({ runsDir, cycleId, plain }: WatchAppProps) {
  const { runs, refresh } = useRunWatcher(runsDir, cycleId);
  const { exit } = useApp();
  const [view, setView] = useState<ViewState>({ mode: 'global', selectedIndex: 0 });
  const [approving, setApproving] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  const approveGate = useCallback(
    (gateId: string) => {
      setApproving(true);
      setApprovalError(null);
      const child = spawn('kata', ['approve', gateId], { stdio: 'ignore' });
      child.on('error', (err) => {
        setApproving(false);
        setApprovalError(`Could not run kata approve: ${err.message}`);
      });
      child.on('close', (code) => {
        setApproving(false);
        if (code !== 0) {
          setApprovalError(`kata approve failed (exit code ${String(code)})`);
        } else {
          setApprovalError(null);
          refresh();
        }
      });
    },
    [refresh],
  );

  const lex = getLexicon(plain);

  if (approving) {
    return (
      <Box>
        <Text color="yellow">Approving {lex.gate}…</Text>
      </Box>
    );
  }

  if (view.mode === 'detail') {
    const run = runs.find((r) => r.runId === view.runId);
    const backIndex = Math.max(0, runs.findIndex((r) => r.runId === view.runId));
    return (
      <Box flexDirection="column">
        {approvalError && <Text color="red">{approvalError}</Text>}
        <DetailView
          run={run}
          onBack={() => setView({ mode: 'global', selectedIndex: backIndex })}
          onApprove={approveGate}
          onQuit={() => exit()}
          plain={plain}
        />
      </Box>
    );
  }

  const clampedIndex = Math.min(view.selectedIndex, Math.max(0, runs.length - 1));

  return (
    <Box flexDirection="column">
      {approvalError && <Text color="red">{approvalError}</Text>}
      <GlobalView
        runs={runs}
        selectedIndex={clampedIndex}
        onSelectChange={(index) => setView({ mode: 'global', selectedIndex: index })}
        onDrillIn={(run) => setView({ mode: 'detail', runId: run.runId })}
        onApprove={approveGate}
        onQuit={() => exit()}
        plain={plain}
      />
    </Box>
  );
}
