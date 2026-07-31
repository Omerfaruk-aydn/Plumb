/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Credential store interface for the PLUMB provider subsystem.
 * The production implementation lives in @google/gemini-cli-core
 * and uses KeychainService (Windows Credential Manager / macOS Keychain / libsecret).
 *
 * This file provides the interface contract and a factory that imports
 * the real implementation from core at runtime.
 */

import type {
  PlumbCredential,
  PlumbCredentialEntry,
  PlumbCredentialSource,
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
  getProviderMetadata(provider: string): Promise<{
    selectedModel?: string;
    smolModel?: string;
    planningModel?: string;
    disabled?: boolean;
    accountLabels: string[];
    credentialRefs: string[];
  } | null>;
  healthCheck(): Promise<{ available: boolean; usingFallback: boolean }>;
}

// ─── Factory ───────────────────────────────────────────────────────────

/**
 * Get the production credential store.
 * Uses OS-protected storage (Windows Credential Manager via @github/keytar,
 * macOS Keychain, Linux libsecret) with encrypted file fallback.
 */
export async function createPlumbCredentialStore(): Promise<IPlumbCredentialStore> {
  // Dynamic import to avoid static circular dependency between provider and core
  const core = await import('@google/gemini-cli-core');
  const store = core.getPlumbCredentialStore();
  return store as unknown as IPlumbCredentialStore;
}

// ─── Singleton ─────────────────────────────────────────────────────────

let defaultStore: IPlumbCredentialStore | undefined;
let storePromise: Promise<IPlumbCredentialStore> | undefined;

export function getPlumbCredentialStore(): IPlumbCredentialStore {
  if (defaultStore) return defaultStore;
  // Synchronous fallback: return a stub that throws if not yet initialized.
  // Callers should use createPlumbCredentialStore() or await initialization.
  throw new Error(
    'PlumbCredentialStore not initialized. Call createPlumbCredentialStore() first.',
  );
}

export async function ensurePlumbCredentialStore(): Promise<IPlumbCredentialStore> {
  if (defaultStore) return defaultStore;
  if (!storePromise) {
    storePromise = createPlumbCredentialStore();
  }
  defaultStore = await storePromise;
  return defaultStore;
}

export function resetPlumbCredentialStore(): void {
  defaultStore = undefined;
  storePromise = undefined;
}
