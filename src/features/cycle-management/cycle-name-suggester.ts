import { execFileSync } from 'node:child_process';
import type { Cycle } from '@domain/types/cycle.js';

export interface CycleNameSuggestion {
  name: string;
  source: 'llm' | 'heuristic';
}

export interface CycleNameSuggesterDeps {
  invokeClaude?: (prompt: string) => string;
}

export class CycleNameSuggester {
  private readonly invokeClaude: (prompt: string) => string;

  constructor(deps: CycleNameSuggesterDeps = {}) {
    this.invokeClaude = deps.invokeClaude ?? defaultInvokeClaude;
  }

  suggest(cycle: Pick<Cycle, 'id' | 'bets' | 'createdAt'>): CycleNameSuggestion {
    const prompt = buildCycleNameSuggestionPrompt(cycle);

    try {
      const raw = this.invokeClaude(prompt);
      const name = parseSuggestedCycleName(raw);
      if (name) {
        return { name, source: 'llm' };
      }
    } catch {
      // Fall through to deterministic heuristic naming when Claude is unavailable.
    }

    return { name: buildHeuristicCycleName(cycle), source: 'heuristic' };
  }
}

export function buildCycleNameSuggestionPrompt(cycle: Pick<Cycle, 'id' | 'bets' | 'createdAt'>): string {
  const lines: string[] = [
    'You are naming a software development cycle.',
    'Return exactly one concise cycle name.',
    'Constraints:',
    '- 3 to 7 words when possible',
    '- Title Case',
    '- No quotes',
    '- No numbering or bullets',
    '- Reflect the actual bets in the cycle',
    '',
    `Cycle ID: ${cycle.id}`,
    `Created At: ${cycle.createdAt}`,
    '',
    'Bets:',
  ];

  if (cycle.bets.length === 0) {
    lines.push('- No bets have been added yet.');
  } else {
    for (const bet of cycle.bets) {
      lines.push(`- ${bet.description}`);
    }
  }

  lines.push('');
  lines.push('Return only the cycle name.');

  return lines.join('\n');
}

export function parseSuggestedCycleName(raw: string): string | undefined {
  for (const line of raw.split('\n')) {
    const cleaned = cleanSuggestedCycleNameLine(line);
    if (isLikelySuggestedCycleName(cleaned)) {
      return cleaned;
    }
  }

  return undefined;
}

export function buildHeuristicCycleName(cycle: Pick<Cycle, 'bets' | 'createdAt'>): string {
  const segments = cycle.bets
    .map((bet) => summarizeBetDescription(bet.description))
    .filter(Boolean)
    .slice(0, 2);

  if (segments.length === 0) {
    return 'Planned Cycle';
  }

  if (segments.length === 1) {
    return segments[0]!;
  }

  const suffix = cycle.bets.length > 2 ? ' + More' : '';
  return `${segments[0]} + ${segments[1]}${suffix}`;
}

function summarizeBetDescription(description: string): string {
  const withoutIssueRefs = description
    .replace(/\b(?:closes|fixes|resolves)\s+#\d+\b/gi, '')
    .replace(/\s+#\d+\b/g, '')
    .replace(/[“”"'`]/g, '')
    .trim();

  const tokens = withoutIssueRefs
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .map((token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean);

  const joined = tokens.join(' ');
  const truncated = joined.length > 42 ? `${joined.slice(0, 39).trimEnd()}...` : joined;
  return normalizeSuggestedCycleName(toTitleCase(truncated)) ?? 'Planned Cycle';
}

function normalizeSuggestedCycleName(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  const collapsed = trimmed.replace(/\s+/g, ' ');
  return collapsed.length > 80 ? collapsed.slice(0, 80).trimEnd() : collapsed;
}

function cleanSuggestedCycleNameLine(line: string): string | undefined {
  if (line.trim().startsWith('```')) {
    return undefined;
  }

  const cleaned = line
    .trim()
    .replace(/^(?:[-*]|\d+[.)])\s*/, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^cycle name:\s*/i, '')
    .replace(/^name:\s*/i, '')
    .trim();

  return normalizeSuggestedCycleName(cleaned);
}

function isLikelySuggestedCycleName(value: string | undefined): value is string {
  if (!value) return false;
  if (value.startsWith('```')) return false;
  if (value.endsWith(':')) return false;

  return !/^(?:sure|here(?:'s| is)|i(?:'d| would)? suggest|how about|maybe|my suggestion|suggested name|recommended name|possible name)\b/i.test(value);
}

function toTitleCase(value: string): string {
  return value
    .split(' ')
    .map((word) => {
      if (!word) return word;
      if (word === word.toUpperCase() && word.length <= 4) return word;
      return word[0]!.toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

function defaultInvokeClaude(prompt: string): string {
  return execFileSync('claude', ['--print'], {
    input: prompt,
    encoding: 'utf-8',
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
  });
}
