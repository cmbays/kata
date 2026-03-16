import { isJsonFile } from './file-filters.js';

describe('file-filters', () => {
  describe('isJsonFile', () => {
    it('returns true for .json files', () => {
      expect(isJsonFile('data.json')).toBe(true);
      expect(isJsonFile('pending-abc.json')).toBe(true);
    });

    it('returns false for non-.json files', () => {
      expect(isJsonFile('readme.md')).toBe(false);
      expect(isJsonFile('json')).toBe(false);
      expect(isJsonFile('')).toBe(false);
      expect(isJsonFile('.DS_Store')).toBe(false);
    });
  });
});
