import { generateKataMd } from './kata-md-generator.js';
import type { KataConfig } from '@domain/types/config.js';

const BASE_CONFIG: KataConfig = {
  methodology: 'shape-up',
  outputMode: 'thematic',
  execution: {
    adapter: 'manual',
    config: {},
    confidenceThreshold: 0.7,
  },
  customStagePaths: [],
  project: {
    name: 'test-project',
    repository: undefined,
  },
  user: {
    experienceLevel: 'intermediate',
  },
  cooldown: {
    synthesisDepth: 'standard',
  },
};

describe('generateKataMd', () => {
  it('generates valid markdown content', () => {
    const md = generateKataMd({ config: BASE_CONFIG, kataDir: '/tmp/.kata' });
    expect(md).toContain('# KATA.md');
    expect(md).toContain('Project Context');
  });

  it('includes project name', () => {
    const md = generateKataMd({ config: BASE_CONFIG, kataDir: '/tmp/.kata' });
    expect(md).toContain('test-project');
  });

  it('uses fallback name when project.name is undefined', () => {
    const config = { ...BASE_CONFIG, project: {} };
    const md = generateKataMd({ config, kataDir: '/tmp/.kata' });
    expect(md).toContain('Unnamed Project');
  });

  it('includes methodology', () => {
    const md = generateKataMd({ config: BASE_CONFIG, kataDir: '/tmp/.kata' });
    expect(md).toContain('shape-up');
  });

  it('includes adapter', () => {
    const config = { ...BASE_CONFIG, execution: { ...BASE_CONFIG.execution, adapter: 'claude-cli' as const } };
    const md = generateKataMd({ config, kataDir: '/tmp/.kata' });
    expect(md).toContain('claude-cli');
  });

  it('includes experience level', () => {
    const md = generateKataMd({ config: BASE_CONFIG, kataDir: '/tmp/.kata' });
    expect(md).toContain('intermediate');
  });

  it('reflects beginner experience level', () => {
    const config = {
      ...BASE_CONFIG,
      user: { experienceLevel: 'beginner' as const },
    };
    const md = generateKataMd({ config, kataDir: '/tmp/.kata' });
    expect(md).toContain('beginner');
  });

  it('includes synthesis depth', () => {
    const config = {
      ...BASE_CONFIG,
      cooldown: { synthesisDepth: 'thorough' as const },
    };
    const md = generateKataMd({ config, kataDir: '/tmp/.kata' });
    expect(md).toContain('thorough');
  });

  it('includes kataka registry placeholder', () => {
    const md = generateKataMd({ config: BASE_CONFIG, kataDir: '/tmp/.kata' });
    expect(md).toContain('Kataka Registry');
  });

  it('includes active cycle placeholder', () => {
    const md = generateKataMd({ config: BASE_CONFIG, kataDir: '/tmp/.kata' });
    expect(md).toContain('Active Cycle');
  });

  it('includes confidence threshold', () => {
    const md = generateKataMd({ config: BASE_CONFIG, kataDir: '/tmp/.kata' });
    expect(md).toContain('0.7');
  });
});
