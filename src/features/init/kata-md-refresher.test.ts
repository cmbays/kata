import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { KataMdRefresher, generateLearningsSection, generateSynthesisSection } from './kata-md-refresher.js';
import type { Learning } from '@domain/types/learning.js';
import type { SynthesisProposal } from '@domain/types/synthesis.js';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpFile(content?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'kata-md-refresher-'));
  const path = join(dir, 'KATA.md');
  if (content !== undefined) {
    writeFileSync(path, content, 'utf-8');
  }
  return path;
}

function makeLearning(overrides: Partial<Learning> = {}): Learning {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    tier: 'agent',
    category: 'testing',
    content: 'a useful pattern',
    evidence: [],
    confidence: 0.8,
    citations: [],
    derivedFrom: [],
    reinforcedBy: [],
    usageCount: 0,
    versions: [],
    archived: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Learning;
}

// ---------------------------------------------------------------------------
// KataMdRefresher tests
// ---------------------------------------------------------------------------

describe('KataMdRefresher.updateSection', () => {
  it('creates the file if it does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kata-md-new-'));
    const path = join(dir, 'KATA.md');
    const refresher = new KataMdRefresher(path);

    refresher.updateSection('learnings', 'some learning content');

    const written = readFileSync(path, 'utf-8');
    expect(written).toContain('<!-- kata:begin:learnings -->');
    expect(written).toContain('some learning content');
    expect(written).toContain('<!-- kata:end:learnings -->');
  });

  it('appends a new section when markers do not exist', () => {
    const path = makeTmpFile('# KATA.md\n\nSome user content.\n');
    const refresher = new KataMdRefresher(path);

    refresher.updateSection('learnings', 'first learnings');

    const written = readFileSync(path, 'utf-8');
    expect(written).toContain('# KATA.md');
    expect(written).toContain('Some user content.');
    expect(written).toContain('<!-- kata:begin:learnings -->');
    expect(written).toContain('first learnings');
    expect(written).toContain('<!-- kata:end:learnings -->');
  });

  it('replaces existing section content between markers', () => {
    const initial = [
      '# KATA.md',
      '',
      '## Project',
      '',
      'Some user text.',
      '',
      '<!-- kata:begin:learnings -->',
      'old learning content',
      '<!-- kata:end:learnings -->',
      '',
      '## After section',
    ].join('\n');

    const path = makeTmpFile(initial);
    const refresher = new KataMdRefresher(path);

    refresher.updateSection('learnings', 'new learning content');

    const written = readFileSync(path, 'utf-8');
    expect(written).toContain('new learning content');
    expect(written).not.toContain('old learning content');
  });

  it('preserves all content outside the markers exactly', () => {
    const before = '# KATA.md\n\nUser section before.\n\n';
    const after = '\n\n## User section after.\n\nMore user content.\n';
    const initial =
      before +
      '<!-- kata:begin:learnings -->\nold\n<!-- kata:end:learnings -->' +
      after;

    const path = makeTmpFile(initial);
    const refresher = new KataMdRefresher(path);

    refresher.updateSection('learnings', 'updated');

    const written = readFileSync(path, 'utf-8');
    expect(written).toContain('User section before.');
    expect(written).toContain('## User section after.');
    expect(written).toContain('More user content.');
  });

  it('can update multiple sections independently', () => {
    const path = makeTmpFile('# KATA.md\n');
    const refresher = new KataMdRefresher(path);

    refresher.updateSection('learnings', 'learning A');
    refresher.updateSection('kataka', 'kataka content');
    refresher.updateSection('synthesis', 'synthesis summary');

    const written = readFileSync(path, 'utf-8');
    expect(written).toContain('<!-- kata:begin:learnings -->');
    expect(written).toContain('learning A');
    expect(written).toContain('<!-- kata:begin:kataka -->');
    expect(written).toContain('kataka content');
    expect(written).toContain('<!-- kata:begin:synthesis -->');
    expect(written).toContain('synthesis summary');
  });

  it('can replace the same section twice', () => {
    const path = makeTmpFile('# KATA.md\n');
    const refresher = new KataMdRefresher(path);

    refresher.updateSection('learnings', 'first value');
    refresher.updateSection('learnings', 'second value');

    const written = readFileSync(path, 'utf-8');
    expect(written).toContain('second value');
    expect(written).not.toContain('first value');
  });
});

describe('KataMdRefresher.readSection', () => {
  it('returns null when file does not exist', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'kata-md-read-')), 'KATA.md');
    const refresher = new KataMdRefresher(path);

    expect(refresher.readSection('learnings')).toBeNull();
  });

  it('returns null when section does not exist in file', () => {
    const path = makeTmpFile('# KATA.md\n\nNo sections here.\n');
    const refresher = new KataMdRefresher(path);

    expect(refresher.readSection('learnings')).toBeNull();
  });

  it('returns null when only begin marker is present', () => {
    const path = makeTmpFile('<!-- kata:begin:learnings -->\ncontent without end marker\n');
    const refresher = new KataMdRefresher(path);

    expect(refresher.readSection('learnings')).toBeNull();
  });

  it('returns the content between markers', () => {
    const path = makeTmpFile(
      '# KATA.md\n\n<!-- kata:begin:learnings -->\nsome learning\n<!-- kata:end:learnings -->\n',
    );
    const refresher = new KataMdRefresher(path);

    const content = refresher.readSection('learnings');
    expect(content).toContain('some learning');
  });

  it('returns content after updateSection', () => {
    const path = makeTmpFile('');
    const refresher = new KataMdRefresher(path);

    refresher.updateSection('synthesis', 'synthesis summary here');
    const content = refresher.readSection('synthesis');

    expect(content).toContain('synthesis summary here');
  });
});

// ---------------------------------------------------------------------------
// generateLearningsSection tests
// ---------------------------------------------------------------------------

describe('generateLearningsSection', () => {
  it('returns placeholder when no learnings provided', () => {
    const result = generateLearningsSection([]);
    expect(result).toContain('No learnings');
  });

  it('formats learnings as bullet list with category and confidence', () => {
    const learnings = [
      makeLearning({ category: 'build', confidence: 0.9, content: 'TDD is effective' }),
      makeLearning({ category: 'research', confidence: 0.75, content: 'Read docs first' }),
    ];
    const result = generateLearningsSection(learnings);

    expect(result).toContain('**[build]**');
    expect(result).toContain('TDD is effective');
    expect(result).toContain('confidence: 0.90');
    expect(result).toContain('**[research]**');
    expect(result).toContain('Read docs first');
  });

  it('sorts learnings by confidence descending', () => {
    const learnings = [
      makeLearning({ confidence: 0.4, content: 'low confidence' }),
      makeLearning({ confidence: 0.9, content: 'high confidence' }),
      makeLearning({ confidence: 0.6, content: 'mid confidence' }),
    ];
    const result = generateLearningsSection(learnings);

    const highIdx = result.indexOf('high confidence');
    const midIdx = result.indexOf('mid confidence');
    const lowIdx = result.indexOf('low confidence');

    expect(highIdx).toBeLessThan(midIdx);
    expect(midIdx).toBeLessThan(lowIdx);
  });

  it('limits output to top 10 learnings', () => {
    const learnings = Array.from({ length: 15 }, (_, i) =>
      makeLearning({ confidence: i / 15, content: `learning ${i}` }),
    );
    const result = generateLearningsSection(learnings);

    const bulletCount = (result.match(/^- /gm) ?? []).length;
    expect(bulletCount).toBe(10);
  });

  it('excludes archived learnings', () => {
    const learnings = [
      makeLearning({ archived: false, content: 'active learning' }),
      makeLearning({ archived: true, content: 'archived learning' }),
    ];
    const result = generateLearningsSection(learnings);

    expect(result).toContain('active learning');
    expect(result).not.toContain('archived learning');
  });
});

// ---------------------------------------------------------------------------
// generateSynthesisSection tests
// ---------------------------------------------------------------------------

describe('generateSynthesisSection', () => {
  const appliedAt = '2026-02-28T12:00:00.000Z';

  it('returns placeholder when no proposals', () => {
    const result = generateSynthesisSection([], appliedAt);
    expect(result).toContain(appliedAt);
    expect(result).toContain('no proposals');
  });

  it('lists proposal types and reasoning', () => {
    const proposals: SynthesisProposal[] = [
      {
        id: randomUUID(),
        type: 'new-learning',
        proposedContent: 'Some new learning',
        proposedTier: 'agent',
        proposedCategory: 'testing',
        confidence: 0.9,
        citations: [randomUUID(), randomUUID()],
        reasoning: 'Observed consistently across runs',
        createdAt: appliedAt,
      },
      {
        id: randomUUID(),
        type: 'methodology-recommendation',
        recommendation: 'Add more integration tests',
        area: 'testing',
        confidence: 0.8,
        citations: [randomUUID(), randomUUID()],
        reasoning: 'Coverage gaps detected',
        createdAt: appliedAt,
      },
    ];

    const result = generateSynthesisSection(proposals, appliedAt);

    expect(result).toContain('new-learning');
    expect(result).toContain('Observed consistently across runs');
    expect(result).toContain('methodology-recommendation');
    expect(result).toContain('Coverage gaps detected');
    expect(result).toContain(appliedAt);
  });
});
