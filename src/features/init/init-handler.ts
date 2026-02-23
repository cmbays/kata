import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readdirSync, copyFileSync } from 'node:fs';
import { KataConfigSchema, type KataConfig } from '@domain/types/config.js';
import { StageRegistry } from '@infra/registries/stage-registry.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { loadPipelineTemplates } from '@infra/persistence/pipeline-template-store.js';
import { checkBinaryExists } from '@infra/execution/claude-cli-adapter.js';
import { generateAoConfig, detectGitBranch, deriveProjectKey } from '@infra/execution/ao-config-generator.js';
import { KATA_DIRS } from '@shared/constants/paths.js';
import { logger } from '@shared/lib/logger.js';
import { detectProject, type ProjectInfo, type ProjectType } from './project-detector.js';

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
  projectType: ProjectType;
  /** Whether the claude binary was found on PATH (only set when adapter = claude-cli) */
  claudeCliDetected?: boolean;
  /** Path to generated AO config file (only set when adapter = composio) */
  aoConfigPath?: string;
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
  if (existsSync(join(candidate, KATA_DIRS.stages, KATA_DIRS.builtin))) {
    return candidate;
  }

  // Fallback: try one more level up (handles nested dist structures)
  candidate = resolve(thisDir, '..', '..');
  if (existsSync(join(candidate, KATA_DIRS.stages, KATA_DIRS.builtin))) {
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
 * 5. Copy built-in prompt templates into .kata/prompts/
 * 6. Load pipeline templates into .kata/templates/
 * 7. Return summary
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
  const kataDir = join(cwd, KATA_DIRS.root);
  const stagesDir = join(kataDir, KATA_DIRS.stages);
  const templatesDir = join(kataDir, KATA_DIRS.templates);
  const cyclesDir = join(kataDir, KATA_DIRS.cycles);
  const knowledgeDir = join(kataDir, KATA_DIRS.knowledge);

  // Create directory structure
  JsonStore.ensureDir(kataDir);
  JsonStore.ensureDir(stagesDir);
  JsonStore.ensureDir(templatesDir);
  JsonStore.ensureDir(cyclesDir);
  JsonStore.ensureDir(knowledgeDir);
  JsonStore.ensureDir(join(kataDir, KATA_DIRS.pipelines));
  JsonStore.ensureDir(join(kataDir, KATA_DIRS.history));
  JsonStore.ensureDir(join(kataDir, KATA_DIRS.tracking));
  JsonStore.ensureDir(join(kataDir, KATA_DIRS.prompts));

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
  const configPath = join(kataDir, KATA_DIRS.config);
  JsonStore.write(configPath, config, KataConfigSchema);

  // Adapter-specific setup
  let claudeCliDetected: boolean | undefined;
  let aoConfigPath: string | undefined;

  if (adapter === 'claude-cli') {
    claudeCliDetected = await checkBinaryExists('claude');
    if (!claudeCliDetected) {
      logger.warn('claude binary not found on PATH. Install Claude Code before running stages.');
    }
  } else if (adapter === 'composio') {
    const projectKey = deriveProjectKey(projectInfo.packageName, cwd);
    const branch = detectGitBranch(cwd);
    aoConfigPath = join(kataDir, 'ao-config.yaml');
    generateAoConfig({ projectKey, repoPath: cwd, branch, outputPath: aoConfigPath });
  }

  // Load built-in stages
  const packageRoot = resolvePackageRoot();
  const builtinStagesDir = join(packageRoot, KATA_DIRS.stages, KATA_DIRS.builtin);
  const registry = new StageRegistry(stagesDir);

  let stagesLoaded = 0;
  if (existsSync(builtinStagesDir)) {
    registry.loadBuiltins(builtinStagesDir);
    stagesLoaded = registry.list().length;
  } else {
    logger.warn(`Built-in stages not found at "${builtinStagesDir}". Stages were not loaded — check your installation.`);
  }

  // Copy prompt templates to .kata/prompts/
  // Stage JSONs reference "../prompts/<name>.md" (relative to .kata/stages/),
  // so they resolve to .kata/prompts/<name>.md at runtime.
  // Source: {packageRoot}/stages/prompts/*.md
  const builtinPromptsDir = join(packageRoot, KATA_DIRS.stages, KATA_DIRS.prompts);
  if (existsSync(builtinPromptsDir)) {
    const promptsDir = join(kataDir, KATA_DIRS.prompts);
    let mdFiles: string[] = [];
    try {
      mdFiles = readdirSync(builtinPromptsDir).filter((f) => f.endsWith('.md'));
    } catch (err) {
      logger.warn(`Could not list prompt templates directory: ${err instanceof Error ? err.message : String(err)}`);
    }
    for (const mdFile of mdFiles) {
      try {
        copyFileSync(join(builtinPromptsDir, mdFile), join(promptsDir, mdFile));
      } catch (err) {
        logger.warn(`Could not copy prompt template "${mdFile}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } else {
    logger.warn(`Built-in prompt templates not found at "${builtinPromptsDir}". Prompts were not copied.`);
  }

  // Load pipeline templates
  const builtinTemplatesDir = join(packageRoot, KATA_DIRS.templates);
  let templatesLoaded = 0;
  if (existsSync(builtinTemplatesDir)) {
    const templates = loadPipelineTemplates(builtinTemplatesDir);
    // Write each template into .kata/templates/
    const { PipelineTemplateSchema } = await import('@domain/types/pipeline.js');
    for (const template of templates) {
      const templatePath = join(templatesDir, `${template.name.toLowerCase().replace(/\s+/g, '-')}.json`);
      JsonStore.write(templatePath, template, PipelineTemplateSchema);
    }
    templatesLoaded = templates.length;
  } else {
    logger.warn(`Built-in pipeline templates not found at "${builtinTemplatesDir}". Templates were not loaded.`);
  }

  return {
    kataDir,
    config,
    stagesLoaded,
    templatesLoaded,
    projectType: projectInfo.projectType,
    claudeCliDetected,
    aoConfigPath,
  };
}
