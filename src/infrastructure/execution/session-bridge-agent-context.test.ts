import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PreparedRun } from '@domain/ports/session-bridge.js';
import type { SessionContext } from '@shared/lib/session-context.js';
import { formatSessionBridgeAgentContext } from './session-bridge-agent-context.js';

function createPreparedRun(overrides: Partial<PreparedRun> = {}): PreparedRun {
  const runId = overrides.runId ?? randomUUID();

  return {
    runId,
    betId: overrides.betId ?? randomUUID(),
    betName: overrides.betName ?? 'Fix the Login Bug #42',
    cycleId: overrides.cycleId ?? randomUUID(),
    cycleName: overrides.cycleName ?? 'Launch Cycle',
    kataDir: overrides.kataDir ?? '/tmp/example/.kata',
    stages: overrides.stages ?? ['research', 'build'],
    isolation: overrides.isolation ?? 'worktree',
    startedAt: overrides.startedAt ?? '2026-03-15T12:00:00.000Z',
    agentId: overrides.agentId,
    katakaId: overrides.katakaId,
    manifest: overrides.manifest ?? {
      stageType: 'research,build',
      prompt: 'Execute the bet',
      context: {
        pipelineId: runId,
        stageIndex: 0,
        metadata: {
          runId,
        },
      },
      artifacts: [],
      learnings: [],
    },
  };
}

function createSessionContext(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    kataInitialized: true,
    kataDir: '/tmp/example/.kata',
    inWorktree: true,
    activeCycle: null,
    launchMode: 'interactive',
    ...overrides,
  };
}

describe('formatSessionBridgeAgentContext', () => {
  it('renders artifacts, gates, launch notes, and injected learnings', () => {
    const prepared = createPreparedRun({
      manifest: {
        stageType: 'research,build',
        prompt: 'Execute the bet',
        context: {
          pipelineId: randomUUID(),
          stageIndex: 0,
          metadata: {},
        },
        artifacts: [
          { name: 'fix.ts', required: true, description: 'Updated implementation' },
          { name: 'notes.md', required: false },
        ],
        entryGate: {
          type: 'all',
          conditions: [
            { type: 'artifact-exists', artifactName: 'fix.ts' },
            { type: 'predecessor-complete', predecessorType: 'research' },
            { type: 'human-approved', description: 'reviewer sign-off required' },
          ],
        },
        exitGate: {
          type: 'all',
          conditions: [
            { type: 'schema-valid' },
            { type: 'command-passes' },
            { type: 'custom-check' },
          ],
        },
        learnings: [
          { tier: 'project', category: 'workflow', content: 'Prefer cycle prepare before launch', confidence: 0.82 },
        ],
      },
    });

    const context = formatSessionBridgeAgentContext(prepared, {
      launchMode: 'agent',
      repoRoot: '/tmp/example',
      sessionContext: createSessionContext({ kataDir: null, inWorktree: false, launchMode: 'agent' }),
    });

    expect(context).toContain('- **Launch mode**: agent');
    expect(context).toContain('outside a git worktree');
    expect(context).toContain('Expected artifacts:');
    expect(context).toContain('fix.ts [required] — Updated implementation');
    expect(context).toContain('notes.md [optional]');
    expect(context).toContain('[artifact-exists] artifact "fix.ts" must exist');
    expect(context).toContain('[predecessor-complete] stage "research" must be complete');
    expect(context).toContain('[human-approved] reviewer sign-off required');
    expect(context).toContain('[schema-valid] output must pass schema validation');
    expect(context).toContain('[command-passes] command must exit with code 0');
    expect(context).toContain('[custom-check] custom-check');
    expect(context).toContain('### Injected Learnings');
    expect(context).toContain('[project/workflow] (confidence: 82%)');
  });

  it('omits optional sections when the manifest is minimal and slugifies the branch name', () => {
    const prepared = createPreparedRun({
      betName: 'Fix the Login Bug #42',
      manifest: {
        stageType: 'research,build',
        prompt: 'Execute the bet',
        context: {
          pipelineId: randomUUID(),
          stageIndex: 0,
          metadata: {},
        },
        artifacts: [],
        learnings: [],
      },
    });

    const context = formatSessionBridgeAgentContext(prepared, {
      launchMode: 'interactive',
      repoRoot: '/tmp/example',
      sessionContext: createSessionContext(),
    });

    expect(context).toContain('- **In worktree**: yes');
    expect(context).not.toContain('outside a git worktree');
    expect(context).not.toContain('Expected artifacts:');
    expect(context).not.toContain('### Gates');
    expect(context).not.toContain('### Injected Learnings');
    expect(context).toContain(`git checkout -b keiko-${prepared.runId.slice(0, 8)}/fix-the-login-bug-42`);
  });
});
