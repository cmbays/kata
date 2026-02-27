import React from 'react';
import { render } from 'ink';
import type { Command } from 'commander';
import { withCommandContext, kataDirPath } from '@cli/utils.js';
import ConfigApp from '@cli/tui/ConfigApp.js';

export function registerConfigCommand(parent: Command): void {
  parent
    .command('config')
    .alias('dojo')
    .description('Interactive methodology editor TUI — steps, flavors, kata patterns (dojo setup)')
    .action(
      withCommandContext(async (ctx) => {
        const stepsDir = kataDirPath(ctx.kataDir, 'stages');
        const flavorsDir = kataDirPath(ctx.kataDir, 'flavors');
        const katasDir = kataDirPath(ctx.kataDir, 'katas');

        const { waitUntilExit } = render(
          React.createElement(ConfigApp, { stepsDir, flavorsDir, katasDir }),
        );

        await waitUntilExit();
      }),
    );
}
