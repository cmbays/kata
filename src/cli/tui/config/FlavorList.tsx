import { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { FlavorRegistry } from '@infra/registries/flavor-registry.js';
import { StepRegistry } from '@infra/registries/step-registry.js';
import type { Flavor, FlavorStepRef } from '@domain/types/flavor.js';
import type { FlavorValidationResult } from '@domain/ports/flavor-registry.js';

export type FlavorAction =
  | { type: 'flavor:create' }
  | { type: 'flavor:delete'; flavor: Flavor };

export interface FlavorListProps {
  flavorsDir: string;
  stepsDir: string;
  onDetailEnter: () => void;
  onDetailExit: () => void;
  onAction?: (action: FlavorAction) => void;
}

export default function FlavorList({
  flavorsDir,
  stepsDir,
  onDetailEnter,
  onDetailExit,
  onAction = () => {},
}: FlavorListProps) {
  const { flavors, validate } = useMemo(() => {
    try {
      const flavorReg = new FlavorRegistry(flavorsDir);
      const stepReg = new StepRegistry(stepsDir);
      const stepResolver = (ref: FlavorStepRef) => {
        try {
          return stepReg.get(ref.stepType);
        } catch {
          return undefined;
        }
      };
      return {
        flavors: flavorReg.list(),
        validate: (f: Flavor) => flavorReg.validate(f, stepResolver),
      };
    } catch {
      const noopValidate = (_: Flavor): FlavorValidationResult => ({ valid: true });
      return { flavors: [], validate: noopValidate };
    }
  }, [flavorsDir, stepsDir]);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [detail, setDetail] = useState<Flavor | null>(null);

  const clamped = Math.min(selectedIndex, Math.max(0, flavors.length - 1));

  useInput((input, key) => {
    if (detail !== null) {
      if (key.escape) {
        setDetail(null);
        onDetailExit();
      } else if (input === 'd') {
        onAction({ type: 'flavor:delete', flavor: detail });
      }
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex((i) => Math.min(flavors.length - 1, i + 1));
    } else if (key.return) {
      const f = flavors[clamped];
      if (f) {
        setDetail(f);
        onDetailEnter();
      }
    } else if (input === 'n') {
      onAction({ type: 'flavor:create' });
    } else if (input === 'd' && flavors.length > 0) {
      const f = flavors[clamped];
      if (f) onAction({ type: 'flavor:delete', flavor: f });
    }
  });

  if (detail !== null) {
    return <FlavorDetail flavor={detail} validation={validate(detail)} />;
  }

  return (
    <Box flexDirection="column">
      <Text bold>Flavors ({flavors.length})</Text>
      <Box flexDirection="column" marginTop={1}>
        {flavors.length === 0 ? (
          <Text dimColor>No flavors found.</Text>
        ) : (
          flavors.map((flavor, i) => (
            <FlavorRow
              key={`${flavor.stageCategory}:${flavor.name}`}
              flavor={flavor}
              isSelected={i === clamped}
            />
          ))
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>[↑↓] select  [Enter] detail  [n] new  [d] del  [Tab] switch section</Text>
      </Box>
    </Box>
  );
}

function FlavorRow({ flavor, isSelected }: { flavor: Flavor; isSelected: boolean }) {
  return (
    <Box>
      <Text color="cyan">{isSelected ? '>' : ' '} </Text>
      <Text bold={isSelected}>{flavor.name.padEnd(28)}</Text>
      <Text color="yellow">{`[${flavor.stageCategory}]`.padEnd(12)}</Text>
      <Text dimColor>{flavor.steps.length} step(s)</Text>
    </Box>
  );
}

interface FlavorDetailProps {
  flavor: Flavor;
  validation: FlavorValidationResult;
}

function FlavorDetail({ flavor, validation }: FlavorDetailProps) {
  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        {flavor.name}
      </Text>
      <Text>
        Category: <Text color="yellow">{flavor.stageCategory}</Text>
      </Text>
      {flavor.description !== undefined && <Text>Description: {flavor.description}</Text>}
      <Text>
        Synthesis artifact: <Text bold>{flavor.synthesisArtifact}</Text>
      </Text>
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Steps ({flavor.steps.length}):</Text>
        {flavor.steps.map((ref, i) => (
          <Box key={ref.stepName}>
            <Text dimColor>{String(i + 1).padStart(2)}. </Text>
            <Text>{ref.stepName}</Text>
            <Text dimColor> (type: {ref.stepType})</Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        {validation.valid ? (
          <Text color="green">✓ DAG valid</Text>
        ) : (
          <Box flexDirection="column">
            <Text color="red">✗ DAG errors:</Text>
            {validation.errors.map((e, idx) => (
              <Text key={idx} color="red">
                {'  '}• {e}
              </Text>
            ))}
          </Box>
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>[Esc] back</Text>
      </Box>
    </Box>
  );
}
