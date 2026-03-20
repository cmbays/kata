import { join } from 'node:path';
import { existsSync, readdirSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { BridgeRunMetaSchema, type BridgeRunMeta } from '@domain/types/bridge-run.js';
import { isJsonFile } from '@shared/lib/file-filters.js';
import { logger } from '@shared/lib/logger.js';

/**
 * Persist a bridge-run metadata record to .kata/bridge-runs/<runId>.json.
 */
export function writeBridgeRunMeta(bridgeRunsDir: string, meta: BridgeRunMeta): void {
  mkdirSync(bridgeRunsDir, { recursive: true });
  writeFileSync(
    join(bridgeRunsDir, `${meta.runId}.json`),
    JSON.stringify(meta, null, 2) + '\n',
  );
}

/**
 * Read a bridge-run metadata record by runId.
 * Returns null if the file does not exist or fails to parse.
 */
export function readBridgeRunMeta(bridgeRunsDir: string, runId: string): BridgeRunMeta | null {
  const path = join(bridgeRunsDir, `${runId}.json`);
  // Stryker disable next-line ConditionalExpression: guard redundant with catch — readFileSync throws for missing file
  if (!existsSync(path)) return null;
  try {
    return BridgeRunMetaSchema.parse(JSON.parse(readFileSync(path, 'utf-8')));
  } catch (err) {
    logger.warn(`Bridge-run metadata at "${path}" exists but failed to parse — treating as missing.`, {
      runId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * List all bridge-run metadata records for a given cycle.
 * Filters by cycleId and skips non-JSON files and parse failures.
 */
export function listBridgeRunsForCycle(bridgeRunsDir: string, cycleId: string): BridgeRunMeta[] {
  if (!existsSync(bridgeRunsDir)) return [];

  return readdirSync(bridgeRunsDir)
    .filter(isJsonFile)
    .map((f) => {
      try {
        const meta = BridgeRunMetaSchema.parse(JSON.parse(readFileSync(join(bridgeRunsDir, f), 'utf-8')));
        return meta.cycleId === cycleId ? meta : null;
      } catch (err) {
        logger.warn(`Skipping unreadable bridge-run file "${f}" in cycle listing.`, {
          file: f,
          cycleId,
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    })
    .filter((m): m is BridgeRunMeta => m !== null);
}
