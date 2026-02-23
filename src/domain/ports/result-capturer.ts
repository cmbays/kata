import type { ExecutionHistoryEntry } from '@domain/types/history.js';
import type { ExecutionResult } from '@domain/types/manifest.js';

/**
 * Options for capturing an execution result as a history entry.
 * Defined here so both the port interface and its implementation can reference
 * this type without a cross-layer import.
 */
export interface CaptureOptions {
  pipelineId: string;
  stageType: string;
  stageFlavor?: string;
  stageIndex: number;
  adapterName: string;
  result: ExecutionResult;
  cycleId?: string;
  betId?: string;
}

/**
 * Port interface for capturing execution results to history.
 * Used by PipelineRunner to record stage outcomes without depending on
 * the concrete ResultCapturer infrastructure class.
 */
export interface IResultCapturer {
  capture(options: CaptureOptions): ExecutionHistoryEntry;
}
