import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod/v4';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { JsonlStore, JsonlStoreError } from './jsonl-store.js';

const WidgetSchema = z.object({ id: z.string(), value: z.number() });
type Widget = z.infer<typeof WidgetSchema>;

const OutcomeSchema = z.object({ decisionId: z.string(), result: z.string(), updatedAt: z.string() });

function tempDir(): string {
  const dir = join(tmpdir(), `kata-jsonl-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('JsonlStore.append', () => {
  it('creates file and appends an entry', () => {
    const dir = tempDir();
    const path = join(dir, 'widgets.jsonl');

    JsonlStore.append(path, { id: 'a', value: 1 }, WidgetSchema);
    const entries = JsonlStore.readAll(path, WidgetSchema);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ id: 'a', value: 1 });
  });

  it('appends multiple entries', () => {
    const dir = tempDir();
    const path = join(dir, 'widgets.jsonl');

    JsonlStore.append(path, { id: 'a', value: 1 }, WidgetSchema);
    JsonlStore.append(path, { id: 'b', value: 2 }, WidgetSchema);
    JsonlStore.append(path, { id: 'c', value: 3 }, WidgetSchema);

    const entries = JsonlStore.readAll(path, WidgetSchema);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('creates parent directories if missing', () => {
    const dir = tempDir();
    const path = join(dir, 'nested', 'deeply', 'widgets.jsonl');

    JsonlStore.append(path, { id: 'a', value: 1 }, WidgetSchema);
    const entries = JsonlStore.readAll(path, WidgetSchema);
    expect(entries).toHaveLength(1);
  });

  it('throws JsonlStoreError on validation failure', () => {
    const dir = tempDir();
    const path = join(dir, 'widgets.jsonl');

    expect(() =>
      JsonlStore.append(path, { id: 'a', value: 'not-a-number' } as unknown as Widget, WidgetSchema)
    ).toThrow(JsonlStoreError);
  });
});

describe('JsonlStore.readAll', () => {
  it('returns empty array for missing file', () => {
    const dir = tempDir();
    const path = join(dir, 'nonexistent.jsonl');
    expect(JsonlStore.readAll(path, WidgetSchema)).toEqual([]);
  });

  it('skips blank lines', () => {
    const dir = tempDir();
    const path = join(dir, 'widgets.jsonl');
    writeFileSync(path, '\n{"id":"a","value":1}\n\n{"id":"b","value":2}\n', 'utf-8');

    const entries = JsonlStore.readAll(path, WidgetSchema);
    expect(entries).toHaveLength(2);
  });

  it('skips invalid JSON lines without throwing', () => {
    const dir = tempDir();
    const path = join(dir, 'widgets.jsonl');
    writeFileSync(path, '{"id":"a","value":1}\nnot-json\n{"id":"b","value":2}\n', 'utf-8');

    const entries = JsonlStore.readAll(path, WidgetSchema);
    expect(entries).toHaveLength(2);
  });

  it('skips lines failing schema validation without throwing', () => {
    const dir = tempDir();
    const path = join(dir, 'widgets.jsonl');
    writeFileSync(path, '{"id":"a","value":1}\n{"id":"b","value":"bad"}\n', 'utf-8');

    const entries = JsonlStore.readAll(path, WidgetSchema);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('a');
  });
});

describe('JsonlStore.readDecisionsWithOutcomes', () => {
  function writeJsonl(path: string, entries: unknown[]): void {
    const dir = join(path, '..');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
  }

  it('returns decisions with no outcomes when outcome file is missing', () => {
    const dir = tempDir();
    const decisionsPath = join(dir, 'decisions.jsonl');
    const outcomesPath = join(dir, 'decision-outcomes.jsonl');

    writeJsonl(decisionsPath, [{ id: 'w1', value: 10, decidedAt: '2026-01-01T00:00:00.000Z' }]);

    const results = JsonlStore.readDecisionsWithOutcomes(
      decisionsPath,
      outcomesPath,
      WidgetSchema.extend({ decidedAt: z.string() }),
      OutcomeSchema,
    );
    expect(results).toHaveLength(1);
    expect(results[0].latestOutcome).toBeUndefined();
  });

  it('merges latest outcome per decision ID', () => {
    const dir = tempDir();
    const decisionsPath = join(dir, 'decisions.jsonl');
    const outcomesPath = join(dir, 'decision-outcomes.jsonl');

    writeJsonl(decisionsPath, [
      { id: 'w1', value: 10, decidedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'w2', value: 20, decidedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    writeJsonl(outcomesPath, [
      { decisionId: 'w1', result: 'first', updatedAt: '2026-01-01T01:00:00.000Z' },
      { decisionId: 'w1', result: 'second', updatedAt: '2026-01-01T02:00:00.000Z' },
      { decisionId: 'w2', result: 'only', updatedAt: '2026-01-01T01:00:00.000Z' },
    ]);

    const results = JsonlStore.readDecisionsWithOutcomes(
      decisionsPath,
      outcomesPath,
      WidgetSchema.extend({ decidedAt: z.string() }),
      OutcomeSchema,
    );

    expect(results).toHaveLength(2);
    const w1 = results.find((r) => r.id === 'w1');
    expect(w1?.latestOutcome?.result).toBe('second'); // Latest by updatedAt
    const w2 = results.find((r) => r.id === 'w2');
    expect(w2?.latestOutcome?.result).toBe('only');
  });

  it('preserves decision order', () => {
    const dir = tempDir();
    const decisionsPath = join(dir, 'decisions.jsonl');
    const outcomesPath = join(dir, 'decision-outcomes.jsonl');

    writeJsonl(decisionsPath, [
      { id: 'w3', value: 30, decidedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'w1', value: 10, decidedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'w2', value: 20, decidedAt: '2026-01-01T00:00:00.000Z' },
    ]);

    const results = JsonlStore.readDecisionsWithOutcomes(
      decisionsPath,
      outcomesPath,
      WidgetSchema.extend({ decidedAt: z.string() }),
      OutcomeSchema,
    );

    expect(results.map((r) => r.id)).toEqual(['w3', 'w1', 'w2']);
  });
});
