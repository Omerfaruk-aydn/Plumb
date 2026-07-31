/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * OMP-derived provider registry for PLUMB.
 * Manages the active provider set, auth state, and provider lifecycle.
 * Upstream source: D:\Kesit-next\packages\ai\src\registry\registry.ts
 * Upstream license: MIT (c) 2025 Mario Zechner, (c) 2025-2026 Can Bölük
 */

import {
  type PlumbProvider,
  type PlumbProviderId,
  type PlumbModel,
  type PlumbApiKeyCredential,
  type PlumbOAuthCredential,
} from '../types.js';
import {
  SELECTABLE_PROVIDERS,
  getPlumbProvider,
  getProvidersByCategory,
  getProviderSetupGroups,
} from '../catalog/providers.js';
import {
  getPlumbCredentialStore,
  type PlumbCredentialStore,
} from '../auth/credential-store.js';

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
  readonly #credentialStore: PlumbCredentialStore;
  readonly #activeProviders = new Map<PlumbProviderId, PlumbProviderState>();
  #selectedProvider: PlumbProviderId | null = null;
  #initialized = false;

  constructor(credentialStore?: PlumbCredentialStore) {
    this.#credentialStore = credentialStore ?? getPlumbCredentialStore();
  }

  // ── Initialization ────────────────────────────────────────────────

  /** Initialize the registry: load stored credentials and resolve provider states. */
  async initialize(): Promise<void> {
    if (this.#initialized) return;

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

    // Mark available local/keyless providers
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

  // ── Provider access ───────────────────────────────────────────────

  /** Get all available providers (from catalog). */
  getAllProviders(): readonly PlumbProvider[] {
    return SELECTABLE_PROVIDERS;
  }

  /** Get providers grouped by category for setup UI. */
  getProviderSetupGroups(): Map<string, PlumbProvider[]> {
    return getProviderSetupGroups();
  }

  /** Get providers in a specific category. */
  getProvidersByCategory(category: string): PlumbProvider[] {
    return SELECTABLE_PROVIDERS.filter((p) => p.category === category);
  }

  /** Get the state of a specific provider. */
  getProviderState(
    providerId: PlumbProviderId,
  ): PlumbProviderState | undefined {
    return this.#activeProviders.get(providerId);
  }

  /** Get all active (authenticated or local) provider states. */
  getActiveProviderStates(): PlumbProviderState[] {
    return [...this.#activeProviders.values()].filter(
      (s) => s.authState === 'authenticated',
    );
  }

  /** Check if any provider is authenticated and usable. */
  hasUsableProvider(): boolean {
    return this.getActiveProviderStates().length > 0;
  }

  /** Check if a specific provider is authenticated. */
  isProviderAuthenticated(providerId: PlumbProviderId): boolean {
    const state = this.#activeProviders.get(providerId);
    return state?.authState === 'authenticated';
  }

  // ── Provider selection ────────────────────────────────────────────

  /** Get the currently selected/default provider. */
  getSelectedProvider(): PlumbProviderId | null {
    return this.#selectedProvider;
  }

  /** Set the active provider. */
  selectProvider(providerId: PlumbProviderId): void {
    if (!getPlumbProvider(providerId)) {
      throw new Error(`Unknown provider: ${providerId}`);
    }
    this.#selectedProvider = providerId;
  }

  // ── Auth operations ───────────────────────────────────────────────

  /** Mark a provider as authenticating. */
  setAuthenticating(providerId: PlumbProviderId): void {
    const provider = getPlumbProvider(providerId);
    if (!provider) return;
    this.#activeProviders.set(providerId, {
      provider,
      authState: 'authenticating',
      credentials: null,
    });
  }

  /** Mark a provider as authenticated with credentials. */
  async setAuthenticated(
    providerId: PlumbProviderId,
    credential: PlumbOAuthCredential | PlumbApiKeyCredential,
  ): Promise<void> {
    const provider = getPlumbProvider(providerId);
    if (!provider) return;

    await this.#credentialStore.storeCredential(providerId, credential);

    this.#activeProviders.set(providerId, {
      provider,
      authState: 'authenticated',
      credentials: credential,
    });

    // Auto-select if no provider is selected
    if (!this.#selectedProvider) {
      this.#selectedProvider = providerId;
    }
  }

  /** Mark a provider as having an auth error. */
  setAuthError(providerId: PlumbProviderId, error: string): void {
    const existing = this.#activeProviders.get(providerId);
    this.#activeProviders.set(providerId, {
      provider: existing?.provider ?? getPlumbProvider(providerId)!,
      authState: 'error',
      credentials: existing?.credentials ?? null,
      error,
    });
  }

  /** Log out (remove credentials) for a provider. */
  async logout(providerId: PlumbProviderId): Promise<void> {
    await this.#credentialStore.removeCredentials(providerId);
    this.#activeProviders.delete(providerId);
    if (this.#selectedProvider === providerId) {
      this.#selectedProvider = null;
    }
  }

  /** Get API key for a provider. Resolves stored creds > env vars. */
  async getApiKey(providerId: PlumbProviderId): Promise<string | undefined> {
    return this.#credentialStore.getApiKey(providerId);
  }

  /** Check and refresh OAuth credentials if needed. */
  async ensureValidCredentials(providerId: PlumbProviderId): Promise<boolean> {
    const state = this.#activeProviders.get(providerId);
    if (!state) return false;

    if (state.authState === 'authenticated') {
      // Check OAuth expiry
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

export function resetPlumbProviderRegistry(): void {
  defaultRegistry = undefined;
}
