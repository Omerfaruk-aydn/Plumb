/**
 * Minimal shim for @oh-my-pi/pi-utils used by the imported OMP catalog.
 * Provides only the functions actually needed by the catalog subsystem.
 *
 * OMP source: D:\PLUMB-upstreams\oh-my-pi\packages\utils\src\
 * OMP SHA: 4df68d60438423b384b2b47fb3d6835641624757
 */

import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

// ─── Types ─────────────────────────────────────────────────────────────

export type FetchImpl = typeof fetch;

// ─── Path helpers ──────────────────────────────────────────────────────

export function getModelDbPath(): string {
  const home = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '/tmp';
  const dir = join(home, '.plumb');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'models.db');
}

export function getAgentDbPath(): string {
  const home = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '/tmp';
  const dir = join(home, '.plumb');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'agent.db');
}

export function getAgentDir(): string {
  const home = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '/tmp';
  return join(home, '.plumb');
}

export function getConfigRootDir(): string {
  const home = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '/tmp';
  return join(home, '.plumb');
}

// ─── Type guards ───────────────────────────────────────────────────────

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isEnoent(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

// ─── Fetch helpers ─────────────────────────────────────────────────────

export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  retries = 3,
): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      lastError = err;
      if (i < retries - 1) {
        await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
      }
    }
  }
  throw lastError;
}

export function wrapFetchForExtraCa(
  _fetchImpl: FetchImpl,
): FetchImpl {
  // In PLUMB, we don't add extra CA certs — return fetch as-is
  return _fetchImpl;
}

// ─── Function helpers ──────────────────────────────────────────────────

export function once<T>(fn: () => T): () => T {
  let called = false;
  let result: T;
  return () => {
    if (!called) {
      called = true;
      result = fn();
    }
    return result;
  };
}

// ─── Logger ────────────────────────────────────────────────────────────

export function log(...args: unknown[]): void {
  console.log('[PLUMB]', ...args);
}

export function warn(...args: unknown[]): void {
  console.warn('[PLUMB]', ...args);
}

export function error(...args: unknown[]): void {
  console.error('[PLUMB]', ...args);
}

export function debug(...args: unknown[]): void {
  if (process.env['DEBUG']) {
    console.debug('[PLUMB]', ...args);
  }
}

// ─── Environment ───────────────────────────────────────────────────────

export function $env(key: string): string | undefined {
  return process.env[key];
}

// ─── SSE helpers ───────────────────────────────────────────────────────

export async function* readSseJson(
  response: Response,
): AsyncGenerator<Record<string, unknown>, void, unknown> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') return;
          try {
            yield JSON.parse(data) as Record<string, unknown>;
          } catch {
            // Skip malformed JSON
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function readStream(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let result = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      result += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  return result;
}

export function extractHttpStatusFromError(error: unknown): number | null {
  if (error instanceof Response) return error.status;
  if (error instanceof Error) {
    const match = /status[:\s]+(\d{3})/i.exec(error.message);
    if (match) return parseInt(match[1], 10);
  }
  return null;
}

// Re-export logger as namespace for `import * as logger` pattern
export const logger = { log, warn, error, debug };
