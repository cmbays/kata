export const KATA_DIRS = {
  root: '.kata',
  stages: 'stages',
  pipelines: 'pipelines',
  cycles: 'cycles',
  history: 'history',
  knowledge: 'knowledge',
  templates: 'templates',
  tracking: 'tracking',
  prompts: 'prompts',
  config: 'config.json',
  builtin: 'builtin',
} as const;

export type KataDirKey = keyof typeof KATA_DIRS;
