import type { Learning } from '@domain/types/learning.js';
import type { KnowledgeStats } from '@infra/knowledge/knowledge-store.js';
import {
  formatLearningTable,
  formatKnowledgeStats,
  formatLearningJson,
  formatKnowledgeStatsJson,
} from './knowledge-formatter.js';

const makeLearning = (overrides: Partial<Learning> = {}): Learning => ({
  id: '00000000-0000-0000-0000-000000000001',
  tier: 'stage',
  category: 'code-quality',
  content: 'Always add error handling around async calls.',
  evidence: [],
  confidence: 0.85,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

describe('formatLearningTable', () => {
  it('returns "No learnings found." for empty list', () => {
    expect(formatLearningTable([])).toBe('No learnings found.');
  });

  it('formats learnings into a table', () => {
    const learnings = [makeLearning()];
    const result = formatLearningTable(learnings);
    expect(result).toContain('Tier');
    expect(result).toContain('Category');
    expect(result).toContain('Confidence');
    expect(result).toContain('stage');
    expect(result).toContain('code-quality');
    expect(result).toContain('0.85');
  });

  it('truncates long content', () => {
    const learnings = [
      makeLearning({
        content: 'This is a very long learning content string that exceeds the maximum display width for the table column',
      }),
    ];
    const result = formatLearningTable(learnings);
    expect(result).toContain('...');
  });

  it('formats multiple learnings', () => {
    const learnings = [
      makeLearning({ tier: 'stage', category: 'testing' }),
      makeLearning({ tier: 'category', category: 'architecture' }),
      makeLearning({ tier: 'agent', category: 'preferences' }),
    ];
    const result = formatLearningTable(learnings);
    const lines = result.split('\n');
    // header + separator + 3 data rows
    expect(lines).toHaveLength(5);
  });
});

describe('formatKnowledgeStats', () => {
  const makeStats = (overrides: Partial<KnowledgeStats> = {}): KnowledgeStats => ({
    total: 42,
    byTier: { stage: 20, category: 15, agent: 7 },
    topCategories: [
      { category: 'code-quality', count: 12 },
      { category: 'architecture', count: 8 },
    ],
    averageConfidence: 0.73,
    ...overrides,
  });

  it('shows header and total count (plain)', () => {
    const result = formatKnowledgeStats(makeStats(), true);
    expect(result).toContain('=== Knowledge Store Stats ===');
    expect(result).toContain('Total Learnings: 42');
  });

  it('uses thematic knowledge label by default', () => {
    const result = formatKnowledgeStats(makeStats());
    expect(result).toContain('=== Bunkai Store Stats ===');
  });

  it('shows average confidence', () => {
    const result = formatKnowledgeStats(makeStats());
    expect(result).toContain('Average Confidence: 0.73');
  });

  it('shows tier breakdown (plain)', () => {
    const result = formatKnowledgeStats(makeStats(), true);
    expect(result).toContain('Stage:    20');
    expect(result).toContain('Category: 15');
    expect(result).toContain('Agent:    7');
  });

  it('uses thematic stage label in tier breakdown by default', () => {
    const result = formatKnowledgeStats(makeStats());
    expect(result).toContain('Gyo:    20');
  });

  it('shows top categories', () => {
    const result = formatKnowledgeStats(makeStats());
    expect(result).toContain('code-quality: 12');
    expect(result).toContain('architecture: 8');
  });

  it('handles empty stats', () => {
    const result = formatKnowledgeStats(
      makeStats({ total: 0, byTier: { stage: 0, category: 0, agent: 0 }, topCategories: [], averageConfidence: 0 }),
    );
    expect(result).toContain('Total Learnings: 0');
  });
});

describe('formatLearningJson', () => {
  it('returns valid JSON array', () => {
    const learnings = [makeLearning()];
    const result = formatLearningJson(learnings);
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].tier).toBe('stage');
  });
});

describe('formatKnowledgeStatsJson', () => {
  it('returns valid JSON', () => {
    const stats: KnowledgeStats = {
      total: 10,
      byTier: { stage: 5, category: 3, agent: 2 },
      topCategories: [],
      averageConfidence: 0.5,
    };
    const result = formatKnowledgeStatsJson(stats);
    const parsed = JSON.parse(result);
    expect(parsed.total).toBe(10);
  });
});
