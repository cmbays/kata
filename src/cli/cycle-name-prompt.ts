import type { CycleNameSuggestion } from '@features/cycle-management/cycle-name-suggester.js';

export function shouldPromptForCycleName(isJson: boolean): boolean {
  return !isJson && !!process.stdin.isTTY && !!process.stdout.isTTY;
}

export async function promptForCycleActivationName(suggestion: CycleNameSuggestion): Promise<string> {
  const { input } = await import('@inquirer/prompts');

  return input({
    message: 'Cycle name:',
    default: suggestion.name,
    validate: (value) => value.trim() ? true : 'Cycle name is required before activation.',
  });
}
