import type { KataConfig } from '@domain/types/config.js';
import type { IExecutionAdapter } from './execution-adapter.js';

/**
 * Port interface for resolving execution adapters from project configuration.
 * Used by PipelineRunner without depending on the concrete AdapterResolver class.
 *
 * Satisfied by `AdapterResolver` (the class constructor, not an instance) since
 * `AdapterResolver.resolve` is a static method and static methods are properties
 * of the class value itself.
 */
export interface IAdapterResolver {
  resolve(config?: KataConfig): IExecutionAdapter;
}
