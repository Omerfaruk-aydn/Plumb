/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */

/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */

import { spawn, execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ─── Types ─────────────────────────────────────────────────────────────

export interface CodexStatus {
  installed: boolean;
  version?: string;
  loggedIn: boolean;
  authMode?: string;
  accountEmail?: string;
  planType?: string;
  defaultModel?: string;
  error?: string;
}

export interface CodexAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  accountId?: string;
  email?: string;
}

// ─── CLI detection ─────────────────────────────────────────────────────

let cachedStatus: CodexStatus | null = null;

function getCodexConfigDir(): string {
  const home = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '';
  return join(home, '.codex');
}

function getAuthFilePath(): string {
  return join(getCodexConfigDir(), 'auth.json');
}

function getConfigFilePath(): string {
  return join(getCodexConfigDir(), 'config.toml');
}

/** Check if the codex CLI is installed. */
export function isCodexInstalled(): boolean {
  try {
    const result = execSync('codex --version', {
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return !!result;
  } catch {
    return false;
  }
}

/** Get the codex CLI version. */
export function getCodexVersion(): string | null {
  try {
    const result = execSync('codex --version', {
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result?.toString().trim() || null;
  } catch {
    return null;
  }
}

// ─── Auth status ───────────────────────────────────────────────────────

/** Check codex login status. Uses auth.json as primary source since
 *  the codex CLI writes status output directly to TTY, not stdout. */
export async function getCodexStatus(): Promise<CodexStatus> {
  if (cachedStatus) return cachedStatus;

  const installed = isCodexInstalled();
  if (!installed) {
    cachedStatus = { installed: false, loggedIn: false };
    return cachedStatus;
  }

  const version = getCodexVersion() ?? undefined;

  // Check auth.json directly — the codex CLI writes status to TTY not stdout
  const tokens = readCodexAuthTokens();
  const loggedIn = !!tokens?.accessToken;

  let authMode: string | undefined;
  let accountEmail: string | undefined;
  let planType: string | undefined;
  let defaultModel: string | undefined;

  if (loggedIn && tokens) {
    accountEmail = tokens.email;
    // Parse plan type from JWT
    try {
      const payload = parseJwtPayload(tokens.accessToken);
      if (payload) {
        const auth = getJwtField(payload, 'https://api.openai.com/auth') as
          | Record<string, unknown>
          | undefined;
        if (auth) {
          const pt = auth['chatgpt_plan_type'];
          if (typeof pt === 'string') planType = pt;
        }
        // Determine auth mode from JWT claims
        const aud = getJwtField(payload, 'aud');
        if (typeof aud === 'string' && aud.includes('app_')) {
          authMode = 'chatgpt';
        }
      }
    } catch {
      // JWT parsing is best-effort
    }

    // Read default model from config
    try {
      const configPath = getConfigFilePath();
      if (existsSync(configPath)) {
        const config = readFileSync(configPath, 'utf-8');
        const modelMatch = /^model\s*=\s*"([^"]+)"/m.exec(config);
        if (modelMatch) defaultModel = modelMatch[1];
      }
    } catch {
      // Config reading is best-effort
    }
  }

  cachedStatus = {
    installed: true,
    version,
    loggedIn,
    authMode,
    accountEmail,
    planType,
    defaultModel,
  };

  return cachedStatus;
}

/** Clear the cached status (call after login/logout). */
export function clearCodexStatusCache(): void {
  cachedStatus = null;
}

// ─── Auth tokens ───────────────────────────────────────────────────────

/** Read auth tokens from codex's auth.json. */
export function readCodexAuthTokens(): CodexAuthTokens | null {
  const authPath = getAuthFilePath();
  if (!existsSync(authPath)) return null;

  try {
    const raw = JSON.parse(readFileSync(authPath, 'utf-8'));
    const tokens = raw.tokens ?? raw;

    const accessToken: string | undefined =
      tokens.access_token ?? tokens.accessToken;
    if (!accessToken) return null;

    const refreshToken: string | undefined =
      tokens.refresh_token ?? tokens.refreshToken;

    // Parse expiry from JWT
    let expiresAt: number | undefined;
    try {
      const payload = parseJwtPayload(accessToken);
      const exp = getJwtField(payload ?? {}, 'exp');
      if (typeof exp === 'number') expiresAt = exp * 1000;
    } catch {
      // Best-effort
    }

    // Parse account info from JWT
    let accountId: string | undefined;
    let email: string | undefined;
    try {
      const payload = parseJwtPayload(accessToken);
      if (payload) {
        const auth = getJwtField(payload, 'https://api.openai.com/auth') as
          | Record<string, unknown>
          | undefined;
        if (auth) {
          const aid = auth['chatgpt_account_id'];
          if (typeof aid === 'string') accountId = aid;
        }
        const em = getJwtField(payload, 'email');
        if (typeof em === 'string') email = em;
      }
    } catch {
      // Best-effort
    }

    return { accessToken, refreshToken, expiresAt, accountId, email };
  } catch {
    return null;
  }
}

/** Check if the current Codex auth token is still valid. */
export function isCodexTokenValid(): boolean {
  const tokens = readCodexAuthTokens();
  if (!tokens) return false;
  if (!tokens.expiresAt) return true; // No expiry info = assume valid
  return Date.now() < tokens.expiresAt - 60_000; // 60s buffer
}

// ─── Login flow ────────────────────────────────────────────────────────

/** Start the codex login flow. Returns a result indicating success or failure. */
export async function startCodexLogin(): Promise<{
  success: boolean;
  error?: string;
}> {
  clearCodexStatusCache();

  try {
    execSync('codex login', {
      timeout: 120_000,
      stdio: 'inherit',
    });
    clearCodexStatusCache();
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Login failed',
    };
  }
}

/** Start codex login as a non-blocking process. */
export function startCodexLoginAsync(): {
  process: ReturnType<typeof spawn>;
  promise: Promise<{ success: boolean; error?: string }>;
} {
  clearCodexStatusCache();

  const child = spawn('codex', ['login'], {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: true,
  });

  const promise = new Promise<{ success: boolean; error?: string }>(
    (resolve) => {
      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('close', (code) => {
        clearCodexStatusCache();
        if (code === 0) {
          resolve({ success: true });
        } else {
          resolve({ success: false, error: stderr || 'Login failed' });
        }
      });
      child.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    },
  );

  return { process: child, promise };
}

// ─── Logout ────────────────────────────────────────────────────────────

export async function codexLogout(): Promise<void> {
  try {
    execSync('codex logout', {
      timeout: 10000,
      stdio: 'pipe',
    });
  } catch {
    // Best-effort
  }
  clearCodexStatusCache();
}

// ─── Model discovery ───────────────────────────────────────────────────

/** Discover models available via Codex/ChatGPT subscription.
 *  Reads from the Codex CLI's local models cache (~/.codex/models_cache.json)
 *  which is populated by the official Codex client. */
export async function discoverCodexModels(): Promise<
  Array<{
    id: string;
    name: string;
    provider: string;
    api: string;
    contextWindow: number;
    maxTokens: number;
    reasoning: boolean;
    input: string;
    isOAuth: boolean;
  }>
> {
  const tokens = readCodexAuthTokens();
  if (!tokens?.accessToken) return [];

  // First try the Codex CLI's local models cache
  try {
    const cachePath = join(getCodexConfigDir(), 'models_cache.json');
    if (existsSync(cachePath)) {
      const raw = JSON.parse(readFileSync(cachePath, 'utf-8')) as {
        models?: Array<{
          slug?: string;
          display_name?: string;
          context_window?: number;
          supported_reasoning_levels?: unknown[];
          input_modalities?: string[];
          visibility?: string;
        }>;
      };

      if (raw.models && raw.models.length > 0) {
        return raw.models
          .filter((m) => m.slug && m.visibility !== 'hidden')
          .map((m) => ({
            id: m.slug!,
            name: m.display_name ?? m.slug!,
            provider: 'openai-codex',
            api: 'openai-codex-responses',
            contextWindow: m.context_window ?? 272000,
            maxTokens: 32768,
            reasoning: (m.supported_reasoning_levels?.length ?? 0) > 0,
            input: m.input_modalities?.includes('image')
              ? 'text+image'
              : 'text',
            isOAuth: true,
          }));
      }
    }
  } catch {
    // Cache read failure — fall through to API fallback
  }

  // Fallback: try the OpenAI API (may not work with ChatGPT tokens)
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) return [];

    const data = (await response.json()) as {
      data?: Array<{ id: string; owned_by?: string }>;
    };

    return (data.data ?? []).map((m) => ({
      id: m.id,
      name: m.id,
      provider: 'openai-codex',
      api: 'openai-codex-responses',
      contextWindow: 131072,
      maxTokens: 32768,
      reasoning:
        m.id.includes('o3') ||
        m.id.includes('o4') ||
        m.id.includes('reasoning'),
      input: 'text',
      isOAuth: true,
    }));
  } catch {
    return [];
  }
}

// ─── Account identity ──────────────────────────────────────────────────

export function getCodexAccountLabel(): string | null {
  const tokens = readCodexAuthTokens();
  if (!tokens) return null;

  const parts: string[] = [];
  if (tokens.email) parts.push(tokens.email);
  if (tokens.accountId) parts.push(tokens.accountId.slice(0, 8));

  return parts.length > 0 ? parts.join(' · ') : null;
}

// ─── Utilities ─────────────────────────────────────────────────────────

function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getJwtField(obj: Record<string, unknown>, key: string): unknown {
  return obj[key];
}
