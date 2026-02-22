export interface IRefResolver {
  resolveRef(ref: string, basePath: string): string;
}
