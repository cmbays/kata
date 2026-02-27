import { useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import StepList from './config/StepList.js';
import FlavorList from './config/FlavorList.js';
import KataList from './config/KataList.js';
import type { StepAction } from './config/StepList.js';
import type { FlavorAction } from './config/FlavorList.js';
import type { KataAction } from './config/KataList.js';
import { getLexicon, cap } from '@cli/lexicon.js';

export type ConfigAction = StepAction | FlavorAction | KataAction;

type SectionIndex = 0 | 1 | 2;

export interface ConfigAppProps {
  stepsDir: string;
  flavorsDir: string;
  katasDir: string;
  onAction?: (action: ConfigAction) => void;
  initialSectionIndex?: number;
  initialFlavorName?: string;
  plain?: boolean;
}

export default function ConfigApp({ stepsDir, flavorsDir, katasDir, onAction, initialSectionIndex, initialFlavorName, plain }: ConfigAppProps) {
  const { exit } = useApp();
  const [sectionIndex, setSectionIndex] = useState(initialSectionIndex ?? 0);
  const [inDetail, setInDetail] = useState(false);
  const lex = getLexicon(plain);

  const SECTIONS = [
    cap(lex.step) + 's',
    cap(lex.flavor) + 's',
    'Katas',
  ] as const;

  const SECTION_DESCRIPTIONS = [
    `Atomic tasks — what an agent does within a ${lex.stage}. Each ${lex.step} has a prompt (instructions), ${lex.gate}s (entry/exit conditions), and output artifacts (files it produces).`,
    `Named ${lex.step} sequences — one approach to executing a ${lex.stage}. ${cap(lex.step)}s run sequentially within a ${lex.flavor}. Multiple ${lex.flavor}s of the same ${lex.stage} run in parallel.`,
    `Saved workflows — an ordered sequence of ${lex.stage}s (e.g., research → plan → build → review). Use as a template when starting a new execution session.`,
  ];

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
        <Text dimColor>{SECTION_DESCRIPTIONS[sectionIndex as SectionIndex] ?? SECTION_DESCRIPTIONS[0]}</Text>
      </Box>

      {sectionIndex === 0 && <StepList stepsDir={stepsDir} flavorsDir={flavorsDir} plain={plain} {...sectionProps} />}
      {sectionIndex === 1 && (
        <FlavorList flavorsDir={flavorsDir} stepsDir={stepsDir} initialFlavorName={initialFlavorName} plain={plain} {...sectionProps} />
      )}
      {sectionIndex === 2 && <KataList katasDir={katasDir} plain={plain} {...sectionProps} />}
    </Box>
  );
}

function TabLabel({ label, isActive }: { label: string; isActive: boolean }) {
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

