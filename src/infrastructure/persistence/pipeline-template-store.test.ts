import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { PipelineTemplate } from '@domain/types/pipeline.js';
import { loadPipelineTemplates } from './pipeline-template-store.js';

describe('loadPipelineTemplates', () => {
  it('should load all template JSON files from a directory', () => {
    const templateDir = mkdtempSync(join(tmpdir(), 'templates-'));

    const template1: PipelineTemplate = {
      name: 'Vertical Slice',
      type: 'vertical',
      description: 'Full pipeline',
      stages: [{ type: 'research' }, { type: 'interview' }],
    };
    const template2: PipelineTemplate = {
      name: 'Bug Fix',
      type: 'bug-fix',
      description: 'Quick fix pipeline',
      stages: [{ type: 'research' }, { type: 'build' }],
    };

    writeFileSync(join(templateDir, 'vertical.json'), JSON.stringify(template1));
    writeFileSync(join(templateDir, 'bug-fix.json'), JSON.stringify(template2));

    const templates = loadPipelineTemplates(templateDir);
    expect(templates).toHaveLength(2);
    expect(templates.map((t) => t.name).sort()).toEqual(['Bug Fix', 'Vertical Slice']);
  });

  it('should return empty array for non-existent directory', () => {
    const templates = loadPipelineTemplates('/tmp/nonexistent-xyz');
    expect(templates).toHaveLength(0);
  });

  it('should skip invalid templates', () => {
    const templateDir = mkdtempSync(join(tmpdir(), 'templates-'));
    writeFileSync(join(templateDir, 'bad.json'), '{ invalid }');
    writeFileSync(
      join(templateDir, 'good.json'),
      JSON.stringify({
        name: 'Good',
        type: 'spike',
        stages: [{ type: 'research' }],
      }),
    );

    const templates = loadPipelineTemplates(templateDir);
    expect(templates).toHaveLength(1);
  });
});
