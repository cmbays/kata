import { createHash } from 'node:crypto';
import type { GapReport } from '@domain/types/orchestration.js';
import { GapBridger } from './gap-bridger.js';

function makeGap(overrides: Partial<GapReport> = {}): GapReport {
  return {
    description: 'Missing test coverage for auth module',
    severity: 'medium',
    suggestedFlavors: [],
    ...overrides,
  };
}

describe('GapBridger', () => {
  let knowledgeStore: { capture: ReturnType<typeof vi.fn> };
  let bridger: GapBridger;

  beforeEach(() => {
    knowledgeStore = { capture: vi.fn() };
    bridger = new GapBridger({ knowledgeStore: knowledgeStore as unknown as import('@domain/ports/knowledge-store.js').IKnowledgeStore });
  });

  it('returns empty result for empty gaps array', () => {
    const result = bridger.bridge([]);
    expect(result.bridged).toHaveLength(0);
    expect(result.blocked).toHaveLength(0);
  });

  it('blocks all high-severity gaps', () => {
    const gaps = [
      makeGap({ severity: 'high', description: 'Critical auth missing' }),
      makeGap({ severity: 'high', description: 'No encryption layer' }),
    ];
    const result = bridger.bridge(gaps);
    expect(result.blocked).toHaveLength(2);
    expect(result.bridged).toHaveLength(0);
  });

  it('bridges all low-severity gaps', () => {
    const gaps = [
      makeGap({ severity: 'low', description: 'Minor style issue' }),
      makeGap({ severity: 'low', description: 'Optional docs gap' }),
    ];
    const result = bridger.bridge(gaps);
    expect(result.bridged).toHaveLength(2);
    expect(result.blocked).toHaveLength(0);
  });

  it('bridges all medium-severity gaps', () => {
    const gaps = [
      makeGap({ severity: 'medium', description: 'Test gap A' }),
      makeGap({ severity: 'medium', description: 'Test gap B' }),
    ];
    const result = bridger.bridge(gaps);
    expect(result.bridged).toHaveLength(2);
    expect(result.blocked).toHaveLength(0);
  });

  it('separates mixed-severity gaps into blocked and bridged', () => {
    const gaps = [
      makeGap({ severity: 'high', description: 'Critical' }),
      makeGap({ severity: 'medium', description: 'Medium' }),
      makeGap({ severity: 'low', description: 'Low' }),
    ];
    const result = bridger.bridge(gaps);
    expect(result.blocked).toHaveLength(1);
    expect(result.blocked[0]!.description).toBe('Critical');
    expect(result.bridged).toHaveLength(2);
  });

  it('calls knowledgeStore.capture for each non-high gap', () => {
    const gaps = [
      makeGap({ severity: 'low', description: 'Gap A' }),
      makeGap({ severity: 'medium', description: 'Gap B' }),
    ];
    bridger.bridge(gaps);
    expect(knowledgeStore.capture).toHaveBeenCalledTimes(2);
  });

  it('does not call knowledgeStore.capture for high-severity gaps', () => {
    bridger.bridge([makeGap({ severity: 'high' })]);
    expect(knowledgeStore.capture).not.toHaveBeenCalled();
  });

  it('captures learning with tier=step, confidence=0.6, source=extracted', () => {
    bridger.bridge([makeGap({ severity: 'low', description: 'Some gap' })]);
    expect(knowledgeStore.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        tier: 'step',
        confidence: 0.6,
        source: 'extracted',
      }),
    );
  });

  it('captures learning with category starting with gap-', () => {
    bridger.bridge([makeGap({ severity: 'medium', description: 'A gap' })]);
    const call = knowledgeStore.capture.mock.calls[0]![0];
    expect(call.category).toMatch(/^gap-[a-f0-9]{8}$/);
  });

  it('captures learning content that includes the gap description', () => {
    bridger.bridge([makeGap({ severity: 'low', description: 'No Rust async flavor' })]);
    const call = knowledgeStore.capture.mock.calls[0]![0];
    expect(call.content).toContain('No Rust async flavor');
  });

  it('includes suggested flavors in the captured learning content', () => {
    bridger.bridge([
      makeGap({
        severity: 'low',
        description: 'Missing build flavor',
        suggestedFlavors: ['rust-async', 'go-build'],
      }),
    ]);
    const call = knowledgeStore.capture.mock.calls[0]![0];
    expect(call.content).toContain('Suggested: rust-async, go-build.');
  });

  it('omits suggested flavors text when suggestedFlavors is empty', () => {
    bridger.bridge([
      makeGap({ severity: 'low', description: 'Some gap', suggestedFlavors: [] }),
    ]);
    const call = knowledgeStore.capture.mock.calls[0]![0];
    expect(call.content).not.toContain('Suggested');
  });

  it('produces different category hashes for different descriptions', () => {
    bridger.bridge([
      makeGap({ severity: 'low', description: 'Gap description one' }),
      makeGap({ severity: 'low', description: 'Gap description two' }),
    ]);
    const cat1 = knowledgeStore.capture.mock.calls[0]![0].category;
    const cat2 = knowledgeStore.capture.mock.calls[1]![0].category;
    expect(cat1).not.toBe(cat2);
  });

  it('produces a deterministic hash for the same description', () => {
    const desc = 'Deterministic test';
    const expected = createHash('sha256').update(desc).digest('hex').slice(0, 8);

    bridger.bridge([makeGap({ severity: 'low', description: desc })]);
    const call = knowledgeStore.capture.mock.calls[0]![0];
    expect(call.category).toBe(`gap-${expected}`);
  });

  it('still marks gap as bridged even if capture throws', () => {
    knowledgeStore.capture.mockImplementation(() => {
      throw new Error('Disk full');
    });
    const result = bridger.bridge([makeGap({ severity: 'low', description: 'Failing gap' })]);
    expect(result.bridged).toHaveLength(1);
    expect(result.blocked).toHaveLength(0);
  });

  it('continues capturing subsequent gaps even if one capture fails', () => {
    knowledgeStore.capture
      .mockImplementationOnce(() => { throw new Error('fail first'); })
      .mockImplementationOnce(() => ({ id: 'ok' }));

    const result = bridger.bridge([
      makeGap({ severity: 'low', description: 'First' }),
      makeGap({ severity: 'medium', description: 'Second' }),
    ]);
    expect(result.bridged).toHaveLength(2);
    expect(knowledgeStore.capture).toHaveBeenCalledTimes(2);
  });
});
