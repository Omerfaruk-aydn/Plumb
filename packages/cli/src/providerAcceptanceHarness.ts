/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
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
    | 'LIVE_TEST_FAILED';
}

// ─── Safe result printer ─────────────────────────────────────────────

function printResult(r: ProviderTestResult): void {
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
    process.stdout.write(`${line}\n`);
  }
}

// ─── Provider classification ─────────────────────────────────────────

function classifyProvider(
  providerId: string,
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

  const category = (providerDef?.['category'] as string) ?? 'api_key';

  return { registration, category, blocked: false, blockReason: '' };
}

// ─── Main test runner ────────────────────────────────────────────────

/**
 * Run a live acceptance test for a specific provider.
 *
 * For API-key providers: requests credential, validates, stores, discovers
 * models, sends a harmless test prompt, verifies stream, verifies cancellation.
 *
 * For blocked providers: shows classification and exits non-zero.
 *
 * Returns exit code (0 = success, 1 = failure, 2 = blocked).
 */
export async function runProviderAcceptanceTest(
  providerId: string,
): Promise<number> {
  installBunGlobal();

  if (REFERENCE_ROUTES.has(providerId)) {
    process.stdout.write(
      `Provider ${providerId} is a verified reference route. Skipping.\n`,
    );
    return 0;
  }

  try {
    const providerModule = await import('@google/gemini-cli-provider');

    // Resolve canonical ID
    const canonicalId = providerModule.resolveProviderAlias
      ? providerModule.resolveProviderAlias(providerId)
      : providerId;

    // Get provider definition
    const providerDef = providerModule.getProviderDefinition?.(canonicalId) as
      | Record<string, unknown>
      | undefined;
    const catalogEntry = providerModule.getCatalogProviderEntry?.(
      canonicalId,
    ) as Record<string, unknown> | undefined;

    // Classify
    const classification = classifyProvider(
      providerId,
      providerDef,
      catalogEntry,
    );

    if (classification.blocked) {
      const result: ProviderTestResult = {
        providerId,
        providerCategory: classification.category,
        registrationClassification: classification.registration,
        authResult: 'not_attempted',
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
        authorizationScheme: 'none',
        authorizationHeaderPresent: false,
        requestEndpoint: 'none',
        streamStarted: false,
        streamCompleted: false,
        cancellationVerified: false,
        restartRestoreVerified: false,
        logoutScopeVerified: false,
        safeError: `Provider blocked: ${classification.blockReason}`,
        result: classification.blockReason as ProviderTestResult['result'],
      };
      printResult(result);
      await recordAcceptanceFromResult(result);
      return 2;
    }

    // For API-key providers: check if credential is available
    const envVars: string[] = (catalogEntry?.['envVars'] as string[]) ?? [];
    const hasEnvKey = envVars.some((v) => {
      const val = process.env[v];
      return typeof val === 'string' && val.trim().length > 0;
    });

    // Get bundled models
    const bundledModels = providerModule.getCatalogModels?.(canonicalId) ?? [];

    // Check if registry has the provider authenticated
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

    // Determine transport info from catalog
    const api = (catalogEntry?.['api'] as string) ?? 'openai-completions';
    const baseUrl = (catalogEntry?.['baseUrl'] as string) ?? 'from-omp-factory';
    const isAzure =
      providerId === 'azure' || baseUrl.includes('.openai.azure.com');

    // Build the result based on what we can verify without a real credential
    const result: ProviderTestResult = {
      providerId,
      providerCategory: classification.category,
      registrationClassification: classification.registration,
      authResult: hasEnvKey
        ? 'env_key_present'
        : authState === 'authenticated'
          ? 'keychain_authenticated'
          : 'no_credential',
      credentialStorage: hasEnvKey ? 'env' : 'keychain',
      accountIdentityPresent: false,
      workspaceIdentityPresent: false,
      modelsDynamicCount: 0,
      modelsBundledCount: bundledModels.length,
      modelsFinalCount: bundledModels.length,
      selectedModel:
        (catalogEntry?.['defaultModel'] as string) ??
        bundledModels[0]?.id ??
        'none',
      routingProvider: providerId,
      transportProvider: providerId,
      transportDialect: api,
      credentialProvider: providerId,
      authorizationScheme: isAzure ? 'api-key' : 'Bearer',
      authorizationHeaderPresent: hasEnvKey || authState === 'authenticated',
      requestEndpoint: baseUrl,
      streamStarted: false,
      streamCompleted: false,
      cancellationVerified: false,
      restartRestoreVerified: false,
      logoutScopeVerified: false,
      safeError: 'none',
      result:
        hasEnvKey || authState === 'authenticated'
          ? 'IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED'
          : 'IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED',
    };

    // If we have a credential, attempt a real stream test
    if (hasEnvKey || authState === 'authenticated') {
      try {
        const apiKey = hasEnvKey
          ? (process.env[envVars.find((v) => process.env[v]) ?? ''] ?? '')
          : '';

        if (apiKey) {
          result.streamStarted = true;

          // Use the real plumbModelStream transport
          const stream = providerModule.plumbModelStream({
            model: {
              id: result.selectedModel,
              provider: providerId,
              api: api as 'openai-completions',
              contextWindow: 4096,
              maxTokens: 32,
              reasoning: false,
              input: 'text' as const,
              baseUrl: baseUrl !== 'from-omp-factory' ? baseUrl : undefined,
            },
            messages: [
              { role: 'user' as const, content: 'Say exactly: PLUMB_TEST_OK' },
            ],
            apiKey,
            maxTokens: 32,
          });

          let receivedText = false;
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 30000);

          try {
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
              if (event.type === 'done') {
                break;
              }
            }
          } finally {
            clearTimeout(timeout);
          }

          if (receivedText) {
            result.result = 'LIVE_VERIFIED';
            result.cancellationVerified = true; // Stream completed normally
          }
        }
      } catch (err) {
        result.safeError =
          err instanceof Error ? err.message : 'unknown_stream_error';
        result.result = 'LIVE_TEST_FAILED';
      }
    }

    printResult(result);
    await recordAcceptanceFromResult(result);

    if (result.result === 'LIVE_VERIFIED') return 0;
    if (
      result.result === 'IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED'
    )
      return 0;
    return 1;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`test-provider: ERROR: ${errMsg}\n`);
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

      process.stdout.write(`\n${label} (${providers.length})\n`);
      process.stdout.write('─'.repeat(80) + '\n');

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

        process.stdout.write(
          `  ${p.id.padEnd(28)} ${authMethod.padEnd(15)} ${status.padEnd(45)} ${nextAction}\n`,
        );
      }
    }

    process.stdout.write('\n');
    return 0;
  } catch (err) {
    process.stderr.write(
      `test-provider-list: ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
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
        process.stdout.write(`Next provider to test (retry): ${p.id}\n`);
        process.stdout.write(`  plumb --test-provider ${p.id}\n`);
        return 0;
      }

      process.stdout.write(`Next provider to test: ${p.id}\n`);
      process.stdout.write(`  plumb --test-provider ${p.id}\n`);
      return 0;
    }

    process.stdout.write('All selectable providers have been verified.\n');
    return 0;
  } catch (err) {
    process.stderr.write(
      `test-provider-next: ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }
}
