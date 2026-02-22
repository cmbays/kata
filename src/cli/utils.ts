import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { ConfigNotFoundError } from '@shared/lib/errors.js';

/**
 * Resolve the .kata/ directory path from a given cwd (or process.cwd()).
 * Throws ConfigNotFoundError if the directory does not exist.
 */
export function resolveKataDir(cwd?: string): string {
  const dir = join(cwd ?? process.cwd(), '.kata');
  if (!existsSync(dir)) {
    throw new ConfigNotFoundError(dir);
  }
  return dir;
}

/**
 * Extract global CLI options from a Commander command.
 */
export function getGlobalOptions(cmd: import('commander').Command): { json: boolean; verbose: boolean; cwd?: string } {
  const opts = cmd.optsWithGlobals();
  return { json: !!opts.json, verbose: !!opts.verbose, cwd: opts.cwd };
}
