import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SubscriptionManager } from './subscription-manager.js';

let tempDir: string;
let manager: SubscriptionManager;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'kata-sub-test-'));
  manager = new SubscriptionManager(tempDir);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('SubscriptionManager', () => {
  describe('subscribe', () => {
    it('creates subscriptions for a new agent', () => {
      manager.subscribe('agent-1', ['testing', 'architecture']);

      const subs = manager.getSubscriptions('agent-1');
      expect(subs).toEqual(['testing', 'architecture']);
    });

    it('merges new categories with existing ones', () => {
      manager.subscribe('agent-1', ['testing']);
      manager.subscribe('agent-1', ['architecture', 'performance']);

      const subs = manager.getSubscriptions('agent-1');
      expect(subs).toEqual(['testing', 'architecture', 'performance']);
    });

    it('deduplicates categories', () => {
      manager.subscribe('agent-1', ['testing', 'architecture']);
      manager.subscribe('agent-1', ['testing', 'debugging']);

      const subs = manager.getSubscriptions('agent-1');
      expect(subs).toEqual(['testing', 'architecture', 'debugging']);
    });

    it('handles multiple agents independently', () => {
      manager.subscribe('agent-1', ['testing']);
      manager.subscribe('agent-2', ['architecture']);

      expect(manager.getSubscriptions('agent-1')).toEqual(['testing']);
      expect(manager.getSubscriptions('agent-2')).toEqual(['architecture']);
    });

    it('persists subscriptions to disk', () => {
      manager.subscribe('agent-1', ['testing']);

      // Create a new manager instance pointing to the same path
      const freshManager = new SubscriptionManager(tempDir);
      expect(freshManager.getSubscriptions('agent-1')).toEqual(['testing']);
    });

    it('creates the subscriptions file if it does not exist', () => {
      const filePath = join(tempDir, 'subscriptions.json');
      expect(existsSync(filePath)).toBe(false);

      manager.subscribe('agent-1', ['testing']);

      expect(existsSync(filePath)).toBe(true);
    });
  });

  describe('unsubscribe', () => {
    it('removes specific categories from an agent', () => {
      manager.subscribe('agent-1', ['testing', 'architecture', 'performance']);
      manager.unsubscribe('agent-1', ['architecture']);

      expect(manager.getSubscriptions('agent-1')).toEqual(['testing', 'performance']);
    });

    it('removes the agent entry when all categories are unsubscribed', () => {
      manager.subscribe('agent-1', ['testing']);
      manager.unsubscribe('agent-1', ['testing']);

      expect(manager.getSubscriptions('agent-1')).toEqual([]);
      const all = manager.listAll();
      expect('agent-1' in all).toBe(false);
    });

    it('is a no-op for non-existent agent', () => {
      // Should not throw
      manager.unsubscribe('nonexistent', ['testing']);
      expect(manager.getSubscriptions('nonexistent')).toEqual([]);
    });

    it('is a no-op for categories not subscribed', () => {
      manager.subscribe('agent-1', ['testing']);
      manager.unsubscribe('agent-1', ['architecture']);

      expect(manager.getSubscriptions('agent-1')).toEqual(['testing']);
    });

    it('does not affect other agents', () => {
      manager.subscribe('agent-1', ['testing', 'architecture']);
      manager.subscribe('agent-2', ['testing']);
      manager.unsubscribe('agent-1', ['testing']);

      expect(manager.getSubscriptions('agent-1')).toEqual(['architecture']);
      expect(manager.getSubscriptions('agent-2')).toEqual(['testing']);
    });
  });

  describe('getSubscriptions', () => {
    it('returns empty array for unknown agent', () => {
      expect(manager.getSubscriptions('unknown')).toEqual([]);
    });

    it('returns empty array when no subscriptions file exists', () => {
      expect(manager.getSubscriptions('agent-1')).toEqual([]);
    });
  });

  describe('listAll', () => {
    it('returns empty object when no subscriptions exist', () => {
      expect(manager.listAll()).toEqual({});
    });

    it('returns all agents and their subscriptions', () => {
      manager.subscribe('agent-1', ['testing', 'architecture']);
      manager.subscribe('agent-2', ['debugging']);

      const all = manager.listAll();
      expect(all).toEqual({
        'agent-1': ['testing', 'architecture'],
        'agent-2': ['debugging'],
      });
    });
  });
});
