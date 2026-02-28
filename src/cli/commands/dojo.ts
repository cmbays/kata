import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import { withCommandContext, kataDirPath } from '@cli/utils.js';
import { DiaryStore } from '@infra/dojo/diary-store.js';
import { SessionStore } from '@infra/dojo/session-store.js';
import { SourceRegistry } from '@infra/dojo/source-registry.js';
import { DojoDiaryEntrySchema } from '@domain/types/dojo.js';
import { DataAggregator } from '@features/dojo/data-aggregator.js';
import { SessionBuilder } from '@features/dojo/session-builder.js';
import { DiaryWriter } from '@features/dojo/diary-writer.js';
import { CycleManager } from '@domain/services/cycle-manager.js';
import { KnowledgeStore } from '@infra/knowledge/knowledge-store.js';
import { JsonStore } from '@infra/persistence/json-store.js';
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

/** Validate that a string is a valid UUID v4. Prevents path traversal via CLI ID arguments. */
export function validateSessionId(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error(`Invalid session ID "${id}". Expected a UUID.`);
  }
  return id;
}

/** Parse a CLI option value as a positive integer. Throws on non-digit strings or non-positive values. */
export function parsePositiveInt(value: string): number {
  if (!/^\d+$/.test(value.trim())) {
    throw new Error(`Expected a positive integer, got "${value}".`);
  }
  const n = Number(value.trim());
  if (n < 1) {
    throw new Error(`Expected a positive integer, got "${value}".`);
  }
  return n;
}

export function registerDojoCommand(parent: Command): void {
  const dojo = parent
    .command('dojo')
    .description('Personal training environment — session archive, diary, and sources');

  // kata dojo list
  dojo
    .command('list')
    .description('List past dojo sessions')
    .action(withCommandContext((ctx) => {
      const sessionsDir = join(kataDirPath(ctx.kataDir, 'dojo'), 'sessions');
      const store = new SessionStore(sessionsDir);
      const sessions = store.list();

      if (ctx.globalOpts.json) {
        console.log(formatDojoSessionTableJson(sessions));
      } else {
        console.log(formatDojoSessionTable(sessions, ctx.globalOpts.plain));
      }
    }));

  // kata dojo open [session-id]
  dojo
    .command('open')
    .description('Open a dojo session in the browser (latest if omitted)')
    .argument('[session-id]', 'Session ID')
    .action(withCommandContext((ctx, sessionId?: string) => {
      const sessionsDir = join(kataDirPath(ctx.kataDir, 'dojo'), 'sessions');
      const store = new SessionStore(sessionsDir);

      const id = sessionId ? validateSessionId(sessionId) : store.latest()?.id;
      if (!id) {
        console.log('No dojo sessions found. Generate one first with "kata dojo generate".');
        return;
      }

      const htmlPath = store.getHtmlPath(id);
      if (!htmlPath) {
        console.error(`Session "${id}" not found.`);
        return;
      }

      try {
        let cmd: string;
        let args: string[];
        if (process.platform === 'darwin') {
          cmd = 'open';
          args = [htmlPath];
        } else if (process.platform === 'win32') {
          cmd = 'cmd';
          args = ['/c', 'start', '', htmlPath];
        } else {
          cmd = 'xdg-open';
          args = [htmlPath];
        }
        execFileSync(cmd, args);
        console.log(`Opened session ${id.slice(0, 8)} in browser.`);
      } catch {
        console.log(`Could not open browser. Open manually: ${htmlPath}`);
      }
    }));

  // kata dojo inspect <session-id>
  dojo
    .command('inspect')
    .description('Show session details in the terminal')
    .argument('<session-id>', 'Session ID')
    .action(withCommandContext((ctx, sessionId: string) => {
      validateSessionId(sessionId);
      const sessionsDir = join(kataDirPath(ctx.kataDir, 'dojo'), 'sessions');
      const store = new SessionStore(sessionsDir);
      const meta = store.getMeta(sessionId);

      if (!meta) {
        console.error(`Session "${sessionId}" not found.`);
        return;
      }

      if (ctx.globalOpts.json) {
        console.log(formatDojoSessionDetailJson(meta));
      } else {
        console.log(formatDojoSessionDetail(meta, ctx.globalOpts.plain));
      }
    }));

  // kata dojo diary [-n count]
  dojo
    .command('diary')
    .description('List recent diary entries')
    .option('-n, --count <count>', 'Number of entries to show', parsePositiveInt)
    .action(withCommandContext((ctx) => {
      const localOpts = ctx.cmd.opts();
      const diaryDir = join(kataDirPath(ctx.kataDir, 'dojo'), 'diary');
      const store = new DiaryStore(diaryDir);
      const count = localOpts.count ?? 10;
      const entries = store.recent(count);

      if (ctx.globalOpts.json) {
        console.log(formatDojoDiaryTableJson(entries));
      } else {
        console.log(formatDojoDiaryTable(entries, ctx.globalOpts.plain));
      }
    }));

  // kata dojo diary-write <cycle-id>
  dojo
    .command('diary-write')
    .description('Write a diary entry for a cycle')
    .argument('<cycle-id>', 'Cycle ID')
    .option('--narrative <text>', 'Rich LLM-generated narrative')
    .option('--json-stdin', 'Accept full DojoDiaryEntry as JSON from stdin')
    .action(withCommandContext((ctx, cycleId: string) => {
      validateSessionId(cycleId);
      const localOpts = ctx.cmd.opts();
      const diaryDir = join(kataDirPath(ctx.kataDir, 'dojo'), 'diary');
      const store = new DiaryStore(diaryDir);

      if (localOpts.jsonStdin) {
        try {
          const raw = readFileSync(0, 'utf-8');
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw);
          } catch {
            console.error('Invalid JSON input from stdin.');
            process.exitCode = 1;
            return;
          }
          const entry = DojoDiaryEntrySchema.parse(parsed);
          store.write(entry);
          console.log(`Diary entry written for cycle ${entry.cycleId.slice(0, 8)}.`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Invalid diary entry format: ${msg}`);
          process.exitCode = 1;
        }
        return;
      }

      const writer = new DiaryWriter(store);
      writer.write({
        cycleId,
        narrative: localOpts.narrative,
        betOutcomes: [],
        proposals: [],
        learningsCaptured: 0,
      });
      console.log(`Diary entry written for cycle ${cycleId.slice(0, 8)}.`);
    }));

  // kata dojo sources
  dojo
    .command('sources')
    .description('Show curated source registry')
    .action(withCommandContext((ctx) => {
      const sourcesPath = join(kataDirPath(ctx.kataDir, 'dojo'), 'sources.json');
      const registry = new SourceRegistry(sourcesPath);
      const sources = registry.list();

      if (ctx.globalOpts.json) {
        console.log(formatDojoSourceTableJson(sources));
      } else {
        console.log(formatDojoSourceTable(sources, ctx.globalOpts.plain));
      }
    }));

  // kata dojo generate
  dojo
    .command('generate')
    .description('Generate a new training session from recent data')
    .option('--title <title>', 'Custom session title')
    .option('--cycles <count>', 'Number of recent cycles to include', parsePositiveInt)
    .action(withCommandContext((ctx) => {
      const localOpts = ctx.cmd.opts();
      const dojoDir = kataDirPath(ctx.kataDir, 'dojo');
      const sessionsDir = join(dojoDir, 'sessions');
      const diaryDir = join(dojoDir, 'diary');

      const aggregator = new DataAggregator({
        knowledgeStore: new KnowledgeStore(kataDirPath(ctx.kataDir, 'knowledge')),
        diaryStore: new DiaryStore(diaryDir),
        cycleManager: new CycleManager(kataDirPath(ctx.kataDir, 'cycles'), JsonStore),
        runsDir: kataDirPath(ctx.kataDir, 'runs'),
      });

      const data = aggregator.gather({
        maxDiaries: localOpts.cycles ?? 5,
      });

      const builder = new SessionBuilder({
        sessionStore: new SessionStore(sessionsDir),
      });

      const { meta, htmlPath } = builder.build(data, {
        title: localOpts.title,
      });

      if (ctx.globalOpts.json) {
        console.log(JSON.stringify({ meta, htmlPath }, null, 2));
      } else {
        console.log(`Session generated: ${meta.title}`);
        console.log(`  ID:       ${meta.id.slice(0, 8)}`);
        console.log(`  Topics:   ${meta.topicCount}`);
        console.log(`  Sections: ${meta.sectionCount}`);
        console.log(`  Path:     ${htmlPath}`);
        console.log('');
        console.log('Open with: kata dojo open');
      }
    }));
}
