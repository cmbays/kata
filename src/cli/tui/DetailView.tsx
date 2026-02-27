import { Box, Text, useInput } from 'ink';
import type { WatchRun, WatchStageDetail } from './run-reader.js';
import { getLexicon, cap, pl } from '@cli/lexicon.js';

export interface DetailViewProps {
  run: WatchRun | undefined;
  onBack: () => void;
  onApprove: (gateId: string) => void;
  onQuit: () => void;
  plain?: boolean;
}

function stageStatusIcon(status: WatchStageDetail['status']): string {
  switch (status) {
    case 'completed':
      return '✓';
    case 'running':
      return '●';
    case 'failed':
      return '✗';
    default:
      return '○';
  }
}

function stageStatusColor(status: WatchStageDetail['status']): string {
  switch (status) {
    case 'completed':
      return 'green';
    case 'running':
      return 'cyan';
    case 'failed':
      return 'red';
    default:
      return 'gray';
  }
}

export default function DetailView({ run, onBack, onApprove, onQuit, plain }: DetailViewProps) {
  const lex = getLexicon(plain);

  useInput((input, key) => {
    if (input === 'q') {
      onQuit();
      return;
    }
    if (key.leftArrow) {
      onBack();
      return;
    }
    if (input === 'a' && run?.pendingGateId) {
      onApprove(run.pendingGateId);
      return;
    }
  });

  if (!run) {
    return (
      <Box>
        <Text color="yellow">Run not found.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>{run.betTitle}</Text>
        <Text dimColor>{'  '}({run.runId.slice(0, 8)})</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        {run.stageDetails.map((detail) => (
          <StageRow key={detail.category} detail={detail} plain={plain} />
        ))}
      </Box>

      {run.pendingGateId && (
        <Box marginTop={1}>
          <Text color="yellow">{cap(lex.gate)} pending: {run.pendingGateId}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>[a] approve {lex.gate}{'  '}[←] back{'  '}[q] quit</Text>
      </Box>
    </Box>
  );
}

interface StageRowProps {
  detail: WatchStageDetail;
  plain?: boolean;
}

function StageRow({ detail, plain }: StageRowProps) {
  const lex = getLexicon(plain);
  const icon = stageStatusIcon(detail.status);
  const color = stageStatusColor(detail.status);
  const confStr =
    detail.avgConfidence !== undefined ? ` (${detail.avgConfidence.toFixed(2)})` : '';

  return (
    <Box marginBottom={1}>
      <Text color={color}>{icon} </Text>
      <Text bold>{detail.category.toUpperCase().padEnd(10)}</Text>
      <Text dimColor>
        {detail.flavorCount} {pl(lex.flavor, plain, detail.flavorCount)}
        {'  '}
        {detail.artifactCount} artifact{detail.artifactCount !== 1 ? 's' : ''}
        {'  '}
        {detail.decisionCount} {pl(lex.decision, plain, detail.decisionCount)}
        {confStr}
      </Text>
      {detail.pendingGateId && <Text color="yellow">{'  '}⚠ {detail.pendingGateId}</Text>}
    </Box>
  );
}

