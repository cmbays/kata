import { join } from 'node:path';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import type { StageCategory, Stage } from '@domain/types/stage.js';
import type { IFlavorRegistry } from '@domain/ports/flavor-registry.js';
import type { IDecisionRegistry } from '@domain/ports/decision-registry.js';
import type { IStageRuleRegistry } from '@domain/ports/rule-registry.js';
import type {
  IFlavorExecutor,
  OrchestratorContext,
  OrchestratorResult,
} from '@domain/ports/stage-orchestrator.js';
import type { PipelineOrchestrationResult } from '@domain/ports/meta-orchestrator.js';
import { createStageOrchestrator } from '@domain/services/orchestrators/index.js';
import { MetaOrchestrator } from '@domain/services/meta-orchestrator.js';
import { KATA_DIRS } from '@shared/constants/paths.js';
import { logger } from '@shared/lib/logger.js';
import type { UsageAnalytics } from '@infra/tracking/usage-analytics.js';

export interface KiaiRunnerDeps {
  flavorRegistry: IFlavorRegistry;
  decisionRegistry: IDecisionRegistry;
  executor: IFlavorExecutor;
  kataDir: string;
  analytics?: UsageAnalytics;
  /** Optional rule registry passed to the stage orchestrator for rule-driven selection. */
  ruleRegistry?: IStageRuleRegistry;
}

export interface KiaiRunOptions {
  bet?: Record<string, unknown>;
  pin?: string[];
  dryRun?: boolean;
}

export interface ArtifactEntry {
  name: string;
  timestamp: string;
  file: string;
}

/**
 * KiaiRunner — the primary service for executing a Stage orchestration.
 *
 * Bridges the CLI (`kata kiai run <category>`) with the Stage Orchestrator.
 * Builds the OrchestratorContext, constructs the Stage object, invokes
 * the orchestrator, and persists the resulting stage artifact.
 */
export class KiaiRunner {
  constructor(private readonly deps: KiaiRunnerDeps) {}

  /**
   * Run orchestration for a single Stage category.
   *
   * 1. Build OrchestratorContext with available artifacts and learnings
   * 2. Build Stage object with available flavors from FlavorRegistry
   * 3. Create and run the Stage Orchestrator
   * 4. Persist the stage artifact to .kata/artifacts/
   */
  async runStage(
    stageCategory: StageCategory,
    options: KiaiRunOptions = {},
  ): Promise<OrchestratorResult> {
    // Build context
    const context: OrchestratorContext = {
      availableArtifacts: this.scanAvailableArtifacts(),
      bet: options.bet,
      learnings: [],
    };

    // Build Stage object
    const availableFlavors = this.deps.flavorRegistry
      .list(stageCategory)
      .map((f) => f.name);

    const stage: Stage = {
      category: stageCategory,
      orchestrator: {
        type: stageCategory,
        confidenceThreshold: 0.7,
        maxParallelFlavors: 3,
      },
      availableFlavors,
      pinnedFlavors: options.pin,
    };

    // Create orchestrator
    const orchestrator = createStageOrchestrator(
      stageCategory,
      {
        flavorRegistry: this.deps.flavorRegistry,
        decisionRegistry: this.deps.decisionRegistry,
        executor: this.deps.executor,
        ruleRegistry: this.deps.ruleRegistry,
      },
      stage.orchestrator,
    );

    // For dry-run, we still run the orchestrator (which includes selection)
    // since the executor is what actually does real work
    const result = await orchestrator.run(stage, context);

    // Persist stage artifact
    if (!options.dryRun) {
      try {
        this.persistArtifact(stageCategory, result);
      } catch (err) {
        logger.warn('Failed to persist stage artifact — result is still valid.', {
          stageCategory,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Record analytics event (never crash on analytics failure)
    try {
      this.deps.analytics?.recordEvent({
        stageCategory: result.stageCategory,
        selectedFlavors: [...result.selectedFlavors],
        executionMode: result.executionMode,
        decisionConfidences: result.decisions.map((d) => d.confidence),
      });
    } catch {
      // Analytics failures must never crash a successful orchestration
    }

    return result;
  }

  /**
   * Run a multi-stage pipeline via the MetaOrchestrator.
   *
   * Processes stages linearly, passing artifacts between stages.
   * Persists each stage's artifact and records analytics events.
   */
  async runPipeline(
    categories: StageCategory[],
    options: KiaiRunOptions = {},
  ): Promise<PipelineOrchestrationResult> {
    const metaOrchestrator = new MetaOrchestrator({
      flavorRegistry: this.deps.flavorRegistry,
      decisionRegistry: this.deps.decisionRegistry,
      executor: this.deps.executor,
      ruleRegistry: this.deps.ruleRegistry,
    });

    const result = await metaOrchestrator.runPipeline(categories, options.bet);

    // Persist each stage artifact and record analytics
    for (const stageResult of result.stageResults) {
      if (!options.dryRun) {
        try {
          this.persistArtifact(stageResult.stageCategory, stageResult);
        } catch (err) {
          logger.warn('Failed to persist stage artifact — result is still valid.', {
            stageCategory: stageResult.stageCategory,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      try {
        this.deps.analytics?.recordEvent({
          stageCategory: stageResult.stageCategory,
          selectedFlavors: [...stageResult.selectedFlavors],
          executionMode: stageResult.executionMode,
          decisionConfidences: stageResult.decisions.map((d) => d.confidence),
        });
      } catch {
        // Analytics failures must never crash a successful orchestration
      }
    }

    return result;
  }

  /**
   * List recent stage artifacts from .kata/artifacts/.
   */
  listRecentArtifacts(): ArtifactEntry[] {
    return listRecentArtifacts(this.deps.kataDir);
  }

  /**
   * Scan .kata/artifacts/ for existing artifact names.
   */
  private scanAvailableArtifacts(): string[] {
    const artifactsDir = join(this.deps.kataDir, KATA_DIRS.artifacts);
    if (!existsSync(artifactsDir)) return [];

    return readdirSync(artifactsDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace('.json', ''));
  }

  /**
   * Persist the stage artifact to .kata/artifacts/{category}-{timestamp}.json
   */
  private persistArtifact(stageCategory: StageCategory, result: OrchestratorResult): void {
    const artifactsDir = join(this.deps.kataDir, KATA_DIRS.artifacts);
    if (!existsSync(artifactsDir)) {
      mkdirSync(artifactsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${stageCategory}-${timestamp}.json`;
    const filePath = join(artifactsDir, filename);

    const payload = {
      name: result.stageArtifact.name,
      stageCategory,
      selectedFlavors: result.selectedFlavors,
      executionMode: result.executionMode,
      value: result.stageArtifact.value,
      timestamp: new Date().toISOString(),
    };

    writeFileSync(filePath, JSON.stringify(payload, null, 2));
  }
}

/**
 * List recent stage artifacts from .kata/artifacts/.
 * Standalone function usable without full KiaiRunner initialization.
 */
export function listRecentArtifacts(kataDir: string): ArtifactEntry[] {
  const artifactsDir = join(kataDir, KATA_DIRS.artifacts);
  if (!existsSync(artifactsDir)) return [];

  const files = readdirSync(artifactsDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse();

  return files.map((file) => {
    try {
      const raw = readFileSync(join(artifactsDir, file), 'utf-8');
      const data = JSON.parse(raw);
      return {
        name: data.name ?? file.replace('.json', ''),
        timestamp: data.timestamp ?? data.completedAt ?? 'unknown',
        file,
      };
    } catch (err) {
      logger.warn(`Could not parse artifact file "${file}" — showing partial info.`, {
        file,
        error: err instanceof Error ? err.message : String(err),
      });
      return { name: file.replace('.json', ''), timestamp: 'unknown', file };
    }
  });
}
