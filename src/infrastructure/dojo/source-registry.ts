import { existsSync, readFileSync } from 'node:fs';
import { JsonStore } from '@infra/persistence/json-store.js';
import {
  DojoSourceRegistrySchema,
  DojoSourceSchema,
  type DojoSource,
  type DojoSourceRegistry,
} from '@domain/types/dojo.js';
import { logger } from '@shared/lib/logger.js';

export class SourceRegistry {
  private registry: DojoSourceRegistry;

  constructor(
    private readonly registryPath: string,
  ) {
    this.registry = this.loadOrCreate();
  }

  list(): DojoSource[] {
    return this.registry.sources;
  }

  forDomain(domain: string): DojoSource[] {
    return this.registry.sources.filter(
      (s) => s.active && s.domains.includes(domain),
    );
  }

  active(): DojoSource[] {
    return this.registry.sources.filter((s) => s.active);
  }

  add(source: DojoSource): void {
    const parsed = DojoSourceSchema.parse(source);
    const existing = this.registry.sources.findIndex((s) => s.id === parsed.id);
    if (existing >= 0) {
      this.registry.sources[existing] = parsed;
    } else {
      this.registry.sources.push(parsed);
    }
    this.save();
  }

  remove(id: string): boolean {
    const before = this.registry.sources.length;
    this.registry.sources = this.registry.sources.filter((s) => s.id !== id);
    if (this.registry.sources.length < before) {
      this.save();
      return true;
    }
    return false;
  }

  toggleActive(id: string): boolean {
    const source = this.registry.sources.find((s) => s.id === id);
    if (!source) return false;
    source.active = !source.active;
    this.save();
    return true;
  }

  static loadDefaults(defaultsPath: string): DojoSource[] {
    if (!existsSync(defaultsPath)) {
      logger.warn(`Default sources file not found at "${defaultsPath}"`);
      return [];
    }
    try {
      const raw = JSON.parse(readFileSync(defaultsPath, 'utf-8'));
      const registry = DojoSourceRegistrySchema.parse(raw);
      return registry.sources;
    } catch (err) {
      logger.warn(`Failed to load default sources: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  seedDefaults(defaults: DojoSource[]): number {
    let added = 0;
    for (const source of defaults) {
      const exists = this.registry.sources.some((s) => s.name === source.name && s.url === source.url);
      if (!exists) {
        this.registry.sources.push(DojoSourceSchema.parse(source));
        added++;
      }
    }
    if (added > 0) this.save();
    return added;
  }

  private loadOrCreate(): DojoSourceRegistry {
    if (JsonStore.exists(this.registryPath)) {
      return JsonStore.read(this.registryPath, DojoSourceRegistrySchema);
    }
    return { sources: [], updatedAt: new Date().toISOString() };
  }

  private save(): void {
    this.registry.updatedAt = new Date().toISOString();
    JsonStore.write(this.registryPath, this.registry, DojoSourceRegistrySchema);
  }
}
