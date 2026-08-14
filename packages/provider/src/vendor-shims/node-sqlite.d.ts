/**
 * PLUMB-side ambient declaration for the subset of `node:sqlite` used by
 * vendor-shims/sqlite-database.ts.
 *
 * The repository pins @types/node 20.11.24, which predates the node:sqlite
 * typings (added in @types/node 22.5). The runtime target is Node 24, where
 * `node:sqlite` is available natively. Keeping the declaration local to the
 * provider package avoids a repo-wide @types/node bump while the runtime is
 * Node 24+.
 */
declare module 'node:sqlite' {
  export class StatementSync {
    run(...params: unknown[]): {
      changes: number | bigint;
      lastInsertRowid: number | bigint;
    };
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
    finalize(): void;
  }

  export interface DatabaseSyncOptions {
    readOnly?: boolean;
    open?: boolean;
    enableForeignKeyConstraints?: boolean;
  }

  export class DatabaseSync {
    constructor(path: string, options?: DatabaseSyncOptions);
    prepare(sql: string): StatementSync;
    exec(sql: string): void;
    close(): void;
  }
}
