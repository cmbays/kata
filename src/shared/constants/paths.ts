export const KATA_DIRS = {
  root: '.kata',
  stages: 'stages',
  flavors: 'flavors',
  pipelines: 'pipelines',
  cycles: 'cycles',
  history: 'history',
  knowledge: 'knowledge',
  templates: 'templates',
  tracking: 'tracking',
  prompts: 'prompts',
  artifacts: 'artifacts',
  rules: 'rules',
  config: 'config.json',
  builtin: 'builtin',
} as const;

export type KataDirKey = keyof typeof KATA_DIRS;
