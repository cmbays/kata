import type { TokenUsage } from '@domain/types/history.js';

/**
 * Port interface for recording token usage.
 * Used by PipelineRunner without depending on the concrete TokenTracker class.
 */
export interface ITokenTracker {
  recordUsage(stageId: string, tokenUsage: TokenUsage): void;
}
