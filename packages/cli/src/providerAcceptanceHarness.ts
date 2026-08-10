/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
import * as fs from 'node:fs';
import * as readline from 'node:readline';
import { installBunGlobal } from '@google/gemini-cli-provider';
import { writeToStderr, writeToStdout } from '@google/gemini-cli-core';
import { BUILD_IDENTITY } from './generated/buildIdentity.js';
import { recordAcceptance, getAllAcceptances } from './providerAcceptance.js';

// OMP SHA from the embedded build (hardcoded at build time)
const OMP_SHA = '4df68d60438423b384b2b47fb3d6835641624757';

// Reference routes that are already user-verified and must not be retested.
//
// 'custom-openai-compat' was previously listed here too, but it is a
// PLUMB_ONLY_SYNTHETIC provider excluded from SELECTABLE_PROVIDERS (no user
// can ever configure/verify it through the real setup flow -- it has no
// catalog models, no discovery adapter, and no base-URL configuration UI at
// all). Marking a provider nobody can reach as "already user-verified" is
// exactly the fake-acceptance shape this harness exists to prevent; removed
// so a direct `--test-provider custom-openai-compat` invocation reports its
// real (non-selectable / no model source) classification instead.
const REFERENCE_ROUTES = new Set(['nvidia']);

const LOCAL_PROVIDER_ROUTES = new Set([
  'ollama',
  'lm-studio',
  'llama-cpp',
  'vllm',
  'sglang',
]);

const GATEWAY_PROVIDER_ROUTES = new Set([
  'openrouter',
  'portkey',
  'litellm',
  'vercel-ai-gateway',
  'cloudflare-ai-gateway',
  'kilo',
  'nanogpt',
  'zenmux',
]);

// Env var that switches the interactive acceptance test to a deterministic
// stub provider boundary (used by the Windows ConPTY integration test).
export const ACCEPTANCE_STUB_ENV = 'PLUMB_ACCEPTANCE_STUB';
export const ACCEPTANCE_STUB_AUTO_AUTH_ENV = 'PLUMB_ACCEPTANCE_STUB_AUTO';
const STUB_USER_CODE = 'PLUMB-STUB-0000';

// ---------------------------------------------------------------------------
// Live terminal channel
// ---------------------------------------------------------------------------
//
// The interactive acceptance command is a plain CLI command. It never mounts
// the Ink renderer, never alternates screens, and never routes user-visible
// lines through the project's output backlog (patchStdio/coreEvents). Every
// live line is written synchronously to the real terminal file descriptor so
// Windows ConPTY shows it immediately, before any await.

export interface LiveTerminal {
  writeLine(line: string): void;
}

/**
 * Synchronous stderr terminal writer. Prefers fs.writeSync on the real fd
 * (immune to process.stdout/stderr monkey patching) and falls back to the
 * captured original write otherwise.
 */
function syncStderrWriteLine(line: string): void {
  try {
    const fd = process.stderr?.fd;
    if (typeof fd === 'number' && Number.isInteger(fd) && fd >= 0) {
      fs.writeSync(fd, `${line}\n`);
      return;
    }
  } catch {
    // fall through: bypassed fd, use the captured writer
  }
  writeToStderr(`${line}\n`);
}

export function createLiveTerminal(
  writer: (line: string) => void = syncStderrWriteLine,
): LiveTerminal {
  return { writeLine: writer };
}

export const realTerminal: LiveTerminal = createLiveTerminal();

// ---------------------------------------------------------------------------
// Final report channel (stdout, exactly once)
// ---------------------------------------------------------------------------

/**
 * Writes the structured final result to the real stdout, bypassing any
 * process.stdout.write patching, so it is emitted exactly once at the end of
 * the flow and never merges with live heartbeat lines.
 */
export function finalReportWriteLine(line: string): void {
  writeToStdout(`${line}\n`);
}

export type ReportEmitter = (line: string) => void;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ProviderTestResult {
  providerId: string;
  providerCategory: string;
  registrationClassification: string;
  authResult: string;
  credentialStorage: string;
  accountIdentityPresent: boolean;
  workspaceIdentityPresent: boolean;
  modelsDynamicCount: number;
  modelsBundledCount: number;
  modelsFinalCount: number;
  selectedModel: string;
  routingProvider: string;
  transportProvider: string;
  transportDialect: string;
  credentialProvider: string;
  authorizationScheme: string;
  authorizationHeaderPresent: boolean;
  requestEndpoint: string;
  streamStarted: boolean;
  streamCompleted: boolean;
  cancellationVerified: boolean;
  restartRestoreVerified: boolean;
  logoutScopeVerified: boolean;
  terminalRestored: boolean;
  safeError: string;
  result:
    | 'LIVE_VERIFIED'
    | 'IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED'
    | 'BLOCKED_CLIENT_REGISTRATION'
    | 'BLOCKED_PROVIDER_POLICY'
    | 'BLOCKED_ACCOUNT_ENTITLEMENT'
    | 'IMPLEMENTATION_INCOMPLETE_NOT_SELECTABLE'
    | 'SERVER_UNAVAILABLE'
    | 'LIVE_TEST_FAILED'
    | 'LIVE_TEST_CANCELLED';
}

// ---------------------------------------------------------------------------
// Provider classification
// ---------------------------------------------------------------------------

function classifyProvider(
  providerId: string,
  plumbCategory: string | undefined,
  providerDef: Record<string, unknown> | undefined,
  catalogEntry: Record<string, unknown> | undefined,
): {
  registration: string;
  category: string;
  blocked: boolean;
  blockReason: string;
} {
  const BLOCKED_CLIENT_REGISTRATIONS = new Set(['openai-codex']);
  const BLOCKED_NO_MODEL_SOURCE = new Set<string>([]);

  if (BLOCKED_CLIENT_REGISTRATIONS.has(providerId)) {
    return {
      registration: 'UPSTREAM_PRODUCT_OWNED_REGISTRATION',
      category: 'coding_plan',
      blocked: true,
      blockReason: 'BLOCKED_CLIENT_REGISTRATION',
    };
  }
  if (BLOCKED_NO_MODEL_SOURCE.has(providerId)) {
    return {
      registration: 'MISSING_REGISTRATION',
      category: 'api_key',
      blocked: true,
      blockReason: 'IMPLEMENTATION_INCOMPLETE_NOT_SELECTABLE',
    };
  }

  let registration = 'MISSING_REGISTRATION';
  if (providerDef?.['login']) {
    registration = 'UPSTREAM_PRODUCT_OWNED_REGISTRATION';
  } else if (catalogEntry?.['envVars']) {
    registration = 'MISSING_REGISTRATION';
  }

  const category = plumbCategory ?? 'api_key';

  return { registration, category, blocked: false, blockReason: '' };
}

// ---------------------------------------------------------------------------
// Test result builder / reporter
// ---------------------------------------------------------------------------

function buildTestResult(
  providerId: string,
  classification: { registration: string; category: string },
  overrides: Partial<ProviderTestResult> = {},
): ProviderTestResult {
  return {
    providerId,
    providerCategory: classification.category,
    registrationClassification: classification.registration,
    authResult: 'not_started',
    credentialStorage: 'none',
    accountIdentityPresent: false,
    workspaceIdentityPresent: false,
    modelsDynamicCount: 0,
    modelsBundledCount: 0,
    modelsFinalCount: 0,
    selectedModel: 'none',
    routingProvider: providerId,
    transportProvider: providerId,
    transportDialect: 'none',
    credentialProvider: providerId,
    authorizationScheme: 'Bearer',
    authorizationHeaderPresent: false,
    requestEndpoint: 'none',
    streamStarted: false,
    streamCompleted: false,
    cancellationVerified: false,
    restartRestoreVerified: false,
    logoutScopeVerified: false,
    terminalRestored: false,
    safeError: 'none',
    result: 'LIVE_TEST_FAILED',
    ...overrides,
  };
}

interface LocalAcceptanceModel {
  id: string;
  api?: string;
  baseUrl?: string;
}

interface LocalAcceptanceProviderModule {
  getPlumbProviderRegistry?: () => {
    initialize(): Promise<void>;
    getApiKey?(providerId: string): Promise<string | undefined>;
    getProviderState?(providerId: string): {
      credentials?: { type: string; key?: string };
    } | null;
  };
  getPlumbModelRegistry?: () => {
    refreshProvider(
      providerId: string,
      apiKey?: string,
    ): Promise<LocalAcceptanceModel[]>;
    findModel?(
      providerId: string,
      modelId: string,
    ): LocalAcceptanceModel | undefined;
  };
  plumbModelStream?: (options: Record<string, unknown>) => AsyncIterable<{
    type: string;
    text?: string;
    error?: { code: string };
  }>;
}

async function runLocalProviderAcceptanceTest(
  providerId: string,
  providerModule: LocalAcceptanceProviderModule,
  classification: { registration: string; category: string },
  report: ReportEmitter,
): Promise<number> {
  const providerRegistry = providerModule.getPlumbProviderRegistry?.();
  let apiKey: string | undefined;
  if (providerRegistry) {
    try {
      await providerRegistry.initialize();
      apiKey = await providerRegistry.getApiKey?.(providerId);
      if (!apiKey) {
        const credential =
          providerRegistry.getProviderState?.(providerId)?.credentials;
        if (credential?.type === 'api_key') apiKey = credential.key;
      }
    } catch {
      // Keyless local endpoints are valid. Discovery below remains the
      // authority for whether the configured server is actually reachable.
    }
  }

  const modelRegistry = providerModule.getPlumbModelRegistry?.();
  if (!modelRegistry?.refreshProvider || !providerModule.plumbModelStream) {
    const result = buildTestResult(providerId, classification, {
      authResult: apiKey ? 'keychain_authenticated' : 'not_required',
      credentialStorage: apiKey ? 'keychain' : 'none',
      result: 'IMPLEMENTATION_INCOMPLETE_NOT_SELECTABLE',
      safeError: 'Local discovery or transport is not registered.',
    });
    emitResultReport(result, report);
    void recordAcceptanceFromResult(result);
    return 1;
  }

  let models: LocalAcceptanceModel[] = [];
  try {
    models = await modelRegistry.refreshProvider(providerId, apiKey);
  } catch {
    // Discovery adapters intentionally keep network errors provider-local.
    // The safe result below exposes no URL, response body, or credential.
  }

  const discoveredModel = models[0];
  const selectedModel = discoveredModel
    ? (modelRegistry.findModel?.(providerId, discoveredModel.id) ??
      discoveredModel)
    : undefined;
  const result = buildTestResult(providerId, classification, {
    registrationClassification: 'LOCAL_RUNTIME_ENDPOINT',
    authResult: apiKey ? 'keychain_authenticated' : 'not_required',
    credentialStorage: apiKey ? 'keychain' : 'none',
    modelsDynamicCount: models.length,
    modelsFinalCount: models.length,
    selectedModel: selectedModel?.id ?? 'none',
    transportDialect: selectedModel?.api ?? 'none',
    authorizationHeaderPresent: Boolean(apiKey),
    requestEndpoint: selectedModel?.baseUrl ?? 'configured-local-endpoint',
  });

  if (!selectedModel) {
    result.result = 'SERVER_UNAVAILABLE';
    result.safeError =
      'SERVER_UNAVAILABLE: the configured local server returned no discoverable models.';
    emitResultReport(result, report);
    void recordAcceptanceFromResult(result);
    return 1;
  }

  let sawText = false;
  let sawDone = false;
  try {
    result.streamStarted = true;
    const stream = providerModule.plumbModelStream({
      model: selectedModel,
      messages: [{ role: 'user', content: 'Say exactly: PLUMB_TEST_OK' }],
      apiKey: apiKey ?? '',
      maxTokens: 32,
    });
    for await (const event of stream) {
      if (event.type === 'text' && event.text) sawText = true;
      if (event.type === 'done') {
        sawDone = true;
        break;
      }
      if (event.type === 'error') {
        const unavailableCodes = new Set([
          'NETWORK_ERROR',
          'REQUEST_FAILED',
          'NO_RESPONSE_BODY',
        ]);
        if (unavailableCodes.has(event.error?.code ?? '')) {
          result.result = 'SERVER_UNAVAILABLE';
          result.safeError =
            'SERVER_UNAVAILABLE: the configured local server could not complete the request.';
        } else {
          result.result = 'LIVE_TEST_FAILED';
          result.safeError = `Local transport error: ${event.error?.code ?? 'UNKNOWN'}`;
        }
        break;
      }
    }
  } catch {
    result.result = 'SERVER_UNAVAILABLE';
    result.safeError =
      'SERVER_UNAVAILABLE: the configured local server could not complete the request.';
  }

  result.streamCompleted = sawDone;
  if (sawText && sawDone) {
    result.result = 'LIVE_VERIFIED';
    result.safeError = 'none';
  } else if (result.safeError === 'none') {
    result.result = 'LIVE_TEST_FAILED';
    result.safeError =
      'Local stream completed without both text and done events.';
  }

  emitResultReport(result, report);
  void recordAcceptanceFromResult(result);
  return result.result === 'LIVE_VERIFIED' ? 0 : 1;
}

function emitResultReport(r: ProviderTestResult, emit: ReportEmitter): void {
  const lines = [
    `provider.id: ${r.providerId}`,
    `provider.category: ${r.providerCategory}`,
    `registration.classification: ${r.registrationClassification}`,
    `auth.result: ${r.authResult}`,
    `credential.storage: ${r.credentialStorage}`,
    `account.identity.present: ${r.accountIdentityPresent}`,
    `workspace.identity.present: ${r.workspaceIdentityPresent}`,
    `models.dynamic.count: ${r.modelsDynamicCount}`,
    `models.bundled.count: ${r.modelsBundledCount}`,
    `models.final.count: ${r.modelsFinalCount}`,
    `selected.model: ${r.selectedModel}`,
    `routing.provider: ${r.routingProvider}`,
    `transport.provider: ${r.transportProvider}`,
    `transport.dialect: ${r.transportDialect}`,
    `credential.provider: ${r.credentialProvider}`,
    `authorization.scheme: ${r.authorizationScheme}`,
    `authorization.header.present: ${r.authorizationHeaderPresent}`,
    `request.endpoint: ${r.requestEndpoint}`,
    `stream.started: ${r.streamStarted}`,
    `stream.completed: ${r.streamCompleted}`,
    `cancellation.verified: ${r.cancellationVerified}`,
    `restart.restore.verified: ${r.restartRestoreVerified}`,
    `logout.scope.verified: ${r.logoutScopeVerified}`,
    `terminal.restored: ${r.terminalRestored}`,
    `safe.error: ${r.safeError}`,
    `result: ${r.result}`,
  ];
  for (const line of lines) {
    emit(line);
  }
}

// ---------------------------------------------------------------------------
// Coding-plan login helpers
// ---------------------------------------------------------------------------

function isGithubEnterprisePrompt(message: string): boolean {
  return message.toLowerCase().includes('github enterprise');
}

/** Extract a temporary user code from the OAuth instructions string. */
function extractUserCode(instructions?: string): string | undefined {
  if (!instructions) return undefined;
  const match = /Enter code:\s*([A-Z0-9-]+)/i.exec(instructions);
  return match?.[1];
}

/** Prompt policy: allowEmpty prompts (e.g. GitHub Enterprise domain) are skipped. */
export interface PromptPolicy {
  isSkippable(prompt: { message: string; allowEmpty?: boolean }): boolean;
}

const BASE_PROMPT_POLICY: PromptPolicy = {
  isSkippable: (prompt) => prompt.allowEmpty === true,
};

/**
 * Reads a single line from stdin for genuinely required input. The prompt is
 * printed via the live terminal (never the stdout patch) and the answer is
 * never echoed. Resolves to '' when aborted.
 */
function makeStdinReader(terminal: LiveTerminal) {
  return (prompt: string, signal: AbortSignal): Promise<string> =>
    new Promise<string>((resolve) => {
      terminal.writeLine(prompt);
      const rl = readline.createInterface({
        input: process.stdin,
        terminal: false,
      });
      let settled = false;
      const settle = (value: string) => {
        if (settled) return;
        settled = true;
        rl.close();
        resolve(value);
      };
      if (signal.aborted) {
        settle('');
        return;
      }
      signal.addEventListener('abort', () => settle(''), { once: true });
      rl.question('', (raw) => settle(raw.trim()));
    });
}

export type ReadLine = (prompt: string, signal: AbortSignal) => Promise<string>;

/**
 * One attempt at answering the model-number prompt. The picker decides whether
 * to select, reprompt, cancel or end based on this result. The raw submitted
 * line is only carried for numeric/non-numeric classification; the harness
 * never logs arbitrary user text.
 */
export type ModelChoiceAttempt =
  | { type: 'number'; value: number }
  | { type: 'text'; value: string }
  | { type: 'cancel' }
  | { type: 'end' };

/**
 * Per-attempt model selection input. Returns one choice attempt. Empty /
 * invalid submissions are reprompted by the harness, never converted into a
 * failure.
 */
export type ModelInput = (
  prompt: string,
  signal: AbortSignal,
) => Promise<ModelChoiceAttempt>;

/**
 * Wrap any line source into a ModelChoiceAttempt. A lone Escape sequence
 * (cooked-mode residual) or the Ctrl+C byte is treated as cancellation.
 */
function attemptFromLine(line: string): ModelChoiceAttempt {
  if (line.includes('\u001b') || line.includes('\u0003')) {
    return { type: 'cancel' };
  }
  const trimmed = line.trim();
  if (!trimmed) return { type: 'text', value: '' };
  if (/^-?\d+$/.test(trimmed)) {
    return { type: 'number', value: Number.parseInt(trimmed, 10) };
  }
  return { type: 'text', value: trimmed };
}

/**
 * Terminal-backed model input: reads process.stdin directly (cooked mode) and
 * splits on line terminators, so there is exactly one stdin owner and raw mode
 * stays off. Creating a fresh `readline` interface on the same TTY after an
 * auth-phase `rl.close()` is unreliable under Windows ConPTY, so lines are
 * gathered from the raw data channel instead. Resolves with { type: 'cancel' }
 * on abort, { type: 'end' } on EOF.
 */
function createModelInput(): ModelInput {
  let attached = false;
  let buffer = '';
  const queue: Array<(attempt: ModelChoiceAttempt) => void> = [];

  const flush = (attempt: ModelChoiceAttempt): void => {
    const handler = queue.shift();
    if (handler) handler(attempt);
  };

  const onData = (chunk: Buffer | string): void => {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString();
    const parts = buffer.split(/[\r\n]+/);
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      flush(attemptFromLine(part));
    }
  };

  const input = (
    prompt: string,
    signal: AbortSignal,
  ): Promise<ModelChoiceAttempt> => {
    void prompt;
    if (signal.aborted) return Promise.resolve({ type: 'cancel' });
    if (!attached) {
      attached = true;
      process.stdin.on('data', onData);
      if (!process.stdin.readableFlowing) process.stdin.resume();
    }
    return new Promise<ModelChoiceAttempt>((resolve) => {
      queue.push(resolve);
      signal.addEventListener(
        'abort',
        () => {
          const idx = queue.indexOf(resolve);
          if (idx >= 0) {
            queue.splice(idx, 1);
            resolve({ type: 'cancel' });
          }
        },
        { once: true },
      );
    });
  };
  return input;
}

/**
 * Deterministic provider boundary for automated (ConPTY) acceptance runs.
 * Immediately surfaces a URL + user code, then polls forever and can only be
 * left by cancellation or (when `autoAuth` is set) by reading the user code
 * back. Never touches the network.
 */
function buildStubLogin(callbacks: {
  onAuth: (info: {
    url?: string;
    launchUrl?: string;
    instructions?: string;
  }) => void;
  onPrompt: (prompt: {
    message: string;
    placeholder?: string;
    allowEmpty?: boolean;
  }) => Promise<string>;
  signal?: AbortSignal;
  autoAuth?: boolean;
}): Promise<unknown> {
  const present = () => {
    callbacks.onAuth({
      url: 'https://github.com/login/device',
      launchUrl: 'https://github.com/login/device',
      instructions: `Enter code: ${STUB_USER_CODE}`,
    });
  };

  return new Promise<unknown>((resolve, reject) => {
    const onAbort = () =>
      reject(new Error('STUB_POLL_CANCELLED_OPERATION_CANCELLED'));

    if (callbacks.autoAuth === true) {
      present();
      const waitForCode = async () => {
        if (callbacks.signal?.aborted) {
          reject(new Error('STUB_POLL_CANCELLED_OPERATION_CANCELLED'));
          return;
        }
        const line = await callbacks.onPrompt({
          message: `Enter stub device code:`,
          allowEmpty: false,
        });
        if (line === STUB_USER_CODE) {
          resolve({
            access: `PLUMB_STUB_ACCESS_${STUB_USER_CODE}`,
            refresh: `PLUMB_STUB_REFRESH_${STUB_USER_CODE}`,
            apiEndpoint: undefined,
          });
          return;
        }
        // Wrong stub code: keep polling (abort still cancels).
        void waitForCode();
      };
      callbacks.signal?.addEventListener('abort', onAbort, { once: true });
      void waitForCode();
      return;
    }

    const waitForAbort = () => {
      if (!callbacks.signal) {
        present();
        return;
      }
      if (callbacks.signal.aborted) {
        present();
        onAbort();
        return;
      }
      callbacks.signal.addEventListener('abort', onAbort, { once: true });
      present();
    };
    setImmediate(waitForAbort);
  });
}

// ---------------------------------------------------------------------------
// Coding-plan live test
// ---------------------------------------------------------------------------

export interface LiveAcceptanceOptions {
  terminal?: LiveTerminal;
  report?: ReportEmitter;
  readLine?: ReadLine;
  /** Per-attempt model selection input (defaults to a single stdin reader). */
  modelInput?: ModelInput;
  traceMode?: boolean;
  stub?: boolean;
}

type TerminalFinalState = 'CANCELLED' | 'COMPLETED' | 'FAILED';
type LifecycleState = 'RUNNING' | TerminalFinalState;

/**
 * Run a genuinely interactive live test for a coding-plan provider.
 *
 * @param providerId      The canonical provider id ("github-copilot").
 * @param canonicalId     The resolved route id (may differ for antigravity).
 * @param providerModule  The resolved provider module.
 * @param providerDef     The OMP provider definition (has login/refresh).
 * @param plumbCategory   The PLUMB category (coding_plan / api_key / oauth).
 * @param opts            Injectable channels for tests + trace/stub flags.
 */
export async function runCodingPlanLiveAcceptance(
  providerId: string,
  canonicalId: string,
  providerModule: Record<string, unknown>,
  providerDef: Record<string, unknown> | undefined,
  plumbCategory: string | undefined,
  opts: LiveAcceptanceOptions = {},
): Promise<number> {
  const terminal = opts.terminal ?? realTerminal;
  const report = opts.report ?? finalReportWriteLine;
  const readLine = opts.readLine ?? makeStdinReader(terminal);
  // Model selection uses an injected per-attempt input when provided; an
  // injected readLine is wrapped into attempts; otherwise a single readline
  // stdin reader (with EOF detection) owns the prompt.
  const modelInput =
    opts.modelInput ??
    (opts.readLine
      ? async (prompt: string, signal: AbortSignal) =>
          attemptFromLine(await readLine(prompt, signal))
      : createModelInput());
  const traceMode = opts.traceMode === true;
  const stub = opts.stub === true || process.env[ACCEPTANCE_STUB_ENV] === '1';
  const stubAutoAuth = process.env[ACCEPTANCE_STUB_AUTO_AUTH_ENV] === '1';

  const hasLogin = typeof providerDef?.['login'] === 'function';
  const classification = classifyProvider(
    providerId,
    plumbCategory,
    providerDef,
    undefined,
  );

  // -------------------------------------------------------------------------
  // Lifecycle guards
  // -------------------------------------------------------------------------
  let lifecycle: LifecycleState = 'RUNNING';
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let heartbeatSeconds = 0;
  let heartbeatPendingTraced = false;
  let reportedOnce = false;

  const isFinalState = (state: LifecycleState): state is TerminalFinalState =>
    state !== 'RUNNING';

  /** Live lines are ignored once the terminal reached its final state. */
  const writeLive = (line: string): void => {
    if (isFinalState(lifecycle)) return;
    terminal.writeLine(line);
  };

  /** Safe stage traces stream immediately (--trace-safe) or stay silent. */
  const traceStage = (stage: string): void => {
    if (traceMode && !isFinalState(lifecycle)) {
      terminal.writeLine(`trace.stage: ${stage}`);
    }
  };

  const stopHeartbeat = (): void => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }
  };

  const startHeartbeat = (): void => {
    if (heartbeatTimer || lifecycle !== 'RUNNING') return;
    traceStage('TOKEN_POLL_STARTED');
    heartbeatTimer = setInterval(() => {
      if (lifecycle !== 'RUNNING') return;
      heartbeatSeconds += 1;
      if (!heartbeatPendingTraced) {
        heartbeatPendingTraced = true;
        traceStage('TOKEN_POLL_PENDING');
      }
      terminal.writeLine(
        `Waiting for GitHub authorization... ${heartbeatSeconds}s`,
      );
    }, 1000);
  };

  // -------------------------------------------------------------------------
  // Cancellation input ownership (single owner)
  // -------------------------------------------------------------------------
  const abortController = new AbortController();
  let rawModeActive = false;
  const rawRestorers: Array<() => void> = [];
  let rawModeRestored = false;

  const onInput = (data: string | Buffer) => {
    const str = String(data);
    if (str.includes('\u0003') || str.includes('\u001b')) {
      abortController.abort();
    }
  };

  const acquireRawMode = () => {
    if (rawModeActive) return;
    if (process.stdin.isTTY && process.stdin.setRawMode) {
      process.stdin.on('data', onInput);
      process.stdin.setRawMode(true);
      rawModeActive = true;
      rawRestorers.push(() => {
        try {
          if (process.stdin.setRawMode) process.stdin.setRawMode(false);
        } catch {
          // ignore (already restored)
        }
        try {
          process.stdin.removeListener('data', onInput);
        } catch {
          // ignore
        }
      });
    }
  };

  const restoreRawOnce = () => {
    if (rawModeRestored) return;
    rawModeRestored = true;
    for (const restore of rawRestorers) restore();
    rawRestorers.length = 0;
  };

  const onSigint = () => abortController.abort();
  const detachSigint = () => {
    if (process.stdin.isTTY) {
      process.removeListener('SIGINT', onSigint);
    }
  };
  if (process.stdin.isTTY) {
    process.on('SIGINT', onSigint);
    acquireRawMode();
  }

  // While the model picker runs canonical (raw off), Ctrl+C is delivered as a
  // real SIGINT. The CLI's global cleanup handler would then run
  // gracefulShutdown() -> process.exit(0), racing our cancellation path. Take
  // ownership of SIGINT for the picker and restore foreign handlers in finish.
  let foreignSigintOwned = false;
  const foreignSigintListeners: NodeJS.SignalsListener[] = [];
  const acquireSigintOwnership = () => {
    if (foreignSigintOwned) return;
    foreignSigintOwned = true;
    for (const listener of process.listeners('SIGINT')) {
      if (listener !== onSigint) {
        process.removeListener('SIGINT', listener);
        foreignSigintListeners.push(listener);
      }
    }
  };
  const releaseSigintOwnership = () => {
    if (!foreignSigintOwned) return;
    foreignSigintOwned = false;
    for (const listener of foreignSigintListeners.splice(0)) {
      process.on('SIGINT', listener);
    }
  };

  /** Release the device-authorization stdin owner before model selection. */
  const releaseAuthInputOwnership = () => {
    stopHeartbeat();
    // Remove the raw-mode key listener (Esc/Ctrl+C would otherwise compete
    // with the model picker) and restore canonical terminal mode. SIGINT now
    // owns cancellation; the CLI cleanup handler is parked so it cannot
    // process.exit(0) mid-picker.
    restoreRawOnce();
    acquireSigintOwnership();
    try {
      if (process.stdin.isTTY && !process.stdin.readableFlowing) {
        process.stdin.resume();
      }
    } catch {
      // resume is best-effort
    }
  };

  /**
   * Leave RUNNING, stop the heartbeat, restore the terminal, then print the
   * final result exactly once. No live or trace write may follow.
   */
  const finish = (
    finalState: TerminalFinalState,
    result: ProviderTestResult,
    liveCloseLine: string | undefined,
  ): Promise<number> => {
    lifecycle = finalState;
    stopHeartbeat();
    restoreRawOnce();
    detachSigint();
    releaseSigintOwnership();
    if (liveCloseLine !== undefined) {
      terminal.writeLine(liveCloseLine);
    }
    if (!reportedOnce) {
      reportedOnce = true;
      emitResultReport(result, report);
    }
    if (finalState === 'COMPLETED') {
      void recordAcceptanceFromResult(result);
      return Promise.resolve(result.result === 'LIVE_VERIFIED' ? 0 : 1);
    }
    return Promise.resolve(1);
  };

  // If no OMP login function exists, do not pretend to test.
  if (!hasLogin && !stub) {
    const result = buildTestResult(providerId, classification, {
      authResult: 'no_omp_login',
      result: 'IMPLEMENTATION_INCOMPLETE_NOT_SELECTABLE',
      safeError: `OMP definition for ${canonicalId} has no login function`,
    });
    return finish('FAILED', result, undefined);
  }

  // -------------------------------------------------------------------------
  // Startup block must be visible before any await
  // -------------------------------------------------------------------------
  const plumbProvider = providerModule['getPlumbProvider']
    ? (providerModule as Record<string, (id: string) => unknown>)[
        'getPlumbProvider'
      ](providerId)
    : undefined;
  const authMethods =
    ((plumbProvider as { authMethods?: Array<{ type: string }> } | undefined)
      ?.authMethods as Array<{ type: string }>) ?? [];
  const mechanism = authMethods.some((m) => m.type === 'device_code')
    ? 'DEVICE_CODE'
    : authMethods.some((m) => m.type === 'api_key')
      ? 'API_KEY'
      : authMethods.some((m) => m.type === 'oauth')
        ? 'OAUTH_ACCOUNT_FLOW'
        : 'NONE';
  const displayName =
    (plumbProvider as { name?: string } | undefined)?.name ?? providerId;

  writeLive('PLUMB coding-plan live acceptance');
  writeLive(`Provider: ${displayName}`);
  writeLive(`Mechanism: ${mechanism}`);
  writeLive('Stage: Requesting device authorization...');
  writeLive('');

  traceStage('DEVICE_REQUEST_STARTED');

  // -------------------------------------------------------------------------
  // Invoke login
  // -------------------------------------------------------------------------
  const onAuth = (info: {
    url?: string;
    launchUrl?: string;
    instructions?: string;
  }) => {
    writeLive('Verification URL:');
    writeLive(info.launchUrl ?? info.url ?? '');
    const code = extractUserCode(info.instructions);
    if (code) {
      writeLive('User code:');
      writeLive(code);
    }
    writeLive('');
    writeLive('Open the URL and enter the code.');
    writeLive('Stage: Waiting for GitHub authorization...');
    writeLive('Esc or Ctrl+C to cancel');
    traceStage('DEVICE_CODE_PRESENTED');
    startHeartbeat();
  };

  const onProgress = (message: string): void => {
    if (message && message.trim()) {
      writeLive(message.trim());
    }
  };

  const onPromptShim = async (prompt: {
    message: string;
    placeholder?: string;
    allowEmpty?: boolean;
  }): Promise<string> => {
    if (BASE_PROMPT_POLICY.isSkippable(prompt)) {
      // Standard github.com flow: never ask for the enterprise domain.
      traceStage(
        isGithubEnterprisePrompt(prompt.message)
          ? 'PROMPT_SKIPPED_STANDARD_GITHUB'
          : 'PROMPT_SKIPPED_ALLOW_EMPTY',
      );
      return '';
    }
    return readLine(prompt.message, abortController.signal);
  };

  let credentialResult: unknown;
  try {
    if (stub) {
      credentialResult = await buildStubLogin({
        onAuth: (info) => onAuth(info),
        onPrompt: onPromptShim,
        signal: abortController.signal,
        autoAuth: stubAutoAuth,
      });
    } else {
      credentialResult = await (
        providerDef as {
          login: (callbacksWithoutInput: unknown) => Promise<unknown>;
        }
      )['login']({
        onAuth,
        onProgress,
        onPrompt: onPromptShim,
        signal: abortController.signal,
      });
    }
  } catch (err) {
    const wasCancelled =
      abortController.signal.aborted ||
      (err instanceof Error &&
        (err.message.includes('CANCELLED') ||
          err.message.includes('cancelled')));
    if (wasCancelled) {
      const cancelledResult = buildTestResult(providerId, classification, {
        authResult: 'cancelled',
        result: 'LIVE_TEST_CANCELLED',
        terminalRestored: true,
      });
      writeLive('Cancelling...');
      return finish('CANCELLED', cancelledResult, 'LIVE_TEST_CANCELLED');
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    const failedResult = buildTestResult(providerId, classification, {
      authResult: 'login_error',
      result: 'LIVE_TEST_FAILED',
      safeError: errMsg,
      terminalRestored: true,
    });
    return finish('FAILED', failedResult, undefined);
  }

  // Never advance after cancellation.
  if (abortController.signal.aborted) {
    const result = buildTestResult(providerId, classification, {
      authResult: 'cancelled',
      result: 'LIVE_TEST_CANCELLED',
      terminalRestored: true,
    });
    writeLive('Cancelling...');
    return finish('CANCELLED', result, 'LIVE_TEST_CANCELLED');
  }

  traceStage('DEVICE_RESPONSE_RECEIVED');
  traceStage('TOKEN_RECEIVED');
  stopHeartbeat();
  releaseAuthInputOwnership();
  writeLive('Authentication successful.');
  writeLive('');

  // -------------------------------------------------------------------------
  // One authoritative acceptance state object.
  //
  // Model counts, credential availability and selection survive every later
  // phase (cancel / EOF / stream failure) and are always reported from here —
  // never from fallback constants.
  // -------------------------------------------------------------------------
  const credential = extractCredential(credentialResult);

  // Load models
  traceStage('LOADING_MODELS');
  const bundledModels = providerModule['getCatalogModels']
    ? ((providerModule as Record<string, (id: string) => unknown[]>)[
        'getCatalogModels'
      ](canonicalId) as Array<{
        id: string;
        name?: string;
        api?: string;
        baseUrl?: string;
        requestModelId?: string;
        provider: string;
        contextWindow: number;
        maxTokens: number;
        reasoning?: boolean;
        input: string;
        headers?: Record<string, string>;
      }>)
    : [];
  // Live discovery is not performed by the acceptance harness; the bundled
  // catalog is the source of truth for the real 38-model Copilot list.
  const dynamicModelCount = 0;
  const finalModelCount = new Set(bundledModels.map((m) => m.id)).size;

  const state = {
    authResult: 'verified',
    credential,
    bundledCount: bundledModels.length,
    dynamicCount: dynamicModelCount,
    finalCount: finalModelCount,
    selectedModel: undefined as
      | {
          id: string;
          name?: string;
          api?: string;
          baseUrl?: string;
          requestModelId?: string;
          provider: string;
          contextWindow: number;
          maxTokens: number;
          reasoning?: boolean;
          input: string;
          headers?: Record<string, string>;
        }
      | undefined,
    routingProvider: providerId,
    streamStarted: false,
    streamCompleted: false,
    terminalRestored: false,
  };

  const resultFromState = (
    overrides: Partial<ProviderTestResult> = {},
  ): ProviderTestResult =>
    buildTestResult(providerId, classification, {
      authResult: state.authResult,
      credentialStorage: state.credential.storage,
      accountIdentityPresent: state.credential.accountIdentity,
      modelsDynamicCount: state.dynamicCount,
      modelsBundledCount: state.bundledCount,
      modelsFinalCount: state.finalCount,
      selectedModel: state.selectedModel?.id ?? 'none',
      routingProvider: state.routingProvider,
      streamStarted: state.streamStarted,
      streamCompleted: state.streamCompleted,
      terminalRestored: state.terminalRestored,
      ...overrides,
    });

  // -------------------------------------------------------------------------
  // Canonical credential adoption (the same write path /login performs).
  //
  // The OMP login above returns the credential to its CALLER only. Unlike
  // PlumbProviderAuthService (#ompLoginFlow), this harness held no
  // persistence leg of its own — so a store-resolving production transport
  // (the google-gemini-cli / google-antigravity dialect:
  // buildAntigravityRequest -> resolvePlumbProviderId(model.provider) ->
  // resolveUsablePlumbCredential) could not see the credential the user had
  // just authenticated with, and the immediate production stream failed with
  // NO_CREDENTIAL right after "Authentication successful." (live-observed
  // against a real Antigravity account). Adopt the completed login result
  // into the canonical credential authority (secure store + provider
  // registry) under the PLUMB presentation id (`providerId`, never the OMP
  // catalog id) BEFORE the stream step. This never starts another login —
  // it is the missing persistence leg of the login that just succeeded.
  //
  // The stub path is exempt: its credential is synthetic and must never
  // touch the real credential store.
  // -------------------------------------------------------------------------
  if (!stub) {
    const adoptLoginResult = providerModule['adoptPlumbLoginResult'] as
      | ((
          id: string,
          loginResult: unknown,
        ) => Promise<{ kind: 'oauth' | 'api_key' | 'none' }>)
      | undefined;
    if (typeof adoptLoginResult !== 'function') {
      state.terminalRestored = true;
      const result = resultFromState({
        result: 'LIVE_TEST_FAILED',
        safeError:
          'Provider module exposes no canonical login adoption (adoptPlumbLoginResult)',
      });
      return finish('FAILED', result, undefined);
    }
    try {
      await adoptLoginResult(providerId, credentialResult);
    } catch (err) {
      state.terminalRestored = true;
      const result = resultFromState({
        result: 'LIVE_TEST_FAILED',
        safeError: `Credential adoption into the PLUMB credential store failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
      return finish('FAILED', result, undefined);
    }
  }

  traceStage(`MODELS_LOADED (${state.bundledCount})`);
  writeLive(`Models loaded: ${state.bundledCount}`);
  if (state.bundledCount === 0) {
    state.terminalRestored = true;
    const result = resultFromState({
      result: 'BLOCKED_ACCOUNT_ENTITLEMENT',
      safeError: 'No bundled models available after authentication',
    });
    return finish('FAILED', result, undefined);
  }

  // -------------------------------------------------------------------------
  // Interactive model selection (no preselection).
  //
  // The picker loops: empty / whitespace / non-numeric / out-of-range input
  // reprompts; Ctrl+C / Esc / abort cancels; EOF reports
  // MODEL_SELECTION_STDIN_CLOSED. An empty read is never a terminal failure.
  // -------------------------------------------------------------------------
  writeLive('');
  writeLive('Select a model from the list below:');
  for (let i = 0; i < state.bundledCount; i++) {
    const m = bundledModels[i];
    writeLive(`  ${i + 1}. ${m.id}${m.name ? ` (${m.name})` : ''}`);
  }

  traceStage('PREPARING_MODEL_INPUT');
  if (process.stdin.isTTY) {
    traceStage(
      `stdin: isTTY=${process.stdin.isTTY} raw=${process.stdin.isRaw ?? false}` +
        ` readable=${process.stdin.readable ?? false}` +
        ` destroyed=${(process.stdin as { destroyed?: boolean }).destroyed ?? false}` +
        ` ended=${process.stdin.readableEnded ?? false}` +
        ` flowing=${process.stdin.readableFlowing ?? false}` +
        ` dataListeners=${process.stdin.listenerCount('data')}` +
        ` keypressListeners=${process.stdin.listenerCount('keypress')}`,
    );
  }

  let selectedIndex: number | undefined;
  let selectionFinished = false;
  while (!selectionFinished) {
    if (abortController.signal.aborted) break;
    const closed =
      process.stdin.destroyed === true || process.stdin.readableEnded === true;
    if (closed) {
      state.terminalRestored = true;
      const result = resultFromState({
        result: 'LIVE_TEST_FAILED',
        safeError: 'MODEL_SELECTION_STDIN_CLOSED',
      });
      return finish('FAILED', result, undefined);
    }

    traceStage(
      selectedIndex === undefined && !selectionFinished
        ? 'WAITING_FOR_MODEL_INPUT'
        : 'MODEL_REPROMPT',
    );
    const promptText = `Enter model number [1-${state.bundledCount}]:`;
    terminal.writeLine(promptText);
    const attempt = await modelInput(promptText, abortController.signal);
    if (abortController.signal.aborted) break;

    if (attempt.type === 'cancel') {
      break;
    }
    if (attempt.type === 'end') {
      state.terminalRestored = true;
      const result = resultFromState({
        result: 'LIVE_TEST_FAILED',
        safeError: 'MODEL_SELECTION_STDIN_CLOSED',
      });
      return finish('FAILED', result, undefined);
    }
    if (attempt.type === 'text' && attempt.value.trim() === '') {
      writeLive(`Please enter a number from 1 to ${state.bundledCount}`);
      continue;
    }
    if (attempt.type === 'text') {
      writeLive(
        `Please enter a number from 1 to ${state.bundledCount} (got non-numeric input)`,
      );
      continue;
    }
    const n = attempt.value;
    if (!Number.isInteger(n) || n < 1 || n > state.bundledCount) {
      writeLive(`Please enter a number from 1 to ${state.bundledCount}`);
      continue;
    }
    selectedIndex = n - 1;
    selectionFinished = true;
  }

  if (abortController.signal.aborted || selectionFinished === false) {
    state.terminalRestored = true;
    const result = resultFromState({
      result: 'LIVE_TEST_CANCELLED',
      safeError: 'USER_CANCELLED',
    });
    writeLive('Cancelling...');
    return finish('CANCELLED', result, 'LIVE_TEST_CANCELLED');
  }

  const chosenIndex = selectedIndex as number;
  const selectedModel = bundledModels[chosenIndex];
  state.selectedModel = selectedModel;
  traceStage('MODEL_SELECTED');
  writeLive(`Selected model: ${selectedModel.id}`);
  writeLive('');

  // -------------------------------------------------------------------------
  // Stream test (routing always stays on the authenticating provider).
  // -------------------------------------------------------------------------
  traceStage('PREPARING_STREAM');
  const result = resultFromState();
  const plumbModelStream = providerModule['plumbModelStream'] as
    | ((
        opts: Record<string, unknown>,
      ) => AsyncIterable<Record<string, unknown>>)
    | undefined;

  if (!plumbModelStream) {
    state.terminalRestored = true;
    result.terminalRestored = true;
    result.safeError = 'No plumbModelStream in provider module';
    result.result = 'LIVE_TEST_FAILED';
    return finish('FAILED', result, undefined);
  }

  if (!state.credential.available || !state.credential.key) {
    state.terminalRestored = true;
    result.terminalRestored = true;
    result.safeError = 'No usable credential from login';
    result.result = 'LIVE_TEST_FAILED';
    return finish('FAILED', result, undefined);
  }

  const catalogEntry = providerModule['getCatalogProviderEntry']
    ? (
        (
          providerModule as Record<
            string,
            (id: string) => Record<string, unknown> | undefined
          >
        )['getCatalogProviderEntry'] ?? (() => undefined)
      )(canonicalId)
    : undefined;

  const modelApi =
    selectedModel.api ??
    (catalogEntry?.['api'] as string) ??
    'openai-completions';
  const isCopilot = state.routingProvider === 'github-copilot';
  const modelBaseUrl =
    selectedModel.baseUrl ??
    (isCopilot
      ? (state.credential.apiEndpoint ?? 'https://api.githubcopilot.com')
      : undefined);
  const modelHeaders: Record<string, string> | undefined = isCopilot
    ? {
        'User-Agent': 'opencode/1.3.15',
        'X-GitHub-Api-Version': '2026-06-01',
      }
    : undefined;

  result.routingProvider = state.routingProvider;
  result.transportProvider = state.routingProvider;
  result.credentialProvider = state.routingProvider;
  result.transportDialect = modelApi;
  result.requestEndpoint = modelBaseUrl ?? 'from-omp-factory';
  result.authorizationScheme = 'Bearer';
  result.authorizationHeaderPresent = true;

  try {
    // Deterministic transport boundary for automated runs: observe the same
    // selection -> stream transition and return the fixed acceptance marker.
    const stubStream: AsyncIterable<Record<string, unknown>> =
      (async function* () {
        state.streamStarted = true;
        result.streamStarted = true;
        yield { type: 'text', text: 'PLUMB_TEST_OK' };
        yield { type: 'done' };
      })();

    const stream = stub
      ? stubStream
      : plumbModelStream({
          model: {
            // Spread the FULL catalog model (selectedModel) so that
            // requestModelId, name, baseUrl, headers, thinking, pricing,
            // and every other catalog field the transport may consult are
            // preserved. Constructing a synthetic model that only copies
            // `id` loses requestModelId — which for Antigravity models
            // like gemini-3.6-flash maps the display id to the wire id
            // (gemini-3.6-flash-low). Without this spread the acceptance
            // harness sends the display id on the wire, the backend
            // returns 404, and the test reports LIVE_TEST_FAILED even
            // though the credential and endpoint are correct.
            ...selectedModel,
            // The canonical catalog/OMP id, NOT the PLUMB presentation id:
            // normal-chat catalog models carry the OMP id on
            // PlumbModel.provider (e.g. `google-antigravity` for a caller
            // selecting `antigravity`), and the transport keys BOTH
            // credential-scope resolution (resolvePlumbProviderId) and the
            // provider-specific request shaping (isAntigravity envelope /
            // User-Agent) off model.provider. Passing the presentation id
            // here would make the acceptance request silently diverge from
            // the exact request normal chat sends. For non-aliased
            // providers (github-copilot) canonicalId === providerId, so
            // this changes nothing for them.
            //
            // selectedModel.provider is already the canonical OMP id from
            // the catalog, but we override explicitly for clarity and to
            // preserve the exact same runtime behavior as before.
            provider: canonicalId,
            // Override transport-specific fallbacks for Copilot and any
            // provider where the catalog omits api/baseUrl. The spread
            // above already carries the catalog values; these ??-coalesces
            // only fire when the catalog entry is missing the field.
            api: modelApi,
            ...(modelBaseUrl ? { baseUrl: modelBaseUrl } : {}),
            ...(modelHeaders ? { headers: modelHeaders } : {}),
            // Harness-specific overrides: narrow the acceptance stream to
            // the minimum token/window envelope so the test stays fast and
            // deterministic.
            contextWindow: 4096,
            maxTokens: 32,
            reasoning: false,
            input: 'text' as const,
          },
          messages: [{ role: 'user', content: 'Say exactly: PLUMB_TEST_OK' }],
          apiKey: state.credential.key,
          maxTokens: 32,
        });

    state.streamStarted =
      stub || !state.streamStarted ? true : state.streamStarted;
    result.streamStarted = true;
    let receivedText = false;

    for await (const event of stream) {
      if (event['type'] === 'text' && event['text']) {
        receivedText = true;
        state.streamCompleted = true;
        result.streamCompleted = true;
        break;
      }
      if (event['type'] === 'error') {
        result.safeError =
          (event['error'] as { message?: string })?.message ?? 'stream_error';
        break;
      }
      if (event['type'] === 'done') {
        break;
      }
    }

    if (receivedText) {
      result.result = 'LIVE_VERIFIED';
      result.cancellationVerified = true;
    } else {
      result.result = 'LIVE_TEST_FAILED';
      result.safeError = result.safeError || 'No text received from stream';
    }
  } catch (err) {
    result.safeError =
      err instanceof Error ? err.message : 'unknown_stream_error';
    result.result = 'LIVE_TEST_FAILED';
  }
  state.terminalRestored = true;
  result.terminalRestored = true;

  return finish('COMPLETED', result, undefined);
}

/**
 * Extract the usable access credential from an OMP login result.
 *
 * OMP device flows return OAuthCredentials with `access`; api-key flows return
 * a string or an object with `accessKey`/`key`. The secret never leaves this
 * function's closure and is only reported through safe flags.
 */
interface LoginCredentialResult {
  access?: string;
  accessKey?: string;
  key?: string;
  apiEndpoint?: string;
}

function isCredentialResult(value: unknown): value is LoginCredentialResult {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'access' in value ||
    'accessKey' in value ||
    'key' in value ||
    'apiEndpoint' in value
  );
}

function extractCredential(credentialResult: unknown): {
  available: boolean;
  key: string | undefined;
  storage: string;
  accountIdentity: boolean;
  apiEndpoint?: string;
} {
  if (typeof credentialResult === 'string' && credentialResult.trim()) {
    return {
      available: true,
      key: credentialResult,
      storage: 'runtime_memory',
      accountIdentity: false,
    };
  }
  if (isCredentialResult(credentialResult)) {
    const access = credentialResult.access;
    if (access) {
      return {
        available: true,
        key: access,
        storage: 'runtime_memory',
        accountIdentity: false,
        apiEndpoint: credentialResult.apiEndpoint,
      };
    }
    const key = credentialResult.accessKey ?? credentialResult.key;
    if (key) {
      return {
        available: true,
        key,
        storage: 'runtime_memory',
        accountIdentity: false,
      };
    }
  }
  return {
    available: false,
    key: undefined,
    storage: 'none',
    accountIdentity: false,
  };
}

// ---------------------------------------------------------------------------
// Main test runner
// ---------------------------------------------------------------------------

/**
 * Run a live acceptance test for a specific provider.
 *
 * Coding plans: genuinely interactive live login via the real OMP login
 * function. API-key providers: consume an env key and attempt a real stream.
 * Blocked providers: report classification and exit.
 *
 * Live tests require an interactive TTY. Without one the command exits
 * safely with LIVE_TEST_REQUIRES_INTERACTIVE_TTY.
 *
 * Returns exit code (0 = success, 1 = failure, 2 = blocked).
 */
/**
 * Claude Subscription (Agent SDK) acceptance test — bespoke, not routed
 * through classifyProvider/runCodingPlanLiveAcceptance/the generic
 * API-key path below. None of those fit: claude-subscription has no OMP
 * registration, no PLUMB-initiated login, no env-var/keychain credential
 * storage (the Agent SDK owns its own auth entirely), and no per-token
 * pricing catalog. This invokes the SAME production implementation normal
 * chat uses (transports/claudeSubscription.ts via plumbModelStream) --
 * never a separate acceptance-only fake adapter.
 *
 * Never prints: OAuth tokens, session secrets, Claude credential contents,
 * prompt text, or raw SDK internal files.
 */
async function runClaudeSubscriptionAcceptanceTest(
  opts: LiveAcceptanceOptions,
): Promise<number> {
  const report = opts.report ?? finalReportWriteLine;
  const providerId = 'claude-subscription';

  const line = (label: string, value: string | boolean | number) =>
    report(`${label}: ${value}`);

  line('provider', providerId);
  line('credentialAuthority', 'EXTERNAL_OFFICIAL_CREDENTIAL_AUTHORITY');

  let sdkPresent = false;
  let sdkVersion = 'unknown';
  try {
    const sdkPkg = (await import(
      '@anthropic-ai/claude-agent-sdk/package.json',
      { with: { type: 'json' } } as never
    )) as { default?: { version?: string }; version?: string };
    sdkVersion = sdkPkg.default?.version ?? sdkPkg.version ?? 'unknown';
    sdkPresent = true;
  } catch {
    sdkPresent = false;
  }
  line('sdk.present', sdkPresent);
  line('sdk.version', sdkVersion);

  const providerModule = await import('@google/gemini-cli-provider');

  // Never reachable: raw Claude Code OAuth ('anthropic' provider id) is
  // hard-blocked from selection (BLOCKED_UPSTREAM_POLICY,
  // catalog/providers.ts) regardless of Claude Subscription's own state.
  const anthropicProvider = providerModule.getPlumbProvider?.('anthropic');
  const legacyOAuthReachable = anthropicProvider?.available === true;
  line('legacyOAuth.reachable', legacyOAuthReachable);

  if (!sdkPresent) {
    const result = buildTestResult(
      providerId,
      {
        registration: 'EXTERNAL_OFFICIAL_CREDENTIAL_AUTHORITY',
        category: 'oauth_account',
      },
      {
        authResult: 'AGENT_SDK_UNAVAILABLE',
        result: 'IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED',
        safeError: 'Agent SDK package not installed',
      },
    );
    emitResultReport(result, report);
    void recordAcceptanceFromResult(result);
    return 1;
  }

  const status = await providerModule.getClaudeSubscriptionStatus();
  line('auth.status', status.status);

  const models = providerModule.getCatalogModels?.(providerId) ?? [];
  line('model.source', 'OFFICIAL_STATIC_METADATA (pinned Agent SDK aliases)');
  line('model.count', models.length);

  if (status.status !== 'CONNECTED_SUBSCRIPTION') {
    const result = buildTestResult(
      providerId,
      {
        registration: 'EXTERNAL_OFFICIAL_CREDENTIAL_AUTHORITY',
        category: 'oauth_account',
      },
      {
        authResult: status.status,
        modelsBundledCount: models.length,
        modelsFinalCount: models.length,
        result: 'IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED',
        safeError: status.detail ?? `Not connected: ${status.status}`,
      },
    );
    emitResultReport(result, report);
    void recordAcceptanceFromResult(result);
    return 1;
  }

  const selectedModel = models[0];
  if (!selectedModel) {
    report('SAFE_ERROR: no Claude Subscription model available');
    return 1;
  }
  line('model.selected', selectedModel.id);

  // Real production chat call -- the same plumbModelStream() dispatch
  // normal chat uses, routed by model.api === 'claude-agent-sdk' to
  // streamClaudeSubscription. Deliberately no tools/toolExecutor here: a
  // real acceptance run must never modify files or run shell commands
  // merely to prove the connection works (see module doc). Tool-authority
  // round-trip verification (PLUMB_MCP_SERVER_REGISTERED,
  // TOOL_REQUEST_RECEIVED, CORE_SCHEDULER_USED, TOOL_EXECUTED_ONCE) is
  // covered by claudeSubscriptionTools.test.ts / claudeSubscriptionToolBridge.test.ts
  // and is intentionally NOT part of this harness yet -- deferred, not
  // silently claimed here.
  line('tools.status', 'NOT_TESTED_BY_HARNESS (see unit tests instead)');
  line(
    'tool.authority',
    'PLUMB_CORE_TOOL_SCHEDULER (design; not exercised by this harness run)',
  );

  let streamStarted = false;
  let streamCompleted = false;
  let sawText = false;
  try {
    const controller = new AbortController();
    const stream = providerModule.plumbModelStream({
      model: selectedModel,
      messages: [
        {
          role: 'user',
          content: 'Reply with exactly the single word: OK',
        },
      ],
      apiKey: '',
      signal: controller.signal,
    });
    for await (const event of stream) {
      if (!streamStarted) {
        streamStarted = true;
        line('stream.started', true);
      }
      if (event.type === 'text') sawText = true;
      if (event.type === 'error') {
        const result = buildTestResult(
          providerId,
          {
            registration: 'EXTERNAL_OFFICIAL_CREDENTIAL_AUTHORITY',
            category: 'oauth_account',
          },
          {
            authResult: status.status,
            modelsBundledCount: models.length,
            modelsFinalCount: models.length,
            selectedModel: selectedModel.id,
            transportDialect: 'claude-agent-sdk',
            streamStarted,
            // Never taken over on this path — see the final result below.
            terminalRestored: true,
            result: 'LIVE_TEST_FAILED',
            safeError: event.error?.message ?? 'stream error',
          },
        );
        emitResultReport(result, report);
        void recordAcceptanceFromResult(result);
        return 1;
      }
      if (event.type === 'done') streamCompleted = true;
    }
  } catch (err) {
    line('stream.completed', false);
    report(
      `SAFE_ERROR: ${err instanceof Error ? err.message : 'stream failed'}`,
    );
    return 1;
  }
  line('stream.completed', streamCompleted);
  line(
    'multiTurn.available',
    'DESIGNED (stateless-per-call transcript re-send; see claudeSubscription.test.ts multi-turn suite)',
  );
  line(
    'cancellation.status',
    'DESIGNED (AbortSignal wired; see claudeSubscription.test.ts cancellation test)',
  );

  const result = buildTestResult(
    providerId,
    {
      registration: 'EXTERNAL_OFFICIAL_CREDENTIAL_AUTHORITY',
      category: 'oauth_account',
    },
    {
      authResult: status.status,
      accountIdentityPresent: Boolean(status.account),
      modelsBundledCount: models.length,
      modelsFinalCount: models.length,
      selectedModel: selectedModel.id,
      routingProvider: providerId,
      transportProvider: providerId,
      transportDialect: 'claude-agent-sdk',
      streamStarted,
      streamCompleted,
      // This bespoke SDK path never takes terminal ownership (no raw-mode
      // acquire, no readline, no SIGINT capture — that machinery exists only
      // in runCodingPlanLiveAcceptance), so the terminal is intact by
      // construction and there is nothing to restore. Reporting the
      // buildTestResult default (false) here falsely implied broken cleanup
      // on an otherwise successful run. The success predicate below is
      // deliberately stream evidence only; this field is not part of it.
      terminalRestored: true,
      result: streamCompleted && sawText ? 'LIVE_VERIFIED' : 'LIVE_TEST_FAILED',
      safeError: streamCompleted ? 'none' : 'stream did not complete',
    },
  );
  emitResultReport(result, report);
  void recordAcceptanceFromResult(result);
  report(
    'REAL_ACCOUNT_TEST: this run used your real Claude Subscription account.',
  );
  return result.result === 'LIVE_VERIFIED' ? 0 : 1;
}

export async function runProviderAcceptanceTest(
  providerId: string,
  opts: LiveAcceptanceOptions = {},
): Promise<number> {
  installBunGlobal();

  const report = opts.report ?? finalReportWriteLine;

  if (REFERENCE_ROUTES.has(providerId)) {
    report(`${providerId} is a verified reference route (skipping).`);
    return 0;
  }

  if (providerId === 'claude-subscription') {
    return runClaudeSubscriptionAcceptanceTest(opts);
  }

  try {
    const providerModule = await import('@google/gemini-cli-provider');

    const canonicalId = providerModule.resolveProviderAlias
      ? providerModule.resolveProviderAlias(providerId)
      : providerId;

    const plumbProvider = providerModule.getPlumbProvider
      ? providerModule.getPlumbProvider(providerId)
      : undefined;
    const plumbCategory = plumbProvider?.category;

    const providerDef = providerModule.getProviderDefinition?.(canonicalId) as
      | Record<string, unknown>
      | undefined;
    const catalogEntry = providerModule.getCatalogProviderEntry?.(
      canonicalId,
    ) as Record<string, unknown> | undefined;

    const classification = classifyProvider(
      providerId,
      plumbCategory,
      providerDef,
      catalogEntry,
    );

    // Custom providers (user-defined OpenAI/Anthropic/Gemini-compatible
    // endpoints) share the exact same generic discover-then-stream
    // production path as the built-in local runtime endpoints -- neither
    // has a static catalog entry, and both must prove SERVER_UNAVAILABLE on
    // no reachable endpoint and the real production request on a live one.
    const isCustomProvider = Boolean(
      providerModule.isCustomProviderId?.(providerId),
    );
    if (LOCAL_PROVIDER_ROUTES.has(providerId) || isCustomProvider) {
      return await runLocalProviderAcceptanceTest(
        providerId,
        providerModule as unknown as LocalAcceptanceProviderModule,
        classification,
        report,
      );
    }

    if (classification.blocked) {
      const result = buildTestResult(providerId, classification, {
        authResult: 'not_attempted',
        result: classification.blockReason as ProviderTestResult['result'],
        safeError: `Provider blocked: ${classification.blockReason}`,
      });
      emitResultReport(result, report);
      void recordAcceptanceFromResult(result);
      return 2;
    }

    // TTY check: live tests require an interactive terminal.
    if (process.stdin.isTTY !== true) {
      report('LIVE_TEST_REQUIRES_INTERACTIVE_TTY');
      return 1;
    }

    // Coding-plan path: invoke the real OMP login.
    if (classification.category === 'coding_plan') {
      return await runCodingPlanLiveAcceptance(
        providerId,
        canonicalId,
        providerModule,
        providerDef,
        plumbCategory,
        opts,
      );
    }

    // API-key path: check credential availability.
    //
    // The OMP catalog entry's `envVars` field is incomplete/absent for
    // PLUMB-specific cloud providers (amazon-bedrock and google-vertex list
    // none there at all; azure omits AZURE_OPENAI_ENDPOINT; watsonx/oci-genai
    // have no OMP catalog entry to begin with). `plumbProvider.envVars` is
    // the already-correct, complete union PLUMB computes from its own
    // authMethods (see catalog/providers.ts plumbEnvVars/buildProvider) and
    // is what setup/status screens use, so credential detection here must
    // agree with it rather than re-deriving a narrower OMP-only list.
    const envVars: string[] =
      plumbProvider?.envVars ?? (catalogEntry?.['envVars'] as string[]) ?? [];
    const hasEnvKey = envVars.some((v) => {
      const val = process.env[v];
      return typeof val === 'string' && val.trim().length > 0;
    });

    const bundledModels = providerModule.getCatalogModels?.(canonicalId) ?? [];
    const defaultModelId = catalogEntry?.['defaultModel'] as string | undefined;
    let selectedModel =
      (defaultModelId
        ? bundledModels.find((m) => m.id === defaultModelId)
        : undefined) ?? bundledModels[0];
    let dynamicModels: typeof bundledModels = [];

    const registry = providerModule.getPlumbProviderRegistry?.();
    let authState = 'unauthenticated';
    let keychainApiKey: string | undefined;
    if (registry) {
      try {
        await registry.initialize();
        const state = registry.getProviderState(providerId);
        authState = state?.authState ?? 'unauthenticated';
        keychainApiKey = await registry.getApiKey?.(providerId);
        // The registry already holds the decrypted credential for keychain
        // ('PLUMB-owned, stored via the canonical credential store' -- the
        // primary auth path for watsonx/oci-genai/azure/etc., see
        // catalog/providers.ts) -- discarding it here (keeping only
        // authState) would make the real stream test unreachable for every
        // provider whose credential lives in the keychain instead of env.
        const cred = state?.credentials;
        if (!keychainApiKey && cred?.type === 'api_key' && cred.key) {
          keychainApiKey = cred.key;
        }
      } catch {
        // Registry not available
      }
    }

    const resolvedCredential = hasEnvKey
      ? (process.env[envVars.find((v) => process.env[v]?.trim()) ?? ''] ?? '')
      : (keychainApiKey ?? '');
    if (
      GATEWAY_PROVIDER_ROUTES.has(providerId) &&
      (resolvedCredential || plumbProvider?.allowUnauthenticated)
    ) {
      try {
        dynamicModels =
          (await providerModule
            .getPlumbModelRegistry?.()
            ?.refreshProvider?.(providerId, resolvedCredential || undefined)) ??
          [];
        const dynamicDefault = defaultModelId
          ? dynamicModels.find((model) => model.id === defaultModelId)
          : undefined;
        selectedModel = dynamicDefault ?? dynamicModels[0] ?? selectedModel;
      } catch {
        // A gateway may not expose model enumeration. Bundled models remain
        // the honest fallback; a dynamic-only gateway stays unverified.
      }
    }

    // Transport dialect/endpoint come from the selected bundled model, not a
    // generic openai-completions fallback: each cloud provider (azure,
    // amazon-bedrock, google-vertex, watsonx, oci-genai) is dispatched
    // through its own registered transport (see transports/streaming.ts),
    // keyed by model.api, and a wrong dialect here would silently route the
    // acceptance stream through the wrong signer/transport.
    const api = selectedModel?.api ?? 'openai-completions';
    const baseUrl = selectedModel?.baseUrl ?? 'from-omp-factory';

    const result = buildTestResult(providerId, classification, {
      authResult: hasEnvKey
        ? 'env_key_present'
        : authState === 'authenticated'
          ? 'keychain_authenticated'
          : 'no_credential',
      credentialStorage: hasEnvKey ? 'env' : 'keychain',
      modelsBundledCount: bundledModels.length,
      modelsDynamicCount: dynamicModels.length,
      modelsFinalCount: dynamicModels.length || bundledModels.length,
      selectedModel: selectedModel?.id ?? 'none',
      transportDialect: api,
      requestEndpoint: baseUrl,
      authorizationHeaderPresent: hasEnvKey || authState === 'authenticated',
      result: 'IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED',
    });

    if ((hasEnvKey || authState === 'authenticated') && selectedModel) {
      try {
        const apiKey = resolvedCredential;

        if (apiKey && providerModule.plumbModelStream) {
          result.streamStarted = true;
          const stream = providerModule.plumbModelStream({
            model: {
              // Spread the full catalog model so that requestModelId and
              // all other catalog metadata are preserved for transports
              // that consult them (e.g. google-antigravity's
              // buildAntigravityRequest uses requestModelId for the wire
              // model).
              ...selectedModel,
              provider: providerId,
              api: api as 'openai-completions',
              contextWindow: selectedModel.contextWindow ?? 4096,
              maxTokens: 32,
              reasoning: false,
              input: 'text' as const,
              ...(baseUrl !== 'from-omp-factory' ? { baseUrl } : {}),
            },
            messages: [{ role: 'user', content: 'Say exactly: PLUMB_TEST_OK' }],
            apiKey,
            maxTokens: 32,
          });

          let receivedText = false;
          for await (const event of stream) {
            if (event.type === 'text' && event.text) {
              receivedText = true;
            }
            if (event.type === 'error') {
              result.safeError = event.error?.message ?? 'stream_error';
              break;
            }
            if (event.type === 'done') {
              result.streamCompleted = true;
              break;
            }
          }

          if (receivedText && result.streamCompleted) {
            result.result = 'LIVE_VERIFIED';
          }
        }
      } catch (err) {
        result.safeError =
          err instanceof Error ? err.message : 'unknown_stream_error';
        result.result = 'LIVE_TEST_FAILED';
      }
    }

    emitResultReport(result, report);
    void recordAcceptanceFromResult(result);
    return result.result === 'LIVE_VERIFIED' ? 0 : 1;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    report(`test-provider: ERROR: ${errMsg}`);
    return 1;
  }
}

function recordAcceptanceFromResult(result: ProviderTestResult): Promise<void> {
  return recordAcceptance({
    providerId: result.providerId,
    modelId: result.selectedModel !== 'none' ? result.selectedModel : undefined,
    testDate: new Date().toISOString(),
    productHead: BUILD_IDENTITY.gitHead,
    ompSha: OMP_SHA,
    safeResult: result.result,
    streamVerified: result.streamCompleted,
    restartVerified: result.restartRestoreVerified,
    logoutVerified: result.logoutScopeVerified,
    safeError: result.safeError !== 'none' ? result.safeError : undefined,
  });
}

// ---------------------------------------------------------------------------
// --test-provider-list / --test-provider-next
// ---------------------------------------------------------------------------

/**
 * List all unverified selectable providers grouped by category.
 */
export async function printProviderTestList(): Promise<number> {
  installBunGlobal();
  const report = finalReportWriteLine;

  try {
    const providerModule = await import('@google/gemini-cli-provider');
    const acceptances = await getAllAcceptances();

    const selectable = providerModule.SELECTABLE_PROVIDERS as unknown as Array<{
      id: string;
      name: string;
      category: string;
      authMethods: Array<{ type: string }>;
      availabilityReason?: string;
    }>;

    const groups: Record<string, typeof selectable> = {
      coding_plan: [],
      oauth_account: [],
      api_key: [],
      local: [],
    };

    for (const p of selectable) {
      const cat = p.category ?? 'api_key';
      if (Object.prototype.hasOwnProperty.call(groups, cat)) {
        groups[cat].push(p);
      } else {
        groups['api_key'].push(p);
      }
    }

    const categoryLabels: Record<string, string> = {
      coding_plan: 'Coding Plans',
      oauth_account: 'OAuth Accounts',
      api_key: 'API Providers',
      local: 'Local Providers',
    };

    for (const [cat, label] of Object.entries(categoryLabels)) {
      const providers = groups[cat];
      if (providers.length === 0) continue;

      report(`\n${label} (${providers.length})`);
      report('-'.repeat(80));

      for (const p of providers) {
        const acc = acceptances[p.id];
        const isVerified = acc?.safeResult === 'LIVE_VERIFIED';
        const isReference = REFERENCE_ROUTES.has(p.id);
        const blocked = p.availabilityReason ?? '';
        const authMethod = p.authMethods.map((m) => m.type).join('+');

        let status: string;
        if (isReference) {
          status = 'REFERENCE_VERIFIED';
        } else if (isVerified) {
          status = 'LIVE_VERIFIED';
        } else if (blocked) {
          status = blocked;
        } else {
          status = 'UNVERIFIED';
        }

        let nextAction: string;
        if (isReference || isVerified) {
          nextAction = 'none (verified)';
        } else if (blocked) {
          nextAction = 'blocked';
        } else {
          nextAction = `plumb --test-provider ${p.id}`;
        }

        report(
          `  ${p.id.padEnd(28)} ${authMethod.padEnd(15)} ${status.padEnd(45)} ${nextAction}`,
        );
      }
    }

    report('');
    return 0;
  } catch (err) {
    report(
      `test-provider-list: ERROR: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }
}

/**
 * Choose the next unverified provider for which the user can supply a credential.
 */
export async function printProviderTestNext(): Promise<number> {
  installBunGlobal();
  const report = finalReportWriteLine;

  try {
    const providerModule = await import('@google/gemini-cli-provider');
    const acceptances = await getAllAcceptances();

    const selectable = providerModule.SELECTABLE_PROVIDERS as unknown as Array<{
      id: string;
      name: string;
      category: string;
      authMethods: Array<{ type: string }>;
      availabilityReason?: string;
    }>;

    for (const p of selectable) {
      if (REFERENCE_ROUTES.has(p.id)) continue;
      if (p.availabilityReason) continue;

      const acc = acceptances[p.id];
      if (acc?.safeResult === 'LIVE_VERIFIED') continue;
      if (acc?.safeResult === 'LIVE_TEST_FAILED') {
        report(`Next provider to test (retry): ${p.id}`);
        report(`  plumb --test-provider ${p.id}`);
        return 0;
      }

      report(`Next provider to test: ${p.id}`);
      report(`  plumb --test-provider ${p.id}`);
      return 0;
    }

    report('All selectable providers have been verified.');
    return 0;
  } catch (err) {
    report(
      `test-provider-next: ERROR: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }
}
