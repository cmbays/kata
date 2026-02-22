import { join } from 'node:path';
import { z } from 'zod/v4';
import { JsonStore } from '@infra/persistence/json-store.js';

/**
 * Schema for the subscriptions file: maps agent IDs to arrays of category strings.
 */
export const SubscriptionsSchema = z.record(z.string(), z.array(z.string()));

export type Subscriptions = z.infer<typeof SubscriptionsSchema>;

/**
 * Manages agent-to-category subscriptions for Tier 2 learning loading.
 *
 * Storage: a single JSON file at `<basePath>/subscriptions.json` mapping
 * agent IDs to category arrays.
 */
export class SubscriptionManager {
  private readonly subscriptionsPath: string;

  constructor(basePath: string) {
    this.subscriptionsPath = join(basePath, 'subscriptions.json');
  }

  /**
   * Add categories to an agent's subscriptions (merge, don't replace).
   * Deduplicates categories automatically.
   */
  subscribe(agentId: string, categories: string[]): void {
    const all = this.loadSubscriptions();
    const existing = all[agentId] ?? [];
    const merged = [...new Set([...existing, ...categories])];
    all[agentId] = merged;
    this.saveSubscriptions(all);
  }

  /**
   * Remove specific categories from an agent's subscriptions.
   */
  unsubscribe(agentId: string, categories: string[]): void {
    const all = this.loadSubscriptions();
    const existing = all[agentId];
    if (!existing) return;

    const filtered = existing.filter((cat) => !categories.includes(cat));
    if (filtered.length === 0) {
      delete all[agentId];
    } else {
      all[agentId] = filtered;
    }
    this.saveSubscriptions(all);
  }

  /**
   * Get all subscribed categories for an agent.
   * Returns empty array if agent has no subscriptions.
   */
  getSubscriptions(agentId: string): string[] {
    const all = this.loadSubscriptions();
    return all[agentId] ?? [];
  }

  /**
   * Get the full subscription map (all agents and their categories).
   */
  listAll(): Record<string, string[]> {
    return this.loadSubscriptions();
  }

  private loadSubscriptions(): Subscriptions {
    if (!JsonStore.exists(this.subscriptionsPath)) {
      return {};
    }
    return JsonStore.read(this.subscriptionsPath, SubscriptionsSchema);
  }

  private saveSubscriptions(subscriptions: Subscriptions): void {
    JsonStore.write(this.subscriptionsPath, subscriptions, SubscriptionsSchema);
  }
}
