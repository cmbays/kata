import { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { JsonStore } from '@infra/persistence/json-store.js';
import { SavedKataSchema } from '@domain/types/saved-kata.js';
import type { SavedKata } from '@domain/types/saved-kata.js';

export interface KataListProps {
  katasDir: string;
  onDetailEnter: () => void;
  onDetailExit: () => void;
}

export default function KataList({ katasDir, onDetailEnter, onDetailExit }: KataListProps) {
  const katas = useMemo(() => {
    try {
      return JsonStore.list(katasDir, SavedKataSchema);
    } catch {
      return [];
    }
  }, [katasDir]);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [detail, setDetail] = useState<SavedKata | null>(null);

  const clamped = Math.min(selectedIndex, Math.max(0, katas.length - 1));

  useInput((_input, key) => {
    if (detail !== null) {
      if (key.escape) {
        setDetail(null);
        onDetailExit();
      }
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex((i) => Math.min(katas.length - 1, i + 1));
    } else if (key.return) {
      const k = katas[clamped];
      if (k) {
        setDetail(k);
        onDetailEnter();
      }
    }
  });

  if (detail !== null) {
    return <KataDetail kata={detail} />;
  }

  return (
    <Box flexDirection="column">
      <Text bold>Kata Patterns ({katas.length})</Text>
      <Box flexDirection="column" marginTop={1}>
        {katas.length === 0 ? (
          <Text dimColor>
            No kata patterns found. Run `kata execute --save-kata &lt;name&gt;` to save one.
          </Text>
        ) : (
          katas.map((kata, i) => (
            <KataRow key={kata.name} kata={kata} isSelected={i === clamped} />
          ))
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>[↑↓] select  [Enter] detail  [Tab] switch section</Text>
      </Box>
    </Box>
  );
}

function KataRow({ kata, isSelected }: { kata: SavedKata; isSelected: boolean }) {
  const stagesLabel = kata.stages.join(' → ');
  return (
    <Box>
      <Text color="cyan">{isSelected ? '>' : ' '} </Text>
      <Text bold={isSelected}>{kata.name.padEnd(24)}</Text>
      <Text dimColor>{stagesLabel}</Text>
    </Box>
  );
}

function KataDetail({ kata }: { kata: SavedKata }) {
  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        {kata.name}
      </Text>
      {kata.description !== undefined && <Text>Description: {kata.description}</Text>}
      <Box marginTop={1} flexDirection="column">
        <Text bold>Stage sequence:</Text>
        {kata.stages.map((stage, i) => (
          <Box key={`${stage}-${i}`}>
            <Text dimColor>{String(i + 1).padStart(2)}. </Text>
            <Text color="yellow">{stage}</Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>[Esc] back</Text>
      </Box>
    </Box>
  );
}
