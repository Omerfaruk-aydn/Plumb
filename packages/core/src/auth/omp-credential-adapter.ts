/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

import type {
  IPlumbCredentialStore,
  PlumbCredentialEntry,
  PlumbOAuthCredential,
  PlumbApiKeyCredential,
  PlumbProviderId,
} from '@google/gemini-cli-provider';

interface OmpCredentialRecord {
  oauth: PlumbOAuthCredential[];
  apiKeys: PlumbApiKeyCredential[];
  metadata: Record<string, string>;
}

export class OmpAuthSchemaKeychainAdapter implements IPlumbCredentialStore {
  #store = new Map<string, OmpCredentialRecord>();

  private ensure(pid: string): OmpCredentialRecord {
    if (!this.#store.has(pid)) {
      this.#store.set(pid, { oauth: [], apiKeys: [], metadata: {} });
    }
    return this.#store.get(pid)!;
  }

  async getCredentials(pid: PlumbProviderId): Promise<PlumbCredentialEntry[]> {
    const rec = this.#store.get(pid);
    if (!rec) return [];
    return [
      ...rec.oauth.map((c) => ({
        type: 'oauth' as const,
        credential: c,
        lastUsed: c.expires,
      })),
      ...rec.apiKeys.map((c) => ({
        type: 'api_key' as const,
        credential: c,
        lastUsed: Date.now(),
      })),
    ];
  }

  async getApiKey(pid: PlumbProviderId): Promise<string | undefined> {
    return this.#store.get(pid)?.apiKeys[0]?.key;
  }

  async hasCredentials(pid: PlumbProviderId): Promise<boolean> {
    return this.#store.has(pid);
  }

  async listAuthenticatedProviders(): Promise<PlumbProviderId[]> {
    return [...this.#store.keys()] as PlumbProviderId[];
  }

  async storeCredential(
    pid: PlumbProviderId,
    cred: PlumbOAuthCredential | PlumbApiKeyCredential,
  ): Promise<void> {
    if (cred.type === 'oauth') {
      this.ensure(pid).oauth.push(cred);
    } else {
      this.ensure(pid).apiKeys.push(cred);
    }
  }

  async storeOAuthCredential(
    pid: PlumbProviderId,
    credential: PlumbOAuthCredential,
  ): Promise<void> {
    this.ensure(pid).oauth.push(credential);
  }

  async storeApiKeyCredential(
    pid: PlumbProviderId,
    credential: PlumbApiKeyCredential,
  ): Promise<void> {
    this.ensure(pid).apiKeys.push(credential);
  }

  async removeCredentials(pid: PlumbProviderId): Promise<void> {
    this.#store.delete(pid);
  }

  async removeCredential(pid: PlumbProviderId, type: string): Promise<void> {
    const rec = this.#store.get(pid);
    if (!rec) return;
    if (type === 'oauth') rec.oauth = [];
    if (type === 'api_key') rec.apiKeys = [];
    if (rec.oauth.length === 0 && rec.apiKeys.length === 0) {
      this.#store.delete(pid);
    }
  }

  async clearAll(): Promise<void> {
    this.#store.clear();
  }

  async setProviderMetadata(
    pid: PlumbProviderId,
    meta: Record<string, string>,
  ): Promise<void> {
    this.ensure(pid).metadata = { ...meta };
  }

  async getProviderMetadata(
    pid: PlumbProviderId,
  ): Promise<Record<string, string>> {
    return { ...this.#store.get(pid)?.metadata };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  /** Physical backend classification. */
  getPhysicalBackend(): 'OS_KEYCHAIN' | 'SQLITE' {
    return 'OS_KEYCHAIN';
  }

  /** Test-only snapshot access. */
  getStoreForTest(): Map<string, OmpCredentialRecord> {
    return this.#store;
  }
}
