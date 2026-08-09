/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(async () => undefined),
  setAuthenticated: vi.fn(async () => undefined),
  logout: vi.fn(async () => undefined),
  getProviderState: vi.fn((_id: string) => undefined as unknown),
  hydrateCustomProviderModels: vi.fn(),
  setCustomProviderDefinitions: vi.fn(),
}));

vi.mock('@google/gemini-cli-provider', async () => {
  const actual = await vi.importActual<
    typeof import('@google/gemini-cli-provider')
  >('@google/gemini-cli-provider');
  return {
    ...actual,
    getPlumbProviderRegistry: () => ({
      initialize: mocks.initialize,
      setAuthenticated: mocks.setAuthenticated,
      logout: mocks.logout,
      getProviderState: mocks.getProviderState,
    }),
    getPlumbModelRegistry: () => ({
      hydrateCustomProviderModels: mocks.hydrateCustomProviderModels,
    }),
    setCustomProviderDefinitions: mocks.setCustomProviderDefinitions,
  };
});

import { CustomProviderDefinitionStore } from '@google/gemini-cli-core';
import { createCustomProviderConfigActions } from './customProviderConfigActions.js';

describe('customProviderConfigActions', () => {
  let filePath: string;
  let store: CustomProviderDefinitionStore;

  beforeEach(async () => {
    vi.clearAllMocks();
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'plumb-custom-actions-'),
    );
    filePath = path.join(directory, 'custom-providers.json');
    store = new CustomProviderDefinitionStore(filePath);
  });

  afterEach(async () => {
    await fs.rm(path.dirname(filePath), { recursive: true, force: true });
  });

  it('creates a provider, stores its credential separately, and hydrates the registry', async () => {
    const actions = createCustomProviderConfigActions(store);

    const result = await actions.save(
      {
        displayName: 'Private Gateway',
        dialect: 'openai-completions',
        baseUrl: 'https://gateway.example.test/v1',
        credentialPlacement: 'bearer',
        manualModels: [{ id: 'private-model' }],
      },
      'secret-canary',
    );

    expect(result.success).toBe(true);
    expect(result.definition?.id).toMatch(/^custom:/);
    expect(mocks.setAuthenticated).toHaveBeenCalledWith(
      result.definition?.id,
      expect.objectContaining({ type: 'api_key', key: 'secret-canary' }),
    );
    expect(mocks.hydrateCustomProviderModels).toHaveBeenCalled();

    const plaintext = await fs.readFile(filePath, 'utf8');
    expect(plaintext).not.toContain('secret-canary');
    expect(plaintext).toContain('Private Gateway');
  });

  it('rejects an invalid definition without writing anything or touching credentials', async () => {
    const actions = createCustomProviderConfigActions(store);

    const result = await actions.save(
      {
        displayName: '',
        dialect: 'openai-completions',
        baseUrl: 'not-a-url',
      },
      'should-not-be-stored',
    );

    expect(result.success).toBe(false);
    expect(result.fieldErrors).toBeTruthy();
    expect(mocks.setAuthenticated).not.toHaveBeenCalled();
    await expect(fs.readFile(filePath, 'utf8')).rejects.toThrow();
  });

  it('edit keeps the stable ID and re-hydrates in-memory state', async () => {
    const actions = createCustomProviderConfigActions(store);
    const created = await actions.save({
      displayName: 'Before',
      dialect: 'anthropic-messages',
      baseUrl: 'https://anthropic.example.test',
    });
    const id = created.definition!.id;
    mocks.hydrateCustomProviderModels.mockClear();

    const edited = await actions.save({
      id,
      displayName: 'After',
      dialect: 'anthropic-messages',
      baseUrl: 'https://anthropic.example.test',
    });

    expect(edited.definition?.id).toBe(id);
    expect(edited.definition?.displayName).toBe('After');
    expect(mocks.hydrateCustomProviderModels).toHaveBeenCalled();

    const list = await actions.list();
    expect(list).toMatchObject([{ id, displayName: 'After' }]);
  });

  it('delete removes only the target definition and its credential', async () => {
    const actions = createCustomProviderConfigActions(store);
    const a = await actions.save({
      displayName: 'A',
      dialect: 'openai-completions',
      baseUrl: 'https://a.example.test/v1',
    });
    const b = await actions.save({
      displayName: 'B',
      dialect: 'openai-completions',
      baseUrl: 'https://b.example.test/v1',
    });

    await actions.remove(a.definition!.id);

    expect(mocks.logout).toHaveBeenCalledWith(a.definition!.id);
    expect(mocks.logout).not.toHaveBeenCalledWith(b.definition!.id);
    const list = await actions.list();
    expect(list).toMatchObject([{ id: b.definition!.id }]);
  });

  it('reports credential presence from the canonical registry, not the definition file', async () => {
    const actions = createCustomProviderConfigActions(store);
    const created = await actions.save({
      displayName: 'Keyed',
      dialect: 'openai-completions',
      baseUrl: 'https://keyed.example.test/v1',
    });
    mocks.getProviderState.mockReturnValue({
      credentials: { type: 'api_key', key: 'x' },
    });

    await expect(actions.hasCredential(created.definition!.id)).resolves.toBe(
      true,
    );
    mocks.getProviderState.mockReturnValue(undefined);
    await expect(actions.hasCredential(created.definition!.id)).resolves.toBe(
      false,
    );
  });
});
