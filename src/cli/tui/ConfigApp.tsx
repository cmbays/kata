import { useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import StepList from './config/StepList.js';
import FlavorList from './config/FlavorList.js';
import KataList from './config/KataList.js';

const SECTIONS = ['Steps', 'Flavors', 'Katas'] as const;
type SectionName = (typeof SECTIONS)[number];

export interface ConfigAppProps {
  stepsDir: string;
  flavorsDir: string;
  katasDir: string;
}

export default function ConfigApp({ stepsDir, flavorsDir, katasDir }: ConfigAppProps) {
  const { exit } = useApp();
  const [sectionIndex, setSectionIndex] = useState(0);
  const [inDetail, setInDetail] = useState(false);

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
        <Text dimColor>[Tab] switch  [q] quit</Text>
      </Box>

      {sectionIndex === 0 && <StepList stepsDir={stepsDir} {...sectionProps} />}
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
