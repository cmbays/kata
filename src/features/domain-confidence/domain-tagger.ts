import type { DomainTags } from '@domain/types/domain-tags.js';

/**
 * DomainTagger — pure function, no external dependencies.
 *
 * Auto-detect domain tags from a bet description string using keyword heuristics.
 * Returns an empty object if no heuristics match.
 * Always sets `source: 'auto-detected'` when at least one tag is inferred.
 */
export function detectTags(description: string): Partial<DomainTags> {
  const lower = description.toLowerCase();
  const result: Partial<DomainTags> = {};

  // --- domain heuristics ---
  if (
    lower.includes('frontend') ||
    lower.includes('react') ||
    lower.includes('vue') ||
    lower.includes('angular') ||
    lower.includes('css') ||
    lower.includes(' ui ') ||
    lower.startsWith('ui ') ||
    lower.endsWith(' ui') ||
    lower === 'ui' ||
    lower.includes(' ux ') ||
    lower.startsWith('ux ') ||
    lower.endsWith(' ux') ||
    lower === 'ux'
  ) {
    result.domain = 'web-frontend';
  } else if (
    lower.includes('backend') ||
    lower.includes(' api ') ||
    lower.startsWith('api ') ||
    lower.endsWith(' api') ||
    lower === 'api' ||
    lower.includes('server') ||
    lower.includes('express') ||
    lower.includes('fastapi') ||
    lower.includes('django')
  ) {
    result.domain = 'web-backend';
  }

  // --- language heuristics ---
  if (lower.includes('typescript') || lower.includes(' ts ') || lower.includes('.ts')) {
    result.language = 'typescript-js';
  } else if (lower.includes('python') || lower.includes('.py')) {
    result.language = 'python';
  } else if (lower.includes('rust')) {
    result.language = 'rust';
  } else if (lower.includes('go ') || lower.includes('golang')) {
    result.language = 'go';
  }

  // --- workType heuristics ---
  if (lower.includes('fix') || lower.includes('bug') || lower.includes('broken') || lower.includes('error')) {
    result.workType = 'bug-fix';
  } else if (lower.includes('refactor')) {
    result.workType = 'refactor';
  } else if (lower.includes('greenfield') || lower.includes('new project') || lower.includes('from scratch')) {
    result.workType = 'greenfield';
  } else if (lower.includes('migrate') || lower.includes('migration')) {
    result.workType = 'legacy-migration';
  }

  // --- scope heuristics (based on description length) ---
  if (description.length < 50) {
    result.scope = 'small';
  } else if (description.length > 200) {
    result.scope = 'large';
  }

  // Set source only if any tag was detected
  const hasAnyTag = Object.keys(result).length > 0;
  if (hasAnyTag) {
    result.source = 'auto-detected';
  }

  return result;
}
