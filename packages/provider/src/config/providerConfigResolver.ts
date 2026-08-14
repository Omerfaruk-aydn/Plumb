/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
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
