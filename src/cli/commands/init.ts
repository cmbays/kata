import { writeFileSync } from 'node:fs';
import type { Command } from 'commander';
import type { ProjectType } from '@features/init/project-detector.js';
import { handleInit } from '@features/init/init-handler.js';
import { scanProject, type ScanDepth } from '@features/init/scan-handler.js';
import { discoverAndRegisterAgents } from '@features/init/agent-discoverer.js';
import { generateKataMd } from '@features/init/kata-md-generator.js';
import { withCommandContext } from '@cli/utils.js';
import { getLexicon, pl } from '@cli/lexicon.js';
import { logger } from '@shared/lib/logger.js';

const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  node: 'Node.js / TypeScript',
  rust: 'Rust',
  go: 'Go',
  python: 'Python',
  unknown: 'Generic (no framework detected)',
};

type AdapterKey = 'manual' | 'claude-cli' | 'composio';
const ADAPTER_LABELS: Record<AdapterKey, string> = {
  manual: 'Manual — you drive each step and approve gates',
  'claude-cli': 'Claude CLI — stages run autonomously via the claude binary',
  composio: 'Composio — stages dispatched to a remote agent (experimental)',
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
    .option('--discover-agents', 'After init, scan for *.agent.ts / *.kataka.ts files and CLAUDE.md agent declarations, then auto-register discovered kataka')
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

      // --discover-agents: scan for agent-like files and auto-register kataka
      let agentDiscovery: import('@features/init/agent-discoverer.js').AgentDiscoveryResult | undefined;
      if (localOpts.discoverAgents) {
        agentDiscovery = discoverAndRegisterAgents(cwd, result.kataDir);
        // Refresh KATA.md with discovered agents
        if (result.kataMdPath && agentDiscovery.agents.length > 0) {
          try {
            const content = generateKataMd({
              config: result.config,
              kataDir: result.kataDir,
              registeredAgents: agentDiscovery.agents,
            });
            writeFileSync(result.kataMdPath, content, 'utf-8');
          } catch (err) {
            logger.warn(`Failed to refresh KATA.md with discovered agents: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }

      if (ctx.globalOpts.json) {
        console.log(JSON.stringify({ ...result, agentDiscovery }, null, 2));
      } else {
        const projectLabel = result.config.project.name
          ? `kata initialized for ${result.config.project.name}`
          : 'kata project initialized';

        console.log(`✓ ${projectLabel}`);
        console.log('');
        const adapter = result.config.execution.adapter;
        console.log(`  Steps loaded:     ${result.stagesLoaded}`);
        console.log(`  Flavors loaded:   ${result.flavorsLoaded}`);
        console.log(`  Templates loaded: ${result.templatesLoaded}`);
        console.log(`  Project type:     ${PROJECT_TYPE_LABELS[result.projectType] ?? result.projectType}`);
        console.log(`  Adapter:          ${ADAPTER_LABELS[adapter] ?? adapter}`);

        // Adapter-specific notes
        if (adapter === 'claude-cli') {
          if (result.claudeCliDetected === false) {
            console.log('');
            console.log('  ⚠ claude binary not found on PATH.');
            console.log('    Install Claude Code: https://docs.anthropic.com/en/docs/claude-code');
          }
        } else if (adapter === 'composio') {
          if (result.aoConfigFailed) {
            console.log('');
            console.log('  ⚠ AO config could not be written. Run "kata init --adapter composio" again');
            console.log('    or create .kata/ao-config.yaml manually.');
          } else {
            console.log('');
            console.log('  ✓ AO config written to .kata/ao-config.yaml');
          }
        }

        const lex = getLexicon(ctx.globalOpts.plain);
        console.log('');
        console.log('  What\'s next:');
        console.log(`  → Explore steps:       kata ${lex.step} list`);
        console.log(`  → Build your method:   kata config            (interactive editor)`);
        console.log(`  → Start execution:     kata ${lex.execute} build`);
        console.log(`  → Monitor runs:        kata watch             (live TUI dashboard)`);
        console.log(`  → Start a cycle:       kata ${lex.cycle} new`);
        console.log('');
        console.log('  .gitignore — commit your .kata/ config, ignore generated data:');
        console.log('    .kata/history/');
        console.log('    .kata/tracking/');
        console.log('    .kata/artifacts/');
        if (adapter === 'claude-cli') {
          console.log('    .claude/worktrees/');
        }
        console.log('');
        console.log('  Docs: https://github.com/cmbays/kata');

        // Agent discovery summary
        if (agentDiscovery) {
          console.log('');
          console.log(`  Discovered ${agentDiscovery.discovered} potential ${pl(lex.agent, ctx.globalOpts.plain, agentDiscovery.discovered)} — registered ${agentDiscovery.registered}`);
          for (const agent of agentDiscovery.agents) {
            console.log(`    ✓ ${agent.name} (${agent.id})`);
          }
        }
      }
    }, { needsKataDir: false }));
}
