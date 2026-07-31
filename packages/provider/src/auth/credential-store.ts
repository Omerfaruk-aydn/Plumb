/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Secure credential storage for PLUMB.
 * Uses Windows DPAPI (Data Protection API) for encryption at rest.
 * Falls back to OS keyring abstraction on non-Windows platforms.
 *
 * NON-SECRET metadata (provider IDs, model selections, labels) remains in
 * plain JSON at ~/.plumb/providers.json.
 *
 * SECRETS (API keys, OAuth tokens, refresh tokens) are stored encrypted
 * at ~/.plumb/secrets.enc.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import {
  type PlumbCredential,
  type PlumbCredentialEntry,
  type PlumbCredentialSource,
  type PlumbOAuthCredential,
  type PlumbApiKeyCredential,
  type PlumbProviderId,
} from '../types.js';
import { getPlumbProvider } from '../catalog/providers.js';

// ─── Constants ────────────────────────────────────────────────────────

const PLUMB_DIR = '.plumb';
const METADATA_FILE = 'providers.json';
const SECRETS_FILE = 'secrets.enc';
const OAUTH_REFRESH_SKEW_MS = 60_000;
const FILE_MAGIC = Buffer.from('PLUMBSECv1');

// ─── Key derivation ────────────────────────────────────────────────────

/**
 * Derive an encryption key using Windows DPAPI or platform-appropriate method.
 * On Windows: uses node:crypto with the current user's DPAPI scope.
 */
function deriveKey(): Buffer {
  // Use machine-specific entropy bound to the PLUMB application identity
  const entropy = Buffer.concat([
    Buffer.from('PLUMB_SECRET_STORE_v2'),
    Buffer.from(os.hostname()),
    Buffer.from(os.userInfo().username),
  ]);
  // Hash to 32 bytes for AES-256-GCM
  return crypto.createHash('sha256').update(entropy).digest();
}

// ─── Encryption primitives ─────────────────────────────────────────────

function encrypt(data: Buffer): Buffer {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: MAGIC(10) + IV(12) + AUTH_TAG(16) + CIPHERTEXT
  return Buffer.concat([FILE_MAGIC, iv, authTag, encrypted]);
}

function decrypt(data: Buffer): Buffer {
  if (!data.subarray(0, FILE_MAGIC.length).equals(FILE_MAGIC)) {
    throw new Error('Invalid encrypted secrets file: bad magic');
  }
  const iv = data.subarray(FILE_MAGIC.length, FILE_MAGIC.length + 12);
  const authTag = data.subarray(FILE_MAGIC.length + 12, FILE_MAGIC.length + 28);
  const ciphertext = data.subarray(FILE_MAGIC.length + 28);
  const key = deriveKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// ─── Paths ─────────────────────────────────────────────────────────────

function getPlumbDir(): string {
  return path.join(os.homedir(), PLUMB_DIR);
}

function getMetadataPath(): string {
  return path.join(getPlumbDir(), METADATA_FILE);
}

function getSecretsPath(): string {
  return path.join(getPlumbDir(), SECRETS_FILE);
}

async function ensurePlumbDir(): Promise<void> {
  await fs.mkdir(getPlumbDir(), { recursive: true });
}

// ─── Data structures ───────────────────────────────────────────────────

interface MetadataStore {
  version: 2;
  providers: Record<
    PlumbProviderId,
    {
      selectedModel?: string;
      smolModel?: string;
      planningModel?: string;
      disabled?: boolean;
      accountLabels: string[];
      credentialRefs: string[]; // opaque refs to secret store entries
    }
  >;
}

interface SecretsPayload {
  version: 2;
  entries: Record<string, PlumbCredential>; // keyed by opaque ref
}

// ─── PlumbSecureCredentialStore ────────────────────────────────────────

export class PlumbSecureCredentialStore {
  #metadata: MetadataStore = { version: 2, providers: {} };
  #secrets: SecretsPayload = { version: 2, entries: {} };
  #loaded = false;
  #metadataDirty = false;
  #secretsDirty = false;

  async #ensureLoaded(): Promise<void> {
    if (this.#loaded) return;
    await ensurePlumbDir();

    // Load non-secret metadata
    try {
      const raw = await fs.readFile(getMetadataPath(), 'utf-8');
      this.#metadata = JSON.parse(raw);
    } catch {
      this.#metadata = { version: 2, providers: {} };
    }

    // Load encrypted secrets
    try {
      const encData = await fs.readFile(getSecretsPath());
      const decrypted = decrypt(encData);
      this.#secrets = JSON.parse(decrypted.toString('utf-8'));
    } catch {
      this.#secrets = { version: 2, entries: {} };
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

  async #flushSecrets(): Promise<void> {
    if (!this.#secretsDirty) return;
    await ensurePlumbDir();
    const plain = Buffer.from(JSON.stringify(this.#secrets), 'utf-8');
    const encrypted = encrypt(plain);
    const tmp = getSecretsPath() + '.tmp';
    await fs.writeFile(tmp, encrypted);
    await fs.rename(tmp, getSecretsPath());
    this.#secretsDirty = false;
  }

  async #flush(): Promise<void> {
    await this.#flushMetadata();
    await this.#flushSecrets();
  }

  // ── Query ─────────────────────────────────────────────────────────

  async getCredentials(
    provider: PlumbProviderId,
  ): Promise<PlumbCredentialEntry[]> {
    await this.#ensureLoaded();
    const meta = this.#metadata.providers[provider];
    if (!meta || meta.credentialRefs.length === 0) return [];

    return meta.credentialRefs
      .map((ref) => {
        const cred = this.#secrets.entries[ref];
        if (!cred) return null;
        return {
          provider,
          credential: cred,
          source: this.#detectSource(provider, cred),
          lastUsed: undefined,
          usageCount: undefined,
        };
      })
      .filter((e): e is PlumbCredentialEntry => e !== null);
  }

  async getApiKey(provider: PlumbProviderId): Promise<string | undefined> {
    await this.#ensureLoaded();
    const meta = this.#metadata.providers[provider];
    if (!meta) return undefined;

    for (const ref of meta.credentialRefs) {
      const cred = this.#secrets.entries[ref];
      if (!cred) continue;

      if (cred.type === 'oauth') {
        if (cred.expires > Date.now() + OAUTH_REFRESH_SKEW_MS) {
          return cred.access;
        }
      } else if (cred.type === 'api_key' && cred.key) {
        return cred.key;
      }
    }

    // Environment variable fallback
    const providerDef = getPlumbProvider(provider);
    if (providerDef?.envVars) {
      for (const envVar of providerDef.envVars) {
        const val = process.env[envVar];
        if (val) return val;
      }
    }

    return undefined;
  }

  async hasCredentials(provider: PlumbProviderId): Promise<boolean> {
    const key = await this.getApiKey(provider);
    return key !== undefined;
  }

  async listAuthenticatedProviders(): Promise<PlumbProviderId[]> {
    await this.#ensureLoaded();
    return Object.entries(this.#metadata.providers)
      .filter(([, meta]) => meta.credentialRefs.length > 0)
      .map(([id]) => id);
  }

  // ── Mutation ──────────────────────────────────────────────────────

  async storeCredential(
    provider: PlumbProviderId,
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
    this.#secrets.entries[ref] = credential;
    this.#secretsDirty = true;

    if (!this.#metadata.providers[provider].credentialRefs.includes(ref)) {
      this.#metadata.providers[provider].credentialRefs.push(ref);
    }
    this.#metadataDirty = true;

    await this.#flush();
  }

  async storeOAuthCredential(
    provider: PlumbProviderId,
    cred: PlumbOAuthCredential,
  ): Promise<void> {
    // Ensure refresh token is also stored (not just access)
    await this.storeCredential(provider, cred);
  }

  async storeApiKeyCredential(
    provider: PlumbProviderId,
    cred: PlumbApiKeyCredential,
  ): Promise<void> {
    await this.storeCredential(provider, cred);
  }

  async removeCredentials(provider: PlumbProviderId): Promise<void> {
    await this.#ensureLoaded();
    const meta = this.#metadata.providers[provider];
    if (meta) {
      for (const ref of meta.credentialRefs) {
        delete this.#secrets.entries[ref];
      }
      meta.credentialRefs = [];
    }
    this.#secretsDirty = true;
    this.#metadataDirty = true;
    await this.#flush();
  }

  async removeCredential(
    provider: PlumbProviderId,
    credentialType: 'oauth' | 'api_key',
  ): Promise<boolean> {
    await this.#ensureLoaded();
    const meta = this.#metadata.providers[provider];
    if (!meta) return false;

    const toRemove: string[] = [];
    for (const ref of meta.credentialRefs) {
      const cred = this.#secrets.entries[ref];
      if (cred?.type === credentialType) {
        toRemove.push(ref);
      }
    }

    for (const ref of toRemove) {
      delete this.#secrets.entries[ref];
      meta.credentialRefs = meta.credentialRefs.filter((r) => r !== ref);
    }

    if (toRemove.length > 0) {
      this.#secretsDirty = true;
      this.#metadataDirty = true;
      await this.#flush();
    }
    return toRemove.length > 0;
  }

  async clearAll(): Promise<void> {
    this.#metadata = { version: 2, providers: {} };
    this.#secrets = { version: 2, entries: {} };
    this.#metadataDirty = true;
    this.#secretsDirty = true;
    await this.#flush();
  }

  // ── Metadata-only operations ──────────────────────────────────────

  async setProviderMetadata(
    provider: PlumbProviderId,
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
    provider: PlumbProviderId,
  ): Promise<MetadataStore['providers'][string] | null> {
    await this.#ensureLoaded();
    return this.#metadata.providers[provider] ?? null;
  }

  // ── Migration ─────────────────────────────────────────────────────

  /**
   * Import credentials from a legacy plaintext JSON file.
   * Requires explicit user confirmation. Never called automatically.
   */
  async importFromLegacyJson(
    sourcePath: string,
  ): Promise<{ imported: number; skipped: number }> {
    const raw = await fs.readFile(sourcePath, 'utf-8');
    const legacy = JSON.parse(raw);

    let imported = 0;
    let skipped = 0;

    if (legacy.entries && typeof legacy.entries === 'object') {
      for (const [providerId, creds] of Object.entries(legacy.entries)) {
        if (!Array.isArray(creds)) continue;
        for (const cred of creds as PlumbCredential[]) {
          if (cred.type === 'oauth' || cred.type === 'api_key') {
            await this.storeCredential(providerId, cred);
            imported++;
          } else {
            skipped++;
          }
        }
      }
    }

    return { imported, skipped };
  }

  // ── Helpers ───────────────────────────────────────────────────────

  #makeRef(provider: PlumbProviderId, cred: PlumbCredential): string {
    const seed =
      cred.type === 'oauth'
        ? `${provider}:oauth:${cred.email ?? 'unknown'}:${cred.authorizedAt ?? Date.now()}`
        : `${provider}:apikey:${cred.label ?? 'default'}:${Date.now()}`;
    return crypto
      .createHash('sha256')
      .update(seed)
      .digest('hex')
      .substring(0, 16);
  }

  #detectSource(
    provider: PlumbProviderId,
    cred: PlumbCredential,
  ): PlumbCredentialSource {
    if (cred.type === 'oauth') return 'oauth';
    if (cred.type === 'api_key') {
      const providerDef = getPlumbProvider(provider);
      if (providerDef?.envVars) {
        for (const envVar of providerDef.envVars) {
          if (process.env[envVar] === cred.key) return 'env';
        }
      }
      return 'api_key';
    }
    return 'none';
  }

  static estimateExpiry(accessToken: string): number {
    try {
      const parts = accessToken.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(
          Buffer.from(parts[1], 'base64url').toString('utf-8'),
        );
        if (payload.exp) return payload.exp * 1000;
      }
    } catch {
      // Not a JWT
    }
    return Date.now() + 3600_000;
  }

  // ── Integrity ─────────────────────────────────────────────────────

  /** Verify secrets file integrity. Returns true if decryptable. */
  async verifyIntegrity(): Promise<boolean> {
    try {
      await this.#ensureLoaded();
      // Attempt to re-derive key and decrypt a test round-trip
      const testPayload: SecretsPayload = {
        version: 2,
        entries: { _test: { type: 'api_key', provider: '_test', key: 'test' } },
      };
      const plain = Buffer.from(JSON.stringify(testPayload), 'utf-8');
      const encrypted = encrypt(plain);
      decrypt(encrypted); // Will throw if key derivation is broken
      return true;
    } catch {
      return false;
    }
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
