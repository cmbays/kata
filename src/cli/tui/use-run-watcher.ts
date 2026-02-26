import { useState, useEffect, useCallback } from 'react';
import { watch as fsWatch } from 'node:fs';
import { listActiveRuns, type WatchRun } from './run-reader.js';
import { logger } from '@shared/lib/logger.js';

export const DEBOUNCE_MS = 500;

/**
 * Creates a file watcher on runsDir that debounces calls to onUpdate.
 * Returns a cleanup function that stops watching and clears any pending timer.
 * Handles non-existent directories gracefully (no-op watcher).
 */
export function createRunWatcher(dir: string, onUpdate: () => void): () => void {
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let watcher: ReturnType<typeof fsWatch> | undefined;

  try {
    watcher = fsWatch(dir, { recursive: true }, () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(onUpdate, DEBOUNCE_MS);
    });
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      logger.warn('kata watch: fs.watch failed, live refresh disabled', { dir, code: code ?? 'unknown' });
    }
    // ENOENT: directory doesn't exist yet — start without watching
  }

  return () => {
    clearTimeout(debounceTimer);
    watcher?.close();
  };
}

/**
 * React hook that reads active runs from runsDir and re-reads on file changes.
 * Optionally filters runs to a specific cycleId.
 */
export function useRunWatcher(
  runsDir: string,
  cycleId?: string,
): { runs: WatchRun[]; refresh: () => void } {
  const [runs, setRuns] = useState<WatchRun[]>(() => listActiveRuns(runsDir, cycleId));

  const refresh = useCallback(() => {
    setRuns(listActiveRuns(runsDir, cycleId));
  }, [runsDir, cycleId]);

  useEffect(() => {
    return createRunWatcher(runsDir, refresh);
  }, [runsDir, refresh]);

  return { runs, refresh };
}
