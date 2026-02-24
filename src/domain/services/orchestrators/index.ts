import type { StageCategory, OrchestratorConfig } from '@domain/types/stage.js';
import type { Flavor } from '@domain/types/flavor.js';
import type { OrchestratorContext, FlavorExecutionResult } from '@domain/ports/stage-orchestrator.js';
import type { IStageOrchestrator } from '@domain/ports/stage-orchestrator.js';
import { OrchestratorError } from '@shared/lib/errors.js';
import {
  BaseStageOrchestrator,
  type SynthesisStrategy,
  type StageOrchestratorDeps,
} from '../stage-orchestrator.js';

// ---------------------------------------------------------------------------
// Shared scoring helpers
// ---------------------------------------------------------------------------

/**
 * Extract a lowercase string from a bet field for keyword matching.
 */
function betText(context: OrchestratorContext): string {
  const { bet } = context;
  if (!bet) return '';
  const parts: string[] = [];
  if (typeof bet.title === 'string') parts.push(bet.title);
  if (typeof bet.description === 'string') parts.push(bet.description);
  if (Array.isArray(bet.tags)) {
    for (const tag of bet.tags) {
      if (typeof tag === 'string') parts.push(tag);
    }
  }
  return parts.join(' ').toLowerCase();
}

/**
 * Score a Flavor by how many of the given keywords appear in its name or
 * the bet context. Returns a value in [0, 1].
 */
function keywordScore(
  flavor: Flavor,
  context: OrchestratorContext,
  keywords: string[],
): number {
  const text = betText(context);
  const flavorName = flavor.name.toLowerCase();
  const description = (flavor.description ?? '').toLowerCase();

  let hits = 0;
  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    if (flavorName.includes(kwLower) || description.includes(kwLower) || text.includes(kwLower)) {
      hits++;
    }
  }

  return keywords.length > 0 ? Math.min(1, hits / keywords.length) : 0.5;
}

/**
 * Boost score for learnings that mention a flavor by name.
 */
function learningBoost(flavor: Flavor, context: OrchestratorContext): number {
  const learnings = context.learnings ?? [];
  const flavorName = flavor.name.toLowerCase();
  const boost = learnings.some((l) => l.toLowerCase().includes(flavorName)) ? 0.1 : 0;
  return boost;
}

// ---------------------------------------------------------------------------
// Standard synthesis strategy (used by all 5 categories)
// ---------------------------------------------------------------------------

function standardSynthesis(results: FlavorExecutionResult[]): SynthesisStrategy {
  return {
    approach: 'merge-all',
    alternatives: ['merge-all', 'first-wins', 'cascade'],
    reasoning: `Merging all ${results.length} flavor synthesis artifact(s) into a single keyed record for downstream stage consumption.`,
  };
}

// ---------------------------------------------------------------------------
// Concrete orchestrators per StageCategory
// ---------------------------------------------------------------------------

/**
 * Research orchestrator.
 * Favors flavors that emphasize exploration, discovery, and broad investigation.
 */
class ResearchOrchestrator extends BaseStageOrchestrator {
  private static readonly KEYWORDS = [
    'explore', 'investigate', 'discover', 'survey', 'analysis',
    'competitive', 'domain', 'technical', 'feasibility', 'breadth',
  ];

  protected scoreFlavorForContext(flavor: Flavor, context: OrchestratorContext): number {
    const base = keywordScore(flavor, context, ResearchOrchestrator.KEYWORDS);
    const hasArtifacts = context.availableArtifacts.length > 0 ? 0.05 : 0;
    const boost = learningBoost(flavor, context);
    return Math.min(1, base + hasArtifacts + boost);
  }

  protected getSynthesisStrategy(
    results: FlavorExecutionResult[],
    _context: OrchestratorContext,
  ): SynthesisStrategy {
    return standardSynthesis(results);
  }
}

/**
 * Plan orchestrator.
 * Favors flavors that produce structured plans, designs, and specifications.
 */
class PlanOrchestrator extends BaseStageOrchestrator {
  private static readonly KEYWORDS = [
    'shape', 'design', 'plan', 'roadmap', 'architecture', 'spec',
    'breadboard', 'wireframe', 'decompose', 'structure',
  ];

  protected scoreFlavorForContext(flavor: Flavor, context: OrchestratorContext): number {
    const base = keywordScore(flavor, context, PlanOrchestrator.KEYWORDS);
    // Boost if research artifacts are available (plan benefits from prior research)
    const hasResearch = context.availableArtifacts.some((a) =>
      a.includes('research') || a.includes('summary'),
    )
      ? 0.1
      : 0;
    const boost = learningBoost(flavor, context);
    return Math.min(1, base + hasResearch + boost);
  }

  protected getSynthesisStrategy(
    results: FlavorExecutionResult[],
    _context: OrchestratorContext,
  ): SynthesisStrategy {
    return standardSynthesis(results);
  }
}

/**
 * Build orchestrator.
 * Favors flavors aligned with the implementation language or framework evident in the bet context.
 */
class BuildOrchestrator extends BaseStageOrchestrator {
  private static readonly KEYWORDS = [
    'typescript', 'javascript', 'python', 'rust', 'go', 'build',
    'implement', 'feature', 'bugfix', 'refactor', 'tdd', 'test',
  ];

  protected scoreFlavorForContext(flavor: Flavor, context: OrchestratorContext): number {
    const base = keywordScore(flavor, context, BuildOrchestrator.KEYWORDS);
    const boost = learningBoost(flavor, context);
    return Math.min(1, base + boost);
  }

  protected getSynthesisStrategy(
    results: FlavorExecutionResult[],
    _context: OrchestratorContext,
  ): SynthesisStrategy {
    return standardSynthesis(results);
  }
}

/**
 * Review orchestrator.
 * Favors flavors that check quality, security, or architectural soundness.
 */
class ReviewOrchestrator extends BaseStageOrchestrator {
  private static readonly KEYWORDS = [
    'security', 'api', 'frontend', 'architecture', 'performance',
    'quality', 'audit', 'accessibility', 'compliance', 'review',
  ];

  protected scoreFlavorForContext(flavor: Flavor, context: OrchestratorContext): number {
    const base = keywordScore(flavor, context, ReviewOrchestrator.KEYWORDS);
    // Boost if build artifacts available (review follows build)
    const hasBuildOutput = context.availableArtifacts.some((a) =>
      a.includes('build') || a.includes('implementation'),
    )
      ? 0.1
      : 0;
    const boost = learningBoost(flavor, context);
    return Math.min(1, base + hasBuildOutput + boost);
  }

  protected getSynthesisStrategy(
    results: FlavorExecutionResult[],
    _context: OrchestratorContext,
  ): SynthesisStrategy {
    // Review uses cascade: each reviewer sees prior findings
    return {
      approach: 'cascade',
      alternatives: ['merge-all', 'first-wins', 'cascade'],
      reasoning: `Using cascade synthesis for ${results.length} review flavor(s) so that later reviewers can reference earlier findings.`,
    };
  }
}

/**
 * Wrap-up orchestrator.
 * Favors flavors that document, index, and capture learnings from completed work.
 */
class WrapupOrchestrator extends BaseStageOrchestrator {
  private static readonly KEYWORDS = [
    'document', 'wrap', 'summary', 'learning', 'index', 'archive',
    'changelog', 'cleanup', 'retrospective', 'capture',
  ];

  protected scoreFlavorForContext(flavor: Flavor, context: OrchestratorContext): number {
    const base = keywordScore(flavor, context, WrapupOrchestrator.KEYWORDS);
    // Boost when many artifacts available (more to document)
    const artifactBoost = Math.min(0.2, context.availableArtifacts.length * 0.02);
    const boost = learningBoost(flavor, context);
    return Math.min(1, base + artifactBoost + boost);
  }

  protected getSynthesisStrategy(
    results: FlavorExecutionResult[],
    _context: OrchestratorContext,
  ): SynthesisStrategy {
    return standardSynthesis(results);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

type OrchestratorConstructor = new (
  stageCategory: StageCategory,
  deps: StageOrchestratorDeps,
  config: OrchestratorConfig,
) => BaseStageOrchestrator;

const ORCHESTRATOR_MAP: Record<StageCategory, OrchestratorConstructor> = {
  research: ResearchOrchestrator,
  plan: PlanOrchestrator,
  build: BuildOrchestrator,
  review: ReviewOrchestrator,
  wrapup: WrapupOrchestrator,
};

/**
 * Create the appropriate concrete Stage Orchestrator for the given stage category.
 *
 * @param stageCategory — One of the five fixed stage categories.
 * @param deps — Injected dependencies: FlavorRegistry, DecisionRegistry, executor.
 * @param config — Orchestrator configuration from the Stage definition.
 * @returns A fully wired IStageOrchestrator instance.
 * @throws OrchestratorError if stageCategory is not a known value.
 */
export function createStageOrchestrator(
  stageCategory: StageCategory,
  deps: StageOrchestratorDeps,
  config: OrchestratorConfig,
): IStageOrchestrator {
  const Ctor = ORCHESTRATOR_MAP[stageCategory];
  if (!Ctor) {
    throw new OrchestratorError(
      `Unknown stage category "${stageCategory}". ` +
        `Valid categories are: ${Object.keys(ORCHESTRATOR_MAP).join(', ')}.`,
    );
  }
  return new Ctor(stageCategory, deps, config);
}
