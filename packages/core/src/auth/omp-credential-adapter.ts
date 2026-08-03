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
  PlumbCredential,
  PlumbOAuthCredential,
  PlumbApiKeyCredential,
} from '@google/gemini-cli-provider';

interface OmpCredentialRecord {
  oauth: PlumbOAuthCredential[];
  apiKeys: PlumbApiKeyCredential[];
  metadata: { accountLabels: string[]; credentialRefs: string[] };
}

export class OmpAuthSchemaKeychainAdapter implements IPlumbCredentialStore {
  #store = new Map<string, OmpCredentialRecord>();

  private ensure(pid: string): OmpCredentialRecord {
    if (!this.#store.has(pid)) {
      this.#store.set(pid, {
        oauth: [],
        apiKeys: [],
        metadata: { accountLabels: [], credentialRefs: [] },
      });
    }
    return this.#store.get(pid)!;
  }

  async getCredentials(pid: string): Promise<PlumbCredentialEntry[]> {
    const rec = this.#store.get(pid);
    if (!rec) return [];
    return [
      ...rec.oauth.map((c) => ({
        provider: pid,
        type: 'oauth' as const,
        source: 'oauth' as const,
        credential: c,
        lastUsed: c.expires,
      })),
      ...rec.apiKeys.map((c) => ({
        provider: pid,
        type: 'api_key' as const,
        source: 'api_key' as const,
        credential: c,
        lastUsed: Date.now(),
      })),
    ];
  }

  async getApiKey(pid: string): Promise<string | undefined> {
    return this.#store.get(pid)?.apiKeys[0]?.key;
  }

  async hasCredentials(pid: string): Promise<boolean> {
    return this.#store.has(pid);
  }

  async listAuthenticatedProviders(): Promise<string[]> {
    return [...this.#store.keys()];
  }

  async storeCredential(pid: string, cred: PlumbCredential): Promise<void> {
    if (cred.type === 'oauth') {
      this.ensure(pid).oauth.push(cred);
    } else {
      this.ensure(pid).apiKeys.push(cred);
    }
  }

  async storeOAuthCredential(
    pid: string,
    cred: PlumbOAuthCredential,
  ): Promise<void> {
    this.ensure(pid).oauth.push(cred);
  }

  async storeApiKeyCredential(
    pid: string,
    cred: PlumbApiKeyCredential,
  ): Promise<void> {
    this.ensure(pid).apiKeys.push(cred);
  }

  async removeCredentials(pid: string): Promise<void> {
    this.#store.delete(pid);
  }

  async removeCredential(
    pid: string,
    credentialType: 'oauth' | 'api_key',
  ): Promise<boolean> {
    const rec = this.#store.get(pid);
    if (!rec) return false;
    if (credentialType === 'oauth') rec.oauth = [];
    if (credentialType === 'api_key') rec.apiKeys = [];
    if (rec.oauth.length === 0 && rec.apiKeys.length === 0) {
      this.#store.delete(pid);
    }
    return true;
  }

  async clearAll(): Promise<void> {
    this.#store.clear();
  }

  async setProviderMetadata(
    pid: string,
    _updates: Partial<{
      selectedModel: string;
      smolModel: string;
      planningModel: string;
      disabled: boolean;
    }>,
  ): Promise<void> {
    const rec = this.ensure(pid);
    rec.metadata.accountLabels = [];
    rec.metadata.credentialRefs = [];
  }

  async getProviderMetadata(pid: string): Promise<{
    accountLabels: string[];
    credentialRefs: string[];
  } | null> {
    const rec = this.#store.get(pid);
    if (!rec) return null;
    return { ...rec.metadata };
  }

  async healthCheck(): Promise<{
    available: boolean;
    usingFallback: boolean;
  }> {
    return { available: true, usingFallback: false };
  }

  getPhysicalBackend(): 'OS_KEYCHAIN' | 'SQLITE' {
    return 'OS_KEYCHAIN';
  }
}
