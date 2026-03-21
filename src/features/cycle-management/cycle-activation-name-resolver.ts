import type { Cycle } from '@domain/types/cycle.js';
import { CycleNameSuggester, type CycleNameSuggestion } from './cycle-name-suggester.js';

export interface ResolveCycleActivationNameInput {
  cycle: Pick<Cycle, 'id' | 'name' | 'bets' | 'createdAt'>;
  providedName?: string;
  promptForName?: (suggestion: CycleNameSuggestion) => Promise<string>;
}

export interface ResolveCycleActivationNameDeps {
  suggester?: Pick<CycleNameSuggester, 'suggest'>;
}

export interface ResolvedCycleActivationName {
  name: string;
  source: 'provided' | 'existing' | 'prompted' | 'llm' | 'heuristic';
  suggestedName?: string;
}

export async function resolveCycleActivationName(
  input: ResolveCycleActivationNameInput,
  deps: ResolveCycleActivationNameDeps = {},
): Promise<ResolvedCycleActivationName> {
  if (input.providedName !== undefined) {
    const normalizedProvided = normalizeCycleName(input.providedName);
    if (!normalizedProvided) {
      throw new Error('Cycle name must be non-empty when provided.');
    }
    return { name: normalizedProvided, source: 'provided' };
  }

  const existingName = normalizeCycleName(input.cycle.name);
  if (existingName) {
    return { name: existingName, source: 'existing' };
  }

  const suggester = deps.suggester ?? new CycleNameSuggester();
  const suggestion = suggester.suggest(input.cycle);

  if (!input.promptForName) {
    return { name: suggestion.name, source: suggestion.source, suggestedName: suggestion.name };
  }

  const promptedName = normalizeCycleName(await input.promptForName(suggestion));
  if (!promptedName) {
    throw new Error('Cycle name is required before activation.');
  }

  if (promptedName === suggestion.name) {
    return { name: promptedName, source: suggestion.source, suggestedName: suggestion.name };
  }

  return { name: promptedName, source: 'prompted', suggestedName: suggestion.name };
}

function normalizeCycleName(name: string | undefined): string | undefined {
  const trimmed = name?.trim();
  return trimmed ? trimmed : undefined;
}
