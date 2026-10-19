export interface DbPort {
  execute(sql: string, params?: unknown[]): Promise<void>;
  select<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

export class RepoError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "RepoError";
    this.code = code;
  }
}
