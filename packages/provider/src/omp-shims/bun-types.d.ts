/**
 * Minimal Bun type declarations for OMP catalog files.
 */

declare module "bun:sqlite" {
  class Database {
    constructor(path?: string, options?: { create?: boolean });
    exec(sql: string): Database;
    query<T = unknown, P extends unknown[] = unknown[]>(sql: string): Statement<T, P>;
    prepare<T = unknown, P extends unknown[] = unknown[]>(sql: string): Statement<T, P>;
    close(): void;
    pragma(pragma: string, value?: string): void;
    run(sql: string, ...params: unknown[]): unknown;
  }

  class Statement<T = unknown, P extends unknown[] = unknown[]> {
    run(...params: P): unknown;
    get(...params: P): T;
    all(...params: P): T[];
    finalize(): void;
  }

  export { Database, Statement };
}

interface BunEnv {
  [key: string]: string | undefined;
}

interface BunHashFn {
  (input: string | Uint8Array | ArrayBuffer, seed?: number): number;
  crc32(input: string | Uint8Array | ArrayBuffer, seed?: number): number;
  xxhash32(input: string | Uint8Array | ArrayBuffer, seed?: number): number;
  xxhash64: (
    input: string | Uint8Array | ArrayBuffer,
    seed?: bigint,
  ) => bigint;
}

interface BunFetchInit extends RequestInit {
  fetch?: typeof fetch;
}

declare const Bun: {
  hash: BunHashFn;
  env: BunEnv;
  deepEquals(a: unknown, b: unknown, opts?: { strict?: boolean }): boolean;
};
