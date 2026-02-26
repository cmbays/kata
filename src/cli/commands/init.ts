import type { Command } from 'commander';
import type { ProjectType } from '@features/init/project-detector.js';
import { handleInit } from '@features/init/init-handler.js';
import { scanProject, type ScanDepth } from '@features/init/scan-handler.js';
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
    .option('--scan <depth>', 'Scan project for metadata without initializing (basic | full). Output is always JSON.')
    .action(withCommandContext(async (ctx) => {
      const localOpts = ctx.cmd.opts();
      const cwd = ctx.globalOpts.cwd ?? process.cwd();

      // --scan mode: collect project data, output JSON, do not init
      if (localOpts.scan) {
        const depth = localOpts.scan as string;
        if (depth !== 'basic' && depth !== 'full') {
          throw new Error(`Invalid scan depth "${depth}". Valid values: basic, full`);
        }
        const scanResult = scanProject(cwd, depth as ScanDepth);
        console.log(JSON.stringify(scanResult, null, 2));
        return;
      }

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
        console.log(`  Steps loaded:     ${result.stagesLoaded}`);
        console.log(`  Flavors loaded:   ${result.flavorsLoaded}`);
        console.log(`  Templates loaded: ${result.templatesLoaded}`);
        console.log(`  Project type:     ${PROJECT_TYPE_LABELS[result.projectType] ?? result.projectType}`);
        console.log(`  Adapter:          ${result.config.execution.adapter}`);

        // Adapter-specific notes
        if (result.config.execution.adapter === 'claude-cli') {
          if (result.claudeCliDetected === false) {
            console.log('');
            console.log('  ⚠ claude binary not found on PATH.');
            console.log('    Install Claude Code before running stages:');
            console.log('    https://docs.anthropic.com/en/docs/claude-code');
          } else {
            console.log('    Stages run in isolated worktrees via: claude -w');
          }
        } else if (result.config.execution.adapter === 'composio') {
          console.log('    [experimental] AO config written to .kata/ao-config.yaml');
          console.log('    See issue #23 for full integration status.');
        }

        console.log('');
        console.log('  What\'s next:');
        console.log('  → See stages:          kata gyo list');
        console.log('  → See steps:           kata waza list');
        console.log('  → Create a step:       kata waza create');
        console.log('  → Start execution:     kata kiai build');
        console.log('  → Start a cycle:       kata keiko new');
        console.log('');
        console.log('  Tip: add these lines to your .gitignore:');
        console.log('    .kata/history/');
        console.log('    .kata/tracking/');
        if (result.config.execution.adapter === 'claude-cli') {
          console.log('    .claude/worktrees/');
        }
        console.log('');
        console.log('  Docs: https://github.com/cmbays/kata');
      }
    }, { needsKataDir: false }));
}
