/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type PlumbProvider,
  type PlumbProviderId,
  type PlumbApiKeyCredential,
  type PlumbOAuthCredential,
} from '../types.js';
import {
  SELECTABLE_PROVIDERS,
  getPlumbProvider,
  getProviderSetupGroups,
} from '../catalog/providers.js';
import {
  type IPlumbCredentialStore,
  ensurePlumbCredentialStore,
} from '../auth/credential-store.js';
import { invalidateModelCache } from './model-cache.js';
import { listCustomPlumbProviders } from '../config/customProviderDefinitions.js';

// ─── Auth state ────────────────────────────────────────────────────────

export type PlumbProviderAuthState =
  | 'unauthenticated'
  | 'authenticating'
  | 'authenticated'
  | 'expired'
  | 'error';

export type PlumbProviderHealthState =
  | 'unknown'
  | 'checking'
  | 'online'
  | 'offline'
  | 'error';

export interface PlumbProviderState {
  provider: PlumbProvider;
  authState: PlumbProviderAuthState;
  /** Omitted only by legacy/test callers; production registry states set it. */
  healthState?: PlumbProviderHealthState;
  credentials: PlumbOAuthCredential | PlumbApiKeyCredential | null;
  error?: string;
  healthErrorCode?: string;
}

// ─── Provider registry ────────────────────────────────────────────────

export class PlumbProviderRegistry {
  #credentialStore: IPlumbCredentialStore | null = null;
  readonly #activeProviders = new Map<PlumbProviderId, PlumbProviderState>();
  #selectedProvider: PlumbProviderId | null = null;
  #initialized = false;

  // ── Initialization ────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this.#initialized) return;
    this.#credentialStore = await ensurePlumbCredentialStore();

    const authenticated =
      await this.#credentialStore.listAuthenticatedProviders();

    for (const providerId of authenticated) {
      const provider = getPlumbProvider(providerId);
      if (!provider) continue;

      const creds = await this.#credentialStore.getCredentials(providerId);
      const usable = creds.find(
        (c) =>
          (c.credential.type === 'oauth' &&
            c.credential.expires > Date.now()) ||
          (c.credential.type === 'api_key' && c.credential.key),
      );

      this.#activeProviders.set(providerId, {
        provider,
        authState: usable ? 'authenticated' : 'expired',
        healthState: 'unknown',
        credentials: usable?.credential ?? null,
      });
    }

    for (const provider of [
      ...SELECTABLE_PROVIDERS,
      ...listCustomPlumbProviders(),
    ]) {
      if (
        provider.allowUnauthenticated &&
        !this.#activeProviders.has(provider.id)
      ) {
        this.#activeProviders.set(provider.id, {
          provider,
          authState: 'authenticated',
          healthState: 'unknown',
          credentials: null,
        });
      }
    }

    this.#initialized = true;
  }

  #ensureStore(): IPlumbCredentialStore {
    if (!this.#credentialStore) {
      throw new Error('Registry not initialized. Call initialize() first.');
    }
    return this.#credentialStore;
  }

  // ── Provider access ───────────────────────────────────────────────

  getAllProviders(): readonly PlumbProvider[] {
    return [...SELECTABLE_PROVIDERS, ...listCustomPlumbProviders()];
  }

  getProviderSetupGroups(): Map<string, PlumbProvider[]> {
    return getProviderSetupGroups();
  }

  getProviderState(
    providerId: PlumbProviderId,
  ): PlumbProviderState | undefined {
    return this.#activeProviders.get(providerId);
  }

  getActiveProviderStates(): PlumbProviderState[] {
    return [...this.#activeProviders.values()].filter(
      (s) => s.authState === 'authenticated',
    );
  }

  hasUsableProvider(): boolean {
    return this.getActiveProviderStates().length > 0;
  }

  isProviderAuthenticated(providerId: PlumbProviderId): boolean {
    const state = this.#activeProviders.get(providerId);
    return state?.authState === 'authenticated';
  }

  // ── Provider selection ────────────────────────────────────────────

  getSelectedProvider(): PlumbProviderId | null {
    return this.#selectedProvider;
  }

  selectProvider(providerId: PlumbProviderId): void {
    if (!getPlumbProvider(providerId)) {
      throw new Error(`Unknown provider: ${providerId}`);
    }
    this.#selectedProvider = providerId;
  }

  // ── Auth operations ───────────────────────────────────────────────

  setAuthenticating(providerId: PlumbProviderId): void {
    const provider = getPlumbProvider(providerId);
    if (!provider) return;
    this.#activeProviders.set(providerId, {
      provider,
      authState: 'authenticating',
      healthState: 'unknown',
      credentials: null,
    });
  }

  async setAuthenticated(
    providerId: PlumbProviderId,
    credential: PlumbOAuthCredential | PlumbApiKeyCredential,
  ): Promise<void> {
    const provider = getPlumbProvider(providerId);
    if (!provider) return;

    await this.#ensureStore().storeCredential(providerId, credential);

    // Invalidate model cache when credentials change so discovery re-fetches
    // with the new credential. This covers re-authentication (e.g. a
    // different account signing in) WITHOUT an explicit prior logout() call
    // — the same cross-account stale-entitlement risk applies here: without
    // both invalidations, a currently-running process could keep serving
    // the previous account's discovered models after switching accounts.
    invalidateModelCache(providerId);
    try {
      const { getPlumbModelRegistry } = await import('./model-registry.js');
      getPlumbModelRegistry().invalidateCache(providerId);
    } catch {
      // Non-fatal: the on-disk cache is already invalidated above.
    }

    this.#activeProviders.set(providerId, {
      provider,
      authState: 'authenticated',
      healthState: 'unknown',
      credentials: credential,
    });

    if (!this.#selectedProvider) {
      this.#selectedProvider = providerId;
    }
  }

  /**
   * Marks a provider active without storing a PLUMB-side credential. For
   * synthetic providers whose auth is entirely owned by an external process
   * (claude-subscription's official Agent SDK CLI, authenticated via
   * `claude setup-token` — PLUMB never receives or stores a token for it),
   * the normal setAuthenticated() path never runs because there is no
   * credential to persist. Without this, such a provider is confirmed
   * connected (e.g. getClaudeSubscriptionStatus() === CONNECTED_SUBSCRIPTION)
   * during first-time setup, a model gets picked, but the provider never
   * enters #activeProviders — so every later /model open (which filters via
   * getActiveProviderStates()) silently omits it, even in the same running
   * session. Call this once external auth is confirmed live.
   */
  markProviderActiveWithoutCredential(providerId: PlumbProviderId): void {
    const provider = getPlumbProvider(providerId);
    if (!provider) return;
    this.#activeProviders.set(providerId, {
      provider,
      authState: 'authenticated',
      healthState: 'unknown',
      credentials: null,
    });
    if (!this.#selectedProvider) {
      this.#selectedProvider = providerId;
    }
  }

  setAuthError(providerId: PlumbProviderId, error: string): void {
    const existing = this.#activeProviders.get(providerId);
    this.#activeProviders.set(providerId, {
      provider: existing?.provider ?? getPlumbProvider(providerId)!,
      authState: 'error',
      healthState: existing?.healthState ?? 'unknown',
      credentials: existing?.credentials ?? null,
      error,
    });
  }

  setProviderHealth(
    providerId: PlumbProviderId,
    healthState: PlumbProviderHealthState,
    healthErrorCode?: string,
  ): void {
    const existing = this.#activeProviders.get(providerId);
    const provider = existing?.provider ?? getPlumbProvider(providerId);
    if (!provider) return;
    this.#activeProviders.set(providerId, {
      provider,
      authState:
        existing?.authState ??
        (provider.allowUnauthenticated ? 'authenticated' : 'unauthenticated'),
      healthState,
      credentials: existing?.credentials ?? null,
      ...(existing?.error ? { error: existing.error } : undefined),
      ...(healthErrorCode ? { healthErrorCode } : undefined),
    });
  }

  async logout(providerId: PlumbProviderId): Promise<void> {
    await this.#ensureStore().removeCredentials(providerId);
    invalidateModelCache(providerId);
    // Also clear the model registry's in-memory discovered-model cache for
    // this provider — invalidateModelCache above only clears the on-disk
    // cache (registry/model-cache.ts). Without this, a currently-running
    // process that logs out and back in as a DIFFERENT account on the same
    // provider keeps serving the previous account's discovered models
    // (PlumbModelRegistry.#discoveredModels) until restart — a real
    // cross-account stale-entitlement leak, not just a cosmetic staleness
    // issue. Dynamic import avoids a static circular dependency
    // (model-registry.ts already imports this module for
    // getPlumbProviderRegistry()).
    try {
      const { getPlumbModelRegistry } = await import('./model-registry.js');
      getPlumbModelRegistry().invalidateCache(providerId);
    } catch {
      // Non-fatal: the on-disk cache is already invalidated above, and a
      // fresh process will not see stale in-memory state regardless.
    }
    this.#activeProviders.delete(providerId);
    if (this.#selectedProvider === providerId) {
      this.#selectedProvider = null;
    }
  }

  async getApiKey(providerId: PlumbProviderId): Promise<string | undefined> {
    return this.#ensureStore().getApiKey(providerId);
  }

  async ensureValidCredentials(providerId: PlumbProviderId): Promise<boolean> {
    const state = this.#activeProviders.get(providerId);
    if (!state) return false;

    if (state.authState === 'authenticated') {
      if (
        state.credentials?.type === 'oauth' &&
        state.credentials.expires <= Date.now() + 60_000
      ) {
        state.authState = 'expired';
        return false;
      }
      return true;
    }
    return false;
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────

let defaultRegistry: PlumbProviderRegistry | undefined;

export function getPlumbProviderRegistry(): PlumbProviderRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new PlumbProviderRegistry();
  }
  return defaultRegistry;
}

/**
 * Report whether the process-level registry singleton has been constructed.
 * Used by `plumb --diagnose-provider-runtime` to distinguish a live legacy
 * registry instance from a module that is merely present in the dist tree.
 */
export function isPlumbProviderRegistryInstantiated(): boolean {
  return defaultRegistry !== undefined;
}

export function resetPlumbProviderRegistry(): void {
  defaultRegistry = undefined;
}
