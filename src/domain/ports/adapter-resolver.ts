import type { KataConfig } from '@domain/types/config.js';
import type { IExecutionAdapter } from './execution-adapter.js';

/**
 * Port interface for resolving execution adapters from project configuration.
 * Used by PipelineRunner without depending on the concrete AdapterResolver class.
 */
export interface IAdapterResolver {
  resolve(config?: KataConfig): IExecutionAdapter;
}
