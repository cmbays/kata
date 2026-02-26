import React from 'react';
import { render } from 'ink';
import type { Command } from 'commander';
import { withCommandContext, kataDirPath } from '@cli/utils.js';
import WatchApp from '@cli/tui/WatchApp.js';

export function registerWatchCommand(parent: Command): void {
  parent
    .command('watch')
    .alias('kanshi')
    .description('Watch active kata runs in real time (TUI)')
    .option('--cycle <id>', 'Filter to runs matching this cycle ID')
    .action(
      withCommandContext(async (ctx) => {
        const localOpts = ctx.cmd.opts();
        const runsDir = kataDirPath(ctx.kataDir, 'runs');

        const { waitUntilExit } = render(
          React.createElement(WatchApp, {
            runsDir,
            cycleId: localOpts['cycle'] as string | undefined,
          }),
        );

        await waitUntilExit();
      }),
    );
}
