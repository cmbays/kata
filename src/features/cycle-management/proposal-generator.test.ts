import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { CycleManager } from '@domain/services/cycle-manager.js';
import { KnowledgeStore } from '@infra/knowledge/knowledge-store.js';
import { PipelineSchema } from '@domain/types/pipeline.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { ProposalGenerator, type ProposalGeneratorDeps, type CycleProposal } from './proposal-generator.js';

describe('ProposalGenerator', () => {
  const baseDir = join(tmpdir(), `kata-proposal-test-${Date.now()}`);
  const cyclesDir = join(baseDir, 'cycles');
  const knowledgeDir = join(baseDir, 'knowledge');
  const pipelineDir = join(baseDir, 'pipelines');
  const historyDir = join(baseDir, 'history');

  let cycleManager: CycleManager;
  let knowledgeStore: KnowledgeStore;
  let generator: ProposalGenerator;

  beforeEach(() => {
    mkdirSync(cyclesDir, { recursive: true });
    mkdirSync(knowledgeDir, { recursive: true });
    mkdirSync(pipelineDir, { recursive: true });
    mkdirSync(historyDir, { recursive: true });

    cycleManager = new CycleManager(cyclesDir);
    knowledgeStore = new KnowledgeStore(knowledgeDir);

    const deps: ProposalGeneratorDeps = {
      cycleManager,
      knowledgeStore,
      pipelineDir,
      historyDir,
    };

    generator = new ProposalGenerator(deps);
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  describe('generate', () => {
    it('returns empty array for cycle with no bets', () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 }, 'Empty Cycle');
      const proposals = generator.generate(cycle.id);
      expect(proposals).toEqual([]);
    });

    it('returns empty array when all bets are complete and no learnings', () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 }, 'All Done');
      cycleManager.addBet(cycle.id, {
        description: 'Build auth',
        appetite: 30,
        outcome: 'complete',
        issueRefs: [],
      });
      cycleManager.addBet(cycle.id, {
        description: 'Build search',
        appetite: 20,
        outcome: 'complete',
        issueRefs: [],
      });

      const proposals = generator.generate(cycle.id);
      expect(proposals).toEqual([]);
    });

    it('generates proposals from partial bets', () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 }, 'Partial Cycle');
      cycleManager.addBet(cycle.id, {
        description: 'Build auth system',
        appetite: 40,
        outcome: 'partial',
        outcomeNotes: 'Login done, signup not started',
        issueRefs: [],
      });

      const proposals = generator.generate(cycle.id);
      expect(proposals.length).toBe(1);
      expect(proposals[0]!.description).toContain('Continue: Build auth system');
      expect(proposals[0]!.source).toBe('unfinished');
      expect(proposals[0]!.priority).toBe('high');
      // Reduced appetite: 40 * 0.6 = 24
      expect(proposals[0]!.suggestedAppetite).toBe(24);
      expect(proposals[0]!.rationale).toContain('Login done, signup not started');
    });

    it('generates proposals from abandoned bets', () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 }, 'Abandoned Cycle');
      cycleManager.addBet(cycle.id, {
        description: 'Implement real-time features',
        appetite: 30,
        outcome: 'abandoned',
        outcomeNotes: 'Too complex for this cycle',
        issueRefs: [],
      });

      const proposals = generator.generate(cycle.id);
      expect(proposals.length).toBe(1);
      expect(proposals[0]!.description).toContain('Retry: Implement real-time features');
      expect(proposals[0]!.source).toBe('unfinished');
      expect(proposals[0]!.priority).toBe('medium');
      // Same appetite for abandoned work (no progress made)
      expect(proposals[0]!.suggestedAppetite).toBe(30);
      expect(proposals[0]!.rationale).toContain('Too complex for this cycle');
    });

    it('combines unfinished and learning proposals with correct priority', () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 }, 'Mixed Cycle');
      cycleManager.addBet(cycle.id, {
        description: 'Build feature X',
        appetite: 25,
        outcome: 'partial',
        issueRefs: [],
      });
      cycleManager.addBet(cycle.id, {
        description: 'Polish UI',
        appetite: 15,
        outcome: 'complete',
        issueRefs: [],
      });

      // Add a high-confidence learning
      knowledgeStore.capture({
        tier: 'stage',
        category: 'process',
        content: 'Research stages consistently take too long',
        stageType: 'research',
        confidence: 0.85,
        evidence: [
          {
            pipelineId: crypto.randomUUID(),
            stageType: 'research',
            observation: 'Took 3x estimated time',
            recordedAt: new Date().toISOString(),
          },
        ],
      });

      const proposals = generator.generate(cycle.id);
      expect(proposals.length).toBeGreaterThanOrEqual(2);

      // Unfinished should come before learning
      const unfinishedIdx = proposals.findIndex((p) => p.source === 'unfinished');
      const learningIdx = proposals.findIndex((p) => p.source === 'learning');
      expect(unfinishedIdx).toBeLessThan(learningIdx);
    });
  });

  describe('analyzeUnfinishedWork', () => {
    it('returns empty array for cycle with all pending bets', () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      cycleManager.addBet(cycle.id, {
        description: 'Pending work',
        appetite: 20,
        outcome: 'pending',
        issueRefs: [],
      });

      const updated = cycleManager.get(cycle.id);
      const proposals = generator.analyzeUnfinishedWork(updated);
      expect(proposals).toEqual([]);
    });

    it('sets minimum appetite of 1 for partial bets with very low appetite', () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      cycleManager.addBet(cycle.id, {
        description: 'Tiny bet',
        appetite: 1,
        outcome: 'partial',
        issueRefs: [],
      });

      const updated = cycleManager.get(cycle.id);
      const proposals = generator.analyzeUnfinishedWork(updated);
      expect(proposals.length).toBe(1);
      expect(proposals[0]!.suggestedAppetite).toBe(1); // Max(1, round(1 * 0.6)) = 1
    });

    it('includes related bet IDs', () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      cycleManager.addBet(cycle.id, {
        description: 'Some work',
        appetite: 20,
        outcome: 'abandoned',
        issueRefs: [],
      });

      const updated = cycleManager.get(cycle.id);
      const proposals = generator.analyzeUnfinishedWork(updated);
      expect(proposals[0]!.relatedBetIds).toHaveLength(1);
      expect(proposals[0]!.relatedBetIds![0]).toBe(updated.bets[0]!.id);
    });
  });

  describe('analyzeLearnings', () => {
    it('returns empty array when no learnings exist', () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const proposals = generator.analyzeLearnings(cycle.id);
      expect(proposals).toEqual([]);
    });

    it('returns empty array for low-confidence learnings', () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      knowledgeStore.capture({
        tier: 'stage',
        category: 'testing',
        content: 'Might be useful',
        stageType: 'build',
        confidence: 0.3,
        evidence: [],
      });

      const proposals = generator.analyzeLearnings(cycle.id);
      expect(proposals).toEqual([]);
    });

    it('generates proposals for high-confidence learnings', () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const learning = knowledgeStore.capture({
        tier: 'stage',
        category: 'architecture',
        content: 'Modular design patterns reduce build failures by 40%',
        stageType: 'build',
        confidence: 0.9,
        evidence: [
          {
            pipelineId: crypto.randomUUID(),
            stageType: 'build',
            observation: 'Modular builds succeeded more often',
            recordedAt: new Date().toISOString(),
          },
        ],
      });

      const proposals = generator.analyzeLearnings(cycle.id);
      expect(proposals.length).toBe(1);
      expect(proposals[0]!.source).toBe('learning');
      expect(proposals[0]!.priority).toBe('low');
      expect(proposals[0]!.suggestedAppetite).toBe(10);
      expect(proposals[0]!.relatedLearningIds).toContain(learning.id);
    });

    it('groups learnings by category to avoid duplicates', () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      knowledgeStore.capture({
        tier: 'stage',
        category: 'testing',
        content: 'Integration tests catch more issues than unit tests alone',
        stageType: 'build',
        confidence: 0.8,
        evidence: [],
      });
      knowledgeStore.capture({
        tier: 'stage',
        category: 'testing',
        content: 'Test coverage above 80% correlates with fewer bugs',
        stageType: 'build',
        confidence: 0.75,
        evidence: [],
      });

      const proposals = generator.analyzeLearnings(cycle.id);
      // Should produce one proposal per category, not per learning
      expect(proposals.length).toBe(1);
      // Both learnings should be in relatedLearningIds
      expect(proposals[0]!.relatedLearningIds!.length).toBe(2);
    });

    it('truncates long learning content in description', () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const longContent = 'A'.repeat(200);
      knowledgeStore.capture({
        tier: 'stage',
        category: 'research',
        content: longContent,
        stageType: 'research',
        confidence: 0.9,
        evidence: [],
      });

      const proposals = generator.analyzeLearnings(cycle.id);
      expect(proposals[0]!.description.length).toBeLessThan(200);
      expect(proposals[0]!.description).toContain('...');
    });
  });

  describe('analyzeDependencies', () => {
    it('returns empty array for cycle with no complete bets', () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      cycleManager.addBet(cycle.id, {
        description: 'Pending',
        appetite: 20,
        outcome: 'pending',
        issueRefs: [],
      });

      const updated = cycleManager.get(cycle.id);
      const proposals = generator.analyzeDependencies(updated);
      expect(proposals).toEqual([]);
    });

    it('generates proposals for completed spike pipelines', () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const updated = cycleManager.addBet(cycle.id, {
        description: 'Research caching',
        appetite: 15,
        outcome: 'complete',
        issueRefs: [],
      });

      const bet = updated.bets[0]!;
      const pipelineId = crypto.randomUUID();

      // Create a completed spike pipeline
      const pipeline = {
        id: pipelineId,
        name: 'Cache spike',
        type: 'spike' as const,
        stages: [{
          stageRef: { type: 'research' },
          state: 'complete' as const,
          artifacts: [],
        }],
        state: 'complete' as const,
        currentStageIndex: 0,
        metadata: { issueRefs: [], cycleId: cycle.id, betId: bet.id },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const pipelinePath = join(pipelineDir, `${pipelineId}.json`);
      JsonStore.write(pipelinePath, pipeline, PipelineSchema);

      // Map pipeline to bet
      cycleManager.mapPipeline(cycle.id, bet.id, pipelineId);
      const finalCycle = cycleManager.get(cycle.id);

      const proposals = generator.analyzeDependencies(finalCycle);
      expect(proposals.length).toBe(1);
      expect(proposals[0]!.source).toBe('dependency');
      expect(proposals[0]!.priority).toBe('medium');
      expect(proposals[0]!.description).toContain('Cache spike');
      expect(proposals[0]!.relatedBetIds).toContain(bet.id);
    });

    it('ignores non-complete pipelines', () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const updated = cycleManager.addBet(cycle.id, {
        description: 'Active bet',
        appetite: 20,
        outcome: 'complete',
        issueRefs: [],
      });

      const bet = updated.bets[0]!;
      const pipelineId = crypto.randomUUID();

      // Create an active (not complete) pipeline
      const pipeline = {
        id: pipelineId,
        name: 'Active pipeline',
        type: 'spike' as const,
        stages: [{
          stageRef: { type: 'research' },
          state: 'active' as const,
          artifacts: [],
        }],
        state: 'active' as const,
        currentStageIndex: 0,
        metadata: { issueRefs: [] },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const pipelinePath = join(pipelineDir, `${pipelineId}.json`);
      JsonStore.write(pipelinePath, pipeline, PipelineSchema);

      cycleManager.mapPipeline(cycle.id, bet.id, pipelineId);
      const finalCycle = cycleManager.get(cycle.id);

      const proposals = generator.analyzeDependencies(finalCycle);
      expect(proposals).toEqual([]);
    });
  });

  describe('prioritize', () => {
    it('sorts by priority: high > medium > low', () => {
      const proposals: CycleProposal[] = [
        {
          id: '1',
          description: 'Low priority',
          rationale: '',
          suggestedAppetite: 10,
          priority: 'low',
          source: 'learning',
        },
        {
          id: '2',
          description: 'High priority',
          rationale: '',
          suggestedAppetite: 30,
          priority: 'high',
          source: 'unfinished',
        },
        {
          id: '3',
          description: 'Medium priority',
          rationale: '',
          suggestedAppetite: 20,
          priority: 'medium',
          source: 'dependency',
        },
      ];

      const sorted = generator.prioritize(proposals);
      expect(sorted[0]!.priority).toBe('high');
      expect(sorted[1]!.priority).toBe('medium');
      expect(sorted[2]!.priority).toBe('low');
    });

    it('sorts by source within same priority', () => {
      const proposals: CycleProposal[] = [
        {
          id: '1',
          description: 'Dependency',
          rationale: '',
          suggestedAppetite: 20,
          priority: 'medium',
          source: 'dependency',
        },
        {
          id: '2',
          description: 'Unfinished',
          rationale: '',
          suggestedAppetite: 30,
          priority: 'medium',
          source: 'unfinished',
        },
      ];

      const sorted = generator.prioritize(proposals);
      expect(sorted[0]!.source).toBe('unfinished');
      expect(sorted[1]!.source).toBe('dependency');
    });

    it('deduplicates by description', () => {
      const proposals: CycleProposal[] = [
        {
          id: '1',
          description: 'Same thing',
          rationale: 'First',
          suggestedAppetite: 20,
          priority: 'high',
          source: 'unfinished',
        },
        {
          id: '2',
          description: 'Same thing',
          rationale: 'Second',
          suggestedAppetite: 30,
          priority: 'medium',
          source: 'learning',
        },
      ];

      const sorted = generator.prioritize(proposals);
      expect(sorted.length).toBe(1);
      expect(sorted[0]!.rationale).toBe('First'); // Keeps the first seen
    });

    it('returns empty array for empty input', () => {
      const sorted = generator.prioritize([]);
      expect(sorted).toEqual([]);
    });
  });
});
