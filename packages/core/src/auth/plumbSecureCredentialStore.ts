/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { homedir } from '../utils/paths.js';
import { KeychainService } from '../services/keychainService.js';
import { randomUUID } from 'node:crypto';
import type {
  IPlumbCredentialStore,
  PlumbCredential,
  PlumbCredentialEntry,
  PlumbCredentialSource,
  PlumbOAuthCredential,
  PlumbApiKeyCredential,
} from '@google/gemini-cli-provider';

export type {
  PlumbOAuthCredential,
  PlumbApiKeyCredential,
  PlumbCredential,
  PlumbCredentialSource,
  PlumbCredentialEntry,
};

// ─── Constants ────────────────────────────────────────────────────────

const PLUMB_DIR = '.plumb';
const METADATA_FILE = 'providers.json';
const KEYCHAIN_SERVICE_NAME = 'plumb-provider-credentials';
const OAUTH_REFRESH_SKEW_MS = 60_000;

interface NonSecretMetadata {
  version: 3;
  providers: Record<
    string,
    {
      selectedModel?: string;
      smolModel?: string;
      planningModel?: string;
      disabled?: boolean;
      accountLabels: string[];
      credentialRefs: string[];
    }
  >;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function getPlumbDir(): string {
  return path.join(homedir(), PLUMB_DIR);
}

function getMetadataPath(): string {
  return path.join(getPlumbDir(), METADATA_FILE);
}

async function ensurePlumbDir(): Promise<void> {
  await fs.mkdir(getPlumbDir(), { recursive: true });
}

// ─── PlumbSecureCredentialStore ────────────────────────────────────────

export class PlumbSecureCredentialStore implements IPlumbCredentialStore {
  readonly #keychain: KeychainService;
  #metadata: NonSecretMetadata = { version: 3, providers: {} };
  #loaded = false;
  #metadataDirty = false;

  constructor() {
    this.#keychain = new KeychainService(KEYCHAIN_SERVICE_NAME);
  }

  async #ensureLoaded(): Promise<void> {
    if (this.#loaded) return;
    await ensurePlumbDir();
    try {
      const raw = await fs.readFile(getMetadataPath(), 'utf-8');
      this.#metadata = JSON.parse(raw) as NonSecretMetadata;
    } catch {
      this.#metadata = { version: 3, providers: {} };
    }
    this.#loaded = true;
  }

  async #flushMetadata(): Promise<void> {
    if (!this.#metadataDirty) return;
    await ensurePlumbDir();
    const tmp = getMetadataPath() + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(this.#metadata, null, 2), 'utf-8');
    await fs.rename(tmp, getMetadataPath());
    this.#metadataDirty = false;
  }

  // ── Query ─────────────────────────────────────────────────────────

  async getCredentials(provider: string): Promise<PlumbCredentialEntry[]> {
    await this.#ensureLoaded();
    const meta = this.#metadata.providers[provider];
    if (!meta || meta.credentialRefs.length === 0) return [];

    const entries: PlumbCredentialEntry[] = [];
    for (const ref of meta.credentialRefs) {
      try {
        const raw = await this.#keychain.getPassword(ref);
        if (!raw) continue;
        const cred = JSON.parse(raw) as PlumbCredential;
        entries.push({
          provider,
          credential: cred,
          source: this.#detectSource(provider, cred),
        });
      } catch {
        // Corrupted or missing entry — skip
      }
    }
    return entries;
  }

  async getApiKey(provider: string): Promise<string | undefined> {
    await this.#ensureLoaded();
    const meta = this.#metadata.providers[provider];
    if (!meta) return undefined;

    for (const ref of meta.credentialRefs) {
      try {
        const raw = await this.#keychain.getPassword(ref);
        if (!raw) continue;
        const cred = JSON.parse(raw) as PlumbCredential;

        if (cred.type === 'oauth') {
          if (cred.expires > Date.now() + OAUTH_REFRESH_SKEW_MS) {
            return cred.access;
          }
        } else if (cred.type === 'api_key' && cred.key) {
          return cred.key;
        }
      } catch {
        continue;
      }
    }
    return undefined;
  }

  async hasCredentials(provider: string): Promise<boolean> {
    const key = await this.getApiKey(provider);
    return key !== undefined;
  }

  async listAuthenticatedProviders(): Promise<string[]> {
    await this.#ensureLoaded();
    const result: string[] = [];
    for (const [providerId, meta] of Object.entries(this.#metadata.providers)) {
      if (meta.credentialRefs.length > 0) {
        // Verify at least one credential is still accessible
        for (const ref of meta.credentialRefs) {
          try {
            const raw = await this.#keychain.getPassword(ref);
            if (raw) {
              result.push(providerId);
              break;
            }
          } catch {
            // skip
          }
        }
      }
    }
    return result;
  }

  // ── Mutation ──────────────────────────────────────────────────────

  async storeCredential(
    provider: string,
    credential: PlumbCredential,
  ): Promise<void> {
    await this.#ensureLoaded();

    if (!this.#metadata.providers[provider]) {
      this.#metadata.providers[provider] = {
        accountLabels: [],
        credentialRefs: [],
      };
    }

    const ref = this.#makeRef(provider, credential);
    await this.#keychain.setPassword(ref, JSON.stringify(credential));

    const meta = this.#metadata.providers[provider];
    if (!meta.credentialRefs.includes(ref)) {
      meta.credentialRefs.push(ref);
    }
    if (credential.type === 'oauth' && credential.email) {
      if (!meta.accountLabels.includes(credential.email)) {
        meta.accountLabels.push(credential.email);
      }
    }
    if (credential.type === 'api_key' && credential.label) {
      if (!meta.accountLabels.includes(credential.label)) {
        meta.accountLabels.push(credential.label);
      }
    }

    this.#metadataDirty = true;
    await this.#flushMetadata();
  }

  /** Thin delegation to satisfy IPlumbCredentialStore — same physical write path as storeCredential. */
  async storeOAuthCredential(
    provider: string,
    credential: PlumbOAuthCredential,
  ): Promise<void> {
    await this.storeCredential(provider, credential);
  }

  /** Thin delegation to satisfy IPlumbCredentialStore — same physical write path as storeCredential. */
  async storeApiKeyCredential(
    provider: string,
    credential: PlumbApiKeyCredential,
  ): Promise<void> {
    await this.storeCredential(provider, credential);
  }

  async removeCredentials(provider: string): Promise<void> {
    await this.#ensureLoaded();
    const meta = this.#metadata.providers[provider];
    if (meta) {
      for (const ref of meta.credentialRefs) {
        try {
          await this.#keychain.deletePassword(ref);
        } catch {
          // Already deleted or inaccessible
        }
      }
      meta.credentialRefs = [];
    }
    this.#metadataDirty = true;
    await this.#flushMetadata();
  }

  async removeCredential(
    provider: string,
    credentialType: 'oauth' | 'api_key',
  ): Promise<boolean> {
    await this.#ensureLoaded();
    const meta = this.#metadata.providers[provider];
    if (!meta) return false;

    let removed = false;
    const remaining: string[] = [];

    for (const ref of meta.credentialRefs) {
      try {
        const raw = await this.#keychain.getPassword(ref);
        if (raw) {
          const cred = JSON.parse(raw) as PlumbCredential;
          if (cred.type === credentialType) {
            await this.#keychain.deletePassword(ref);
            removed = true;
            continue;
          }
        }
      } catch {
        // skip corrupted
      }
      remaining.push(ref);
    }

    meta.credentialRefs = remaining;
    this.#metadataDirty = true;
    await this.#flushMetadata();
    return removed;
  }

  async clearAll(): Promise<void> {
    await this.#ensureLoaded();
    for (const meta of Object.values(this.#metadata.providers)) {
      for (const ref of meta.credentialRefs) {
        try {
          await this.#keychain.deletePassword(ref);
        } catch {
          // skip
        }
      }
    }
    this.#metadata = { version: 3, providers: {} };
    this.#metadataDirty = true;
    await this.#flushMetadata();
  }

  // ── Health ────────────────────────────────────────────────────────

  async healthCheck(): Promise<{ available: boolean; usingFallback: boolean }> {
    const available = await this.#keychain.isAvailable();
    const usingFallback = await this.#keychain.isUsingFileFallback();
    return { available, usingFallback };
  }

  // ── Metadata operations ───────────────────────────────────────────

  async setProviderMetadata(
    provider: string,
    updates: Partial<{
      selectedModel: string;
      smolModel: string;
      planningModel: string;
      disabled: boolean;
    }>,
  ): Promise<void> {
    await this.#ensureLoaded();
    if (!this.#metadata.providers[provider]) {
      this.#metadata.providers[provider] = {
        accountLabels: [],
        credentialRefs: [],
      };
    }
    Object.assign(this.#metadata.providers[provider], updates);
    this.#metadataDirty = true;
    await this.#flushMetadata();
  }

  async getProviderMetadata(
    provider: string,
  ): Promise<NonSecretMetadata['providers'][string] | null> {
    await this.#ensureLoaded();
    return this.#metadata.providers[provider] ?? null;
  }

  // ── Migration ─────────────────────────────────────────────────────

  /**
   * Import credentials from a legacy encrypted file.
   * Prompts the user for confirmation before migration.
   */
  async migrateFromLegacyFile(
    _sourcePath: string,
  ): Promise<{ imported: number; skipped: number }> {
    // Migration from the old AES-256-GCM hostname-key file.
    // Not implemented in this phase — requires interactive confirmation.
    return { imported: 0, skipped: 0 };
  }

  // ── Helpers ───────────────────────────────────────────────────────

  #makeRef(provider: string, _cred: PlumbCredential): string {
    return `plumb:cred:${provider}:${randomUUID()}`;
  }

  #detectSource(
    provider: string,
    cred: PlumbCredential,
  ): PlumbCredentialSource {
    if (cred.type === 'oauth') return 'oauth';
    return 'api_key';
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────

let defaultStore: PlumbSecureCredentialStore | undefined;

export function getPlumbCredentialStore(): PlumbSecureCredentialStore {
  if (!defaultStore) {
    defaultStore = new PlumbSecureCredentialStore();
  }
  return defaultStore;
}

export function resetPlumbCredentialStore(): void {
  defaultStore = undefined;
}
