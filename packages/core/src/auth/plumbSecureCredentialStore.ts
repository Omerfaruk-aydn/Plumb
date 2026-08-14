/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
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
} from '@plumb/provider';

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
  version: 3 | 4;
  providers: Record<
    string,
    {
      selectedModel?: string;
      smolModel?: string;
      planningModel?: string;
      disabled?: boolean;
      accountLabels: string[];
      credentialRefs: string[];
      /**
       * Safe (non-secret) provider configuration set via PLUMB's in-app
       * setup UX -- AWS region/profile, Azure endpoint/deployment map,
       * Vertex project/location, watsonx service URL/project/space, OCI
       * region/project/compartment/auth mode, etc. Never secret material
       * (API keys, private keys, session tokens) -- those go through
       * storeApiKeyCredential/getApiKey instead. Added in metadata version
       * 4; absent on files written by older PLUMB versions, which is why
       * every reader treats it as optional rather than requiring a
       * migration.
       */
      cloudConfig?: Record<string, string>;
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
    const meta = this.#metadata.providers[provider];

    // Write the new credential FIRST, prune stale ones AFTER. A concurrent
    // reader (getCredentials/getApiKey) must never observe a window where
    // this provider has zero OAuth entries — during a refresh, that reads
    // as "never signed in" (NO_CREDENTIAL) instead of "has a valid/expired
    // credential", which is a real, observed race under concurrent
    // resolveUsablePlumbCredential() calls. Prune-before-write can produce
    // exactly that empty window; write-before-prune can only ever produce a
    // transient DUPLICATE (old + new both present), which every reader
    // already resolves safely (prefers non-expired, else most-recent).
    const ref = this.#makeRef(provider, credential);
    await this.#keychain.setPassword(ref, JSON.stringify(credential));
    if (!meta.credentialRefs.includes(ref)) {
      meta.credentialRefs.push(ref);
    }

    // A provider has exactly one active OAuth credential at a time
    // (PlumbProviderState.credentials is singular). Without this, every
    // login/refresh appends a brand-new keychain ref under a fresh UUID
    // without ever removing the previous one — refs accumulate forever,
    // including already-expired entries, and a reader that doesn't
    // explicitly re-check expiry on every entry (or that stops at the first
    // match) can resolve a stale/expired credential even immediately after
    // a genuinely successful refresh. Prune all OTHER OAuth refs for this
    // provider (never the one just written) so exactly one survives.
    if (credential.type === 'oauth') {
      const survivors: string[] = [ref];
      for (const otherRef of meta.credentialRefs) {
        if (otherRef === ref) continue;
        const raw = await this.#keychain
          .getPassword(otherRef)
          .catch(() => null);
        if (!raw) continue;
        let existing: PlumbCredential | undefined;
        try {
          existing = JSON.parse(raw) as PlumbCredential;
        } catch {
          continue;
        }
        if (existing.type === 'oauth') {
          await this.#keychain.deletePassword(otherRef).catch(() => {});
          continue;
        }
        survivors.push(otherRef);
      }
      meta.credentialRefs = survivors;
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

  /**
   * Merges `updates` into the provider's safe (non-secret) cloud
   * configuration (region, profile, project, deployment map, auth mode,
   * etc.) -- never secret material. A key set to `undefined` removes it
   * (used when a user switches auth mode/scope and a field becomes
   * irrelevant, e.g. clearing OCI's `project` when switching to
   * `space`-scoped watsonx). Writes atomically via the same
   * tmp-file-then-rename path every other metadata write uses.
   */
  async setProviderCloudConfig(
    provider: string,
    updates: Record<string, string | undefined>,
  ): Promise<void> {
    await this.#ensureLoaded();
    if (!this.#metadata.providers[provider]) {
      this.#metadata.providers[provider] = {
        accountLabels: [],
        credentialRefs: [],
      };
    }
    const entry = this.#metadata.providers[provider];
    const merged = { ...(entry.cloudConfig ?? {}) };
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) delete merged[key];
      else merged[key] = value;
    }
    entry.cloudConfig = merged;
    this.#metadataDirty = true;
    await this.#flushMetadata();
  }

  /** Replaces the provider's entire safe cloud configuration -- used for atomic full-form saves. */
  async replaceProviderCloudConfig(
    provider: string,
    config: Record<string, string>,
  ): Promise<void> {
    await this.#ensureLoaded();
    if (!this.#metadata.providers[provider]) {
      this.#metadata.providers[provider] = {
        accountLabels: [],
        credentialRefs: [],
      };
    }
    this.#metadata.providers[provider].cloudConfig = { ...config };
    this.#metadataDirty = true;
    await this.#flushMetadata();
  }

  async getProviderCloudConfig(
    provider: string,
  ): Promise<Record<string, string>> {
    await this.#ensureLoaded();
    return { ...(this.#metadata.providers[provider]?.cloudConfig ?? {}) };
  }

  /** Clears the provider's safe cloud configuration -- part of remove/logout. Never touches external credential chains (AWS/ADC/OCI profiles). */
  async clearProviderCloudConfig(provider: string): Promise<void> {
    await this.#ensureLoaded();
    const entry = this.#metadata.providers[provider];
    if (!entry?.cloudConfig) return;
    delete entry.cloudConfig;
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
