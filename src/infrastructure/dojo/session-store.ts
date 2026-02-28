import { join } from 'node:path';
import { writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { JsonStore } from '@infra/persistence/json-store.js';
import {
  DojoSessionMetaSchema,
  DojoSessionIndexSchema,
  DojoSessionSchema,
  type DojoSession,
  type DojoSessionMeta,
  type DojoSessionIndex,
} from '@domain/types/dojo.js';
import { logger } from '@shared/lib/logger.js';

export class SessionStore {
  constructor(private readonly sessionsDir: string) {}

  save(session: DojoSession, html: string): DojoSessionMeta {
    const sessionDir = join(this.sessionsDir, session.id);
    JsonStore.ensureDir(sessionDir);

    const meta: DojoSessionMeta = DojoSessionMetaSchema.parse({
      id: session.id,
      title: session.title,
      summary: session.summary,
      topicCount: session.topics.length,
      sectionCount: session.sections.length,
      tags: session.tags,
      createdAt: session.createdAt,
    });

    JsonStore.write(join(sessionDir, 'meta.json'), meta, DojoSessionMetaSchema);
    JsonStore.write(join(sessionDir, 'session.json'), session, DojoSessionSchema);
    const htmlPath = join(sessionDir, 'session.html');
    try {
      writeFileSync(htmlPath, html, 'utf-8');
    } catch (err) {
      throw new Error(`Failed to write session HTML to ${htmlPath}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }

    this.updateIndex(meta);
    return meta;
  }

  getMeta(id: string): DojoSessionMeta | null {
    const metaPath = join(this.sessionsDir, id, 'meta.json');
    if (!JsonStore.exists(metaPath)) return null;
    return JsonStore.read(metaPath, DojoSessionMetaSchema);
  }

  getSession(id: string): DojoSession | null {
    // Sessions are stored as full JSON files for non-HTML consumption
    // But the plan stores HTML + meta. We can reconstruct from meta if needed.
    // For now, we store the full session alongside meta.
    const sessionPath = join(this.sessionsDir, id, 'session.json');
    if (!JsonStore.exists(sessionPath)) return null;
    return JsonStore.read(sessionPath, DojoSessionSchema);
  }

  getHtmlPath(id: string): string | null {
    const htmlPath = join(this.sessionsDir, id, 'session.html');
    if (!existsSync(htmlPath)) return null;
    return htmlPath;
  }

  getHtml(id: string): string | null {
    const htmlPath = this.getHtmlPath(id);
    if (!htmlPath) return null;
    return readFileSync(htmlPath, 'utf-8');
  }

  list(): DojoSessionMeta[] {
    const index = this.loadIndex();
    return index.sessions;
  }

  latest(): DojoSessionMeta | null {
    const sessions = this.list();
    return sessions.length > 0 ? sessions[0]! : null;
  }

  rebuildIndex(): DojoSessionIndex {
    if (!existsSync(this.sessionsDir)) {
      return { sessions: [], updatedAt: new Date().toISOString() };
    }

    const sessions: DojoSessionMeta[] = [];
    const dirs = readdirSync(this.sessionsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    for (const dir of dirs) {
      const metaPath = join(this.sessionsDir, dir.name, 'meta.json');
      if (!JsonStore.exists(metaPath)) continue;
      try {
        const meta = JsonStore.read(metaPath, DojoSessionMetaSchema);
        sessions.push(meta);
      } catch (err) {
        logger.warn(`Skipping session "${dir.name}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const index: DojoSessionIndex = {
      sessions,
      updatedAt: new Date().toISOString(),
    };

    JsonStore.write(join(this.sessionsDir, 'index.json'), index, DojoSessionIndexSchema);
    return index;
  }

  private loadIndex(): DojoSessionIndex {
    const indexPath = join(this.sessionsDir, 'index.json');
    if (!JsonStore.exists(indexPath)) {
      return { sessions: [], updatedAt: new Date().toISOString() };
    }
    try {
      return JsonStore.read(indexPath, DojoSessionIndexSchema);
    } catch (err) {
      logger.warn(`Corrupt session index, rebuilding: ${err instanceof Error ? err.message : String(err)}`);
      return this.rebuildIndex();
    }
  }

  private updateIndex(meta: DojoSessionMeta): void {
    const index = this.loadIndex();
    const existing = index.sessions.findIndex((s) => s.id === meta.id);
    if (existing >= 0) {
      index.sessions[existing] = meta;
    } else {
      index.sessions.unshift(meta);
    }
    index.updatedAt = new Date().toISOString();
    JsonStore.write(join(this.sessionsDir, 'index.json'), index, DojoSessionIndexSchema);
  }
}
