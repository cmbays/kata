import { join } from 'node:path';
import { KatakaSchema, type Kataka } from '@domain/types/kataka.js';
import { JsonStore } from '@infra/persistence/json-store.js';

/** Prevents path traversal by requiring strict UUID format before building file paths. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertValidId(id: string): void {
  if (!UUID_RE.test(id)) {
    throw new Error(`Invalid kataka ID: "${id}"`);
  }
}

/**
 * KatakaRegistry — manages kataka (agent) registrations with JSON file persistence.
 *
 * Each kataka is stored as `{id}.json` in the basePath directory.
 * An in-memory cache is populated lazily from disk on first list/get.
 */
export class KatakaRegistry {
  private readonly cache = new Map<string, Kataka>();
  private loaded = false;

  constructor(private readonly basePath: string) {}

  /**
   * Register a new kataka. Validates against KatakaSchema and persists to disk.
   * If a kataka with the same ID already exists, it is overwritten.
   */
  register(kataka: Kataka): void {
    const validated = KatakaSchema.parse(kataka);
    const filePath = join(this.basePath, `${validated.id}.json`);
    JsonStore.write(filePath, validated, KatakaSchema);
    this.cache.set(validated.id, validated);
  }

  /**
   * Retrieve a kataka by ID.
   * @throws Error if the kataka is not found
   */
  get(id: string): Kataka {
    assertValidId(id);
    const cached = this.cache.get(id);
    if (cached) return cached;

    const filePath = join(this.basePath, `${id}.json`);
    if (JsonStore.exists(filePath)) {
      try {
        const kataka = JsonStore.read(filePath, KatakaSchema);
        this.cache.set(id, kataka);
        return kataka;
      } catch (e) {
        throw new Error(
          `Failed to load kataka "${id}": ${e instanceof Error ? e.message : String(e)}`,
          { cause: e },
        );
      }
    }

    throw new Error(`Kataka "${id}" not found.`);
  }

  /**
   * List all registered kataka, loading from disk if the cache is empty.
   */
  list(): Kataka[] {
    if (!this.loaded) {
      this.loadFromDisk();
    }
    return Array.from(this.cache.values());
  }

  /**
   * List only active kataka.
   */
  getActive(): Kataka[] {
    return this.list().filter((k) => k.active);
  }

  /**
   * Deactivate a kataka — sets `active: false` and persists.
   * @throws Error if the kataka is not found
   */
  deactivate(id: string): Kataka {
    assertValidId(id);
    const kataka = this.get(id);
    const updated: Kataka = { ...kataka, active: false };
    const filePath = join(this.basePath, `${id}.json`);
    JsonStore.write(filePath, updated, KatakaSchema);
    this.cache.set(id, updated);
    return updated;
  }

  /**
   * Delete a kataka from disk and cache.
   * @throws Error if the kataka is not found
   */
  delete(id: string): Kataka {
    assertValidId(id);
    const kataka = this.get(id);
    const filePath = join(this.basePath, `${id}.json`);
    JsonStore.remove(filePath);
    this.cache.delete(id);
    return kataka;
  }

  private loadFromDisk(): void {
    const kataka = JsonStore.list(this.basePath, KatakaSchema);
    for (const k of kataka) {
      this.cache.set(k.id, k);
    }
    this.loaded = true;
  }
}
