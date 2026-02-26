export const KATA_DIRS = {
  root: '.kata',
  stages: 'stages',
  flavors: 'flavors',
  pipelines: 'pipelines',
  cycles: 'cycles',
  runs: 'runs',
  history: 'history',
  knowledge: 'knowledge',
  templates: 'templates',
  tracking: 'tracking',
  prompts: 'prompts',
  artifacts: 'artifacts',
  rules: 'rules',
  skill: 'skill',
  vocabularies: 'vocabularies',
  config: 'config.json',
  builtin: 'builtin',
  katas: 'katas',
} as const;

export type KataDirKey = keyof typeof KATA_DIRS;
