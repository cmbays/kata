import type { Command } from 'commander';
import type { ProjectType } from '@features/init/project-detector.js';
import { handleInit } from '@features/init/init-handler.js';
import { withCommandContext } from '@cli/utils.js';

const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  node: 'Node.js / TypeScript',
  rust: 'Rust',
  go: 'Go',
  python: 'Python',
  unknown: 'Generic',
};

/**
 * Register the `kata init` command — the bow that starts your practice.
 */
export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .alias('rei')
    .description('Initialize a new kata project (alias: rei)')
    .option('--methodology <name>', 'Methodology framework (default: shape-up)')
    .option('--adapter <name>', 'Execution adapter: manual, claude-cli, composio')
    .option('--skip-prompts', 'Skip interactive prompts and use defaults')
    .action(withCommandContext(async (ctx) => {
      const localOpts = ctx.cmd.opts();
      const cwd = ctx.globalOpts.cwd ?? process.cwd();

      const result = await handleInit({
        cwd,
        methodology: localOpts.methodology,
        adapter: localOpts.adapter,
        skipPrompts: localOpts.skipPrompts ?? false,
      });

      if (ctx.globalOpts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        const projectLabel = result.config.project.name
          ? `kata initialized for ${result.config.project.name}`
          : 'kata project initialized';

        console.log(`✓ ${projectLabel}`);
        console.log('');
        console.log(`  Stages loaded:    ${result.stagesLoaded}`);
        console.log(`  Templates loaded: ${result.templatesLoaded}`);
        console.log(`  Project type:     ${PROJECT_TYPE_LABELS[result.projectType] ?? result.projectType}`);
        console.log(`  Adapter:          ${result.config.execution.adapter}`);
        console.log('');
        console.log('  What\'s next:');
        console.log('  → Start a pipeline:    kata flow start vertical');
        console.log('  → See all stages:      kata form list');
        console.log('  → See templates:       kata flow start --help');
        console.log('  → Start a new cycle:   kata enbu new "Q1 Sprint"');
        console.log('');
        console.log('  Tip: add these lines to your .gitignore:');
        console.log('    .kata/history/');
        console.log('    .kata/tracking/');
        console.log('');
        console.log('  Docs: https://github.com/cmbays/kata');
      }
    }, { needsKataDir: false }));
}
