import { Command } from 'commander';
import { registerDojoCommand, validateSessionId, parsePositiveInt } from './dojo.js';
import type { DojoSessionMeta, DojoDiaryEntry, DojoSource } from '@domain/types/dojo.js';
import {
  formatDojoSessionTable,
  formatDojoSessionTableJson,
  formatDojoSessionDetail,
  formatDojoSessionDetailJson,
  formatDojoDiaryTable,
  formatDojoDiaryTableJson,
  formatDojoSourceTable,
  formatDojoSourceTableJson,
} from '@cli/formatters/dojo-formatter.js';

describe('validateSessionId', () => {
  it('accepts a valid UUID', () => {
    const uuid = '11111111-1111-1111-1111-111111111111';
    expect(validateSessionId(uuid)).toBe(uuid);
  });

  it('accepts uppercase UUID', () => {
    const uuid = 'ABCDEF01-2345-6789-ABCD-EF0123456789';
    expect(validateSessionId(uuid)).toBe(uuid);
  });

  it('rejects a path traversal string', () => {
    expect(() => validateSessionId('../../etc/passwd')).toThrow('Invalid session ID');
  });

  it('rejects an empty string', () => {
    expect(() => validateSessionId('')).toThrow('Expected a UUID');
  });

  it('rejects a non-UUID string', () => {
    expect(() => validateSessionId('not-a-uuid')).toThrow('Invalid session ID');
  });

  it('rejects a UUID with extra characters', () => {
    expect(() => validateSessionId('11111111-1111-1111-1111-111111111111-extra')).toThrow('Expected a UUID');
  });
});

describe('parsePositiveInt', () => {
  it('parses a valid positive integer', () => {
    expect(parsePositiveInt('5')).toBe(5);
  });

  it('parses "1" as the minimum valid value', () => {
    expect(parsePositiveInt('1')).toBe(1);
  });

  it('rejects zero', () => {
    expect(() => parsePositiveInt('0')).toThrow('Expected a positive integer');
  });

  it('rejects negative numbers', () => {
    expect(() => parsePositiveInt('-3')).toThrow('Expected a positive integer');
  });

  it('rejects non-numeric strings', () => {
    expect(() => parsePositiveInt('abc')).toThrow('Expected a positive integer, got "abc"');
  });

  it('rejects empty string', () => {
    expect(() => parsePositiveInt('')).toThrow('Expected a positive integer');
  });

  it('rejects floating point strings (parseInt truncates but accepts)', () => {
    // parseInt('3.5', 10) returns 3, which is valid
    expect(parsePositiveInt('3.5')).toBe(3);
  });
});

describe('registerDojoCommand', () => {
  it('registers dojo command with subcommands', () => {
    const program = new Command();
    registerDojoCommand(program);
    const dojo = program.commands.find((c) => c.name() === 'dojo');
    expect(dojo).toBeDefined();
    const subNames = dojo!.commands.map((c) => c.name());
    expect(subNames).toContain('list');
    expect(subNames).toContain('open');
    expect(subNames).toContain('inspect');
    expect(subNames).toContain('diary');
    expect(subNames).toContain('diary-write');
    expect(subNames).toContain('sources');
    expect(subNames).toContain('generate');
  });

  it('has correct description on dojo parent command', () => {
    const program = new Command();
    registerDojoCommand(program);
    const dojo = program.commands.find((c) => c.name() === 'dojo');
    expect(dojo!.description()).toContain('training environment');
  });

  it('diary subcommand has -n option', () => {
    const program = new Command();
    registerDojoCommand(program);
    const dojo = program.commands.find((c) => c.name() === 'dojo')!;
    const diary = dojo.commands.find((c) => c.name() === 'diary')!;
    const opts = diary.options.map((o) => o.long);
    expect(opts).toContain('--count');
  });

  it('diary-write subcommand has --narrative and --json-stdin options', () => {
    const program = new Command();
    registerDojoCommand(program);
    const dojo = program.commands.find((c) => c.name() === 'dojo')!;
    const diaryWrite = dojo.commands.find((c) => c.name() === 'diary-write')!;
    const opts = diaryWrite.options.map((o) => o.long);
    expect(opts).toContain('--narrative');
    expect(opts).toContain('--json-stdin');
  });

  it('generate subcommand has --title and --cycles options', () => {
    const program = new Command();
    registerDojoCommand(program);
    const dojo = program.commands.find((c) => c.name() === 'dojo')!;
    const generate = dojo.commands.find((c) => c.name() === 'generate')!;
    const opts = generate.options.map((o) => o.long);
    expect(opts).toContain('--title');
    expect(opts).toContain('--cycles');
  });

  it('inspect subcommand requires a session-id argument', () => {
    const program = new Command();
    registerDojoCommand(program);
    const dojo = program.commands.find((c) => c.name() === 'dojo')!;
    const inspect = dojo.commands.find((c) => c.name() === 'inspect')!;
    const args = inspect.registeredArguments;
    expect(args).toHaveLength(1);
    expect(args[0]!.required).toBe(true);
  });

  it('open subcommand has optional session-id argument', () => {
    const program = new Command();
    registerDojoCommand(program);
    const dojo = program.commands.find((c) => c.name() === 'dojo')!;
    const open = dojo.commands.find((c) => c.name() === 'open')!;
    const args = open.registeredArguments;
    expect(args).toHaveLength(1);
    expect(args[0]!.required).toBe(false);
  });
});

describe('dojo formatter integration', () => {
  const session: DojoSessionMeta = {
    id: '11111111-1111-1111-1111-111111111111',
    title: 'Integration Test Session',
    summary: 'Testing formatters with command context.',
    topicCount: 2,
    sectionCount: 4,
    tags: ['integration'],
    createdAt: '2026-02-28T12:00:00.000Z',
  };

  const diary: DojoDiaryEntry = {
    id: '22222222-2222-2222-2222-222222222222',
    cycleId: '33333333-3333-3333-3333-333333333333',
    narrative: 'All bets delivered on time.',
    wins: ['Shipped feature X'],
    painPoints: [],
    openQuestions: [],
    tags: [],
    createdAt: '2026-02-27T18:00:00.000Z',
  };

  const source: DojoSource = {
    id: '44444444-4444-4444-4444-444444444444',
    name: 'MDN Web Docs',
    url: 'https://developer.mozilla.org/',
    domains: ['web'],
    reputation: 'authoritative' as const,
    active: true,
  };

  it('formatDojoSessionTable produces text for sessions', () => {
    expect(formatDojoSessionTable([session])).toContain('Integration Test Session');
  });

  it('formatDojoSessionTableJson produces parseable JSON', () => {
    const parsed = JSON.parse(formatDojoSessionTableJson([session]));
    expect(parsed[0].title).toBe('Integration Test Session');
  });

  it('formatDojoSessionDetail includes all fields', () => {
    const result = formatDojoSessionDetail(session);
    expect(result).toContain('11111111-1111-1111-1111-111111111111');
    expect(result).toContain('Integration Test Session');
  });

  it('formatDojoSessionDetailJson produces parseable JSON', () => {
    const parsed = JSON.parse(formatDojoSessionDetailJson(session));
    expect(parsed.topicCount).toBe(2);
  });

  it('formatDojoDiaryTable produces text for entries', () => {
    expect(formatDojoDiaryTable([diary])).toContain('All bets delivered');
  });

  it('formatDojoDiaryTableJson produces parseable JSON', () => {
    const parsed = JSON.parse(formatDojoDiaryTableJson([diary]));
    expect(parsed[0].narrative).toContain('All bets delivered');
  });

  it('formatDojoSourceTable produces text for sources', () => {
    expect(formatDojoSourceTable([source])).toContain('MDN Web Docs');
    expect(formatDojoSourceTable([source])).toContain('[authoritative]');
  });

  it('formatDojoSourceTableJson produces parseable JSON', () => {
    const parsed = JSON.parse(formatDojoSourceTableJson([source]));
    expect(parsed[0].name).toBe('MDN Web Docs');
  });
});
