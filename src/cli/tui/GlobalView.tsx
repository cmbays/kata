import { Box, Text, useInput } from 'ink';
import { getAvatar } from './avatars.js';
import type { WatchRun } from './run-reader.js';
import { getLexicon } from '@cli/lexicon.js';

export interface GlobalViewProps {
  runs: WatchRun[];
  selectedIndex: number;
  onSelectChange: (index: number) => void;
  onDrillIn: (run: WatchRun) => void;
  onApprove: (gateId: string) => void;
  onQuit: () => void;
  plain?: boolean;
}

function progressBar(progress: number, width = 8): string {
  const filled = Math.floor(Math.min(1, Math.max(0, progress)) * width);
  return '▓'.repeat(filled) + '░'.repeat(width - filled);
}

export default function GlobalView({
  runs,
  selectedIndex,
  onSelectChange,
  onDrillIn,
  onApprove,
  onQuit,
  plain,
}: GlobalViewProps) {
  const lex = getLexicon(plain);

  useInput((input, key) => {
    if (input === 'q') {
      onQuit();
      return;
    }
    const selected = runs[selectedIndex];
    if (key.return && selected) {
      onDrillIn(selected);
      return;
    }
    if (input === 'a' && selected?.pendingGateId) {
      onApprove(selected.pendingGateId);
      return;
    }
    if (key.upArrow) {
      onSelectChange(Math.max(0, selectedIndex - 1));
      return;
    }
    if (key.downArrow && runs.length > 0) {
      onSelectChange(Math.min(runs.length - 1, selectedIndex + 1));
      return;
    }
  });

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color="cyan">
          KATA WATCH
        </Text>
        <Text>{'  '}</Text>
        <Text>
          {runs.length} active run{runs.length !== 1 ? 's' : ''}
        </Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {runs.length === 0 ? (
          <Text dimColor>No active runs.</Text>
        ) : (
          runs.map((run, i) => (
            <RunRow key={run.runId} run={run} isSelected={i === selectedIndex} plain={plain} />
          ))
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>[↑↓] select  [Enter] drill in  [a] approve {lex.gate}  [q] quit</Text>
      </Box>
    </Box>
  );
}

interface RunRowProps {
  run: WatchRun;
  isSelected: boolean;
  plain?: boolean;
}

function RunRow({ run, isSelected, plain }: RunRowProps) {
  const bar = progressBar(run.stageProgress);
  const stage = (run.currentStage ?? '').toUpperCase();
  const avatar = getAvatar(run.avatarState.stage);
  const lex = getLexicon(plain);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color="cyan">{isSelected ? '>' : ' '} </Text>
        <Text>{avatar} </Text>
        <Text color={run.avatarColor}>{run.betTitle.slice(0, 32).padEnd(32)}</Text>
        <Text>{'  '}{bar}{'  '}</Text>
        <Text bold>{stage}</Text>
      </Box>
      {run.pendingGateId && (
        <Box marginLeft={4}>
          <Text color="yellow">⚠ {lex.gate} pending: {run.pendingGateId}</Text>
        </Box>
      )}
    </Box>
  );
}
