import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { KataConfigSchema, type KataConfig } from '@domain/types/config.js';
import { StageRegistry } from '@infra/registries/stage-registry.js';
import { PipelineComposer } from '@domain/services/pipeline-composer.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { detectProject, type ProjectInfo } from './project-detector.js';

export interface InitOptions {
  cwd: string;
  methodology?: string;
  adapter?: string;
  skipPrompts?: boolean;
}

export interface InitResult {
  kataDir: string;
  config: KataConfig;
  stagesLoaded: number;
  templatesLoaded: number;
}

/**
 * Resolve the package root directory, where stages/ and templates/ live.
 * Works both in dev (src/) and built (dist/) contexts.
 */
function resolvePackageRoot(): string {
  // __dirname equivalent for ESM
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = dirname(thisFile);

  // Walk up from src/features/init/ or dist/features/init/ to the package root
  // In dev: src/features/init → src/features → src → root
  // In dist: dist/features/init → dist/features → dist → root
  let candidate = resolve(thisDir, '..', '..', '..');
  if (existsSync(join(candidate, 'stages', 'builtin'))) {
    return candidate;
  }

  // Fallback: try one more level up (handles nested dist structures)
  candidate = resolve(thisDir, '..', '..');
  if (existsSync(join(candidate, 'stages', 'builtin'))) {
    return candidate;
  }

  // Last resort: return the first candidate
  return resolve(thisDir, '..', '..', '..');
}

/**
 * Prompt the user for methodology and adapter interactively.
 * Only called when skipPrompts is false.
 */
async function promptOptions(): Promise<{ methodology: string; adapter: string }> {
  const { select } = await import('@inquirer/prompts');

  const methodology = await select({
    message: 'Select methodology:',
    choices: [
      { name: 'Shape Up', value: 'shape-up' },
      { name: 'Custom', value: 'custom' },
    ],
    default: 'shape-up',
  });

  const adapter = await select({
    message: 'Select execution adapter:',
    choices: [
      { name: 'Manual (human-driven)', value: 'manual' },
      { name: 'Claude CLI', value: 'claude-cli' },
      { name: 'Composio', value: 'composio' },
    ],
    default: 'manual',
  });

  return { methodology, adapter };
}

/**
 * Initialize a new kata project.
 *
 * Flow:
 * 1. Detect project context (package.json, .git, existing .kata/)
 * 2. Create .kata/ directory structure
 * 3. Write .kata/config.json
 * 4. Load built-in stages into .kata/stages/
 * 5. Load pipeline templates into .kata/templates/
 * 6. Return summary
 */
export async function handleInit(options: InitOptions): Promise<InitResult> {
  const { cwd, skipPrompts = false } = options;
  let { methodology, adapter } = options;

  // Detect existing project info
  const projectInfo: ProjectInfo = detectProject(cwd);

  // Warn if .kata/ already exists
  if (projectInfo.hasKata && !skipPrompts) {
    const { confirm } = await import('@inquirer/prompts');
    const proceed = await confirm({
      message: 'A .kata/ directory already exists. Re-initializing will overwrite config.json. Continue?',
      default: false,
    });
    if (!proceed) {
      throw new Error('Init cancelled — existing .kata/ directory preserved.');
    }
  }

  // Interactive prompts if not skipping
  if (!skipPrompts && !methodology && !adapter) {
    const prompted = await promptOptions();
    methodology = prompted.methodology;
    adapter = prompted.adapter;
  }

  // Apply defaults
  methodology = methodology ?? 'shape-up';
  adapter = adapter ?? 'manual';

  // Resolve paths
  const kataDir = join(cwd, '.kata');
  const stagesDir = join(kataDir, 'stages');
  const templatesDir = join(kataDir, 'templates');
  const cyclesDir = join(kataDir, 'cycles');
  const knowledgeDir = join(kataDir, 'knowledge');

  // Create directory structure
  JsonStore.ensureDir(kataDir);
  JsonStore.ensureDir(stagesDir);
  JsonStore.ensureDir(templatesDir);
  JsonStore.ensureDir(cyclesDir);
  JsonStore.ensureDir(knowledgeDir);

  // Build config
  const config: KataConfig = KataConfigSchema.parse({
    methodology,
    execution: {
      adapter,
      config: {},
    },
    customStagePaths: [],
    project: {
      name: projectInfo.packageName,
      repository: projectInfo.hasGit ? cwd : undefined,
    },
  });

  // Persist config
  const configPath = join(kataDir, 'config.json');
  JsonStore.write(configPath, config, KataConfigSchema);

  // Load built-in stages
  const packageRoot = resolvePackageRoot();
  const builtinStagesDir = join(packageRoot, 'stages', 'builtin');
  const registry = new StageRegistry(stagesDir);

  let stagesLoaded = 0;
  if (existsSync(builtinStagesDir)) {
    registry.loadBuiltins(builtinStagesDir);
    stagesLoaded = registry.list().length;
  }

  // Load pipeline templates
  const builtinTemplatesDir = join(packageRoot, 'templates');
  let templatesLoaded = 0;
  if (existsSync(builtinTemplatesDir)) {
    const templates = PipelineComposer.loadTemplates(builtinTemplatesDir);
    // Write each template into .kata/templates/
    const { PipelineTemplateSchema } = await import('@domain/types/pipeline.js');
    for (const template of templates) {
      const templatePath = join(templatesDir, `${template.name.toLowerCase().replace(/\s+/g, '-')}.json`);
      JsonStore.write(templatePath, template, PipelineTemplateSchema);
    }
    templatesLoaded = templates.length;
  }

  return {
    kataDir,
    config,
    stagesLoaded,
    templatesLoaded,
  };
}
