import { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { StepRegistry } from '@infra/registries/step-registry.js';
import type { Step, StepResources } from '@domain/types/step.js';
import type { Gate } from '@domain/types/gate.js';

export type StepAction =
  | { type: 'step:create' }
  | { type: 'step:edit'; step: Step }
  | { type: 'step:delete'; step: Step };

export interface StepListProps {
  stepsDir: string;
  onDetailEnter: () => void;
  onDetailExit: () => void;
  onAction?: (action: StepAction) => void;
}

export default function StepList({
  stepsDir,
  onDetailEnter,
  onDetailExit,
  onAction = () => {},
}: StepListProps) {
  const steps = useMemo(() => {
    try {
      return new StepRegistry(stepsDir).list();
    } catch {
      return [];
    }
  }, [stepsDir]);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [detail, setDetail] = useState<Step | null>(null);

  const clamped = Math.min(selectedIndex, Math.max(0, steps.length - 1));

  useInput((input, key) => {
    if (detail !== null) {
      if (key.escape || key.leftArrow) {
        setDetail(null);
        onDetailExit();
      } else if (input === 'e') {
        onAction({ type: 'step:edit', step: detail });
      } else if (input === 'd') {
        onAction({ type: 'step:delete', step: detail });
      }
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex((i) => Math.min(steps.length - 1, i + 1));
    } else if (key.return || key.rightArrow) {
      const s = steps[clamped];
      if (s) {
        setDetail(s);
        onDetailEnter();
      }
    } else if (input === 'n') {
      onAction({ type: 'step:create' });
    } else if (input === 'e' && steps.length > 0) {
      const s = steps[clamped];
      if (s) onAction({ type: 'step:edit', step: s });
    } else if (input === 'd' && steps.length > 0) {
      const s = steps[clamped];
      if (s) onAction({ type: 'step:delete', step: s });
    }
  });

  if (detail !== null) {
    return <StepDetail step={detail} />;
  }

  return (
    <Box flexDirection="column">
      <Text bold>Steps ({steps.length})</Text>
      <Box flexDirection="column" marginTop={1}>
        {steps.length === 0 ? (
          <Text dimColor>No steps found.</Text>
        ) : (
          steps.map((step, i) => (
            <StepRow
              key={`${step.type}:${step.flavor ?? ''}`}
              step={step}
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

function StepRow({ step, isSelected }: { step: Step; isSelected: boolean }) {
  const label = step.flavor ? `${step.type}.${step.flavor}` : step.type;
  const cat = step.stageCategory ? `[${step.stageCategory}]` : '';
  return (
    <Box>
      <Text color="cyan">{isSelected ? '>' : ' '} </Text>
      <Text bold={isSelected}>{label.padEnd(30)}</Text>
      <Text color="yellow">{cat.padEnd(12)}</Text>
      <Text dimColor>{(step.description ?? '').slice(0, 40)}</Text>
    </Box>
  );
}

function StepDetail({ step }: { step: Step }) {
  const label = step.flavor ? `${step.type}.${step.flavor}` : step.type;
  const artifactNames = step.artifacts.map((a) => a.name).join(', ');

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        {label}
      </Text>
      {step.stageCategory !== undefined && (
        <Text>
          Category: <Text color="yellow">{step.stageCategory}</Text>
        </Text>
      )}
      {step.description !== undefined && <Text>Description: {step.description}</Text>}
      <Text>Artifacts: {artifactNames.length > 0 ? artifactNames : '(none)'}</Text>
      {step.promptTemplate !== undefined && (
        <Text dimColor>Prompt: {step.promptTemplate}</Text>
      )}
      <GateDetail label="Entry gate" gate={step.entryGate} />
      <GateDetail label="Exit gate" gate={step.exitGate} />
      {step.resources !== undefined && <ResourceDetail resources={step.resources} />}
      <Box marginTop={1}>
        <Text dimColor>[←/Esc] back  [e] edit this step  [d] delete this step</Text>
      </Box>
    </Box>
  );
}

function GateDetail({ label, gate }: { label: string; gate?: Gate }) {
  if (!gate || gate.conditions.length === 0) {
    return (
      <Text>
        {label}: <Text dimColor>none</Text>
      </Text>
    );
  }
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>
        {label}
        <Text dimColor> ({gate.required ? 'required' : 'optional'}):</Text>
      </Text>
      {gate.conditions.map((c, i) => {
        const detail = c.artifactName
          ? ` → ${c.artifactName}`
          : c.predecessorType
            ? ` → ${c.predecessorType}`
            : c.command
              ? `: ${c.command}`
              : '';
        const desc = c.description ? `  (${c.description})` : '';
        return (
          <Box key={i}>
            <Text dimColor>  {i + 1}. </Text>
            <Text color="yellow">{c.type}</Text>
            <Text dimColor>
              {detail}
              {desc}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

function ResourceDetail({ resources }: { resources: StepResources }) {
  const { tools, agents, skills } = resources;
  if (tools.length === 0 && agents.length === 0 && skills.length === 0) return null;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Resources:</Text>
      {tools.length > 0 && (
        <Box flexDirection="column">
          <Text dimColor>  Tools:</Text>
          {tools.map((t, i) => (
            <Box key={i}>
              <Text dimColor>    {i + 1}. </Text>
              <Text color="cyan">{t.name}</Text>
              <Text dimColor>
                {' '}— {t.purpose}
                {t.command ? ` (${t.command})` : ''}
              </Text>
            </Box>
          ))}
        </Box>
      )}
      {agents.length > 0 && (
        <Box flexDirection="column">
          <Text dimColor>  Agents:</Text>
          {agents.map((a, i) => (
            <Box key={i}>
              <Text dimColor>    {i + 1}. </Text>
              <Text color="cyan">{a.name}</Text>
              {a.when !== undefined && <Text dimColor> — when {a.when}</Text>}
            </Box>
          ))}
        </Box>
      )}
      {skills.length > 0 && (
        <Box flexDirection="column">
          <Text dimColor>  Skills:</Text>
          {skills.map((s, i) => (
            <Box key={i}>
              <Text dimColor>    {i + 1}. </Text>
              <Text color="cyan">{s.name}</Text>
              {s.when !== undefined && <Text dimColor> — when {s.when}</Text>}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
