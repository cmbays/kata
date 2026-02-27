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

export interface ConfigAppProps {
  stepsDir: string;
  flavorsDir: string;
  katasDir: string;
  onAction?: (action: ConfigAction) => void;
}

export default function ConfigApp({ stepsDir, flavorsDir, katasDir, onAction }: ConfigAppProps) {
  const { exit } = useApp();
  const [sectionIndex, setSectionIndex] = useState(0);
  const [inDetail, setInDetail] = useState(false);

  const handleAction = (action: ConfigAction) => {
    onAction?.(action);
    exit();
  };

  useInput((input, key) => {
    if (inDetail) return;
    if (input === 'q') {
      exit();
      return;
    }
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

      {sectionIndex === 0 && <StepList stepsDir={stepsDir} flavorsDir={flavorsDir} {...sectionProps} />}
      {sectionIndex === 1 && (
        <FlavorList flavorsDir={flavorsDir} stepsDir={stepsDir} {...sectionProps} />
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
