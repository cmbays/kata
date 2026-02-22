import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RefResolver, RefResolutionError } from './ref-resolver.js';

describe('RefResolver', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ref-resolver-test-'));
  });

  describe('resolveRef', () => {
    it('should resolve a file reference and return its contents', () => {
      const content = '# Research Prompt\n\nDo research things.';
      writeFileSync(join(tempDir, 'research.md'), content);

      const result = RefResolver.resolveRef('research.md', tempDir);
      expect(result).toBe(content);
    });

    it('should resolve relative paths with subdirectories', () => {
      mkdirSync(join(tempDir, 'prompts'), { recursive: true });
      const content = '# Shape Prompt\n\nShape the work.';
      writeFileSync(join(tempDir, 'prompts', 'shape.md'), content);

      const result = RefResolver.resolveRef('prompts/shape.md', tempDir);
      expect(result).toBe(content);
    });

    it('should resolve parent directory references', () => {
      mkdirSync(join(tempDir, 'builtin'), { recursive: true });
      mkdirSync(join(tempDir, 'prompts'), { recursive: true });
      const content = '# Build Prompt';
      writeFileSync(join(tempDir, 'prompts', 'build.md'), content);

      const result = RefResolver.resolveRef('../prompts/build.md', join(tempDir, 'builtin'));
      expect(result).toBe(content);
    });

    it('should throw RefResolutionError for missing files', () => {
      expect(() => {
        RefResolver.resolveRef('nonexistent.md', tempDir);
      }).toThrow(RefResolutionError);
    });

    it('should include ref and resolved path in error', () => {
      try {
        RefResolver.resolveRef('missing.md', tempDir);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RefResolutionError);
        const refErr = err as RefResolutionError;
        expect(refErr.ref).toBe('missing.md');
        expect(refErr.resolvedPath).toContain('missing.md');
      }
    });

    it('should handle empty files', () => {
      writeFileSync(join(tempDir, 'empty.md'), '');
      const result = RefResolver.resolveRef('empty.md', tempDir);
      expect(result).toBe('');
    });

    it('should preserve file content exactly (no trimming)', () => {
      const content = '  \n  leading whitespace\n  trailing whitespace  \n  ';
      writeFileSync(join(tempDir, 'whitespace.md'), content);

      const result = RefResolver.resolveRef('whitespace.md', tempDir);
      expect(result).toBe(content);
    });
  });
});
