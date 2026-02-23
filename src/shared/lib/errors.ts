export class KataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KataError';
  }
}

export class ConfigNotFoundError extends KataError {
  constructor(path: string) {
    super(
      `No .kata/ directory found at ${path}. Run "kata init" to initialize your project.`,
    );
    this.name = 'ConfigNotFoundError';
  }
}

export class ValidationError extends KataError {
  constructor(
    message: string,
    public readonly issues: unknown[],
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class StepNotFoundError extends KataError {
  constructor(type: string, flavor?: string) {
    const name = flavor ? `${type}:${flavor}` : type;
    super(`Step not found: "${name}". Run "kata stage list" to see available steps.`);
    this.name = 'StepNotFoundError';
  }
}

/** @deprecated Use StepNotFoundError */
export const StageNotFoundError = StepNotFoundError;

export class PipelineNotFoundError extends KataError {
  constructor(id: string) {
    super(`Pipeline not found: "${id}". Run "kata pipeline status" to see active pipelines.`);
    this.name = 'PipelineNotFoundError';
  }
}

export class CycleNotFoundError extends KataError {
  constructor(id: string) {
    super(`Cycle not found: "${id}". Run "kata cycle status" to see active cycles.`);
    this.name = 'CycleNotFoundError';
  }
}

export class FlavorNotFoundError extends KataError {
  constructor(stageCategory: string, name: string) {
    super(`Flavor not found: "${stageCategory}/${name}". Run "kata stage list" to see available flavors.`);
    this.name = 'FlavorNotFoundError';
  }
}
