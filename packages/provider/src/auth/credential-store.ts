/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Credential store interface for the PLUMB provider subsystem.
 * The production implementation uses OS-protected storage
 * (Windows Credential Manager via @github/keytar).
 * This file is the PURE INTERFACE with no runtime dependencies.
 */

import type {
  PlumbCredential,
  PlumbCredentialEntry,
  PlumbOAuthCredential,
  PlumbApiKeyCredential,
} from '../types.js';

// ─── Interface ─────────────────────────────────────────────────────────

export interface IPlumbCredentialStore {
  getCredentials(provider: string): Promise<PlumbCredentialEntry[]>;
  getApiKey(provider: string): Promise<string | undefined>;
  hasCredentials(provider: string): Promise<boolean>;
  listAuthenticatedProviders(): Promise<string[]>;
  storeCredential(provider: string, credential: PlumbCredential): Promise<void>;
  storeOAuthCredential(
    provider: string,
    cred: PlumbOAuthCredential,
  ): Promise<void>;
  storeApiKeyCredential(
    provider: string,
    cred: PlumbApiKeyCredential,
  ): Promise<void>;
  removeCredentials(provider: string): Promise<void>;
  removeCredential(
    provider: string,
    credentialType: 'oauth' | 'api_key',
  ): Promise<boolean>;
  clearAll(): Promise<void>;
  setProviderMetadata(
    provider: string,
    updates: Partial<{
      selectedModel: string;
      smolModel: string;
      planningModel: string;
      disabled: boolean;
    }>,
  ): Promise<void>;
  getProviderMetadata(
    provider: string,
  ): Promise<{
    selectedModel?: string;
    smolModel?: string;
    planningModel?: string;
    disabled?: boolean;
    accountLabels: string[];
    credentialRefs: string[];
  } | null>;
  healthCheck(): Promise<{ available: boolean; usingFallback: boolean }>;
}

// ─── Singleton registry ────────────────────────────────────────────────

/**
 * Registered credential store factory.
 * Set by the core package during PlumbProviderRegistry initialization.
 */
let storeFactory: (() => Promise<unknown>) | null = null;
let defaultStore: IPlumbCredentialStore | null = null;

export function registerPlumbCredentialStoreFactory(
  factory: () => Promise<unknown>,
): void {
  storeFactory = factory;
}

export async function ensurePlumbCredentialStore(): Promise<IPlumbCredentialStore> {
  if (defaultStore) return defaultStore;
  if (!storeFactory) {
    throw new Error(
      'PlumbCredentialStore not configured. Call registerPlumbCredentialStoreFactory() first.',
    );
  }
  defaultStore = (await storeFactory()) as IPlumbCredentialStore;
  return defaultStore;
}

export function getPlumbCredentialStore(): IPlumbCredentialStore {
  if (!defaultStore) {
    throw new Error(
      'PlumbCredentialStore not initialized. Call ensurePlumbCredentialStore() first.',
    );
  }
  return defaultStore;
}

export function resetPlumbCredentialStore(): void {
  defaultStore = null;
  storeFactory = null;
}
