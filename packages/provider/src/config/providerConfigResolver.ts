/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Dependency-inversion seam for resolving a provider's safe (non-secret)
 * cloud configuration -- region, profile, project/space/compartment,
 * deployment map, auth mode, etc. `packages/provider` cannot import
 * `packages/core` (same constraint documented on `PlumbToolExecutor` in
 * types.ts), so `packages/core` -- which owns `PlumbSecureCredentialStore`,
 * the canonical place PLUMB's in-app configuration UX persists this data --
 * injects a real resolver here at startup via `setProviderConfigResolver`.
 *
 * Callers throughout `packages/provider` (catalog/model-catalog.ts's
 * per-provider ambient-config resolution) must use `resolveProviderConfigValue`
 * instead of reading `process.env` directly for any field a user can now
 * configure through PLUMB's in-app setup UX, so PLUMB-saved configuration
 * takes precedence over environment variables while environment-only setups
 * keep working unchanged (see `resolveProviderConfigValue`'s doc comment for
 * the exact precedence).
 *
 * SYNCHRONOUS BY DESIGN: model-catalog.ts's `getCatalogModels`/
 * `getCatalogModel` are called synchronously from many existing call sites
 * across the codebase; making that chain asynchronous would be a much
 * larger, riskier refactor than this feature requires. `packages/core`'s
 * real resolver (see core/src/config/providerCloudConfigCache.ts) is
 * therefore backed by an in-memory cache populated once at startup (and
 * refreshed synchronously on every configuration save), not a live
 * per-call disk/keychain read.
 */

export type ProviderSafeConfig = Readonly<Record<string, string>>;
export type ProviderConfigResolver = (providerId: string) => ProviderSafeConfig;

let resolver: ProviderConfigResolver | undefined;

/**
 * Installs the real resolver. Passing `undefined` reverts to the default
 * (always returns `{}`, so every lookup falls through to the existing
 * environment-variable/default behavior) -- test-only, and the safe
 * behavior before `packages/core` has wired anything up.
 */
export function setProviderConfigResolver(
  fn: ProviderConfigResolver | undefined,
): void {
  resolver = fn;
}

/** The full safe-config object for a provider, or `{}` if none is configured/wired. */
export function resolveProviderSafeConfig(
  providerId: string,
): ProviderSafeConfig {
  if (!resolver) return {};
  try {
    return resolver(providerId);
  } catch {
    // A resolver failure must never break model catalog resolution --
    // fall through to environment/default the same as "not configured".
    return {};
  }
}

/**
 * Resolves a single ambient-config value with PLUMB's documented
 * precedence: explicit PLUMB-saved configuration (set via the in-app setup
 * UX) beats the environment variable, which beats `fallback`. This never
 * changes behavior for a user who has only ever used environment variables
 * (PLUMB-saved config is empty, so it falls straight through to the same
 * env-var read that already existed) -- it only takes effect once a user
 * has actually configured the field through PLUMB's UI.
 */
export function resolveProviderConfigValue(
  providerId: string,
  configKey: string,
  envVar: string,
  fallback?: string,
): string | undefined {
  const safeConfig = resolveProviderSafeConfig(providerId);
  const fromConfig = safeConfig[configKey]?.trim();
  if (fromConfig) return fromConfig;
  const fromEnv = process.env[envVar]?.trim();
  if (fromEnv) return fromEnv;
  return fallback;
}
