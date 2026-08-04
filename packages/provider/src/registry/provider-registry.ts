/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * PlumbProviderRegistry — single authority for provider state and auth.
 * Uses OS-protected credential storage via KeychainService.
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

// ─── Auth state ────────────────────────────────────────────────────────

export type PlumbProviderAuthState =
  | 'unauthenticated'
  | 'authenticating'
  | 'authenticated'
  | 'expired'
  | 'error';

export interface PlumbProviderState {
  provider: PlumbProvider;
  authState: PlumbProviderAuthState;
  credentials: PlumbOAuthCredential | PlumbApiKeyCredential | null;
  error?: string;
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
        credentials: usable?.credential ?? null,
      });
    }

    for (const provider of SELECTABLE_PROVIDERS) {
      if (
        provider.allowUnauthenticated &&
        !this.#activeProviders.has(provider.id)
      ) {
        this.#activeProviders.set(provider.id, {
          provider,
          authState: 'authenticated',
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
    return SELECTABLE_PROVIDERS;
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
    // with the new credential.
    invalidateModelCache(providerId);

    this.#activeProviders.set(providerId, {
      provider,
      authState: 'authenticated',
      credentials: credential,
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
      credentials: existing?.credentials ?? null,
      error,
    });
  }

  async logout(providerId: PlumbProviderId): Promise<void> {
    await this.#ensureStore().removeCredentials(providerId);
    invalidateModelCache(providerId);
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
