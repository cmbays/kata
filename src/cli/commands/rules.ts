import type { Command } from 'commander';
import { RuleRegistry } from '@infra/registries/rule-registry.js';
import { withCommandContext, kataDirPath } from '@cli/utils.js';

/**
 * Register the `kata rule` subcommands.
 *
 * Provides programmatic (LLM-friendly) rule suggestion review without requiring
 * a full interactive cooldown session.
 */
export function registerRuleCommands(parent: Command): void {
  const rule = parent
    .command('rule')
    .alias('okite')
    .description('Manage rule suggestions — accept or reject pending suggestions (alias: okite)');

  // kata rule accept <id>
  rule
    .command('accept <id>')
    .description('Accept a pending rule suggestion, promoting it to an active rule')
    .action(withCommandContext((ctx, id: string) => {
      const ruleRegistry = new RuleRegistry(kataDirPath(ctx.kataDir, 'rules'));
      const acceptedRule = ruleRegistry.acceptSuggestion(id);

      if (ctx.globalOpts.json) {
        console.log(JSON.stringify({ id, decision: 'accepted', rule: acceptedRule }, null, 2));
      } else {
        console.log(`Accepted rule: [${acceptedRule.effect}] ${acceptedRule.name} — ${acceptedRule.condition}`);
      }
    }));

  // kata rule reject <id> --reason <reason>
  rule
    .command('reject <id>')
    .description('Reject a pending rule suggestion with a reason')
    .requiredOption('-r, --reason <reason>', 'Reason for rejection')
    .action(withCommandContext((ctx, id: string) => {
      const localOpts = ctx.cmd.opts();
      const ruleRegistry = new RuleRegistry(kataDirPath(ctx.kataDir, 'rules'));
      ruleRegistry.rejectSuggestion(id, localOpts.reason as string);

      if (ctx.globalOpts.json) {
        console.log(JSON.stringify({ id, decision: 'rejected' }, null, 2));
      } else {
        console.log(`Rejected suggestion ${id}`);
      }
    }));
}
