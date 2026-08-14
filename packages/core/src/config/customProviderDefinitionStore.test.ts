/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { CustomProviderDefinitionStore } from './customProviderDefinitionStore.js';

const temporaryDirectories: string[] = [];

async function makeStore(): Promise<{
  store: CustomProviderDefinitionStore;
  filePath: string;
}> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'plumb-custom-'));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, 'custom-providers.json');
  return { store: new CustomProviderDefinitionStore(filePath), filePath };
}

describe('CustomProviderDefinitionStore', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => fs.rm(directory, { recursive: true, force: true })),
    );
  });

  it('round-trips definitions without writing credential canaries', async () => {
    const { store, filePath } = await makeStore();
    const definition = await store.upsert({
      id: 'custom:123e4567-e89b-42d3-a456-426614174000',
      displayName: 'Persisted custom',
      dialect: 'google-generative-ai',
      baseUrl: 'https://gemini.example.test/v1beta',
      credentialPlacement: 'query-key',
      manualModels: [{ id: 'gemini-private' }],
    });

    expect(await store.load()).toEqual([definition]);
    const plaintext = await fs.readFile(filePath, 'utf8');
    expect(plaintext).not.toContain('secret-canary');
    expect(plaintext).toContain('Persisted custom');
  });

  it('keeps the stable ID through edit and deletes only the target', async () => {
    const { store } = await makeStore();
    const id = 'custom:123e4567-e89b-42d3-a456-426614174000';
    await store.upsert({
      id,
      displayName: 'Before',
      dialect: 'openai-completions',
      baseUrl: 'https://example.test/v1',
      manualModels: [{ id: 'm' }],
    });
    await store.upsert({
      id,
      displayName: 'After',
      dialect: 'openai-completions',
      baseUrl: 'https://example.test/v1',
      manualModels: [{ id: 'm' }],
    });
    expect(await store.load()).toMatchObject([{ id, displayName: 'After' }]);
    await expect(store.delete(id)).resolves.toBe(true);
    await expect(store.load()).resolves.toEqual([]);
  });

  it('fails closed on unsupported metadata versions', async () => {
    const { store, filePath } = await makeStore();
    await fs.writeFile(
      filePath,
      JSON.stringify({ version: 99, definitions: [] }),
      'utf8',
    );
    await expect(store.load()).rejects.toThrow(/version/i);
  });
});
