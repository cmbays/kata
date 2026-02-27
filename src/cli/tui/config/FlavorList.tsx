import { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { FlavorRegistry } from '@infra/registries/flavor-registry.js';
import { StepRegistry } from '@infra/registries/step-registry.js';
import type { Flavor, FlavorStepRef } from '@domain/types/flavor.js';
import type { Step } from '@domain/types/step.js';
import type { GateCondition } from '@domain/types/gate.js';
import type { FlavorValidationResult } from '@domain/ports/flavor-registry.js';

export type FlavorAction =
  | { type: 'flavor:create' }
  | { type: 'flavor:edit'; flavor: Flavor }
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
  const { flavors, validate, resolveStep } = useMemo(() => {
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
        resolveStep: stepResolver,
      };
    } catch {
      const noopValidate = (_: Flavor): FlavorValidationResult => ({ valid: true });
      return { flavors: [], validate: noopValidate, resolveStep: () => undefined };
    }
  }, [flavorsDir, stepsDir]);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [detail, setDetail] = useState<Flavor | null>(null);

  const clamped = Math.min(selectedIndex, Math.max(0, flavors.length - 1));

  useInput((input, key) => {
    if (detail !== null) {
      if (key.escape || key.leftArrow) {
        setDetail(null);
        onDetailExit();
      } else if (input === 'e') {
        onAction({ type: 'flavor:edit', flavor: detail });
      } else if (input === 'd') {
        onAction({ type: 'flavor:delete', flavor: detail });
      }
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex((i) => Math.min(flavors.length - 1, i + 1));
    } else if (key.return || key.rightArrow) {
      const f = flavors[clamped];
      if (f) {
        setDetail(f);
        onDetailEnter();
      }
    } else if (input === 'n') {
      onAction({ type: 'flavor:create' });
    } else if (input === 'e' && flavors.length > 0) {
      const f = flavors[clamped];
      if (f) onAction({ type: 'flavor:edit', flavor: f });
    } else if (input === 'd' && flavors.length > 0) {
      const f = flavors[clamped];
      if (f) onAction({ type: 'flavor:delete', flavor: f });
    }
  });

  if (detail !== null) {
    return (
      <FlavorDetail flavor={detail} validation={validate(detail)} resolveStep={resolveStep} />
    );
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
        <Text dimColor>[↑↓] select  [Enter] detail  [n] new  [e] edit  [d] del  [Tab] switch section</Text>
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
  resolveStep: (ref: FlavorStepRef) => Step | undefined;
}

function FlavorDetail({ flavor, validation, resolveStep }: FlavorDetailProps) {
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
        <FlavorPipeline steps={flavor.steps} resolveStep={resolveStep} />
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
        <Text dimColor>[←/Esc] back  [e] edit  [d] delete this flavor</Text>
      </Box>
    </Box>
  );
}

function FlavorPipeline({
  steps,
  resolveStep,
}: {
  steps: FlavorStepRef[];
  resolveStep: (ref: FlavorStepRef) => Step | undefined;
}) {
  return (
    <Box flexDirection="column">
      {steps.map((stepRef, i) => {
        const step = resolveStep(stepRef);
        const nextRef = steps[i + 1];
        const nextStep = nextRef ? resolveStep(nextRef) : undefined;
        const showConnector = i < steps.length - 1;

        // Artifacts that exit this step and enter the next (visual "hand-off")
        const exitArtifacts =
          step?.exitGate?.conditions.filter((c) => c.artifactName).map((c) => c.artifactName!) ??
          [];
        const entryArtifacts =
          nextStep?.entryGate?.conditions
            .filter((c) => c.artifactName)
            .map((c) => c.artifactName!) ?? [];
        const matchedArtifacts = exitArtifacts.filter((a) => entryArtifacts.includes(a));

        return (
          <Box key={stepRef.stepName} flexDirection="column">
            <StepPipelineBlock stepRef={stepRef} step={step} index={i + 1} />
            {showConnector && <PipelineConnector matchedArtifacts={matchedArtifacts} />}
          </Box>
        );
      })}
    </Box>
  );
}

function StepPipelineBlock({
  stepRef,
  step,
  index,
}: {
  stepRef: FlavorStepRef;
  step: Step | undefined;
  index: number;
}) {
  const typeLabel = step
    ? step.flavor
      ? `${step.type}.${step.flavor}`
      : step.type
    : stepRef.stepType;
  const entryConditions = step?.entryGate?.conditions ?? [];
  const exitConditions = step?.exitGate?.conditions ?? [];
  const artifacts = step?.artifacts ?? [];

  return (
    <Box flexDirection="column">
      {entryConditions.length > 0 ? (
        <Box flexDirection="column">
          <Text color="green">  Entry:</Text>
          {entryConditions.map((c, ci) => (
            <Text key={ci} dimColor>
              {'    '}
              {conditionLabel(c.type)}
              {conditionDetail(c) !== '' ? ` ${conditionDetail(c)}` : ''}
            </Text>
          ))}
        </Box>
      ) : (
        <Text dimColor>  Entry: none</Text>
      )}
      <Box borderStyle="round" flexDirection="column" paddingX={1}>
        <Box>
          <Text dimColor>{String(index).padStart(2)}. </Text>
          <Text bold>{stepRef.stepName}</Text>
          <Text dimColor> [{typeLabel}]</Text>
        </Box>
        {step?.description !== undefined && (
          <Text dimColor>{'    '}{step.description.slice(0, 50)}</Text>
        )}
        {artifacts.length > 0 && (
          <Text dimColor>{'    '}→ {artifacts.map((a) => a.name).join(', ')}</Text>
        )}
        {step === undefined && (
          <Text color="red">{'    '}⚠ step type "{stepRef.stepType}" not found</Text>
        )}
      </Box>
      {exitConditions.length > 0 ? (
        <Box flexDirection="column">
          <Text color="magenta">  Exit:</Text>
          {exitConditions.map((c, ci) => (
            <Text key={ci} dimColor>
              {'    '}
              {conditionLabel(c.type)}
              {conditionDetail(c) !== '' ? ` ${conditionDetail(c)}` : ''}
            </Text>
          ))}
        </Box>
      ) : (
        <Text dimColor>  Exit: none</Text>
      )}
    </Box>
  );
}

function PipelineConnector({ matchedArtifacts }: { matchedArtifacts: string[] }) {
  return (
    <Box flexDirection="column" marginLeft={4}>
      <Text dimColor>│</Text>
      {matchedArtifacts.map((a, i) => (
        <Text key={i} color="green">
          ✓ {a}
        </Text>
      ))}
      <Text dimColor>▼</Text>
    </Box>
  );
}

function conditionLabel(type: string): string {
  const labels: Record<string, string> = {
    'artifact-exists': 'File exists',
    'schema-valid': 'Schema valid',
    'human-approved': 'Human approved',
    'predecessor-complete': 'Predecessor done',
    'command-passes': 'Command passes',
  };
  return labels[type] ?? type;
}

function conditionDetail(c: GateCondition): string {
  if (c.artifactName) return `→ ${c.artifactName}`;
  if (c.predecessorType) return `→ ${c.predecessorType}`;
  if (c.command) return `: ${c.command}`;
  return '';
}
