/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Real interaction tests for the custom provider CRUD screen. Only the
 * actions boundary (../utils/customProviderConfigActions.ts) is mocked;
 * every rendering/navigation/save/delete behavior below is real, driven by
 * actual Ink keypress events.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import type React from 'react';
import {
  renderWithProviders,
  type RenderWithProvidersInstance,
} from '../../test-utils/render.js';
import { waitFor } from '../../test-utils/async.js';
import { PlumbCustomProviderManagerScreen } from './PlumbCustomProviderManagerScreen.js';
import type { CustomProviderConfigActions } from '../utils/customProviderConfigActions.js';
import type { CustomProviderDefinition } from '@google/gemini-cli-provider';

async function renderReady(
  props: React.ComponentProps<typeof PlumbCustomProviderManagerScreen>,
): Promise<RenderWithProvidersInstance> {
  let instance!: RenderWithProvidersInstance;
  await act(async () => {
    instance = await renderWithProviders(
      <PlumbCustomProviderManagerScreen {...props} />,
    );
  });
  await instance.waitUntilReady();
  await waitFor(() => {
    expect(instance.lastFrame()).not.toContain('Loading custom providers…');
  });
  return instance;
}

const ENTER = String.fromCharCode(13);
const ESCAPE = String.fromCharCode(27);
const DOWN_ARROW = String.fromCharCode(27) + '[B';

async function pressKey(stdin: { write: (data: string) => void }, key: string) {
  await act(async () => {
    stdin.write(key);
    await new Promise((resolve) => setTimeout(resolve, 90));
  });
}
async function typeText(
  stdin: { write: (data: string) => void },
  text: string,
) {
  for (const ch of text) await pressKey(stdin, ch);
}

const EXISTING: CustomProviderDefinition = {
  version: 1,
  id: 'custom:123e4567-e89b-42d3-a456-426614174000',
  displayName: 'Private Gateway',
  dialect: 'openai-completions',
  baseUrl: 'https://gateway.example.test/v1',
  credentialPlacement: 'bearer',
  safeHeaders: { 'X-Tenant': 'acme' },
  manualModels: [{ id: 'private-model' }],
};

function makeMockActions(initial: CustomProviderDefinition[] = []): {
  actions: CustomProviderConfigActions;
  list: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  hasCredential: ReturnType<typeof vi.fn>;
} {
  const list = vi.fn().mockResolvedValue(initial);
  const save = vi
    .fn()
    .mockResolvedValue({ success: true, definition: EXISTING });
  const remove = vi.fn().mockResolvedValue(undefined);
  const hasCredential = vi.fn().mockResolvedValue(false);
  return {
    actions: { list, save, remove, hasCredential },
    list,
    save,
    remove,
    hasCredential,
  };
}

describe('PlumbCustomProviderManagerScreen', { timeout: 30000 }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists existing custom providers plus Add/Back entries', async () => {
    const { actions } = makeMockActions([EXISTING]);
    const { lastFrame } = await renderReady({
      actions,
      onClose: vi.fn(),
    });
    const frame = lastFrame();
    expect(frame).toContain('Custom Providers');
    expect(frame).toContain('Private Gateway');
    expect(frame).toContain('openai-completions');
    expect(frame).toContain('+ Add custom provider');
    expect(frame).toContain('Back');
  });

  it('Escape from the list calls onClose', async () => {
    const { actions } = makeMockActions([]);
    const onClose = vi.fn();
    const { stdin } = await renderReady({ actions, onClose });
    await pressKey(stdin, ESCAPE);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('creates a new custom provider through the full field sequence', async () => {
    const { actions, save } = makeMockActions([]);
    const { stdin, waitUntilReady } = await renderReady({
      actions,
      onClose: vi.fn(),
    });

    // "+ Add custom provider" is the only entry when the list is empty.
    await pressKey(stdin, ENTER);
    await waitUntilReady();

    // Name field
    await pressKey(stdin, ENTER);
    await typeText(stdin, 'My Proxy');
    await pressKey(stdin, ENTER);
    await waitUntilReady();

    // Dialect select — accept the default (openai-completions) highlighted first.
    await pressKey(stdin, ENTER);
    await waitUntilReady();

    // Base URL
    await pressKey(stdin, ENTER);
    await typeText(stdin, 'https://proxy.example.test/v1');
    await pressKey(stdin, ENTER);
    await waitUntilReady();

    // Credential placement select — accept default (bearer, first option for openai dialect after 'none').
    await pressKey(stdin, DOWN_ARROW);
    await pressKey(stdin, ENTER);
    await waitUntilReady();

    // API key
    await pressKey(stdin, ENTER);
    await typeText(stdin, 'my-secret-key');
    await pressKey(stdin, ENTER);
    await waitUntilReady();

    // Safe headers — leave blank
    await pressKey(stdin, ENTER);
    await pressKey(stdin, ENTER);
    await waitUntilReady();

    // Manual models
    await pressKey(stdin, ENTER);
    await typeText(stdin, 'model-a');
    await pressKey(stdin, ENTER);
    await waitUntilReady();

    // Save
    await pressKey(stdin, ENTER);
    await waitUntilReady();

    expect(save).toHaveBeenCalledTimes(1);
    const [input, apiKey] = save.mock.calls[0] as [
      Record<string, unknown>,
      string | undefined,
    ];
    expect(input['displayName']).toBe('My Proxy');
    expect(input['dialect']).toBe('openai-completions');
    expect(input['baseUrl']).toBe('https://proxy.example.test/v1');
    expect(input['manualModels']).toEqual([{ id: 'model-a' }]);
    expect(apiKey).toBe('my-secret-key');
  });

  it('editing an existing entry preloads its fields and preserves its ID on save', async () => {
    const { actions, save } = makeMockActions([EXISTING]);
    const { stdin, lastFrame, waitUntilReady } = await renderReady({
      actions,
      onClose: vi.fn(),
    });

    await pressKey(stdin, ENTER); // open the existing entry for edit
    await waitUntilReady();

    expect(lastFrame()).toContain('Edit custom provider');
    expect(lastFrame()).toContain('Private Gateway');
    expect(lastFrame()).toContain('X-Tenant: acme');
    expect(lastFrame()).toContain('private-model');

    // Navigate to Save without changing any field. The dialect and
    // credential-placement rows are RadioButtonSelects that consume
    // up/down themselves, so Enter (accept current highlight) advances
    // focus past them instead of another Down press.
    await pressKey(stdin, DOWN_ARROW); // displayName -> dialect
    await pressKey(stdin, ENTER); // accept dialect -> baseUrl
    await waitUntilReady();
    await pressKey(stdin, DOWN_ARROW); // baseUrl -> credentialPlacement
    await pressKey(stdin, ENTER); // accept credential placement -> apiKey
    await waitUntilReady();
    await pressKey(stdin, DOWN_ARROW); // apiKey -> safeHeaders
    await pressKey(stdin, DOWN_ARROW); // safeHeaders -> manualModels
    await pressKey(stdin, DOWN_ARROW); // manualModels -> save
    await pressKey(stdin, ENTER);
    await waitUntilReady();

    expect(save).toHaveBeenCalledTimes(1);
    const [input] = save.mock.calls[0] as [Record<string, unknown>];
    expect(input['id']).toBe(EXISTING.id);
    expect(input['displayName']).toBe('Private Gateway');
  });

  it('pressing d on a listed entry deletes it without opening the form', async () => {
    const { actions, remove } = makeMockActions([EXISTING]);
    const { stdin, lastFrame, waitUntilReady } = await renderReady({
      actions,
      onClose: vi.fn(),
    });

    await pressKey(stdin, 'd');
    await waitUntilReady();

    expect(remove).toHaveBeenCalledWith(EXISTING.id);
    expect(lastFrame()).toContain('Removed.');
  });

  it('shows a save error and stays on the form instead of closing', async () => {
    const { actions, save } = makeMockActions([]);
    save.mockResolvedValue({
      success: false,
      error: 'Name is required.',
      fieldErrors: { displayName: 'Name is required.' },
    });
    const { stdin, lastFrame, waitUntilReady } = await renderReady({
      actions,
      onClose: vi.fn(),
    });

    await pressKey(stdin, ENTER); // Add custom provider
    await waitUntilReady();
    // Jump straight to Save with an empty name.
    await pressKey(stdin, DOWN_ARROW); // displayName -> dialect
    await pressKey(stdin, ENTER); // accept dialect -> baseUrl
    await waitUntilReady();
    await pressKey(stdin, DOWN_ARROW); // baseUrl -> credentialPlacement
    await pressKey(stdin, ENTER); // accept credential placement -> apiKey
    await waitUntilReady();
    await pressKey(stdin, DOWN_ARROW); // apiKey -> safeHeaders
    await pressKey(stdin, DOWN_ARROW); // safeHeaders -> manualModels
    await pressKey(stdin, DOWN_ARROW); // manualModels -> save
    await pressKey(stdin, ENTER);
    await waitUntilReady();

    expect(lastFrame()).toContain('Name is required.');
    expect(lastFrame()).toContain('Add custom provider');
  });
});
