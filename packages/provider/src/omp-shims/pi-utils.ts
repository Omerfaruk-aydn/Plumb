/**
 * Comprehensive shim for @oh-my-pi/pi-utils.
 * Provides all functions actually imported by the OMP auth/provider/transport closure.
 *
 * OMP source: D:\PLUMB-upstreams\oh-my-pi\packages\utils\src\
 * OMP SHA: 4df68d60438423b384b2b47fb3d6835641624757
 */

import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// ─── Types ─────────────────────────────────────────────────────────────
export type FetchImpl = typeof fetch;

// ─── Constants ─────────────────────────────────────────────────────────
export const APP_NAME = 'plumb';
export const MAIN_CONFIG_FILENAMES = ['plumb.json', 'plumb.jsonc', 'plumb.yaml', 'plumb.yml'];

// ─── Environment ───────────────────────────────────────────────────────
function getHome(): string {
  return process.env['HOME'] ?? process.env['USERPROFILE'] ?? '/tmp';
}

export const $env: Record<string, string> = new Proxy({} as Record<string, string>, {
  get(_, key: string) { return process.env[key] ?? ''; },
});

export function $pickenv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

const TRUTHY: Record<string, boolean> = { '1': true, 'true': true, 'yes': true, 'on': true };
export function $flag(name: string, def = false): boolean {
  const value = process.env[name];
  if (!value) return def;
  return TRUTHY[value.toLowerCase()] === true;
}

export function $envpos(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) || parsed <= 0 ? defaultValue : parsed;
}

// ─── Path helpers ──────────────────────────────────────────────────────
export function getModelDbPath(): string {
  const dir = join(getHome(), '.plumb');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'models.db');
}

export function getAgentDbPath(): string {
  const dir = join(getHome(), '.plumb');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'agent.db');
}

export function getAgentDir(): string { return join(getHome(), '.plumb'); }
export function getConfigRootDir(): string { return join(getHome(), '.plumb'); }

export function getLogsDir(): string {
  const dir = join(getHome(), '.plumb', 'logs');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function getAuthBrokerSnapshotCachePath(): string {
  const dir = join(getHome(), '.plumb');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'auth-broker-snapshot.json');
}

export function getInstallId(): string {
  const dir = join(getHome(), '.plumb');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const idFile = join(dir, 'install-id');
  try { return readFileSync(idFile, 'utf-8').trim(); } catch {
    const id = randomUUID();
    writeFileSync(idFile, id);
    return id;
  }
}

// ─── Type guards ───────────────────────────────────────────────────────
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? (value as Record<string, unknown>) : null;
}

export function isEnoent(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

export function isBunTestRuntime(): boolean { return false; }

// ─── Error classification ──────────────────────────────────────────────
export function isUnexpectedSocketCloseMessage(msg: string): boolean {
  return /socket.*close|connection.*reset|ECONNRESET|EPIPE/i.test(msg);
}

export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes('econnreset') || msg.includes('econnrefused') || msg.includes('etimedout') ||
    msg.includes('socket hang up') || msg.includes('network') || msg.includes('503') ||
    msg.includes('429') || msg.includes('502') || msg.includes('500');
}

export function extractHttpStatusFromError(error: unknown): number | null {
  if (error instanceof Response) return error.status;
  if (error instanceof Error) {
    const match = /status[:\s]+(\d{3})/i.exec(error.message);
    if (match) return parseInt(match[1], 10);
  }
  return null;
}

export function extractRetryHint(source: Response | Headers | null | undefined): number | undefined {
  if (!source) return undefined;
  const headers = source instanceof Response ? source.headers : source;
  const retryAfter = headers.get('retry-after');
  if (!retryAfter) return undefined;
  const seconds = parseInt(retryAfter, 10);
  return isNaN(seconds) ? undefined : seconds * 1000;
}

// ─── Fetch helpers ─────────────────────────────────────────────────────
export async function fetchWithRetry(url: string, init?: RequestInit, retries = 3): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i < retries; i++) {
    try { return await fetch(url, init); } catch (err) {
      lastError = err;
      if (i < retries - 1) await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastError;
}

export function wrapFetchForExtraCa(f: FetchImpl): FetchImpl { return f; }
export function withExtraCaFetch<T extends { fetch?: FetchImpl } | undefined>(o: T): T { return o; }

// ─── Function helpers ──────────────────────────────────────────────────
export function once<T>(fn: () => T): () => T {
  let called = false, result: T;
  return () => { if (!called) { called = true; result = fn(); } return result; };
}

// ─── JSON helpers ──────────────────────────────────────────────────────
export function parseStreamingJson<T>(text: string): T | null {
  try { return JSON.parse(text) as T; } catch { return null; }
}

export function parseStreamingJsonThrottled<T = Record<string, unknown>>(text: string): T | null {
  return parseStreamingJson<T>(text);
}

export function parseJsonWithRepair<T>(text: string): T | null {
  try { return JSON.parse(text) as T; } catch {
    try {
      return JSON.parse(text.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']')) as T;
    } catch { return null; }
  }
}

export function stringifyJson(value: unknown, space?: string | number): string | undefined {
  try { return JSON.stringify(value, null, space); } catch { return undefined; }
}

export function structuredCloneJSON<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export interface JsonPrefixState { kind: 'complete' | 'partial' | 'invalid' | 'empty'; depth: number; inString: boolean; escaped: boolean; }
export function classifyJsonPrefix(text: string): JsonPrefixState {
  if (!text) return { kind: 'empty', depth: 0, inString: false, escaped: false };
  try { JSON.parse(text); return { kind: 'complete', depth: 0, inString: false, escaped: false }; } catch {
    const trimmed = text.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return { kind: 'partial', depth: 1, inString: false, escaped: false };
    return { kind: 'invalid', depth: 0, inString: false, escaped: false };
  }
}

// ─── Image metadata ────────────────────────────────────────────────────
export interface ImageMetadata { width: number; height: number; mimeType: string; }
export function parseImageMetadata(header: Uint8Array): ImageMetadata | null {
  if (header[0] === 0x89 && header[1] === 0x50) return { width: 0, height: 0, mimeType: 'image/png' };
  if (header[0] === 0xff && header[1] === 0xd8) return { width: 0, height: 0, mimeType: 'image/jpeg' };
  if (header[0] === 0x47 && header[1] === 0x49) return { width: 0, height: 0, mimeType: 'image/gif' };
  if (header[0] === 0x52 && header[1] === 0x49) return { width: 0, height: 0, mimeType: 'image/webp' };
  return null;
}

// ─── SSE helpers ───────────────────────────────────────────────────────
export async function* readSseJson(response: Response): AsyncGenerator<Record<string, unknown>, void, unknown> {
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
          try { yield JSON.parse(data) as Record<string, unknown>; } catch {}
        }
      }
    }
  } finally { reader.releaseLock(); }
}

export async function* readSseEvents(response: Response): AsyncGenerator<{ event?: string; data: string }, void, unknown> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '', currentEvent = '', currentData = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.startsWith('event: ')) currentEvent = line.slice(7).trim();
        else if (line.startsWith('data: ')) currentData += line.slice(6);
        else if (line === '') { if (currentData) yield { event: currentEvent || undefined, data: currentData }; currentEvent = ''; currentData = ''; }
      }
    }
  } finally { reader.releaseLock(); }
}

export async function readStream(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let result = '';
  try { while (true) { const { done, value } = await reader.read(); if (done) break; result += decoder.decode(value, { stream: true }); } } finally { reader.releaseLock(); }
  return result;
}

// ─── Text helpers ──────────────────────────────────────────────────────
export function sanitizeText(text: string): string {
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

export async function readJsonl<T>(filePath: string): Promise<T[]> {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return content.split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as T);
  } catch { return []; }
}

// ─── Logger ────────────────────────────────────────────────────────────
export function log(...args: unknown[]): void { console.log('[PLUMB]', ...args); }
export function warn(...args: unknown[]): void { console.warn('[PLUMB]', ...args); }
export function error(...args: unknown[]): void { console.error('[PLUMB]', ...args); }
export function debug(...args: unknown[]): void { if (process.env['DEBUG']) console.debug('[PLUMB]', ...args); }
export const logger = { log, warn, error, debug };
