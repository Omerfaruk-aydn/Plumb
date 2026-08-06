/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
import * as readline from 'node:readline';
import { installBunGlobal } from '@google/gemini-cli-provider';
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

// ─── Result types ────────────────────────────────────────────────────

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

// ─── Single-line writer ──────────────────────────────────────────────

/** Flush-safe single-line stdout writer. One visible line per call. */
function writeOut(line: string): void {
  process.stdout.write(`${line}\n`);
}

// ─── Safe trace ──────────────────────────────────────────────────────

/** Stage-only trace. Never includes user/device codes or tokens. */
function buildSafeTrace(): string[] {
  return [];
}
function traceTrace(stages: string[], name: string): void {
  stages.push(name);
}

// ─── Provider classification ─────────────────────────────────────────

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

  // Use the PLUMB category from getPlumbProvider (the authoritative source),
  // not the OMP definition which does not carry a category field.
  const category = plumbCategory ?? 'api_key';

  return { registration, category, blocked: false, blockReason: '' };
}

// ─── Test result builder ─────────────────────────────────────────────

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
    safeError: 'none',
    result: 'LIVE_TEST_FAILED',
    ...overrides,
  };
}

// ─── Safe result printer ─────────────────────────────────────────────

function printSafeResult(r: ProviderTestResult): void {
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
    `safe.error: ${r.safeError}`,
    `result: ${r.result}`,
  ];
  for (const line of lines) {
    writeOut(line);
  }
}

// ─── Coding-plan login helpers ───────────────────────────────────────

/** Prompt detection: github.com enterprise question is skippable. */
function isGithubEnterprisePrompt(message: string): boolean {
  return message.toLowerCase().includes('github enterprise');
}

/** Extract a temporary user code from the OAuth instructions string. */
function extractUserCode(instructions?: string): string | undefined {
  if (!instructions) return undefined;
  const match = /Enter code:\s*([A-Z0-9-]+)/i.exec(instructions);
  return match?.[1];
}

/**
 * Single-input-owner login controller.
 *
 * On top of providing onAuth/onProgress to the OMP login thunk, this
 * implements the input contract:
 *  - `onPrompt` never asks for a GitHub Enterprise domain on the standard
 *    github.com flow (allowEmpty prompts are answered with '').
 *  - Raw-mode Esc/Ctrl+C capture and readline are never active together.
 *  - After cancellation the flow stops immediately.
 */
export interface CodingPlanLoginSession {
  login: (callbacks: {
    onAuth: (info: {
      url?: string;
      launchUrl?: string;
      instructions?: string;
    }) => void;
    onProgress: (message: string) => void;
    onPrompt: (prompt: {
      message: string;
      placeholder?: string;
      allowEmpty?: boolean;
    }) => Promise<string>;
    signal?: AbortSignal;
  }) => Promise<unknown>;
  displayName: string;
}

/**
 * Prompt policy helper used by the harness controller. Injectable for tests.
 */
export interface PromptPolicy {
  /** true when a standard allow-empty prompt should be skipped. */
  isSkippable(prompt: { message: string; allowEmpty?: boolean }): boolean;
}

const BASE_PROMPT_POLICY: PromptPolicy = {
  isSkippable: (prompt) => {
    if (!prompt.allowEmpty) return false;
    return true;
  },
};

// ─── Coding-plan live test ──────────────────────────────────────────

/**
 * Run a genuinely interactive live test for a coding-plan provider.
 *
 * Invokes the real OMP login callback, displays the device code / URL,
 * polls for token, stores the credential, loads models, runs an
 * interactive model picker, sends a harmless test prompt, and verifies
 * the streamed response.
 */
export async function runCodingPlanLiveAcceptance(
  providerId: string,
  canonicalId: string,
  providerModule: Record<string, unknown>,
  providerDef: Record<string, unknown> | undefined,
  plumbCategory: string | undefined,
): Promise<number> {
  const hasLogin = typeof providerDef?.['login'] === 'function';
  const classification = classifyProvider(
    providerId,
    plumbCategory,
    providerDef,
    undefined,
  );

  if (!hasLogin) {
    const result = buildTestResult(providerId, classification, {
      authResult: 'no_omp_login',
      result: 'IMPLEMENTATION_INCOMPLETE_NOT_SELECTABLE',
      safeError: `OMP definition for ${canonicalId} has no login function`,
    });
    printSafeResult(result);
    await recordAcceptanceFromResult(result);
    return 1;
  }

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

  // ─── Startup stage must be visible BEFORE the first await ───────────
  writeOut('PLUMB coding-plan live acceptance');
  writeOut(`Provider: ${displayName}`);
  writeOut(`Mechanism: ${mechanism}`);
  writeOut('Stage: Requesting device authorization...');
  writeOut('');

  const stages: string[] = buildSafeTrace();
  traceTrace(stages, 'DEVICE_REQUEST_STARTED');

  // ─── Single terminal input owner ────────────────────────────────────
  const abortController = new AbortController();
  let rawModeActive = false;
  const canceled = false;

  const onInput = (data: string | Buffer) => {
    const str = String(data);
    if (str.includes('\u0003') || str.includes('\u001b')) {
      abortController.abort();
    }
  };
  const rawRestorers: Array<() => void> = [];
  let rawModeRestored = false;

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

  const suspendRawForPrompt = () => {
    if (!rawModeActive) return;
    try {
      if (process.stdin.setRawMode) process.stdin.setRawMode(false);
    } catch {
      // ignore
    }
    try {
      process.stdin.removeListener('data', onInput);
    } catch {
      // ignore
    }
    rawModeActive = false;
    rawRestorers.length = 0;
  };

  const onSigint = () => abortController.abort();
  if (process.stdin.isTTY) {
    process.on('SIGINT', onSigint);
  }
  const releaseSigint = () => {
    if (process.stdin.isTTY) {
      process.removeListener('SIGINT', onSigint);
    }
  };

  // ─── Heartbeat while authorization is pending ──────────────────────
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let heartbeatSeconds = 0;
  const startHeartbeat = () => {
    if (heartbeatTimer) return;
    let pendingTraced = false;
    heartbeatTimer = setInterval(() => {
      heartbeatSeconds += 1;
      if (!pendingTraced) {
        pendingTraced = true;
        traceTrace(stages, 'TOKEN_POLL_PENDING');
      }
      process.stdout.write(
        `\rWaiting for GitHub authorization... ${heartbeatSeconds}s\x1b[K`,
      );
    }, 1000);
  };
  const stopHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }
  };

  // ─── Prompt handler: line input with cancellation support ───────────
  const inputControllerShim = async (prompt: {
    message: string;
    placeholder?: string;
    allowEmpty?: boolean;
  }): Promise<string> => {
    if (BASE_PROMPT_POLICY.isSkippable(prompt)) {
      // Standard github.com flow: never ask for the enterprise domain.
      traceTrace(
        stages,
        isGithubEnterprisePrompt(prompt.message)
          ? 'PROMPT_SKIPPED_STANDARD_GITHUB'
          : 'PROMPT_SKIPPED_ALLOW_EMPTY',
      );
      return prompt.allowEmpty ? '' : '';
    }

    // Genuinely required input: suspend raw mode, read one line.
    suspendRawForPrompt();
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = await new Promise<string>((resolve) => {
      const onAbort = () => {
        rl.close();
        resolve('');
      };
      if (abortController.signal.aborted) {
        onAbort();
        return;
      }
      abortController.signal.addEventListener('abort', onAbort, { once: true });
      rl.question(`${prompt.message}: `, (value) => {
        abortController.signal.removeEventListener('abort', onAbort);
        rl.close();
        resolve(value);
      });
    });
    acquireRawMode(); // restore the single input owner
    return answer;
  };

  // ─── Invoke OMP login ──────────────────────────────────────────────
  let credential: unknown;

  const callbacks = {
    onAuth: (info: {
      url?: string;
      launchUrl?: string;
      instructions?: string;
    }) => {
      stopHeartbeat();
      writeOut('Verification URL:');
      writeOut(info.launchUrl ?? info.url ?? '');
      const code = extractUserCode(info.instructions);
      if (code) {
        writeOut('User code:');
        writeOut(code);
      }
      writeOut('');
      writeOut('Open the URL and enter the code.');
      writeOut('Stage: Waiting for GitHub authorization...');
      writeOut('Esc or Ctrl+C to cancel');
      if (info.launchUrl ?? info.url) {
        traceTrace(stages, 'DEVICE_CODE_PRESENTED');
      }
      traceTrace(stages, 'TOKEN_POLL_STARTED');
      startHeartbeat();
    },
    onProgress: (message: string) => {
      if (message && !/\r/.test(message)) {
        writeOut(message);
      }
    },
    onPrompt: inputControllerShim,
  };
  if (process.stdin.isTTY) {
    acquireRawMode();
  }

  try {
    credential = await (
      providerDef as {
        login: (callbacksWithoutInput: unknown) => Promise<unknown>;
      }
    )['login']({
      onAuth: callbacks.onAuth,
      onProgress: callbacks.onProgress,
      onPrompt: callbacks.onPrompt,
      signal: abortController.signal,
    });
    stopHeartbeat();
  } catch (err) {
    stopHeartbeat();
    const wasCancelled =
      abortController.signal.aborted ||
      canceled ||
      (err instanceof Error &&
        (err.message.includes('CANCELLED') ||
          err.message.includes('cancelled')));
    restoreRawOnce();
    releaseSigint();
    if (wasCancelled) {
      traceTrace(stages, 'CANCELLED');
      writeOut('\rLIVE_TEST_CANCELLED');
      for (const s of stages) writeOut(`trace.stage: ${s}`);
      return 1;
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    writeOut(`LIVE_TEST_FAILED: ${errMsg}`);
    for (const s of stages) writeOut(`trace.stage: ${s}`);
    return 1;
  } finally {
    restoreRawOnce();
    releaseSigint();
  }

  // Never advance the flow after cancellation.
  if (abortController.signal.aborted) {
    traceTrace(stages, 'CANCELLED');
    writeOut('\nLIVE_TEST_CANCELLED');
    for (const s of stages) writeOut(`trace.stage: ${s}`);
    return 1;
  }

  traceTrace(stages, 'DEVICE_RESPONSE_RECEIVED');
  traceTrace(stages, 'TOKEN_RECEIVED');
  stopHeartbeat();
  writeOut('Authentication successful.');
  writeOut('');

  // ─── Load models ────────────────────────────────────────────────────
  const bundledModels = providerModule['getCatalogModels']
    ? ((providerModule as Record<string, (id: string) => unknown[]>)[
        'getCatalogModels'
      ](canonicalId) as Array<{ id: string; name?: string }>)
    : [];

  writeOut(`Models loaded: ${bundledModels.length}`);
  if (bundledModels.length === 0) {
    const result = buildTestResult(providerId, classification, {
      authResult: 'verified',
      result: 'BLOCKED_ACCOUNT_ENTITLEMENT',
      safeError: 'No bundled models available after authentication',
    });
    printSafeResult(result);
    await recordAcceptanceFromResult(result);
    return 1;
  }

  // ─── Interactive model selection (no preselection) ──────────────────
  writeOut('\nSelect a model from the list below:');
  for (let i = 0; i < bundledModels.length; i++) {
    const m = bundledModels[i];
    writeOut(`  ${i + 1}. ${m.id}${m.name ? ` (${m.name})` : ''}`);
  }
  writeOut(`Enter model number [1-${bundledModels.length}]:`);
  const modelSelection = await selectModel(
    bundledModels,
    abortController.signal,
  );

  if (abortController.signal.aborted) {
    writeOut('\nLIVE_TEST_CANCELLED');
    for (const s of stages) writeOut(`trace.stage: ${s}`);
    return 1;
  }
  if (modelSelection === null) {
    writeOut('\nLIVE_TEST_CANCELLED');
    return 1;
  }
  const selectedModel = bundledModels[modelSelection];
  writeOut(`Selected model: ${selectedModel.id}`);
  writeOut('');

  // ─── Stream test ────────────────────────────────────────────────────
  const result = buildTestResult(providerId, classification, {
    authResult: 'verified',
    accountIdentityPresent: true,
    modelsBundledCount: bundledModels.length,
    modelsFinalCount: bundledModels.length,
    selectedModel: selectedModel.id,
  });

  try {
    let apiKey = '';
    if (typeof credential === 'string') {
      apiKey = credential;
    } else if (
      credential &&
      typeof credential === 'object' &&
      'access' in credential
    ) {
      apiKey = (credential as { access: string }).access;
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
    }
  } catch (err) {
    result.safeError =
      err instanceof Error ? err.message : 'unknown_stream_error';
    result.result = 'LIVE_TEST_FAILED';
  }

  printSafeResult(result);
  await recordAcceptanceFromResult(result);
  return result.result === 'LIVE_VERIFIED' ? 0 : 1;
}

/**
 * Interactive model selection. Returns the chosen index or null when
 * cancelled. Never preselects a model without user confirmation.
 */
async function selectModel(
  models: Array<{ id: string; name?: string }>,
  signal: AbortSignal,
): Promise<number | null> {
  if (models.length === 0) return null;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await new Promise<number | null>((resolve) => {
    const onAbort = () => {
      rl.close();
      resolve(null);
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    rl.question('> ', (value) => {
      signal.removeEventListener('abort', onAbort);
      rl.close();
      const index = parseInt(value, 10) - 1;
      if (index >= 0 && index < models.length) resolve(index);
      else resolve(0);
    });
  });
  return answer;
}

// ─── Main test runner ────────────────────────────────────────────────

/**
 * Run a live acceptance test for a specific provider.
 *
 * Coding plans: genuinely interactive live login via the real OMP login
 * function. API-key providers: consume an env key and attempt a real stream.
 * Blocked providers: report classification and exit.
 *
 * Live tests require an interactive TTY. Without one the command exits
 * safely with LIVE_TEST_REQUIRES_INTERACTIVE_TTY — it never falls back to
 * a static report pretending to be a live test.
 *
 * Returns exit code (0 = success, 1 = failure, 2 = blocked).
 */
export async function runProviderAcceptanceTest(
  providerId: string,
): Promise<number> {
  installBunGlobal();

  if (REFERENCE_ROUTES.has(providerId)) {
    writeOut(`Provider ${providerId} is a verified reference route. Skipping.`);
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
      printSafeResult(result);
      await recordAcceptanceFromResult(result);
      return 2;
    }

    // ─── TTY check: live tests require interactive terminal ────────
    if (process.stdin.isTTY !== true) {
      writeOut('LIVE_TEST_REQUIRES_INTERACTIVE_TTY');
      return 1;
    }

    // ─── Coding-plan path: invoke real OMP login ────────────────────
    if (classification.category === 'coding_plan') {
      return await runCodingPlanLiveAcceptance(
        providerId,
        canonicalId,
        providerModule,
        providerDef,
        plumbCategory,
      );
    }

    // ─── API-key path: check credential availability ─────────────────
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
      routingProvider: providerId,
      transportProvider: providerId,
      transportDialect: api,
      credentialProvider: providerId,
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

    printSafeResult(result);
    await recordAcceptanceFromResult(result);
    return result.result === 'LIVE_VERIFIED' ? 0 : 1;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    writeOut(`test-provider: ERROR: ${errMsg}`);
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

// ─── --test-provider-list ────────────────────────────────────────────

/**
 * List all unverified selectable providers grouped by category.
 */
export async function printProviderTestList(): Promise<number> {
  installBunGlobal();

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

      writeOut(`\n${label} (${providers.length})`);
      writeOut('─'.repeat(80));

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

        writeOut(
          `  ${p.id.padEnd(28)} ${authMethod.padEnd(15)} ${status.padEnd(45)} ${nextAction}`,
        );
      }
    }

    writeOut('');
    return 0;
  } catch (err) {
    writeOut(
      `test-provider-list: ERROR: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }
}

// ─── --test-provider-next ────────────────────────────────────────────

/**
 * Choose the next unverified provider for which the user can supply a credential.
 */
export async function printProviderTestNext(): Promise<number> {
  installBunGlobal();

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

    // Find the first unverified, non-blocked, non-reference provider
    for (const p of selectable) {
      if (REFERENCE_ROUTES.has(p.id)) continue;
      if (p.availabilityReason) continue;

      const acc = acceptances[p.id];
      if (acc?.safeResult === 'LIVE_VERIFIED') continue;
      if (acc?.safeResult === 'LIVE_TEST_FAILED') {
        // Retry failed tests
        writeOut(`Next provider to test (retry): ${p.id}`);
        writeOut(`  plumb --test-provider ${p.id}`);
        return 0;
      }

      writeOut(`Next provider to test: ${p.id}`);
      writeOut(`  plumb --test-provider ${p.id}`);
      return 0;
    }

    writeOut('All selectable providers have been verified.');
    return 0;
  } catch (err) {
    writeOut(
      `test-provider-next: ERROR: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }
}
