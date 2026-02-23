import { describe, it, expect } from 'vitest';
import {
  KataError,
  ConfigNotFoundError,
  ValidationError,
  StepNotFoundError,
  PipelineNotFoundError,
  CycleNotFoundError,
  FlavorNotFoundError,
} from './errors.js';

describe('KataError', () => {
  it('has name "KataError"', () => {
    const err = new KataError('base error');
    expect(err.name).toBe('KataError');
    expect(err.message).toBe('base error');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('ConfigNotFoundError', () => {
  it('formats message with path and suggests kata init', () => {
    const err = new ConfigNotFoundError('/some/path/.kata');
    expect(err.name).toBe('ConfigNotFoundError');
    expect(err.message).toContain('/some/path/.kata');
    expect(err.message).toContain('kata init');
    expect(err).toBeInstanceOf(KataError);
  });
});

describe('ValidationError', () => {
  it('includes message and issues array', () => {
    const issues = [{ path: 'name', message: 'required' }];
    const err = new ValidationError('Validation failed', issues);
    expect(err.name).toBe('ValidationError');
    expect(err.message).toBe('Validation failed');
    expect(err.issues).toEqual(issues);
    expect(err).toBeInstanceOf(KataError);
  });
});

describe('StepNotFoundError', () => {
  it('formats message with type only', () => {
    const err = new StepNotFoundError('research');
    expect(err.name).toBe('StepNotFoundError');
    expect(err.message).toContain('"research"');
    expect(err.message).toContain('kata stage list');
    expect(err).toBeInstanceOf(KataError);
  });

  it('formats message with type and flavor', () => {
    const err = new StepNotFoundError('research', 'deep');
    expect(err.message).toContain('"research:deep"');
  });
});

describe('PipelineNotFoundError', () => {
  it('formats message with id and suggests kata pipeline status', () => {
    const err = new PipelineNotFoundError('abc-123');
    expect(err.name).toBe('PipelineNotFoundError');
    expect(err.message).toContain('"abc-123"');
    expect(err.message).toContain('kata pipeline status');
    expect(err).toBeInstanceOf(KataError);
  });
});

describe('CycleNotFoundError', () => {
  it('formats message with id and suggests kata cycle status', () => {
    const err = new CycleNotFoundError('cycle-456');
    expect(err.name).toBe('CycleNotFoundError');
    expect(err.message).toContain('"cycle-456"');
    expect(err.message).toContain('kata cycle status');
    expect(err).toBeInstanceOf(KataError);
  });
});

describe('FlavorNotFoundError', () => {
  it('formats message with stageCategory and name and suggests kata stage list', () => {
    const err = new FlavorNotFoundError('plan', 'ui-planning');
    expect(err.name).toBe('FlavorNotFoundError');
    expect(err.message).toContain('plan/ui-planning');
    expect(err.message).toContain('kata stage list');
    expect(err).toBeInstanceOf(KataError);
  });
});
