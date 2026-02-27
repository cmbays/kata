import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { Command } from 'commander';
import { ConfigNotFoundError } from '@shared/lib/errors.js';
import { KATA_DIRS, type KataDirKey } from '@shared/constants/paths.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { KataConfigSchema } from '@domain/types/config.js';

/**
 * Resolve the .kata/ directory path from a given cwd (or process.cwd()).
 * Throws ConfigNotFoundError if the directory does not exist.
 */
export function resolveKataDir(cwd?: string): string {
  const dir = join(cwd ?? process.cwd(), KATA_DIRS.root);
  if (!existsSync(dir)) {
    throw new ConfigNotFoundError(dir);
  }
  return dir;
}

/**
 * Build an absolute path to a subdirectory within a .kata/ directory.
 */
export function kataDirPath(kataDir: string, subdir: KataDirKey): string {
  return join(kataDir, KATA_DIRS[subdir]);
}

export interface GlobalOptions {
  json: boolean;
  verbose: boolean;
  plain: boolean;
  cwd?: string;
}

export interface CommandContext {
  globalOpts: GlobalOptions;
  kataDir: string;
  cmd: Command;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CommandHandler = (ctx: CommandContext, ...args: any[]) => void | Promise<void>;

/**
 * Extract global CLI options from a Commander command.
 * Respects --plain flag and KATA_PLAIN=1 env var (env var takes effect here;
 * config-file outputMode is merged later in withCommandContext).
 */
export function getGlobalOptions(cmd: Command): GlobalOptions {
  const opts = cmd.optsWithGlobals();
  const plain = !!opts.plain || process.env['KATA_PLAIN'] === '1';
  return { json: !!opts.json, verbose: !!opts.verbose, plain, cwd: opts.cwd };
}

/**
 * Wrap a CLI command handler with standard boilerplate:
 * resolves kataDir, extracts global options, catches errors.
 *
 * Commander's .action() callback receives (...positionalArgs, localOpts, cmd).
 * The wrapper strips the last two, passes cmd via context, and forwards positional args.
 */
export function withCommandContext(
  handler: CommandHandler,
  options?: { needsKataDir?: boolean },
): (...args: unknown[]) => Promise<void> {
  return async (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    const positionalArgs = args.slice(0, -2);
    const globalOpts = getGlobalOptions(cmd);

    try {
      const kataDir = options?.needsKataDir === false
        ? ''
        : resolveKataDir(globalOpts.cwd);

      // Merge outputMode from config when not already forced plain by flag/env.
      // Config is lowest precedence: --plain / KATA_PLAIN=1 always win.
      let plain = globalOpts.plain;
      if (!plain && kataDir) {
        plain = loadConfigOutputMode(kataDir);
      }

      const ctx: CommandContext = { globalOpts: { ...globalOpts, plain }, kataDir, cmd };
      await handler(ctx, ...positionalArgs);
    } catch (error) {
      handleCommandError(error, globalOpts.verbose);
    }
  };
}

/** Read outputMode from .kata/config.json; returns true if 'plain', false otherwise. */
function loadConfigOutputMode(kataDir: string): boolean {
  const configPath = join(kataDir, 'config.json');
  if (!existsSync(configPath)) return false;
  try {
    const config = JsonStore.read(configPath, KataConfigSchema);
    return config.outputMode === 'plain';
  } catch {
    return false;
  }
}

/**
 * Centralized error handler for CLI commands.
 * Prints the error message, and optionally the stack trace if verbose is enabled.
 */
export function handleCommandError(error: unknown, verbose: boolean): void {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  if (verbose && error instanceof Error && error.stack) {
    console.error(error.stack);
  }
  process.exitCode = 1;
}
