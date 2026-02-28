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

      const id = sessionId ?? store.latest()?.id;
      if (!id) {
        console.log('No dojo sessions found. Generate one first with "kata dojo generate".');
        return;
      }

      const htmlPath = store.getHtmlPath(id);
      if (!htmlPath) {
        console.error(`Session "${id}" not found.`);
        return;
      }

      const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
      execFileSync(cmd, [htmlPath]);
      console.log(`Opened session ${id.slice(0, 8)} in browser.`);
    }));

  // kata dojo inspect <session-id>
  dojo
    .command('inspect')
    .description('Show session details in the terminal')
    .argument('<session-id>', 'Session ID')
    .action(withCommandContext((ctx, sessionId: string) => {
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
    .option('-n, --count <count>', 'Number of entries to show', parseInt)
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
      const localOpts = ctx.cmd.opts();
      const diaryDir = join(kataDirPath(ctx.kataDir, 'dojo'), 'diary');
      const store = new DiaryStore(diaryDir);

      if (localOpts.jsonStdin) {
        const raw = readFileSync(0, 'utf-8');
        const entry = DojoDiaryEntrySchema.parse(JSON.parse(raw));
        store.write(entry);
        console.log(`Diary entry written for cycle ${entry.cycleId.slice(0, 8)}.`);
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
        console.log(formatDojoSourceTable(sources));
      }
    }));

  // kata dojo generate
  dojo
    .command('generate')
    .description('Generate a new training session from recent data')
    .option('--title <title>', 'Custom session title')
    .option('--cycles <count>', 'Number of recent cycles to include', parseInt)
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
