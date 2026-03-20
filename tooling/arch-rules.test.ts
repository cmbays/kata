/**
 * Architecture rules enforced by ArchUnit.
 *
 * These complement dependency-cruiser's import-direction checks with
 * structural and cohesion rules that static import analysis cannot detect:
 *
 * - Domain files must not depend on infrastructure (already in dep-cruiser, duplicated for completeness)
 * - Infrastructure files must not contain domain logic (new — the session-bridge lesson)
 * - Domain services must have high cohesion (LCOM)
 * - Naming conventions enforce layer placement
 * - No cycles within layers
 *
 * Run: npx vitest run --config vitest.arch.config.ts
 * Or:  npm run test:arch:unit
 */
import { describe, it, expect } from 'vitest';
import { projectFiles, metrics } from 'archunit';

const tsConfig = './tsconfig.json';
const opts = { allowEmptyTests: true };

describe('Layer dependency rules', () => {
  it('domain must not depend on infrastructure', async () => {
    const violations = await projectFiles(tsConfig)
      .inFolder('src/domain')
      .shouldNot()
      .dependOnFiles()
      .inFolder('src/infrastructure')
      .check(opts);

    expect(violations, fmtV(violations)).toHaveLength(0);
  });

  it('domain must not depend on features', async () => {
    const violations = await projectFiles(tsConfig)
      .inFolder('src/domain')
      .shouldNot()
      .dependOnFiles()
      .inFolder('src/features')
      .check(opts);

    expect(violations, fmtV(violations)).toHaveLength(0);
  });

  it('domain must not depend on CLI', async () => {
    const violations = await projectFiles(tsConfig)
      .inFolder('src/domain')
      .shouldNot()
      .dependOnFiles()
      .inFolder('src/cli')
      .check(opts);

    expect(violations, fmtV(violations)).toHaveLength(0);
  });

  it('infrastructure must not depend on features', async () => {
    const violations = await projectFiles(tsConfig)
      .inFolder('src/infrastructure')
      .shouldNot()
      .dependOnFiles()
      .inFolder('src/features')
      .check(opts);

    expect(violations, fmtV(violations)).toHaveLength(0);
  });

  it('infrastructure must not depend on CLI', async () => {
    const violations = await projectFiles(tsConfig)
      .inFolder('src/infrastructure')
      .shouldNot()
      .dependOnFiles()
      .inFolder('src/cli')
      .check(opts);

    expect(violations, fmtV(violations)).toHaveLength(0);
  });

  it('shared must not depend on features', async () => {
    const violations = await projectFiles(tsConfig)
      .inFolder('src/shared')
      .shouldNot()
      .dependOnFiles()
      .inFolder('src/features')
      .check(opts);

    expect(violations, fmtV(violations)).toHaveLength(0);
  });

  it('shared must not depend on CLI', async () => {
    const violations = await projectFiles(tsConfig)
      .inFolder('src/shared')
      .shouldNot()
      .dependOnFiles()
      .inFolder('src/cli')
      .check(opts);

    expect(violations, fmtV(violations)).toHaveLength(0);
  });
});

describe('Cycle-free layers', () => {
  it('domain layer has no import cycles', async () => {
    const violations = await projectFiles(tsConfig)
      .inFolder('src/domain')
      .should()
      .haveNoCycles()
      .check(opts);

    expect(violations, fmtV(violations)).toHaveLength(0);
  });

  it('infrastructure layer has no import cycles', async () => {
    const violations = await projectFiles(tsConfig)
      .inFolder('src/infrastructure')
      .should()
      .haveNoCycles()
      .check(opts);

    expect(violations, fmtV(violations)).toHaveLength(0);
  });
});

describe('Naming conventions', () => {
  it('files in domain/services should have service-like names', async () => {
    const violations = await projectFiles(tsConfig)
      .inFolder('src/domain/services')
      .shouldNot()
      .haveName(/store|adapter|handler|controller|command/i)
      .check(opts);

    expect(violations, fmtV(violations)).toHaveLength(0);
  });

  it('files in domain/ports should be interfaces or type definitions', async () => {
    const violations = await projectFiles(tsConfig)
      .inFolder('src/domain/ports')
      .should()
      .adhereTo(
        (fileInfo) => {
          const content = fileInfo.content ?? '';
          const hasClassImpl = /^export\s+class\s+\w+\s*\{/m.test(content);
          return !hasClassImpl;
        },
        'Port files in domain/ports should define interfaces/types, not class implementations',
      )
      .check(opts);

    expect(violations, fmtV(violations)).toHaveLength(0);
  });

  it('files in domain/rules should be pure functions, not classes', async () => {
    const violations = await projectFiles(tsConfig)
      .inFolder('src/domain/rules')
      .should()
      .adhereTo(
        (fileInfo) => {
          const content = fileInfo.content ?? '';
          const hasClass = /^export\s+class\s/m.test(content);
          return !hasClass;
        },
        'Rule files in domain/rules should export pure functions, not classes',
      )
      .check(opts);

    expect(violations, fmtV(violations)).toHaveLength(0);
  });
});

describe('Cohesion metrics', () => {
  // LCOM4: number of connected components among methods sharing fields.
  // 1 = perfectly cohesive. Higher = should consider splitting.
  // Baseline: CycleManager=16, BaseStageOrchestrator=15.
  // Ratchet down as we extract more responsibilities.
  it('domain services have acceptable LCOM4', async () => {
    const violations = await metrics(tsConfig)
      .inFolder('src/domain/services')
      .lcom()
      .lcom4()
      .shouldBeBelowOrEqual(16)
      .check(opts);

    expect(violations, fmtV(violations)).toHaveLength(0);
  });

  it('infrastructure files have acceptable LCOM4', async () => {
    const violations = await metrics(tsConfig)
      .inFolder('src/infrastructure')
      .lcom()
      .lcom4()
      .shouldBeBelowOrEqual(15)
      .check(opts);

    expect(violations, fmtV(violations)).toHaveLength(0);
  });
});

describe('Infrastructure structural rules', () => {
  it('infrastructure files must not instantiate domain services', async () => {
    const violations = await projectFiles(tsConfig)
      .inFolder('src/infrastructure')
      .should()
      .adhereTo(
        (fileInfo) => {
          const content = fileInfo.content ?? '';
          const domainServiceInstantiation = /new\s+(CycleManager|ManifestBuilder|PipelineComposer|StageOrchestrator|MetaOrchestrator)\s*\(/;
          return !domainServiceInstantiation.test(content);
        },
        'Infrastructure files must not instantiate domain services directly — use dependency injection',
      )
      .check(opts);

    expect(violations, fmtV(violations)).toHaveLength(0);
  });
});

function fmtV(violations: { toString(): string }[]): string {
  if (violations.length === 0) return '';
  return '\nArchitecture violations:\n' + violations.map((v) => `  - ${v.toString()}`).join('\n');
}
