/**
 * Minimal Bun type declarations for OMP files.
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
  xxhash64: (input: string | Uint8Array | ArrayBuffer, seed?: bigint) => bigint;
}

interface BunShellResult {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number;
  quiet(): BunShellResult;
  nothrow(): BunShellResult;
}

declare namespace Bun {
  interface Server<T = unknown> {
    stop(): void;
    url: URL;
    port: number;
    hostname: string;
  }

  interface ServeOptions {
    port?: number;
    hostname?: string;
    reusePort?: boolean;
    fetch: (req: Request, server: Server) => Response | Promise<Response>;
  }

  function serve(options: ServeOptions): Server;
  function sleep(ms: number | Promise<number>): Promise<void>;

  const env: BunEnv;
  function hash(input: string | Uint8Array | ArrayBuffer, seed?: number): number;
  namespace hash {
    function crc32(input: string | Uint8Array | ArrayBuffer, seed?: number): number;
    function xxhash32(input: string | Uint8Array | ArrayBuffer, seed?: number): number;
    function xxhash64(input: string | Uint8Array | ArrayBuffer, seed?: bigint): bigint;
  }
  function deepEquals(a: unknown, b: unknown, opts?: { strict?: boolean }): boolean;
}

declare function $(strings: TemplateStringsArray, ...values: unknown[]): BunShellResult;

type Timer = ReturnType<typeof setTimeout>;
