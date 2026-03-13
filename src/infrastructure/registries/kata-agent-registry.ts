import { join } from 'node:path';
import { KataAgentSchema, type KataAgent } from '@domain/types/kata-agent.js';
import { JsonStore } from '@infra/persistence/json-store.js';

/** Prevents path traversal by requiring strict UUID format before building file paths. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertValidId(id: string): void {
  if (!UUID_RE.test(id)) {
    throw new Error(`Invalid agent ID: "${id}"`);
  }
}

/**
 * KataAgentRegistry — manages kata agent registrations with JSON file persistence.
 *
 * Each agent is stored as `{id}.json` in the basePath directory.
 * An in-memory cache is populated lazily from disk on first list/get.
 */
export class KataAgentRegistry {
  private readonly cache = new Map<string, KataAgent>();
  private loaded = false;

  constructor(private readonly basePath: string) {}

  /**
   * Register a new agent. Validates against KataAgentSchema and persists to disk.
   * If an agent with the same ID already exists, it is overwritten.
   */
  register(agent: KataAgent): void {
    const validated = KataAgentSchema.parse(agent);
    const filePath = join(this.basePath, `${validated.id}.json`);
    JsonStore.write(filePath, validated, KataAgentSchema);
    this.cache.set(validated.id, validated);
  }

  /**
   * Retrieve an agent by ID.
   * @throws Error if the agent is not found
   */
  get(id: string): KataAgent {
    assertValidId(id);
    const cached = this.cache.get(id);
    if (cached) return cached;

    const filePath = join(this.basePath, `${id}.json`);
    if (JsonStore.exists(filePath)) {
      try {
        const agent = JsonStore.read(filePath, KataAgentSchema);
        this.cache.set(id, agent);
        return agent;
      } catch (e) {
        throw new Error(
          `Failed to load agent "${id}": ${e instanceof Error ? e.message : String(e)}`,
          { cause: e },
        );
      }
    }

    throw new Error(`Agent "${id}" not found.`);
  }

  /**
   * List all registered agents, loading from disk if the cache is empty.
   */
  list(): KataAgent[] {
    if (!this.loaded) {
      this.loadFromDisk();
    }
    return Array.from(this.cache.values());
  }

  /**
   * List only active agents.
   */
  getActive(): KataAgent[] {
    return this.list().filter((k) => k.active);
  }

  /**
   * Deactivate an agent — sets `active: false` and persists.
   * @throws Error if the agent is not found
   */
  deactivate(id: string): KataAgent {
    assertValidId(id);
    const agent = this.get(id);
    const updated: KataAgent = { ...agent, active: false };
    const filePath = join(this.basePath, `${id}.json`);
    JsonStore.write(filePath, updated, KataAgentSchema);
    this.cache.set(id, updated);
    return updated;
  }

  /**
   * Delete an agent from disk and cache.
   * @throws Error if the agent is not found
   */
  delete(id: string): KataAgent {
    assertValidId(id);
    const agent = this.get(id);
    const filePath = join(this.basePath, `${id}.json`);
    JsonStore.remove(filePath);
    this.cache.delete(id);
    return agent;
  }

  private loadFromDisk(): void {
    const agents = JsonStore.list(this.basePath, KataAgentSchema);
    for (const agent of agents) {
      this.cache.set(agent.id, agent);
    }
    this.loaded = true;
  }
}
