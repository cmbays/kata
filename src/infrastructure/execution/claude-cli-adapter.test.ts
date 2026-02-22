import { describe, it, expect, vi } from 'vitest';
import type { ExecutionManifest } from '@domain/types/manifest.js';
import { ClaudeCliAdapter } from './claude-cli-adapter.js';

function makeManifest(overrides: Partial<ExecutionManifest> = {}): ExecutionManifest {
  return {
    stageType: 'build',
    prompt: 'Build the feature according to the plan.',
    context: {
      pipelineId: crypto.randomUUID(),
      stageIndex: 2,
      metadata: {},
    },
    artifacts: [],
    learnings: [],
    ...overrides,
  };
}

describe('ClaudeCliAdapter', () => {
  it('has name "claude-cli"', () => {
    const adapter = new ClaudeCliAdapter();
    expect(adapter.name).toBe('claude-cli');
  });

  it('returns failure when claude binary is not found', async () => {
    const adapter = new ClaudeCliAdapter();
    adapter.setBinaryChecker(async () => false);

    const result = await adapter.execute(makeManifest());

    expect(result.success).toBe(false);
    expect(result.notes).toContain('Claude CLI binary not found');
    expect(result.notes).toContain('manual');
    expect(result.completedAt).toBeDefined();
  });

  it('returns success when execution succeeds', async () => {
    const adapter = new ClaudeCliAdapter();
    adapter.setBinaryChecker(async () => true);
    adapter.setExecFunction(vi.fn().mockResolvedValue({
      stdout: 'Claude output here',
      stderr: '',
    }) as never);

    const result = await adapter.execute(makeManifest());

    expect(result.success).toBe(true);
    expect(result.notes).toContain('Claude output here');
    expect(result.completedAt).toBeDefined();
    expect(result.durationMs).toBeDefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('includes stderr in notes when present', async () => {
    const adapter = new ClaudeCliAdapter();
    adapter.setBinaryChecker(async () => true);
    adapter.setExecFunction(vi.fn().mockResolvedValue({
      stdout: 'main output',
      stderr: 'warning: something',
    }) as never);

    const result = await adapter.execute(makeManifest());

    expect(result.success).toBe(true);
    expect(result.notes).toContain('stdout:');
    expect(result.notes).toContain('main output');
    expect(result.notes).toContain('stderr:');
    expect(result.notes).toContain('warning: something');
  });

  it('returns failure when execution throws an error', async () => {
    const adapter = new ClaudeCliAdapter();
    adapter.setBinaryChecker(async () => true);
    adapter.setExecFunction(vi.fn().mockRejectedValue(
      new Error('Process exited with code 1'),
    ) as never);

    const result = await adapter.execute(makeManifest());

    expect(result.success).toBe(false);
    expect(result.notes).toContain('Claude CLI execution failed');
    expect(result.notes).toContain('Process exited with code 1');
    expect(result.completedAt).toBeDefined();
  });

  it('passes the prompt with --print flag', async () => {
    const mockExec = vi.fn().mockResolvedValue({
      stdout: 'response',
      stderr: '',
    });

    const adapter = new ClaudeCliAdapter();
    adapter.setBinaryChecker(async () => true);
    adapter.setExecFunction(mockExec as never);

    await adapter.execute(makeManifest({ prompt: 'Do the thing' }));

    expect(mockExec).toHaveBeenCalledOnce();
    const [binary, args] = mockExec.mock.calls[0] as [string, string[]];
    expect(binary).toBe('claude');
    expect(args[0]).toBe('--print');
    // The prompt should be the last argument and contain the stage header + prompt
    const lastArg = args[args.length - 1]!;
    expect(lastArg).toContain('Do the thing');
  });

  it('uses custom binary path when provided', async () => {
    const mockExec = vi.fn().mockResolvedValue({
      stdout: 'ok',
      stderr: '',
    });

    const adapter = new ClaudeCliAdapter({ binaryPath: '/usr/local/bin/claude' });
    adapter.setBinaryChecker(async () => true);
    adapter.setExecFunction(mockExec as never);

    await adapter.execute(makeManifest());

    const [binary] = mockExec.mock.calls[0] as [string, string[]];
    expect(binary).toBe('/usr/local/bin/claude');
  });

  it('passes additional args when provided', async () => {
    const mockExec = vi.fn().mockResolvedValue({
      stdout: 'ok',
      stderr: '',
    });

    const adapter = new ClaudeCliAdapter({ additionalArgs: ['--model', 'opus'] });
    adapter.setBinaryChecker(async () => true);
    adapter.setExecFunction(mockExec as never);

    await adapter.execute(makeManifest());

    const [, args] = mockExec.mock.calls[0] as [string, string[]];
    expect(args).toContain('--model');
    expect(args).toContain('opus');
  });

  it('includes artifact info in the prompt', async () => {
    const mockExec = vi.fn().mockResolvedValue({
      stdout: 'ok',
      stderr: '',
    });

    const adapter = new ClaudeCliAdapter();
    adapter.setBinaryChecker(async () => true);
    adapter.setExecFunction(mockExec as never);

    await adapter.execute(makeManifest({
      artifacts: [
        { name: 'design-doc', description: 'The design document', required: true },
      ],
    }));

    const [, args] = mockExec.mock.calls[0] as [string, string[]];
    const lastArg = args[args.length - 1]!;
    expect(lastArg).toContain('design-doc');
    expect(lastArg).toContain('required');
  });

  it('includes learnings in the prompt', async () => {
    const mockExec = vi.fn().mockResolvedValue({
      stdout: 'ok',
      stderr: '',
    });

    const adapter = new ClaudeCliAdapter();
    adapter.setBinaryChecker(async () => true);
    adapter.setExecFunction(mockExec as never);

    await adapter.execute(makeManifest({
      learnings: [
        {
          id: crypto.randomUUID(),
          tier: 'stage',
          category: 'testing',
          content: 'Always write tests',
          evidence: [],
          confidence: 0.9,
          stageType: 'build',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    }));

    const [, args] = mockExec.mock.calls[0] as [string, string[]];
    const lastArg = args[args.length - 1]!;
    expect(lastArg).toContain('Always write tests');
    expect(lastArg).toContain('90%');
  });

  it('returns error for custom binary path that does not exist', async () => {
    const adapter = new ClaudeCliAdapter({ binaryPath: '/nonexistent/claude' });
    adapter.setBinaryChecker(async () => false);

    const result = await adapter.execute(makeManifest());

    expect(result.success).toBe(false);
    expect(result.notes).toContain('/nonexistent/claude');
  });

  it('handles non-Error thrown values gracefully', async () => {
    const adapter = new ClaudeCliAdapter();
    adapter.setBinaryChecker(async () => true);
    adapter.setExecFunction(vi.fn().mockRejectedValue('string error') as never);

    const result = await adapter.execute(makeManifest());

    expect(result.success).toBe(false);
    expect(result.notes).toContain('string error');
  });
});
