/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * PLUMB runtime adaptation for the auth-storage module's `bun:sqlite` API
 * surface, backed by Node's built-in `node:sqlite` DatabaseSync.
 *
 * Surface implemented:
 * - `new Database(path)` (positional path; default in-memory for tests)
 * - `db.prepare(sql)` -> Statement (run/get/all/finalize)
 * - `db.query(sql)`  -> Statement (bun alias of prepare)
 * - `db.run(sql, ...params)` (multi-statement string when no params, via exec)
 * - `db.transaction(fn)` (BEGIN IMMEDIATE / COMMIT / ROLLBACK)
 * - `db.pragma(name, value?)`, `db.close()`
 *
 * The upstream SQLite semantics are preserved: WAL + busy_timeout + data_version
 * polling all flow through the same SQLite file format, so a database written
 * by the Bun runtime remains readable here and vice versa.
 */
import { DatabaseSync } from 'node:sqlite';

/**
 * node:sqlite emits one ExperimentalWarning to stderr on first use. Swallow
 * exactly that line for the duration of the first constructor call — the
 * warning is emitted synchronously inside `new DatabaseSync(...)`, so the
 * interception window is deterministic and self-contained.
 */
function openDatabaseSync(path: string, readOnly?: boolean): DatabaseSync {
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
    const text = typeof chunk === 'string' ? chunk : String(chunk);
    if (
      text.includes('ExperimentalWarning: SQLite is an experimental feature')
    ) {
      return true;
    }
    return originalWrite(
      chunk as Parameters<typeof originalWrite>[0],
      ...(rest as []),
    );
  }) as typeof process.stderr.write;
  try {
    return new DatabaseSync(path, readOnly ? { readOnly: true } : undefined);
  } finally {
    process.stderr.write = originalWrite;
  }
}

type RunResult = { changes: number; lastInsertRowid: number | bigint };

export class Statement<T = unknown> {
  #stmt: ReturnType<DatabaseSync['prepare']>;

  constructor(stmt: ReturnType<DatabaseSync['prepare']>) {
    this.#stmt = stmt;
  }

  run(...params: unknown[]): RunResult {
    const result = this.#stmt.run(...params);
    return {
      changes: Number(result.changes),
      lastInsertRowid: result.lastInsertRowid,
    };
  }

  get(...params: unknown[]): T | undefined {
    return this.#stmt.get(...params) as T | undefined;
  }

  all(...params: unknown[]): T[] {
    return this.#stmt.all(...params) as T[];
  }

  finalize(): void {
    this.#stmt.finalize();
  }
}

export class Database {
  #db: DatabaseSync;

  constructor(
    path?: string,
    options?: { create?: boolean; readOnly?: boolean },
  ) {
    this.#db = openDatabaseSync(path ?? ':memory:', options?.readOnly === true);
  }

  prepare<T = unknown>(sql: string): Statement<T> {
    return new Statement<T>(this.#db.prepare(sql));
  }

  query<T = unknown>(sql: string): Statement<T> {
    return this.prepare<T>(sql);
  }

  run(sql: string, ...params: unknown[]): RunResult {
    if (params.length === 0) {
      this.#db.exec(sql);
      return { changes: 0, lastInsertRowid: 0 };
    }
    const result = this.#db.prepare(sql).run(...params);
    return {
      changes: Number(result.changes),
      lastInsertRowid: result.lastInsertRowid,
    };
  }

  transaction<TArgs extends unknown[], TResult>(
    fn: (...args: TArgs) => TResult,
  ): (...args: TArgs) => TResult {
    return (...args: TArgs): TResult => {
      this.#db.exec('BEGIN IMMEDIATE');
      try {
        const result = fn(...args);
        this.#db.exec('COMMIT');
        return result;
      } catch (err) {
        this.#db.exec('ROLLBACK');
        throw err;
      }
    };
  }

  pragma(pragma: string, value?: string): void {
    if (value === undefined) {
      this.#db.exec(`PRAGMA ${pragma}`);
    } else {
      this.#db.exec(`PRAGMA ${pragma}=${value}`);
    }
  }

  close(): void {
    this.#db.close();
  }
}
