import type { DojoDiaryEntry, DojoSessionMeta, DojoSource } from '@domain/types/dojo.js';
import {
  formatDojoSessionTable,
  formatDojoSessionDetail,
  formatDojoDiaryTable,
  formatDojoDiaryEntry,
  formatDojoSourceTable,
  formatDojoSessionTableJson,
  formatDojoSessionDetailJson,
  formatDojoDiaryTableJson,
  formatDojoDiaryEntryJson,
  formatDojoSourceTableJson,
} from './dojo-formatter.js';

const makeSessionMeta = (overrides: Partial<DojoSessionMeta> = {}): DojoSessionMeta => ({
  id: '00000000-0000-0000-0000-000000000001',
  title: 'Test Session',
  summary: 'A test training session.',
  topicCount: 3,
  sectionCount: 5,
  tags: ['testing'],
  createdAt: '2026-02-28T12:00:00.000Z',
  ...overrides,
});

const makeDiaryEntry = (overrides: Partial<DojoDiaryEntry> = {}): DojoDiaryEntry => ({
  id: '00000000-0000-0000-0000-000000000002',
  cycleId: '00000000-0000-0000-0000-000000000003',
  cycleName: 'Sprint 1',
  narrative: 'Completed three bets successfully. Identified a recurring gap in testing coverage.',
  wins: ['Delivered auth module', 'Shipped search feature'],
  painPoints: ['Flaky CI pipeline'],
  openQuestions: ['Should we adopt integration tests?'],
  mood: 'energized' as const,
  tags: ['build', 'learnings'],
  createdAt: '2026-02-27T18:00:00.000Z',
  ...overrides,
});

const makeSource = (overrides: Partial<DojoSource> = {}): DojoSource => ({
  id: '00000000-0000-0000-0000-000000000004',
  name: 'TypeScript Handbook',
  url: 'https://www.typescriptlang.org/docs/',
  domains: ['typescript', 'language'],
  reputation: 'official' as const,
  description: 'Official TypeScript documentation',
  active: true,
  ...overrides,
});

describe('formatDojoSessionTable', () => {
  it('returns empty message for no sessions', () => {
    const result = formatDojoSessionTable([]);
    expect(result).toContain('No dojo sessions found.');
  });

  it('formats sessions with id prefix, date, title, tags, and counts', () => {
    const sessions = [makeSessionMeta()];
    const result = formatDojoSessionTable(sessions);
    expect(result).toContain('Dojo Sessions');
    expect(result).toContain('00000000');
    expect(result).toContain('Test Session');
    expect(result).toContain('[testing]');
    expect(result).toContain('3 topics, 5 sections');
  });

  it('uses plain lexicon when plain is true', () => {
    const result = formatDojoSessionTable([], true);
    expect(result).toContain('No dojo sessions found.');
  });
});

describe('formatDojoSessionDetail', () => {
  it('formats session meta with all fields', () => {
    const meta = makeSessionMeta();
    const result = formatDojoSessionDetail(meta);
    expect(result).toContain('Dojo Session');
    expect(result).toContain('ID:       00000000-0000-0000-0000-000000000001');
    expect(result).toContain('Title:    Test Session');
    expect(result).toContain('Summary:  A test training session.');
    expect(result).toContain('Topics:   3');
    expect(result).toContain('Sections: 5');
    expect(result).toContain('Tags:     testing');
  });

  it('omits tags line when no tags', () => {
    const result = formatDojoSessionDetail(makeSessionMeta({ tags: [] }));
    expect(result).not.toContain('Tags:');
  });
});

describe('formatDojoDiaryTable', () => {
  it('returns empty message for no entries', () => {
    const result = formatDojoDiaryTable([]);
    expect(result).toContain('No dojo diary entries found.');
  });

  it('formats diary entries with date, name, mood, and summary', () => {
    const entries = [makeDiaryEntry()];
    const result = formatDojoDiaryTable(entries);
    expect(result).toContain('Dojo Diary');
    expect(result).toContain('Sprint 1');
    expect(result).toContain('(energized)');
    expect(result).toContain('Completed three bets');
    expect(result).toContain('Wins: 2');
    expect(result).toContain('Pain points: 1');
  });

  it('truncates long narratives to 80 chars', () => {
    const longNarrative = 'A'.repeat(100);
    const result = formatDojoDiaryTable([makeDiaryEntry({ narrative: longNarrative })]);
    expect(result).toContain('...');
  });

  it('uses cycleId prefix when cycleName is absent', () => {
    const result = formatDojoDiaryTable([makeDiaryEntry({ cycleName: undefined })]);
    expect(result).toContain('00000000');
  });
});

describe('formatDojoDiaryEntry', () => {
  it('formats full diary entry with all sections', () => {
    const entry = makeDiaryEntry();
    const result = formatDojoDiaryEntry(entry);
    expect(result).toContain('Dojo Diary — Sprint 1');
    expect(result).toContain('Cycle:  00000000-0000-0000-0000-000000000003');
    expect(result).toContain('Mood:   energized');
    expect(result).toContain('Completed three bets');
    expect(result).toContain('Wins:');
    expect(result).toContain('+ Delivered auth module');
    expect(result).toContain('Pain Points:');
    expect(result).toContain('- Flaky CI pipeline');
    expect(result).toContain('Open Questions:');
    expect(result).toContain('? Should we adopt integration tests?');
    expect(result).toContain('Tags: build, learnings');
  });

  it('omits optional sections when empty', () => {
    const entry = makeDiaryEntry({ wins: [], painPoints: [], openQuestions: [], tags: [], mood: undefined });
    const result = formatDojoDiaryEntry(entry);
    expect(result).not.toContain('Wins:');
    expect(result).not.toContain('Pain Points:');
    expect(result).not.toContain('Open Questions:');
    expect(result).not.toContain('Tags:');
    expect(result).not.toContain('Mood:');
  });
});

describe('formatDojoSourceTable', () => {
  it('returns empty message for no sources', () => {
    expect(formatDojoSourceTable([])).toBe('No sources configured.');
  });

  it('formats sources with active indicator, name, reputation, domains, and URL', () => {
    const sources = [makeSource()];
    const result = formatDojoSourceTable(sources);
    expect(result).toContain('Dojo Sources');
    expect(result).toContain('● TypeScript Handbook');
    expect(result).toContain('[official]');
    expect(result).toContain('(typescript, language)');
    expect(result).toContain('https://www.typescriptlang.org/docs/');
  });

  it('shows inactive indicator for disabled sources', () => {
    const result = formatDojoSourceTable([makeSource({ active: false })]);
    expect(result).toContain('○ TypeScript Handbook');
  });
});

describe('JSON formatters', () => {
  it('formatDojoSessionTableJson returns valid JSON array', () => {
    const sessions = [makeSessionMeta()];
    const result = JSON.parse(formatDojoSessionTableJson(sessions));
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Test Session');
  });

  it('formatDojoSessionDetailJson returns valid JSON object', () => {
    const result = JSON.parse(formatDojoSessionDetailJson(makeSessionMeta()));
    expect(result.id).toBe('00000000-0000-0000-0000-000000000001');
  });

  it('formatDojoDiaryTableJson returns valid JSON array', () => {
    const result = JSON.parse(formatDojoDiaryTableJson([makeDiaryEntry()]));
    expect(result).toHaveLength(1);
    expect(result[0].mood).toBe('energized');
  });

  it('formatDojoDiaryEntryJson returns valid JSON object', () => {
    const result = JSON.parse(formatDojoDiaryEntryJson(makeDiaryEntry()));
    expect(result.cycleId).toBe('00000000-0000-0000-0000-000000000003');
  });

  it('formatDojoSourceTableJson returns valid JSON array', () => {
    const result = JSON.parse(formatDojoSourceTableJson([makeSource()]));
    expect(result).toHaveLength(1);
    expect(result[0].reputation).toBe('official');
  });
});
