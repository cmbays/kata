import type { Command } from 'commander';
import { withCommandContext } from '@cli/utils.js';

interface LexiconEntry {
  domain: string;
  cli: string;
  alias: string;
  description: string;
}

const LEXICON_TABLE: LexiconEntry[] = [
  { domain: 'Stage (gyo)', cli: 'kata stage', alias: 'kata gyo', description: '4 categories: research, plan, build, review' },
  { domain: 'Step (waza)', cli: 'kata step', alias: 'kata waza', description: 'Atomic methodology units' },
  { domain: 'Flavor (ryu)', cli: 'kata flavor', alias: 'kata ryu', description: 'Named compositions of steps' },
  { domain: 'Cycle (keiko)', cli: 'kata cycle', alias: 'kata keiko', description: 'Time-boxed work periods' },
  { domain: 'Agent (kataka)', cli: 'kata agent', alias: 'kata kataka', description: 'Named agent persona' },
  { domain: 'Init', cli: 'kata init', alias: 'kata rei', description: 'Initialize a project' },
  { domain: 'Execute', cli: 'kata execute', alias: 'kata kiai', description: 'Run stage orchestration' },
  { domain: 'Knowledge', cli: 'kata knowledge', alias: 'kata bunkai', description: 'Manage extracted patterns' },
  { domain: 'Observe', cli: 'kata observe', alias: 'kata kansatsu', description: 'Record observations' },
  { domain: 'Cooldown', cli: 'kata cooldown', alias: 'kata ma', description: 'Reflection on completed cycle' },
  { domain: 'Decision', cli: 'kata decision', alias: 'kata kime', description: 'Record/review decisions' },
  { domain: 'Artifact', cli: 'kata artifact', alias: 'kata maki', description: 'Record named outputs' },
  { domain: 'Approve', cli: 'kata approve', alias: 'kata hai', description: 'Gate approval' },
  { domain: 'Rule', cli: 'kata rule', alias: 'kata okite', description: 'Accept/reject stage rules' },
  { domain: 'Watch', cli: 'kata watch', alias: 'kata kanshi', description: 'Live execution TUI' },
  { domain: 'Config', cli: 'kata config', alias: 'kata seido', description: 'Interactive methodology editor' },
  { domain: 'Dojo', cli: 'kata dojo', alias: '—', description: 'Personal training environment' },
  { domain: 'Lexicon', cli: 'kata lexicon', alias: 'kata kotoba', description: 'Show this vocabulary table' },
];

/**
 * Register the `kata lexicon` command (alias: kata kotoba).
 * Renders the domain → CLI → alias → description vocabulary table.
 */
export function registerLexiconCommand(program: Command): void {
  program
    .command('lexicon')
    .alias('kotoba')
    .description('Show the kata vocabulary table — domain terms, CLI commands, and Japanese aliases (alias: kotoba)')
    .action(withCommandContext((ctx) => {
      if (ctx.globalOpts.json) {
        console.log(JSON.stringify(LEXICON_TABLE, null, 2));
        return;
      }

      const header = ctx.globalOpts.plain
        ? 'Kata Vocabulary'
        : 'Kata Vocabulary (kotoba)';
      console.log(header);
      console.log('');

      const colWidths = {
        domain: Math.max(6, ...LEXICON_TABLE.map((e) => e.domain.length)),
        cli: Math.max(11, ...LEXICON_TABLE.map((e) => e.cli.length)),
        alias: Math.max(5, ...LEXICON_TABLE.map((e) => e.alias.length)),
      };

      const row = (d: string, c: string, a: string, desc: string): string =>
        `  ${d.padEnd(colWidths.domain)}  ${c.padEnd(colWidths.cli)}  ${a.padEnd(colWidths.alias)}  ${desc}`;

      const sep = (w: number): string => '-'.repeat(w);

      console.log(row('Domain', 'CLI Command', 'Alias', 'Description'));
      console.log(row(sep(colWidths.domain), sep(colWidths.cli), sep(colWidths.alias), sep(30)));

      for (const entry of LEXICON_TABLE) {
        console.log(row(entry.domain, entry.cli, entry.alias, entry.description));
      }
    }, { needsKataDir: false }));
}
