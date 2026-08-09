/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Durable, non-secret storage for user-defined custom provider definitions
 * (id/dialect/base URL/credential placement/safe headers/manual models).
 * Credentials themselves never land here -- they stay in the OS-protected
 * `PlumbSecureCredentialStore` keyed by the definition's stable ID, so a
 * definition file leak can never expose a secret.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { homedir } from '../utils/paths.js';
import {
  CUSTOM_PROVIDER_DEFINITION_VERSION,
  normalizeCustomProviderDefinition,
  type CustomProviderDefinition,
  type CustomProviderDefinitionInput,
} from '@google/gemini-cli-provider';

interface CustomProviderFile {
  version: typeof CUSTOM_PROVIDER_DEFINITION_VERSION;
  definitions: CustomProviderDefinition[];
}

function isFileNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    err.code === 'ENOENT'
  );
}

function isCustomProviderFile(value: unknown): value is CustomProviderFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    'version' in value &&
    value.version === CUSTOM_PROVIDER_DEFINITION_VERSION &&
    'definitions' in value &&
    Array.isArray(value.definitions)
  );
}

export class CustomProviderDefinitionStore {
  readonly #filePath: string;
  #writeChain: Promise<void> = Promise.resolve();

  constructor(
    filePath = path.join(homedir(), '.plumb', 'custom-providers.json'),
  ) {
    this.#filePath = filePath;
  }

  async load(): Promise<CustomProviderDefinition[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.#filePath, 'utf8');
    } catch (err) {
      if (isFileNotFound(err)) return [];
      throw err;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isCustomProviderFile(parsed)) {
      throw new Error('Unsupported custom provider metadata version.');
    }
    return parsed.definitions.map((definition) =>
      normalizeCustomProviderDefinition(definition),
    );
  }

  async replaceAll(
    definitions: readonly CustomProviderDefinitionInput[],
  ): Promise<CustomProviderDefinition[]> {
    const normalized = definitions.map((definition) =>
      normalizeCustomProviderDefinition(definition),
    );
    this.#writeChain = this.#writeChain.then(async () => {
      await fs.mkdir(path.dirname(this.#filePath), { recursive: true });
      const tmp = `${this.#filePath}.tmp`;
      const data: CustomProviderFile = {
        version: CUSTOM_PROVIDER_DEFINITION_VERSION,
        definitions: normalized,
      };
      await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
      await fs.rename(tmp, this.#filePath);
    });
    await this.#writeChain;
    return normalized;
  }

  async upsert(
    input: CustomProviderDefinitionInput,
  ): Promise<CustomProviderDefinition> {
    const definition = normalizeCustomProviderDefinition(input);
    const existing = await this.load();
    const next = existing.filter((item) => item.id !== definition.id);
    next.push(definition);
    await this.replaceAll(next);
    return definition;
  }

  async delete(providerId: string): Promise<boolean> {
    const existing = await this.load();
    const next = existing.filter((item) => item.id !== providerId);
    if (next.length === existing.length) return false;
    await this.replaceAll(next);
    return true;
  }
}

let defaultStore: CustomProviderDefinitionStore | undefined;

export function getCustomProviderDefinitionStore(): CustomProviderDefinitionStore {
  defaultStore ??= new CustomProviderDefinitionStore();
  return defaultStore;
}

export function __resetCustomProviderDefinitionStoreForTests(): void {
  defaultStore = undefined;
}
