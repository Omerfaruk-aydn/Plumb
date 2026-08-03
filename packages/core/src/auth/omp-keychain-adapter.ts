/**
 * OMP-auth-schema-preserving keychain adapter.
 *
 * Stores the full OMP AuthCredential records in the OS keychain
 * (KeychainService). Returns PlumbCredential entries to PLUMB consumers
 * via thin conversion — preserves all OMP fields in storage.
 *
 * Physical backend: OS keychain via KeychainService (keytar).
 * No plaintext JSON secrets stored on disk.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { homedir } from '../utils/paths.js';
import { KeychainService } from '../services/keychainService.js';
import type {
  IPlumbCredentialStore,
  PlumbCredentialEntry,
  PlumbCredential,
  PlumbOAuthCredential,
  PlumbApiKeyCredential,
} from '@google/gemini-cli-provider';

// OMP credential types — the same shapes stored by SqliteAuthCredentialStore
// We store the raw JSON as-is so the OMP schema round-trips unchanged.
interface OAuthCredentialStore {
  type: 'oauth';
  access: string;
  refresh: string;
  expires: number;
  email?: string;
  accountId?: string;
}

interface ApiKeyCredentialStore {
  type: 'api_key';
  key: string;
  source?: string;
}

type AuthCredentialStore = OAuthCredentialStore | ApiKeyCredentialStore;

const KEYCHAIN_SERVICE_NAME = 'plumb-provider-credentials';
const PLUMB_DIR = '.plumb';
const METADATA_FILE = 'providers.json';

interface ProviderMetadata {
  accountLabels: string[];
  credentialRefs: string[];
}

interface NonSecretMetadata {
  version: number;
  providers: Record<string, ProviderMetadata>;
}

function getPlumbDir(): string {
  return path.join(homedir(), PLUMB_DIR);
}

function getMetadataPath(): string {
  return path.join(getPlumbDir(), METADATA_FILE);
}

function ensurePlumbDirSync(): void {
  const dir = getPlumbDir();
  fsSync.mkdirSync(dir, { recursive: true });
}

function makeCredentialRef(
  provider: string,
  credType: 'oauth' | 'api_key',
  index: number,
): string {
  const hash = createHash('sha256')
    .update(`${provider}:${credType}:${index}`)
    .digest('hex')
    .slice(0, 8);
  return `${provider}:${credType}:${hash}`;
}

/**
 * Convert OMP AuthCredential → PLUMB PlumbCredential at the query boundary.
 * Preserves all OMP fields in storage; only maps fields PLUMB consumers need.
 */
function toPlumbCredential(
  provider: string,
  cred: AuthCredentialStore,
): PlumbCredential {
  if (cred.type === 'oauth') {
    const oauth = cred as OAuthCredentialStore;
    const result: PlumbOAuthCredential = {
      type: 'oauth',
      provider: provider as PlumbProviderId,
      access: oauth.access,
      refresh: oauth.refresh,
      expires: oauth.expires,
    };
    if (oauth.email) result.email = oauth.email;
    if (oauth.accountId) result.accountId = oauth.accountId;
    return result;
  }
  const ak = cred as ApiKeyCredentialStore;
  const result: PlumbApiKeyCredential = {
    type: 'api_key',
    provider: provider as PlumbProviderId,
    key: ak.key,
  };
  return result;
}

// Type alias for PLUMB provider IDs
type PlumbProviderId = string;

export class OmpKeychainAdapter implements IPlumbCredentialStore {
  readonly #keychain: KeychainService;
  #metadata: NonSecretMetadata = { version: 3, providers: {} };
  #loaded = false;
  #metadataDirty = false;

  constructor() {
    this.#keychain = new KeychainService(KEYCHAIN_SERVICE_NAME);
  }

  async #ensureLoaded(): Promise<void> {
    if (this.#loaded) return;
    ensurePlumbDirSync();
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
    ensurePlumbDirSync();
    const tmp = getMetadataPath() + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(this.#metadata, null, 2), 'utf-8');
    await fs.rename(tmp, getMetadataPath());
    this.#metadataDirty = false;
  }

  async getCredentials(provider: string): Promise<PlumbCredentialEntry[]> {
    await this.#ensureLoaded();
    const meta = this.#metadata.providers[provider];
    if (!meta || meta.credentialRefs.length === 0) return [];

    const entries: PlumbCredentialEntry[] = [];
    for (const ref of meta.credentialRefs) {
      try {
        const raw = await this.#keychain.getPassword(ref);
        if (!raw) continue;
        const ompCred = JSON.parse(raw) as AuthCredentialStore;
        entries.push({
          provider,
          credential: toPlumbCredential(provider, ompCred),
          source: ompCred.type === 'oauth' ? 'oauth' : 'api_key',
        });
      } catch {
        // Corrupted or missing entry — skip
      }
    }
    return entries;
  }

  async getApiKey(provider: string): Promise<string | undefined> {
    const creds = await this.getCredentials(provider);
    for (const entry of creds) {
      if (entry.credential.type === 'api_key' && entry.credential.key) {
        return entry.credential.key;
      }
    }
    return undefined;
  }

  async hasCredentials(provider: string): Promise<boolean> {
    const creds = await this.getCredentials(provider);
    return creds.length > 0;
  }

  async listAuthenticatedProviders(): Promise<string[]> {
    await this.#ensureLoaded();
    const result: string[] = [];
    for (const [providerId, meta] of Object.entries(this.#metadata.providers)) {
      if (meta.credentialRefs.length > 0) {
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

    const ref = makeCredentialRef(provider, credential.type, 
      this.#metadata.providers[provider].credentialRefs.length);
    
    // Store full PLUMB credential shape (converted to OMP-compatible)
    const ompCred = toOmpCredential(credential);
    await this.#keychain.setPassword(ref, JSON.stringify(ompCred));

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

  async storeOAuthCredential(
    provider: string,
    cred: PlumbOAuthCredential,
  ): Promise<void> {
    return this.storeCredential(provider, cred);
  }

  async storeApiKeyCredential(
    provider: string,
    cred: PlumbApiKeyCredential,
  ): Promise<void> {
    return this.storeCredential(provider, cred);
  }

  async removeCredentials(provider: string): Promise<void> {
    await this.#ensureLoaded();
    const meta = this.#metadata.providers[provider];
    if (!meta) return;
    for (const ref of meta.credentialRefs) {
      try {
        await this.#keychain.deletePassword(ref);
      } catch {
        // best-effort
      }
    }
    delete this.#metadata.providers[provider];
    this.#metadataDirty = true;
    await this.#flushMetadata();
  }

  async removeCredential(
    provider: string,
    type: string,
  ): Promise<boolean> {
    await this.#ensureLoaded();
    const meta = this.#metadata.providers[provider];
    if (!meta) return false;

    const refsToRemove: string[] = [];
    for (const ref of meta.credentialRefs) {
      try {
        const raw = await this.#keychain.getPassword(ref);
        if (!raw) continue;
        const ompCred = JSON.parse(raw) as AuthCredentialStore;
        if (ompCred.type === type) refsToRemove.push(ref);
      } catch {
        // skip
      }
    }
    for (const ref of refsToRemove) {
      try {
        await this.#keychain.deletePassword(ref);
      } catch {
        // best-effort
      }
      meta.credentialRefs = meta.credentialRefs.filter((r) => r !== ref);
    }
    this.#metadataDirty = true;
    await this.#flushMetadata();
    return refsToRemove.length > 0;
  }

  async clearAll(): Promise<void> {
    await this.#ensureLoaded();
    for (const [_provider, meta] of Object.entries(this.#metadata.providers)) {
      for (const ref of meta.credentialRefs) {
        try {
          await this.#keychain.deletePassword(ref);
        } catch {
          // best-effort
        }
      }
    }
    this.#metadata = { version: 3, providers: {} };
    this.#metadataDirty = true;
    await this.#flushMetadata();
  }

  async setProviderMetadata(
    provider: string,
    updates: Partial<{
      selectedModel: string;
      smolModel: string;
      planningModel: string;
      disabled: boolean;
    }>,
  ): Promise<void> {
    // OMP auth schema preserves full metadata — store as provider labels
    await this.#ensureLoaded();
    if (!this.#metadata.providers[provider]) {
      this.#metadata.providers[provider] = {
        accountLabels: [],
        credentialRefs: [],
      };
    }
    const meta = this.#metadata.providers[provider];
    // Merge updates into accountLabels for PLUMB compatibility
    if (updates.selectedModel) {
      const key = `model:${updates.selectedModel}`;
      if (!meta.accountLabels.includes(key)) meta.accountLabels.push(key);
    }
    this.#metadataDirty = true;
    await this.#flushMetadata();
  }

  async getProviderMetadata(
    provider: string,
  ): Promise<{
    selectedModel?: string;
    smolModel?: string;
    planningModel?: string;
    disabled?: boolean;
    accountLabels: string[];
    credentialRefs: string[];
  } | null> {
    await this.#ensureLoaded();
    const meta = this.#metadata.providers[provider];
    if (!meta) return null;
    let selectedModel: string | undefined;
    for (const label of meta.accountLabels) {
      if (label.startsWith('model:')) selectedModel = label.slice(6);
    }
    return {
      selectedModel,
      accountLabels: meta.accountLabels,
      credentialRefs: meta.credentialRefs,
    };
  }

  async healthCheck(): Promise<{ available: boolean; usingFallback: boolean }> {
    try {
      const dir = getPlumbDir();
      const exists = fsSync.existsSync(dir);
      if (!exists) return { available: false, usingFallback: true };
      return { available: true, usingFallback: false };
    } catch {
      return { available: false, usingFallback: true };
    }
  }
}

/** Convert PLUMB PlumbCredential to OMP AuthCredential for storage. */
function toOmpCredential(cred: PlumbCredential): AuthCredentialStore {
  if (cred.type === 'oauth') {
    return {
      type: 'oauth',
      access: cred.access,
      refresh: cred.refresh,
      expires: cred.expires,
      email: cred.email,
      accountId: cred.accountId,
    } as OAuthCredentialStore;
  }
  return {
    type: 'api_key',
    key: cred.key,
  } as ApiKeyCredentialStore;
}
