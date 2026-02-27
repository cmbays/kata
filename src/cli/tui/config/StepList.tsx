import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { StepRegistry } from '@infra/registries/step-registry.js';
import { FlavorRegistry } from '@infra/registries/flavor-registry.js';
import type { Step, StepResources } from '@domain/types/step.js';
import type { Gate, GateCondition } from '@domain/types/gate.js';

export type StepAction =
  | { type: 'step:create' }
  | { type: 'step:edit'; step: Step }
  | { type: 'step:delete'; step: Step };

export interface StepListProps {
  stepsDir: string;
  flavorsDir?: string;
  onDetailEnter: () => void;
  onDetailExit: () => void;
  onAction?: (action: StepAction) => void;
}

export default function StepList({
  stepsDir,
  flavorsDir,
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
    return <StepDetail step={detail} stepsDir={stepsDir} flavorsDir={flavorsDir} />;
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

function StepDetail({
  step,
  stepsDir,
  flavorsDir,
}: {
  step: Step;
  stepsDir: string;
  flavorsDir?: string;
}) {
  const label = step.flavor ? `${step.type}.${step.flavor}` : step.type;

  const promptPreview = useMemo(() => {
    if (!step.promptTemplate) return null;
    try {
      const fullPath = join(stepsDir, step.promptTemplate);
      if (!existsSync(fullPath)) return null;
      const lines = readFileSync(fullPath, 'utf-8').split('\n');
      return {
        path: step.promptTemplate,
        lines: lines.filter((l) => l.trim().length > 0).slice(0, 8),
      };
    } catch {
      return null;
    }
  }, [step.promptTemplate, stepsDir]);

  const usedInFlavors = useMemo(() => {
    if (!flavorsDir) return [];
    try {
      return new FlavorRegistry(flavorsDir)
        .list()
        .filter((f) => f.steps.some((s) => s.stepType === step.type));
    } catch {
      return [];
    }
  }, [flavorsDir, step.type]);

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
      {step.description !== undefined && <Text dimColor>{step.description}</Text>}
      {usedInFlavors.length > 0 ? (
        <Text>
          Used in:{' '}
          <Text color="cyan">
            {usedInFlavors.map((f) => `${f.name} (${f.stageCategory})`).join(', ')}
          </Text>
        </Text>
      ) : (
        flavorsDir !== undefined && <Text dimColor>Not used in any flavor</Text>
      )}

      <Box flexDirection="column" marginTop={1}>
        <GateSection gate={step.entryGate} label="Entry gate" />
        <Box borderStyle="round" flexDirection="column" paddingX={1}>
          <Text bold>{label}</Text>
          {step.artifacts.length > 0 && (
            <Text dimColor>produces: {step.artifacts.map((a) => a.name).join(', ')}</Text>
          )}
        </Box>
        <GateSection gate={step.exitGate} label="Exit gate" />
      </Box>

      {promptPreview !== null && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Prompt: {promptPreview.path}</Text>
          <Box flexDirection="column" borderStyle="single" paddingX={1}>
            {promptPreview.lines.map((l, i) => (
              <Text key={i} dimColor>
                {l}
              </Text>
            ))}
          </Box>
        </Box>
      )}

      {step.resources !== undefined && <ResourceDetail resources={step.resources} />}
      <Box marginTop={1}>
        <Text dimColor>[←/Esc] back  [e] edit  [d] delete</Text>
      </Box>
    </Box>
  );
}

function GateSection({ gate, label }: { label: string; gate?: Gate }) {
  if (!gate || gate.conditions.length === 0) {
    return <Text dimColor>{label}: none</Text>;
  }
  return (
    <Box flexDirection="column">
      <Text color={label.startsWith('Entry') ? 'green' : 'magenta'}>{label}:</Text>
      {gate.conditions.map((c, i) => (
        <Box key={i} marginLeft={2}>
          <Text dimColor>{i + 1}. </Text>
          <Text color={c.type === 'human-approved' ? 'yellowBright' : 'yellow'}>
            {conditionLabel(c.type)}
          </Text>
          {conditionDetail(c) !== '' && <Text dimColor> {conditionDetail(c)}</Text>}
          {c.description !== undefined && <Text dimColor> ({c.description})</Text>}
        </Box>
      ))}
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
