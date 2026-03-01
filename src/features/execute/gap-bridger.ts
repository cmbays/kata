import { createHash } from 'node:crypto';
import type { IKnowledgeStore } from '@domain/ports/knowledge-store.js';
import type { GapReport } from '@domain/types/orchestration.js';

export interface GapBridgeResult {
  bridged: GapReport[]; // severity low/medium — captured as learnings
  blocked: GapReport[]; // severity high — block execution
}

export class GapBridger {
  constructor(private readonly deps: { knowledgeStore: IKnowledgeStore }) {}

  bridge(gaps: GapReport[]): GapBridgeResult {
    const blocked: GapReport[] = [];
    const bridged: GapReport[] = [];

    for (const gap of gaps) {
      if (gap.severity === 'high') {
        blocked.push(gap);
      } else {
        // Capture as a step-tier learning
        const hash = createHash('sha256')
          .update(gap.description)
          .digest('hex')
          .slice(0, 8);
        try {
          this.deps.knowledgeStore.capture({
            tier: 'step',
            category: `gap-${hash}`,
            content: `Coverage gap identified: ${gap.description}${gap.suggestedFlavors.length > 0 ? ` Suggested: ${gap.suggestedFlavors.join(', ')}.` : ''}`,
            confidence: 0.6,
            source: 'extracted',
          });
        } catch {
          // Failed to capture learning — still mark as bridged (gap acknowledged, not blocked)
        }
        bridged.push(gap);
      }
    }

    // TODO: call ProjectStateUpdater.incrementGapsClosed() when projectStateFile is provided

    return { bridged, blocked };
  }
}
