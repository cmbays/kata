import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { DojoSession } from '@domain/types/dojo.js';
import { SessionStore } from './session-store.js';

let tempDir: string;
let store: SessionStore;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'kata-session-test-'));
  store = new SessionStore(tempDir);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function makeSession(overrides: Partial<DojoSession> = {}): DojoSession {
  return {
    id: crypto.randomUUID(),
    title: 'Understanding Pipeline Architecture',
    summary: 'A deep dive into how pipelines compose stages.',
    topics: [
      {
        title: 'Stage Composition',
        direction: 'inward',
        description: 'How stages connect through gates and artifacts.',
        priority: 'high',
        tags: ['architecture'],
      },
    ],
    sections: [
      {
        title: 'Introduction',
        type: 'narrative',
        topicTitle: 'Stage Composition',
        content: 'Pipelines are ordered sequences of stages...',
        collapsed: false,
        depth: 0,
      },
    ],
    diaryEntryIds: [],
    runIds: [],
    cycleIds: [],
    sourceIds: [],
    tags: ['architecture', 'pipeline'],
    createdAt: new Date().toISOString(),
    version: 1 as const,
    ...overrides,
  };
}

describe('SessionStore', () => {
  describe('save', () => {
    it('creates a session directory with meta.json and session.html', () => {
      const session = makeSession();
      const html = '<html><body>Session content</body></html>';

      store.save(session, html);

      const sessionDir = join(tempDir, session.id);
      expect(existsSync(join(sessionDir, 'meta.json'))).toBe(true);
      expect(existsSync(join(sessionDir, 'session.html'))).toBe(true);
    });

    it('returns a valid DojoSessionMeta', () => {
      const session = makeSession();
      const meta = store.save(session, '<html></html>');

      expect(meta.id).toBe(session.id);
      expect(meta.title).toBe(session.title);
      expect(meta.summary).toBe(session.summary);
      expect(meta.topicCount).toBe(1);
      expect(meta.sectionCount).toBe(1);
      expect(meta.tags).toEqual(['architecture', 'pipeline']);
      expect(meta.createdAt).toBe(session.createdAt);
    });

    it('writes the HTML content to session.html', () => {
      const session = makeSession();
      const html = '<html><body>Hello Dojo</body></html>';

      store.save(session, html);

      const content = readFileSync(join(tempDir, session.id, 'session.html'), 'utf-8');
      expect(content).toBe(html);
    });

    it('updates the session index', () => {
      const session = makeSession();
      store.save(session, '<html></html>');

      const indexPath = join(tempDir, 'index.json');
      expect(existsSync(indexPath)).toBe(true);

      const raw = JSON.parse(readFileSync(indexPath, 'utf-8'));
      expect(raw.sessions).toHaveLength(1);
      expect(raw.sessions[0].id).toBe(session.id);
    });

    it('updates existing entry in the index on re-save', () => {
      const session = makeSession({ title: 'Original Title' });
      store.save(session, '<html>v1</html>');

      const updated = { ...session, title: 'Updated Title' };
      store.save(updated, '<html>v2</html>');

      const sessions = store.list();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.title).toBe('Updated Title');
    });
  });

  describe('getMeta', () => {
    it('returns meta for a saved session', () => {
      const session = makeSession();
      store.save(session, '<html></html>');

      const meta = store.getMeta(session.id);
      expect(meta).not.toBeNull();
      expect(meta!.id).toBe(session.id);
      expect(meta!.title).toBe(session.title);
    });

    it('returns null for a non-existent session', () => {
      const meta = store.getMeta(crypto.randomUUID());
      expect(meta).toBeNull();
    });
  });

  describe('getHtmlPath', () => {
    it('returns the path to session.html for a saved session', () => {
      const session = makeSession();
      store.save(session, '<html>content</html>');

      const htmlPath = store.getHtmlPath(session.id);
      expect(htmlPath).not.toBeNull();
      expect(htmlPath).toBe(join(tempDir, session.id, 'session.html'));
    });

    it('returns null for a non-existent session', () => {
      const htmlPath = store.getHtmlPath(crypto.randomUUID());
      expect(htmlPath).toBeNull();
    });
  });

  describe('getHtml', () => {
    it('returns the HTML content for a saved session', () => {
      const session = makeSession();
      const html = '<html><body>Full content</body></html>';
      store.save(session, html);

      const result = store.getHtml(session.id);
      expect(result).toBe(html);
    });

    it('returns null for a non-existent session', () => {
      const result = store.getHtml(crypto.randomUUID());
      expect(result).toBeNull();
    });
  });

  describe('list', () => {
    it('returns an empty array when no sessions exist', () => {
      const result = store.list();
      expect(result).toEqual([]);
    });

    it('returns all saved sessions from the index', () => {
      store.save(makeSession(), '<html>1</html>');
      store.save(makeSession(), '<html>2</html>');
      store.save(makeSession(), '<html>3</html>');

      const result = store.list();
      expect(result).toHaveLength(3);
    });
  });

  describe('latest', () => {
    it('returns the most recently saved session from the index', () => {
      const older = makeSession({ createdAt: '2026-01-01T00:00:00.000Z', title: 'Older' });
      const newer = makeSession({ createdAt: '2026-03-01T00:00:00.000Z', title: 'Newer' });

      // Save older first, then newer — updateIndex uses unshift, so
      // the last saved (newer) ends up at index[0]. This also matches
      // rebuildIndex() which sorts by createdAt descending.
      store.save(older, '<html>older</html>');
      store.save(newer, '<html>newer</html>');

      const result = store.latest();
      expect(result).not.toBeNull();
      expect(result!.title).toBe('Newer');
    });

    it('returns null when no sessions exist', () => {
      const result = store.latest();
      expect(result).toBeNull();
    });
  });

  describe('rebuildIndex', () => {
    it('reconstructs index from session directories', () => {
      // Save two sessions
      const session1 = makeSession({ createdAt: '2026-01-15T00:00:00.000Z', title: 'Session A' });
      const session2 = makeSession({ createdAt: '2026-02-15T00:00:00.000Z', title: 'Session B' });
      store.save(session1, '<html>a</html>');
      store.save(session2, '<html>b</html>');

      // Delete the index file to simulate corruption
      const indexPath = join(tempDir, 'index.json');
      rmSync(indexPath);
      expect(existsSync(indexPath)).toBe(false);

      // Rebuild
      const index = store.rebuildIndex();
      expect(index.sessions).toHaveLength(2);
      // Sorted by createdAt descending
      expect(index.sessions[0]!.title).toBe('Session B');
      expect(index.sessions[1]!.title).toBe('Session A');
    });

    it('skips directories without meta.json', () => {
      const session = makeSession();
      store.save(session, '<html></html>');

      // Create a directory without meta.json
      mkdirSync(join(tempDir, 'orphan-dir'), { recursive: true });

      const index = store.rebuildIndex();
      expect(index.sessions).toHaveLength(1);
      expect(index.sessions[0]!.id).toBe(session.id);
    });

    it('skips directories with invalid meta.json', () => {
      const session = makeSession();
      store.save(session, '<html></html>');

      // Create a directory with invalid meta.json
      const badDir = join(tempDir, 'bad-session');
      mkdirSync(badDir, { recursive: true });
      writeFileSync(join(badDir, 'meta.json'), 'invalid json {{{', 'utf-8');

      const index = store.rebuildIndex();
      expect(index.sessions).toHaveLength(1);
    });

    it('returns empty index for non-existent sessions directory', () => {
      const emptyStore = new SessionStore(join(tempDir, 'nonexistent'));
      const index = emptyStore.rebuildIndex();
      expect(index.sessions).toEqual([]);
    });

    it('writes the rebuilt index to disk', () => {
      const session = makeSession();
      store.save(session, '<html></html>');

      // Delete and rebuild
      rmSync(join(tempDir, 'index.json'));
      store.rebuildIndex();

      // The index file should exist again
      const indexPath = join(tempDir, 'index.json');
      expect(existsSync(indexPath)).toBe(true);
    });
  });

  describe('getSession', () => {
    it('returns session data after save (session.json is written by save)', () => {
      const session = makeSession();
      store.save(session, '<html></html>');
      const result = store.getSession(session.id);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(session.id);
      expect(result!.title).toBe(session.title);
    });

    it('creates session.json alongside meta.json and session.html', () => {
      const session = makeSession();
      store.save(session, '<html></html>');
      const sessionDir = join(tempDir, session.id);
      expect(existsSync(join(sessionDir, 'session.json'))).toBe(true);
    });

    it('returns null for a non-existent session', () => {
      const result = store.getSession(crypto.randomUUID());
      expect(result).toBeNull();
    });
  });

  describe('loadIndex corruption recovery', () => {
    it('auto-rebuilds index when corrupt', () => {
      const session = makeSession();
      store.save(session, '<html>ok</html>');
      // Corrupt the index
      writeFileSync(join(tempDir, 'index.json'), '{{{invalid', 'utf-8');
      // list() should recover via rebuildIndex
      const sessions = store.list();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.id).toBe(session.id);
    });
  });
});
