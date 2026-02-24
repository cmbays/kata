import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod/v4';
import { JsonStore, JsonStoreError } from './json-store.js';

const TestSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  count: z.number().int().min(0).default(0),
});

type TestData = z.infer<typeof TestSchema>;

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'kata-store-test-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('JsonStore.read', () => {
  it('reads and validates a valid JSON file', () => {
    const id = crypto.randomUUID();
    const path = join(tempDir, 'test.json');
    writeFileSync(path, JSON.stringify({ id, name: 'test-item', count: 5 }));

    const result = JsonStore.read(path, TestSchema);
    expect(result.id).toBe(id);
    expect(result.name).toBe('test-item');
    expect(result.count).toBe(5);
  });

  it('applies defaults for missing optional fields', () => {
    const id = crypto.randomUUID();
    const path = join(tempDir, 'test.json');
    writeFileSync(path, JSON.stringify({ id, name: 'minimal' }));

    const result = JsonStore.read(path, TestSchema);
    expect(result.count).toBe(0);
  });

  it('throws JsonStoreError for missing file', () => {
    const path = join(tempDir, 'nonexistent.json');
    expect(() => JsonStore.read(path, TestSchema)).toThrow(JsonStoreError);
    expect(() => JsonStore.read(path, TestSchema)).toThrow('File not found');
  });

  it('throws JsonStoreError for invalid JSON', () => {
    const path = join(tempDir, 'bad.json');
    writeFileSync(path, 'not json {{{');
    expect(() => JsonStore.read(path, TestSchema)).toThrow(JsonStoreError);
    expect(() => JsonStore.read(path, TestSchema)).toThrow('Invalid JSON');
  });

  it('throws JsonStoreError for schema validation failure', () => {
    const path = join(tempDir, 'invalid.json');
    writeFileSync(path, JSON.stringify({ id: 'not-a-uuid', name: '' }));
    expect(() => JsonStore.read(path, TestSchema)).toThrow(JsonStoreError);
    expect(() => JsonStore.read(path, TestSchema)).toThrow('Validation failed');
  });
});

describe('JsonStore.write', () => {
  it('writes valid data and creates file', () => {
    const id = crypto.randomUUID();
    const path = join(tempDir, 'output.json');
    const data: TestData = { id, name: 'written', count: 10 };

    JsonStore.write(path, data, TestSchema);

    expect(existsSync(path)).toBe(true);
    const readBack = JsonStore.read(path, TestSchema);
    expect(readBack).toEqual(data);
  });

  it('creates parent directories if needed', () => {
    const id = crypto.randomUUID();
    const path = join(tempDir, 'nested', 'deep', 'output.json');
    const data: TestData = { id, name: 'nested', count: 0 };

    JsonStore.write(path, data, TestSchema);

    expect(existsSync(path)).toBe(true);
  });

  it('throws JsonStoreError if data fails validation before write', () => {
    const path = join(tempDir, 'bad-write.json');
    const badData = { id: 'not-uuid', name: '', count: -5 };

    expect(() => JsonStore.write(path, badData as TestData, TestSchema)).toThrow(JsonStoreError);
    expect(() => JsonStore.write(path, badData as TestData, TestSchema)).toThrow('Validation failed before write');
    expect(existsSync(path)).toBe(false);
  });
});

describe('JsonStore.exists', () => {
  it('returns true for existing file', () => {
    const path = join(tempDir, 'exists.json');
    writeFileSync(path, '{}');
    expect(JsonStore.exists(path)).toBe(true);
  });

  it('returns false for missing file', () => {
    expect(JsonStore.exists(join(tempDir, 'nope.json'))).toBe(false);
  });
});

describe('JsonStore.list', () => {
  it('returns empty array for missing directory', () => {
    const result = JsonStore.list(join(tempDir, 'nonexistent'), TestSchema);
    expect(result).toEqual([]);
  });

  it('reads all valid JSON files from directory', () => {
    const dir = join(tempDir, 'items');
    JsonStore.ensureDir(dir);

    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ id: ids[0], name: 'first' }));
    writeFileSync(join(dir, 'b.json'), JSON.stringify({ id: ids[1], name: 'second', count: 3 }));

    const results = JsonStore.list(dir, TestSchema);
    expect(results).toHaveLength(2);
    const names = results.map((r) => r.name).sort();
    expect(names).toEqual(['first', 'second']);
  });

  it('skips invalid files silently', () => {
    const dir = join(tempDir, 'mixed');
    JsonStore.ensureDir(dir);

    const id = crypto.randomUUID();
    writeFileSync(join(dir, 'good.json'), JSON.stringify({ id, name: 'valid' }));
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({ id: 'not-uuid', name: '' }));
    writeFileSync(join(dir, 'notjson.json'), 'broken {{{');

    const results = JsonStore.list(dir, TestSchema);
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe('valid');
  });

  it('ignores non-JSON files', () => {
    const dir = join(tempDir, 'mixed-ext');
    JsonStore.ensureDir(dir);

    const id = crypto.randomUUID();
    writeFileSync(join(dir, 'data.json'), JSON.stringify({ id, name: 'json' }));
    writeFileSync(join(dir, 'readme.md'), '# Not JSON');

    const results = JsonStore.list(dir, TestSchema);
    expect(results).toHaveLength(1);
  });

  it('throws JsonStoreError when directory is not readable (EACCES)', () => {
    const dir = join(tempDir, 'locked-dir');
    mkdirSync(dir);
    chmodSync(dir, 0o000); // remove all permissions — readdirSync will fail
    try {
      expect(() => JsonStore.list(dir, TestSchema)).toThrow(JsonStoreError);
      expect(() => JsonStore.list(dir, TestSchema)).toThrow('Failed to read directory');
    } finally {
      chmodSync(dir, 0o755); // restore so cleanup can proceed
    }
  });
});

describe('JsonStore.ensureDir', () => {
  it('creates directory if it does not exist', () => {
    const dir = join(tempDir, 'new-dir');
    expect(existsSync(dir)).toBe(false);
    JsonStore.ensureDir(dir);
    expect(existsSync(dir)).toBe(true);
  });

  it('is idempotent for existing directory', () => {
    const dir = join(tempDir, 'existing');
    JsonStore.ensureDir(dir);
    JsonStore.ensureDir(dir);
    expect(existsSync(dir)).toBe(true);
  });
});
