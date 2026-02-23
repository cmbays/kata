// Gate types
export {
  GateConditionType,
  GateConditionSchema,
  GateType,
  GateSchema,
  GateResultSchema,
  type GateCondition,
  type Gate,
  type GateResult,
} from './gate.js';

// Artifact types
export {
  ArtifactSchema,
  ArtifactResultSchema,
  type Artifact,
  type ArtifactResult,
} from './artifact.js';

// Step types (formerly Stage)
export {
  StepType,
  StepRefSchema,
  StepToolSchema,
  StepAgentHintSchema,
  StepResourcesSchema,
  StepSchema,
  type StepRef,
  type StepTool,
  type StepAgentHint,
  type StepResources,
  type Step,
} from './step.js';

// Backwards-compatible re-exports (deprecated — migrate to Step* names)
/** @deprecated Use StepType */ export { StepType as StageType } from './step.js';
/** @deprecated Use StepRefSchema */ export { StepRefSchema as StageRefSchema } from './step.js';
/** @deprecated Use StepToolSchema */ export { StepToolSchema as StageToolSchema } from './step.js';
/** @deprecated Use StepAgentHintSchema */ export { StepAgentHintSchema as StageAgentHintSchema } from './step.js';
/** @deprecated Use StepResourcesSchema */ export { StepResourcesSchema as StageResourcesSchema } from './step.js';
/** @deprecated Use StepRef */ export type { StepRef as StageRef } from './step.js';
/** @deprecated Use StepTool */ export type { StepTool as StageTool } from './step.js';
/** @deprecated Use StepAgentHint */ export type { StepAgentHint as StageAgentHint } from './step.js';
/** @deprecated Use StepResources */ export type { StepResources as StageResources } from './step.js';

// Stage types (macro execution layer — the new top-level concept in the three-tier hierarchy)
export {
  StageCategorySchema,
  OrchestratorConfigSchema,
  StageSchema,
  type StageCategory,
  type OrchestratorConfig,
  type Stage,
} from './stage.js';

// Pipeline types
export {
  PipelineType,
  PipelineState,
  PipelineStepStateSchema,
  PipelineStageStateSchema,
  PipelineMetadataSchema,
  PipelineSchema,
  PipelineTemplateSchema,
  type PipelineStepState,
  type PipelineStageState,
  type PipelineMetadata,
  type Pipeline,
  type PipelineTemplate,
} from './pipeline.js';

// Cycle types
export {
  CycleState,
  BudgetSchema,
  PipelineMappingSchema,
  BudgetAlertLevel,
  BudgetStatusSchema,
  CycleSchema,
  type Budget,
  type PipelineMapping,
  type BudgetStatus,
  type Cycle,
} from './cycle.js';

// Bet types
export {
  BetOutcome,
  BetSchema,
  type Bet,
} from './bet.js';

// Learning types
export {
  LearningTier,
  LearningEvidenceSchema,
  LearningSchema,
  LearningFilterSchema,
  type LearningEvidence,
  type Learning,
  type LearningFilter,
} from './learning.js';

// Manifest types
export {
  ExecutionContextSchema,
  ExecutionManifestSchema,
  ExecutionResultSchema,
  type ExecutionContext,
  type ExecutionManifest,
  type ExecutionResult,
} from './manifest.js';

// History types
export {
  TokenUsageSchema,
  ExecutionHistoryEntrySchema,
  type TokenUsage,
  type ExecutionHistoryEntry,
} from './history.js';

// Config types
export {
  ExecutionAdapterType,
  KataConfigSchema,
  type KataConfig,
} from './config.js';
