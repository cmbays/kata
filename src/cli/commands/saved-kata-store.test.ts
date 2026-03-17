import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { listSavedKatas, loadSavedKata, saveSavedKata, deleteSavedKata } from '@cli/commands/saved-kata-store.js';

describe('saved-kata-store', () => {
  let tmpBase: string;

  beforeEach(() => {
    tmpBase = join(tmpdir(), `kata-saved-store-${randomUUID()}`);
    mkdirSync(tmpBase, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  describe('listSavedKatas', () => {
    it('returns empty when katas dir does not exist', () => {
      expect(listSavedKatas(tmpBase)).toEqual([]);
    });

    it('returns valid katas and skips non-json files', () => {
      const katasDir = join(tmpBase, 'katas');
      mkdirSync(katasDir, { recursive: true });
      writeFileSync(join(katasDir, 'valid.json'), JSON.stringify({ name: 'valid', stages: ['build'] }));
      writeFileSync(join(katasDir, 'notes.txt'), 'not json');
      writeFileSync(join(katasDir, 'broken.json'), '{ broken }');

      const result = listSavedKatas(tmpBase);
      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe('valid');
      expect(result[0]!.stages).toEqual(['build']);
    });

    it('skips files with invalid schema data', () => {
      const katasDir = join(tmpBase, 'katas');
      mkdirSync(katasDir, { recursive: true });
      writeFileSync(join(katasDir, 'bad-schema.json'), JSON.stringify({ name: 123 }));

      expect(listSavedKatas(tmpBase)).toEqual([]);
    });

    it('filters out non-json files from the katas directory', () => {
      const dir = join(tmpBase, 'katas');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'readme.txt'), 'not a kata');
      writeFileSync(join(dir, 'valid.json'), JSON.stringify({
        name: 'valid',
        stages: ['build'],
      }));

      const katas = listSavedKatas(tmpBase);
      expect(katas).toHaveLength(1);
      expect(katas[0]!.name).toBe('valid');
    });
  });

  describe('loadSavedKata', () => {
    it('loads a valid saved kata', () => {
      const katasDir = join(tmpBase, 'katas');
      mkdirSync(katasDir, { recursive: true });
      writeFileSync(join(katasDir, 'my-kata.json'), JSON.stringify({
        name: 'my-kata', stages: ['research', 'build'],
      }));

      const result = loadSavedKata(tmpBase, 'my-kata');
      expect(result.stages).toEqual(['research', 'build']);
    });

    it('throws when kata does not exist', () => {
      expect(() => loadSavedKata(tmpBase, 'missing')).toThrow(
        'Kata "missing" not found.',
      );
    });

    it('throws for invalid JSON content with cause', () => {
      const katasDir = join(tmpBase, 'katas');
      mkdirSync(katasDir, { recursive: true });
      writeFileSync(join(katasDir, 'broken.json'), '{ broken }');

      try {
        loadSavedKata(tmpBase, 'broken');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toContain('Kata "broken" has invalid JSON:');
        expect((err as Error).cause).toBeDefined();
      }
    });

    it('throws for valid JSON with invalid schema and includes cause', () => {
      const katasDir = join(tmpBase, 'katas');
      mkdirSync(katasDir, { recursive: true });
      writeFileSync(join(katasDir, 'bad.json'), JSON.stringify({ name: 123 }));

      try {
        loadSavedKata(tmpBase, 'bad');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toContain('Kata "bad" has invalid structure.');
        expect((err as Error).cause).toBeDefined();
      }
    });
  });

  describe('saveSavedKata', () => {
    it('creates the katas directory and writes the file', () => {
      saveSavedKata(tmpBase, 'new-kata', ['build', 'review']);

      const filePath = join(tmpBase, 'katas', 'new-kata.json');
      expect(existsSync(filePath)).toBe(true);
      const data = JSON.parse(readFileSync(filePath, 'utf-8'));
      expect(data.name).toBe('new-kata');
      expect(data.stages).toEqual(['build', 'review']);
    });
  });

  describe('deleteSavedKata', () => {
    it('deletes an existing saved kata', () => {
      saveSavedKata(tmpBase, 'del-kata', ['build']);
      const filePath = join(tmpBase, 'katas', 'del-kata.json');
      expect(existsSync(filePath)).toBe(true);

      deleteSavedKata(tmpBase, 'del-kata');
      expect(existsSync(filePath)).toBe(false);
    });

    it('throws when kata does not exist', () => {
      expect(() => deleteSavedKata(tmpBase, 'nonexistent')).toThrow(
        'Kata "nonexistent" not found.',
      );
    });
  });
});
