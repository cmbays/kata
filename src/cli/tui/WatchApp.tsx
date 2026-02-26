import { useState, useCallback } from 'react';
import { Box, Text, useApp } from 'ink';
import { spawnSync } from 'node:child_process';
import { useRunWatcher } from './use-run-watcher.js';
import GlobalView from './GlobalView.js';
import DetailView from './DetailView.js';

export interface WatchAppProps {
  runsDir: string;
  cycleId?: string;
}

type ViewState = { mode: 'global'; selectedIndex: number } | { mode: 'detail'; runId: string };

export default function WatchApp({ runsDir, cycleId }: WatchAppProps) {
  const { runs, refresh } = useRunWatcher(runsDir, cycleId);
  const { exit } = useApp();
  const [view, setView] = useState<ViewState>({ mode: 'global', selectedIndex: 0 });
  const [approving, setApproving] = useState(false);

  const approveGate = useCallback(
    (gateId: string) => {
      setApproving(true);
      spawnSync('kata', ['approve', gateId], { stdio: 'ignore', timeout: 10_000 });
      setApproving(false);
      refresh();
    },
    [refresh],
  );

  if (approving) {
    return (
      <Box>
        <Text color="yellow">Approving gate…</Text>
      </Box>
    );
  }

  if (view.mode === 'detail') {
    const run = runs.find((r) => r.runId === view.runId);
    return (
      <DetailView
        run={run}
        onBack={() => setView({ mode: 'global', selectedIndex: 0 })}
        onApprove={approveGate}
        onQuit={() => exit()}
      />
    );
  }

  return (
    <GlobalView
      runs={runs}
      selectedIndex={view.selectedIndex}
      onSelectChange={(index) => setView({ mode: 'global', selectedIndex: index })}
      onDrillIn={(run) => setView({ mode: 'detail', runId: run.runId })}
      onApprove={approveGate}
      onQuit={() => exit()}
    />
  );
}
