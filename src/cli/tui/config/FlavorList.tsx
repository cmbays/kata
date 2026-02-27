import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useMemo, useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { FlavorRegistry } from '@infra/registries/flavor-registry.js';
import { StepRegistry } from '@infra/registries/step-registry.js';
import type { Flavor, FlavorStepRef } from '@domain/types/flavor.js';
import type { Step, StepResources } from '@domain/types/step.js';
import type { Gate, GateCondition } from '@domain/types/gate.js';
import type { FlavorValidationResult } from '@domain/ports/flavor-registry.js';
import { getLexicon, cap, pl } from '@cli/lexicon.js';

export type FlavorAction =
  | { type: 'flavor:create' }
  | { type: 'flavor:edit'; flavor: Flavor }
  | { type: 'flavor:delete'; flavor: Flavor }
  | { type: 'step:edit'; step: Step; fromFlavorName?: string };

export interface FlavorListProps {
  flavorsDir: string;
  stepsDir: string;
  onDetailEnter: () => void;
  onDetailExit: () => void;
  onAction?: (action: FlavorAction) => void;
  /** When provided, restores the view directly into this flavor's detail on mount. */
  initialFlavorName?: string;
  plain?: boolean;
}

export default function FlavorList({
  flavorsDir,
  stepsDir,
  onDetailEnter,
  onDetailExit,
  onAction = () => {},
  initialFlavorName,
  plain,
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
  // Restore into flavor detail on mount when initialFlavorName is provided (e.g., returning from step:edit)
  const [detail, setDetail] = useState<Flavor | null>(() => {
    if (!initialFlavorName) return null;
    return flavors.find((f) => f.name === initialFlavorName) ?? null;
  });
  const [detailStepIndex, setDetailStepIndex] = useState(0);
  const [drillStep, setDrillStep] = useState<Step | null>(null);

  // Fire onDetailEnter once after mount if we restored into a detail view.
  // Empty deps is intentional: this only needs to run once on mount.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!restoredRef.current && initialFlavorName && detail !== null) {
      restoredRef.current = true;
      onDetailEnter();
    }
  }, []);

  const clamped = Math.min(selectedIndex, Math.max(0, flavors.length - 1));
  const clampedStepIndex = detail
    ? Math.min(detailStepIndex, Math.max(0, detail.steps.length - 1))
    : 0;

  useInput((input, key) => {
    // Drill-down: viewing a single step in full detail
    if (detail !== null && drillStep !== null) {
      if (key.escape || key.leftArrow) {
        setDrillStep(null);
      } else if (input === 'e') {
        onAction({ type: 'step:edit', step: drillStep, fromFlavorName: detail.name });
      }
      return;
    }

    // Flavor detail: pipeline navigation
    if (detail !== null) {
      if (key.upArrow) {
        setDetailStepIndex((i) => Math.max(0, i - 1));
      } else if (key.downArrow) {
        setDetailStepIndex((i) => Math.min(detail.steps.length - 1, i + 1));
      } else if (key.return || key.rightArrow) {
        const stepRef = detail.steps[clampedStepIndex];
        if (stepRef) {
          const step = resolveStep(stepRef);
          if (step) setDrillStep(step);
        }
      } else if (key.escape || key.leftArrow) {
        setDetail(null);
        setDetailStepIndex(0);
        setDrillStep(null);
        onDetailExit();
      } else if (input === 'e') {
        onAction({ type: 'flavor:edit', flavor: detail });
      } else if (input === 'd') {
        onAction({ type: 'flavor:delete', flavor: detail });
      }
      return;
    }

    // List mode
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex((i) => Math.min(flavors.length - 1, i + 1));
    } else if (key.return || key.rightArrow) {
      const f = flavors[clamped];
      if (f) {
        setDetail(f);
        setDetailStepIndex(0);
        setDrillStep(null);
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

  const lex = getLexicon(plain);

  if (detail !== null && drillStep !== null) {
    return <StepDrillView step={drillStep} stepsDir={stepsDir} flavors={flavors} plain={plain} />;
  }

  if (detail !== null) {
    return (
      <FlavorDetail
        flavor={detail}
        validation={validate(detail)}
        resolveStep={resolveStep}
        selectedStepIndex={clampedStepIndex}
        plain={plain}
      />
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>{pl(cap(lex.flavor), plain)} ({flavors.length})</Text>
      <Box flexDirection="column" marginTop={1}>
        {flavors.length === 0 ? (
          <Text dimColor>No {pl(lex.flavor, plain)} found.</Text>
        ) : (
          flavors.map((flavor, i) => (
            <FlavorRow
              key={`${flavor.stageCategory}:${flavor.name}`}
              flavor={flavor}
              isSelected={i === clamped}
              plain={plain}
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

function FlavorRow({ flavor, isSelected, plain }: { flavor: Flavor; isSelected: boolean; plain?: boolean }) {
  const lex = getLexicon(plain);
  return (
    <Box>
      <Text color="cyan">{isSelected ? '>' : ' '} </Text>
      <Text bold={isSelected}>{flavor.name.padEnd(28)}</Text>
      <Text color="yellow">{`[${flavor.stageCategory}]`.padEnd(12)}</Text>
      <Text dimColor>{flavor.steps.length} {pl(lex.step, plain, flavor.steps.length)}</Text>
    </Box>
  );
}

interface FlavorDetailProps {
  flavor: Flavor;
  validation: FlavorValidationResult;
  resolveStep: (ref: FlavorStepRef) => Step | undefined;
  selectedStepIndex: number;
  plain?: boolean;
}

function FlavorDetail({ flavor, validation, resolveStep, selectedStepIndex, plain }: FlavorDetailProps) {
  const lex = getLexicon(plain);
  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        {flavor.name}
      </Text>
      <Text>
        {cap(lex.stage)}: <Text color="yellow">{flavor.stageCategory}</Text>
      </Text>
      {flavor.description !== undefined && <Text>Description: {flavor.description}</Text>}
      <Text>
        Synthesis artifact: <Text bold>{flavor.synthesisArtifact}</Text>
      </Text>
      <Box flexDirection="column" marginTop={1}>
        <Text bold>{pl(cap(lex.step), plain)} ({flavor.steps.length}):</Text>
        <FlavorPipeline
          steps={flavor.steps}
          resolveStep={resolveStep}
          selectedStepIndex={selectedStepIndex}
          plain={plain}
        />
      </Box>
      <Box marginTop={1} flexDirection="column">
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
        {validation.warnings && validation.warnings.length > 0 && (
          <Box flexDirection="column">
            <Text color="yellow">⚠ Cross-stage dependencies:</Text>
            {validation.warnings.map((w, idx) => (
              <Text key={idx} color="yellow">
                {'  '}• {w}
              </Text>
            ))}
          </Box>
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          [↑↓] navigate steps  [Enter] view step  [←/Esc] back  [e] edit flavor  [d] delete
        </Text>
      </Box>
    </Box>
  );
}

function FlavorPipeline({
  steps,
  resolveStep,
  selectedStepIndex,
  plain,
}: {
  steps: FlavorStepRef[];
  resolveStep: (ref: FlavorStepRef) => Step | undefined;
  selectedStepIndex: number;
  plain?: boolean;
}) {
  return (
    <Box flexDirection="column">
      {steps.map((stepRef, i) => {
        const step = resolveStep(stepRef);
        const nextRef = steps[i + 1];
        const nextStep = nextRef ? resolveStep(nextRef) : undefined;
        const showConnector = i < steps.length - 1;

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
            <StepPipelineBlock
              stepRef={stepRef}
              step={step}
              index={i + 1}
              isSelected={i === selectedStepIndex}
              plain={plain}
            />
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
  isSelected,
  plain,
}: {
  stepRef: FlavorStepRef;
  step: Step | undefined;
  index: number;
  isSelected: boolean;
  plain?: boolean;
}) {
  const lex = getLexicon(plain);
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
          <Text color="green">  {cap(lex.entryGate)}:</Text>
          {entryConditions.map((c, ci) => (
            <Box key={ci}>
              <Text dimColor>{'    '}</Text>
              <Text color={c.type === 'human-approved' ? 'yellowBright' : 'yellow'}>
                {conditionLabel(c.type)}
              </Text>
              {conditionDetail(c) !== '' && <Text dimColor> {conditionDetail(c)}</Text>}
            </Box>
          ))}
        </Box>
      ) : (
        <Text dimColor>  {cap(lex.entryGate)}: none</Text>
      )}
      <Box
        borderStyle="round"
        borderColor={isSelected ? 'cyan' : undefined}
        flexDirection="column"
        paddingX={1}
      >
        <Box>
          <Text color={isSelected ? 'cyan' : 'white'}>{isSelected ? '› ' : '  '}</Text>
          <Text dimColor>{String(index).padStart(2)}. </Text>
          <Text bold>{stepRef.stepName}</Text>
          <Text dimColor> [{typeLabel}]</Text>
        </Box>
        {step?.description !== undefined && (
          <Text dimColor>{'    '}{step.description}</Text>
        )}
        {artifacts.length > 0 && (
          <Text dimColor>{'    '}→ {artifacts.map((a) => a.name).join(', ')}</Text>
        )}
        {step === undefined && (
          <Text color="red">{'    '}⚠ {lex.step} type "{stepRef.stepType}" not found</Text>
        )}
      </Box>
      {exitConditions.length > 0 ? (
        <Box flexDirection="column">
          <Text color="magenta">  {cap(lex.exitGate)}:</Text>
          {exitConditions.map((c, ci) => (
            <Box key={ci}>
              <Text dimColor>{'    '}</Text>
              <Text color={c.type === 'human-approved' ? 'yellowBright' : 'yellow'}>
                {conditionLabel(c.type)}
              </Text>
              {conditionDetail(c) !== '' && <Text dimColor> {conditionDetail(c)}</Text>}
            </Box>
          ))}
        </Box>
      ) : (
        <Text dimColor>  {cap(lex.exitGate)}: none</Text>
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

// ── Step drill-down view ─────────────────────────────────────────────────────

function StepDrillView({
  step,
  stepsDir,
  flavors,
  plain,
}: {
  step: Step;
  stepsDir: string;
  flavors: Flavor[];
  plain?: boolean;
}) {
  const lex = getLexicon(plain);
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

  const usedInFlavors = useMemo(
    () => flavors.filter((f) => f.steps.some((s) => s.stepType === step.type)),
    [flavors, step.type],
  );

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        {label}
      </Text>
      {step.stageCategory !== undefined && (
        <Text>
          {cap(lex.stage)}: <Text color="yellow">{step.stageCategory}</Text>
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
        <Text dimColor>Not used in any {lex.flavor} in this {lex.stage}</Text>
      )}

      <Box flexDirection="column" marginTop={1}>
        <GateSection gate={step.entryGate} isEntry={true} plain={plain} />
        <Box borderStyle="round" flexDirection="column" paddingX={1}>
          <Text bold>{label}</Text>
          {step.artifacts.length > 0 && (
            <Text dimColor>produces: {step.artifacts.map((a) => a.name).join(', ')}</Text>
          )}
        </Box>
        <GateSection gate={step.exitGate} isEntry={false} plain={plain} />
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
        <Text dimColor>[←/Esc] back to {lex.flavor}  [e] edit this {lex.step}</Text>
      </Box>
    </Box>
  );
}

// ── Shared sub-components ────────────────────────────────────────────────────

function GateSection({ gate, isEntry, plain }: { isEntry: boolean; gate?: Gate; plain?: boolean }) {
  const lex = getLexicon(plain);
  const label = isEntry ? cap(lex.entryGate) : cap(lex.exitGate);
  if (!gate || gate.conditions.length === 0) {
    return <Text dimColor>{label}: none</Text>;
  }
  return (
    <Box flexDirection="column">
      <Text color={isEntry ? 'green' : 'magenta'}>{label}:</Text>
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
  if (c.artifactName) {
    const stagePart = c.sourceStage ? ` (from ${c.sourceStage})` : '';
    return `→ ${c.artifactName}${stagePart}`;
  }
  if (c.predecessorType) return `→ ${c.predecessorType}`;
  if (c.command) return `: ${c.command}`;
  return '';
}
