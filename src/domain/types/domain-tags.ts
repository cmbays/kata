import { z } from 'zod/v4';

// ---------------------------------------------------------------------------
// 4-axis tag vocabulary
// ---------------------------------------------------------------------------

export const DomainArea = z.enum([
  'web-backend', 'web-frontend', 'mobile-ios', 'mobile-android',
  'data-pipeline', 'ml-inference', 'devops', 'security',
  'database', 'api-design', 'developer-tooling', 'system-design',
  'testing', 'documentation', 'performance',
]);

export type DomainArea = z.infer<typeof DomainArea>;

export const LanguageFamily = z.enum([
  'typescript-js', 'python', 'rust', 'go', 'java-jvm',
  'csharp-dotnet', 'ruby', 'swift', 'kotlin', 'cpp',
  'haskell-fp', 'shell-scripting', 'sql',
]);

export type LanguageFamily = z.infer<typeof LanguageFamily>;

export const WorkType = z.enum([
  'greenfield', 'legacy-migration', 'bug-fix', 'feature-addition',
  'refactor', 'optimization', 'integration', 'security-hardening',
  'compliance', 'documentation', 'research', 'prototype',
  'maintenance', 'incident-response',
]);

export type WorkType = z.infer<typeof WorkType>;

export const WorkScope = z.enum(['small', 'medium', 'large']);
export type WorkScope = z.infer<typeof WorkScope>;

export const WorkNovelty = z.enum(['familiar', 'novel', 'experimental']);
export type WorkNovelty = z.infer<typeof WorkNovelty>;

// ---------------------------------------------------------------------------
// DomainTagsSchema — all fields optional (set progressively: user → auto → LLM)
// ---------------------------------------------------------------------------

export const DomainTagsSchema = z.object({
  domain: DomainArea.optional(),
  language: LanguageFamily.optional(),
  /** Open string — React, Django, etc. */
  framework: z.string().optional(),
  workType: WorkType.optional(),
  scope: WorkScope.optional(),
  novelty: WorkNovelty.optional(),
  /** Who set these tags (for provenance) */
  source: z.enum(['user', 'auto-detected', 'llm-inferred']).optional(),
});

export type DomainTags = z.infer<typeof DomainTagsSchema>;

// ---------------------------------------------------------------------------
// DomainConfidenceScoreSchema — computed from historical bet outcomes
// ---------------------------------------------------------------------------

export const DomainConfidenceScoreSchema = z.object({
  /** Historical success rate in matching domains */
  familiarity: z.number().min(0).max(1),
  /** Inverse familiarity + novelty modifier */
  risk: z.number().min(0).max(1),
  /** Completion rate across similar past bets */
  historical: z.number().min(0).max(1),
  /** Weighted average */
  composite: z.number().min(0).max(1),
  /** How many historical bets informed this score */
  sampleSize: z.number().int().min(0),
});

export type DomainConfidenceScore = z.infer<typeof DomainConfidenceScoreSchema>;
