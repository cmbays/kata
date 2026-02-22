export class KataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KataError';
  }
}

export class ConfigNotFoundError extends KataError {
  constructor(path: string) {
    super(
      `No .kata/ directory found at ${path}. Run "kata begin" to initialize your project.`,
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

export class StageNotFoundError extends KataError {
  constructor(type: string, flavor?: string) {
    const name = flavor ? `${type}:${flavor}` : type;
    super(`Stage not found: "${name}". Run "kata form list" to see available stages.`);
    this.name = 'StageNotFoundError';
  }
}

export class PipelineNotFoundError extends KataError {
  constructor(id: string) {
    super(`Pipeline not found: "${id}". Run "kata sequence status" to see active pipelines.`);
    this.name = 'PipelineNotFoundError';
  }
}

export class CycleNotFoundError extends KataError {
  constructor(id: string) {
    super(`Cycle not found: "${id}". Run "kata practice status" to see active cycles.`);
    this.name = 'CycleNotFoundError';
  }
}
