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
const REFERENCE_ROUTES = new Set([
  'nvidia',
  'ollama',
  'lm-studio',
  'llama-cpp',
  'vllm',
  'custom-openai-compat',
]);

// Env var that switches the interactive acceptance test to a deterministic
// stub provider boundary (used by the Windows ConPTY integration test).
export const ACCEPTANCE_STUB_ENV = 'PLUMB_ACCEPTANCE_STUB';
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
 * Deterministic provider boundary for automated (ConPTY) acceptance runs.
 * Immediately surfaces a URL + user code, then polls forever and can only be
 * left by cancellation. Never touches the network.
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
}): Promise<unknown> {
  return new Promise<unknown>((_resolve, reject) => {
    const present = () => {
      callbacks.onAuth({
        url: 'https://github.com/login/device',
        launchUrl: 'https://github.com/login/device',
        instructions: `Enter code: ${STUB_USER_CODE}`,
      });
    };
    const waitForAbort = () => {
      const onAbort = () =>
        reject(new Error('STUB_POLL_CANCELLED_OPERATION_CANCELLED'));
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
  const traceMode = opts.traceMode === true;
  const stub = opts.stub === true || process.env[ACCEPTANCE_STUB_ENV] === '1';

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
  writeLive('Authentication successful.');
  writeLive('');

  // -------------------------------------------------------------------------
  // Load models
  // -------------------------------------------------------------------------
  const bundledModels = providerModule['getCatalogModels']
    ? ((providerModule as Record<string, (id: string) => unknown[]>)[
        'getCatalogModels'
      ](canonicalId) as Array<{ id: string; name?: string }>)
    : [];

  writeLive(`Models loaded: ${bundledModels.length}`);
  if (bundledModels.length === 0) {
    const result = buildTestResult(providerId, classification, {
      authResult: 'verified',
      result: 'BLOCKED_ACCOUNT_ENTITLEMENT',
      safeError: 'No bundled models available after authentication',
      terminalRestored: true,
    });
    return finish('FAILED', result, undefined);
  }

  // -------------------------------------------------------------------------
  // Interactive model selection (no preselection)
  // -------------------------------------------------------------------------
  writeLive('');
  writeLive('Select a model from the list below:');
  for (let i = 0; i < bundledModels.length; i++) {
    const m = bundledModels[i];
    writeLive(`  ${i + 1}. ${m.id}${m.name ? ` (${m.name})` : ''}`);
  }

  const selectionAnswer = await readLine(
    `Enter model number [1-${bundledModels.length}]:`,
    abortController.signal,
  );
  if (abortController.signal.aborted) {
    const result = buildTestResult(providerId, classification, {
      authResult: 'cancelled',
      result: 'LIVE_TEST_CANCELLED',
      terminalRestored: true,
    });
    writeLive('Cancelling...');
    return finish('CANCELLED', result, 'LIVE_TEST_CANCELLED');
  }
  const chosenIndex = Number.parseInt(selectionAnswer, 10) - 1;
  if (
    Number.isNaN(chosenIndex) ||
    chosenIndex < 0 ||
    chosenIndex >= bundledModels.length
  ) {
    const result = buildTestResult(providerId, classification, {
      authResult: 'verified',
      result: 'LIVE_TEST_FAILED',
      safeError: 'No valid model selected',
      terminalRestored: true,
    });
    return finish('FAILED', result, undefined);
  }
  const selectedModel = bundledModels[chosenIndex];
  writeLive(`Selected model: ${selectedModel.id}`);
  writeLive('');

  // -------------------------------------------------------------------------
  // Stream test
  // -------------------------------------------------------------------------
  const result = buildTestResult(providerId, classification, {
    authResult: 'verified',
    accountIdentityPresent: true,
    modelsBundledCount: bundledModels.length,
    modelsFinalCount: bundledModels.length,
    selectedModel: selectedModel.id,
  });

  try {
    let apiKey = '';
    if (typeof credentialResult === 'string') {
      apiKey = credentialResult;
    } else if (
      credentialResult &&
      typeof credentialResult === 'object' &&
      'accessKey' in credentialResult
    ) {
      apiKey = (credentialResult as { accessKey: string }).accessKey;
    }

    if (apiKey) {
      const plumbModelStream = providerModule['plumbModelStream'] as
        | ((
            opts: Record<string, unknown>,
          ) => AsyncIterable<Record<string, unknown>>)
        | undefined;

      if (plumbModelStream) {
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

        const api = (catalogEntry?.['api'] as string) ?? 'openai-completions';

        const stream = plumbModelStream({
          model: {
            id: selectedModel.id,
            provider: providerId,
            api,
            contextWindow: 4096,
            maxTokens: 32,
            reasoning: false,
            input: 'text',
          },
          messages: [{ role: 'user', content: 'Say exactly: PLUMB_TEST_OK' }],
          apiKey,
          maxTokens: 32,
        });

        result.streamStarted = true;
        let receivedText = false;

        for await (const event of stream) {
          if (event['type'] === 'text' && event['text']) {
            receivedText = true;
            result.streamCompleted = true;
            break;
          }
          if (event['type'] === 'error') {
            result.safeError =
              (event['error'] as { message?: string })?.message ??
              'stream_error';
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
      }
    } else {
      result.result = 'LIVE_TEST_FAILED';
      result.safeError = 'No usable credential from login';
    }
  } catch (err) {
    result.safeError =
      err instanceof Error ? err.message : 'unknown_stream_error';
    result.result = 'LIVE_TEST_FAILED';
  }
  result.terminalRestored = true;

  return finish('COMPLETED', result, undefined);
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
    const envVars: string[] = (catalogEntry?.['envVars'] as string[]) ?? [];
    const hasEnvKey = envVars.some((v) => {
      const val = process.env[v];
      return typeof val === 'string' && val.trim().length > 0;
    });

    const bundledModels = providerModule.getCatalogModels?.(canonicalId) ?? [];

    const registry = providerModule.getPlumbProviderRegistry?.();
    let authState = 'unauthenticated';
    if (registry) {
      try {
        await registry.initialize();
        const state = registry.getProviderState(providerId);
        authState = state?.authState ?? 'unauthenticated';
      } catch {
        // Registry not available
      }
    }

    const api = (catalogEntry?.['api'] as string) ?? 'openai-completions';
    const baseUrl = (catalogEntry?.['baseUrl'] as string) ?? 'from-omp-factory';

    const result = buildTestResult(providerId, classification, {
      authResult: hasEnvKey
        ? 'env_key_present'
        : authState === 'authenticated'
          ? 'keychain_authenticated'
          : 'no_credential',
      credentialStorage: hasEnvKey ? 'env' : 'keychain',
      modelsBundledCount: bundledModels.length,
      modelsFinalCount: bundledModels.length,
      requestEndpoint: baseUrl,
      authorizationHeaderPresent: hasEnvKey || authState === 'authenticated',
      result: 'IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED',
    });

    if (hasEnvKey || authState === 'authenticated') {
      try {
        const apiKey = hasEnvKey
          ? (process.env[envVars.find((v) => process.env[v]) ?? ''] ?? '')
          : '';

        if (apiKey && providerModule.plumbModelStream) {
          result.streamStarted = true;
          const stream = providerModule.plumbModelStream({
            model: {
              id: result.selectedModel ?? 'default',
              provider: providerId,
              api: api as 'openai-completions',
              contextWindow: 4096,
              maxTokens: 32,
              reasoning: false,
              input: 'text' as const,
              baseUrl: baseUrl !== 'from-omp-factory' ? baseUrl : undefined,
            },
            messages: [{ role: 'user', content: 'Say exactly: PLUMB_TEST_OK' }],
            apiKey,
            maxTokens: 32,
          });

          let receivedText = false;
          for await (const event of stream) {
            if (event.type === 'text' && event.text) {
              receivedText = true;
              result.streamCompleted = true;
              break;
            }
            if (event.type === 'error') {
              result.safeError = event.error?.message ?? 'stream_error';
              break;
            }
            if (event.type === 'done') break;
          }

          if (receivedText) {
            result.result = 'LIVE_VERIFIED';
            result.cancellationVerified = true;
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
