import { describe, it, expect, vi, beforeEach } from 'vitest';
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

function makeAdapter(opts: ConstructorParameters<typeof ClaudeCliAdapter>[0] = {}) {
  const adapter = new ClaudeCliAdapter({ useWorktree: false, ...opts });
  adapter.setBinaryChecker(async () => true);
  adapter.setFileWriter(vi.fn());
  adapter.setFileDeleter(vi.fn());
  adapter.setIdGenerator(() => 'test1234');
  return adapter;
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

  it('returns error for custom binary path that does not exist', async () => {
    const adapter = new ClaudeCliAdapter({ binaryPath: '/nonexistent/claude' });
    adapter.setBinaryChecker(async () => false);

    const result = await adapter.execute(makeManifest());

    expect(result.success).toBe(false);
    expect(result.notes).toContain('/nonexistent/claude');
  });

  describe('worktree flag', () => {
    it('includes -w and worktree name when useWorktree is true', async () => {
      const mockExec = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
      const adapter = new ClaudeCliAdapter({ useWorktree: true });
      adapter.setBinaryChecker(async () => true);
      adapter.setExecFunction(mockExec);
      adapter.setFileWriter(vi.fn());
      adapter.setFileDeleter(vi.fn());
      adapter.setIdGenerator(() => 'abc12345');

      await adapter.execute(makeManifest({ stageType: 'build' }));

      const [, args] = mockExec.mock.calls[0] as [string, string[]];
      expect(args[0]).toBe('-w');
      expect(args[1]).toBe('kata-build-abc12345');
    });

    it('omits -w flag when useWorktree is false', async () => {
      const mockExec = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
      const adapter = makeAdapter();
      adapter.setExecFunction(mockExec);

      await adapter.execute(makeManifest());

      const [, args] = mockExec.mock.calls[0] as [string, string[]];
      expect(args).not.toContain('-w');
    });
  });

  describe('invocation flags', () => {
    let mockExec: ReturnType<typeof vi.fn>;
    let adapter: ClaudeCliAdapter;

    beforeEach(() => {
      mockExec = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
      adapter = makeAdapter();
      adapter.setExecFunction(mockExec);
    });

    it('passes -p flag for print mode', async () => {
      await adapter.execute(makeManifest());
      const [, args] = mockExec.mock.calls[0] as [string, string[]];
      expect(args).toContain('-p');
    });

    it('passes --system-prompt-file with manifest path', async () => {
      await adapter.execute(makeManifest());
      const [, args] = mockExec.mock.calls[0] as [string, string[]];
      const idx = args.indexOf('--system-prompt-file');
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toContain('kata-manifest-test1234.md');
    });

    it('uses custom binary path when provided', async () => {
      const adapter2 = makeAdapter({ binaryPath: '/usr/local/bin/claude' });
      adapter2.setExecFunction(mockExec);
      await adapter2.execute(makeManifest());
      const [binary] = mockExec.mock.calls[0] as [string, string[]];
      expect(binary).toBe('/usr/local/bin/claude');
    });

    it('passes projectRoot as cwd to exec', async () => {
      const adapter2 = makeAdapter({ projectRoot: '/custom/project/root' });
      adapter2.setExecFunction(mockExec);
      await adapter2.execute(makeManifest());
      const [, , options] = mockExec.mock.calls[0] as [string, string[], { cwd: string }];
      expect(options.cwd).toBe('/custom/project/root');
    });
  });

  describe('stageType sanitization', () => {
    it('sanitizes stageType with special characters in worktree name', async () => {
      const mockExec = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
      const adapter = new ClaudeCliAdapter({ useWorktree: true });
      adapter.setBinaryChecker(async () => true);
      adapter.setExecFunction(mockExec);
      adapter.setFileWriter(vi.fn());
      adapter.setFileDeleter(vi.fn());
      adapter.setIdGenerator(() => 'abc12345');

      await adapter.execute(makeManifest({ stageType: 'Build/Feature!' }));

      const [, args] = mockExec.mock.calls[0] as [string, string[]];
      const worktreeName = args[1];
      // Should only contain safe characters
      expect(worktreeName).toMatch(/^kata-[a-z0-9-]+-abc12345$/);
    });
  });

  describe('manifest serialization', () => {
    let writtenContent: string;
    let adapter: ClaudeCliAdapter;

    beforeEach(() => {
      writtenContent = '';
      adapter = makeAdapter();
      adapter.setFileWriter((_, content) => { writtenContent = content; });
      adapter.setExecFunction(vi.fn().mockResolvedValue({ stdout: '', stderr: '' }));
    });

    it('writes stage type header to manifest file', async () => {
      await adapter.execute(makeManifest({ stageType: 'research' }));
      expect(writtenContent).toContain('# Kata Stage: research');
    });

    it('includes stage flavor in header when present', async () => {
      await adapter.execute(makeManifest({ stageFlavor: 'typescript' }));
      expect(writtenContent).toContain('(typescript)');
    });

    it('includes main prompt text', async () => {
      await adapter.execute(makeManifest({ prompt: 'Do the thing carefully' }));
      expect(writtenContent).toContain('Do the thing carefully');
    });

    it('includes artifact info', async () => {
      await adapter.execute(makeManifest({
        artifacts: [{ name: 'design-doc', description: 'The design document', required: true }],
      }));
      expect(writtenContent).toContain('design-doc');
      expect(writtenContent).toContain('required');
      expect(writtenContent).toContain('The design document');
    });

    it('includes learnings', async () => {
      await adapter.execute(makeManifest({
        learnings: [{
          id: crypto.randomUUID(),
          tier: 'stage',
          category: 'testing',
          content: 'Always write tests',
          evidence: [],
          confidence: 0.9,
          stageType: 'build',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }],
      }));
      expect(writtenContent).toContain('Always write tests');
      expect(writtenContent).toContain('90%');
    });

    it('includes output instructions section', async () => {
      await adapter.execute(makeManifest());
      expect(writtenContent).toContain('Output Instructions');
      expect(writtenContent).toContain('"success"');
    });
  });

  describe('temp file cleanup', () => {
    it('deletes temp file after success', async () => {
      const deleteFile = vi.fn();
      const adapter = makeAdapter();
      adapter.setFileDeleter(deleteFile);
      adapter.setExecFunction(vi.fn().mockResolvedValue({ stdout: '', stderr: '' }));

      await adapter.execute(makeManifest());

      expect(deleteFile).toHaveBeenCalledOnce();
      expect(deleteFile.mock.calls[0]![0]).toContain('kata-manifest-test1234.md');
    });

    it('deletes temp file even when execution throws', async () => {
      const deleteFile = vi.fn();
      const adapter = makeAdapter();
      adapter.setFileDeleter(deleteFile);
      adapter.setExecFunction(vi.fn().mockRejectedValue(new Error('process died')));

      const result = await adapter.execute(makeManifest());

      expect(result.success).toBe(false);
      expect(deleteFile).toHaveBeenCalledOnce();
    });
  });

  describe('output parsing', () => {
    it('parses JSON block from stdout', async () => {
      const stdout = [
        'Some preamble text',
        '```json',
        '{ "success": true, "artifacts": [{ "name": "spec", "path": "docs/spec.md" }], "notes": "Done" }',
        '```',
      ].join('\n');

      const adapter = makeAdapter();
      adapter.setExecFunction(vi.fn().mockResolvedValue({ stdout, stderr: '' }));

      const result = await adapter.execute(makeManifest());

      expect(result.success).toBe(true);
      expect(result.artifacts).toHaveLength(1);
      expect(result.notes).toBe('Done');
    });

    it('parses bare JSON object from stdout', async () => {
      const stdout = '{ "success": false, "artifacts": [], "notes": "gate failed" }';

      const adapter = makeAdapter();
      adapter.setExecFunction(vi.fn().mockResolvedValue({ stdout, stderr: '' }));

      const result = await adapter.execute(makeManifest());

      expect(result.success).toBe(false);
      expect(result.notes).toBe('gate failed');
    });

    it('returns failure when claude produces no JSON in stdout', async () => {
      const adapter = makeAdapter();
      adapter.setExecFunction(vi.fn().mockResolvedValue({
        stdout: 'I completed the task. Everything looks good.',
        stderr: '',
      }));

      const result = await adapter.execute(makeManifest());

      expect(result.success).toBe(false);
      expect(result.artifacts).toEqual([]);
      expect(result.notes).toContain('did not produce a structured result');
      expect(result.notes).toContain('I completed the task');
    });

    it('produces a failure note when stdout and stderr are both empty', async () => {
      const adapter = makeAdapter();
      adapter.setExecFunction(vi.fn().mockResolvedValue({ stdout: '', stderr: '' }));

      const result = await adapter.execute(makeManifest());

      expect(result.success).toBe(false);
      expect(result.notes).toContain('did not produce a structured result');
    });

    it('includes raw output in notes when unstructured (no JSON fallback)', async () => {
      const adapter = makeAdapter();
      adapter.setExecFunction(vi.fn().mockResolvedValue({
        stdout: 'main output',
        stderr: 'warning: something happened',
      }));

      const result = await adapter.execute(makeManifest());

      expect(result.success).toBe(false);
      expect(result.notes).toContain('stdout:');
      expect(result.notes).toContain('main output');
      expect(result.notes).toContain('stderr:');
      expect(result.notes).toContain('warning: something happened');
    });

    it('returns failure when execution throws', async () => {
      const adapter = makeAdapter();
      adapter.setExecFunction(vi.fn().mockRejectedValue(new Error('Process exited with code 1')));

      const result = await adapter.execute(makeManifest());

      expect(result.success).toBe(false);
      expect(result.notes).toContain('Claude CLI execution failed');
      expect(result.notes).toContain('Process exited with code 1');
      expect(result.completedAt).toBeDefined();
    });

    it('handles non-Error thrown values gracefully', async () => {
      const adapter = makeAdapter();
      adapter.setExecFunction(vi.fn().mockRejectedValue('string error') as never);

      const result = await adapter.execute(makeManifest());

      expect(result.success).toBe(false);
      expect(result.notes).toContain('string error');
    });
  });

  it('records durationMs in result', async () => {
    const adapter = makeAdapter();
    adapter.setExecFunction(vi.fn().mockResolvedValue({ stdout: '', stderr: '' }));

    const result = await adapter.execute(makeManifest());

    expect(result.durationMs).toBeDefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
