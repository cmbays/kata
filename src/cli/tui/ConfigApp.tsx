import { useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import StepList from './config/StepList.js';
import FlavorList from './config/FlavorList.js';
import KataList from './config/KataList.js';
import type { StepAction } from './config/StepList.js';
import type { FlavorAction } from './config/FlavorList.js';
import type { KataAction } from './config/KataList.js';

export type ConfigAction = StepAction | FlavorAction | KataAction;

const SECTIONS = ['Steps', 'Flavors', 'Katas'] as const;
type SectionName = (typeof SECTIONS)[number];

const SECTION_DESCRIPTIONS: Record<SectionName, string> = {
  Steps: 'Atomic tasks — what an agent does within a stage. Each step has a prompt (instructions), gates (entry/exit conditions), and output artifacts (files it produces).',
  Flavors: 'Named step sequences — one approach to executing a stage. Steps run sequentially within a flavor. Multiple flavors of the same stage run in parallel.',
  Katas: 'Saved workflows — an ordered sequence of stages (e.g., research → plan → build → review). Use as a template when starting a new execution session.',
};

export interface ConfigAppProps {
  stepsDir: string;
  flavorsDir: string;
  katasDir: string;
  onAction?: (action: ConfigAction) => void;
  initialSectionIndex?: number;
  initialFlavorName?: string;
}

export default function ConfigApp({ stepsDir, flavorsDir, katasDir, onAction, initialSectionIndex, initialFlavorName }: ConfigAppProps) {
  const { exit } = useApp();
  const [sectionIndex, setSectionIndex] = useState(initialSectionIndex ?? 0);
  const [inDetail, setInDetail] = useState(false);

  const handleAction = (action: ConfigAction) => {
    onAction?.(action);
    exit();
  };

  useInput((input, key) => {
    if (input === 'q') {
      exit();
      return;
    }
    if (inDetail) return;
    if (key.tab || input === ']') {
      setSectionIndex((i) => (i + 1) % SECTIONS.length);
    } else if (input === '[') {
      setSectionIndex((i) => (i - 1 + SECTIONS.length) % SECTIONS.length);
    }
  });

  const sectionProps = {
    onDetailEnter: () => setInDetail(true),
    onDetailExit: () => setInDetail(false),
    onAction: handleAction,
  };

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="magenta">
          KATA CONFIG
        </Text>
        <Text dimColor>{'  '}Methodology Editor</Text>
      </Box>

      <Box marginBottom={1}>
        {SECTIONS.map((s, i) => (
          <TabLabel key={s} label={s} isActive={i === sectionIndex} />
        ))}
        <Text dimColor>[Tab] switch  [n] new  [e] edit  [d] del  [q] quit</Text>
      </Box>

      <Box marginBottom={1}>
        <Text dimColor>{SECTION_DESCRIPTIONS[SECTIONS[sectionIndex] ?? 'Steps']}</Text>
      </Box>

      {sectionIndex === 0 && <StepList stepsDir={stepsDir} flavorsDir={flavorsDir} {...sectionProps} />}
      {sectionIndex === 1 && (
        <FlavorList flavorsDir={flavorsDir} stepsDir={stepsDir} initialFlavorName={initialFlavorName} {...sectionProps} />
      )}
      {sectionIndex === 2 && <KataList katasDir={katasDir} {...sectionProps} />}
    </Box>
  );
}

function TabLabel({ label, isActive }: { label: SectionName; isActive: boolean }) {
  return (
    <Box marginRight={2}>
      {isActive ? (
        <Text bold color="cyan">
          [{label}]
        </Text>
      ) : (
        <Text dimColor> {label} </Text>
      )}
    </Box>
  );
}
