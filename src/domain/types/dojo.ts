import { z } from 'zod/v4';

// ── Diary ────────────────────────────────────────────────────────────────────

export const DojoMood = z.enum(['energized', 'steady', 'frustrated', 'reflective', 'uncertain']);
export type DojoMood = z.infer<typeof DojoMood>;

export const DojoDiaryEntrySchema = z.object({
  id: z.string().uuid(),
  cycleId: z.string().uuid(),
  cycleName: z.string().optional(),
  narrative: z.string().min(1),
  wins: z.array(z.string()).default([]),
  painPoints: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
  mood: DojoMood.optional(),
  tags: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
});

export type DojoDiaryEntry = z.infer<typeof DojoDiaryEntrySchema>;

// ── Topics ───────────────────────────────────────────────────────────────────

export const DojoDirection = z.enum(['backward', 'inward', 'outward', 'forward']);
export type DojoDirection = z.infer<typeof DojoDirection>;

export const DojoPriority = z.enum(['high', 'medium', 'low']);
export type DojoPriority = z.infer<typeof DojoPriority>;

export const DojoTopicSchema = z.object({
  title: z.string().min(1),
  direction: DojoDirection,
  description: z.string().min(1),
  priority: DojoPriority,
  tags: z.array(z.string()).default([]),
});

export type DojoTopic = z.infer<typeof DojoTopicSchema>;

// ── Content Sections ─────────────────────────────────────────────────────────

export const DojoSectionType = z.enum([
  'narrative', 'checklist', 'comparison', 'timeline',
  'diagram', 'chart', 'code', 'quiz', 'reference',
]);
export type DojoSectionType = z.infer<typeof DojoSectionType>;

export const DojoContentSectionSchema = z.object({
  title: z.string().min(1),
  type: DojoSectionType,
  topicTitle: z.string().min(1),
  content: z.string(),
  collapsed: z.boolean().default(false),
  depth: z.number().int().min(0).default(0),
});

export type DojoContentSection = z.infer<typeof DojoContentSectionSchema>;

// ── Sources ──────────────────────────────────────────────────────────────────

export const DojoSourceReputation = z.enum(['official', 'authoritative', 'community', 'experimental']);
export type DojoSourceReputation = z.infer<typeof DojoSourceReputation>;

export const DojoSourceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  url: z.url(),
  domains: z.array(z.string()).default([]),
  reputation: DojoSourceReputation,
  description: z.string().optional(),
  active: z.boolean().default(true),
});

export type DojoSource = z.infer<typeof DojoSourceSchema>;

export const DojoSourceRegistrySchema = z.object({
  sources: z.array(DojoSourceSchema).default([]),
  updatedAt: z.string().datetime(),
});

export type DojoSourceRegistry = z.infer<typeof DojoSourceRegistrySchema>;

// ── Sessions ─────────────────────────────────────────────────────────────────

export const DojoSessionSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  summary: z.string().min(1),
  topics: z.array(DojoTopicSchema),
  sections: z.array(DojoContentSectionSchema),
  diaryEntryIds: z.array(z.string().uuid()).default([]),
  runIds: z.array(z.string().uuid()).default([]),
  cycleIds: z.array(z.string().uuid()).default([]),
  sourceIds: z.array(z.string().uuid()).default([]),
  tags: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
  version: z.literal(1),
});

export type DojoSession = z.infer<typeof DojoSessionSchema>;

// ── Session Meta & Index ─────────────────────────────────────────────────────

export const DojoSessionMetaSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  summary: z.string().min(1),
  topicCount: z.number().int().min(0),
  sectionCount: z.number().int().min(0),
  tags: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
});

export type DojoSessionMeta = z.infer<typeof DojoSessionMetaSchema>;

export const DojoSessionIndexSchema = z.object({
  sessions: z.array(DojoSessionMetaSchema).default([]),
  updatedAt: z.string().datetime(),
});

export type DojoSessionIndex = z.infer<typeof DojoSessionIndexSchema>;
