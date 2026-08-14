/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { renderWithProviders } from '../../test-utils/render.js';
import { createMockSettings } from '../../test-utils/settings.js';
import { PlumbModelDialog } from './PlumbModelDialog.js';
import type { Config } from '@plumb/core';
import type {
  PlumbModel,
  PlumbProvider,
  PlumbProviderState,
} from '@plumb/provider';
import { PlumbProviderCategory } from '@plumb/provider';

const KEY_ENTER = String.fromCharCode(0x0d);
const KEY_ESCAPE = String.fromCharCode(0x1b);
const KEY_DOWN_ARROW = String.fromCharCode(0x1b) + '[B';

async function pressKey(stdin: { write: (data: string) => void }, key: string) {
  await act(async () => {
    stdin.write(key);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

/**
 * Unlike the other PLUMB dialogs, PlumbModelDialog kicks off a dynamic
 * import (via useModelDialogData) directly in a mount-time effect, so its
 * first state update can resolve outside any act() scope renderWithProviders
 * itself opens. Wrapping the whole render+ready sequence in one outer act()
 * keeps React's effect flushing (and that update) inside a single act scope.
 */
async function renderDialog(
  element: Parameters<typeof renderWithProviders>[0],
  options: Parameters<typeof renderWithProviders>[1],
) {
  // The dialog's data hook resolves a dynamic import on mount. That
  // continuation can land outside any act() scope renderWithProviders opens
  // on its own, so the mount call and a real-clock wait for the import both
  // stay inside one act() here — closing the act scope only once the
  // pending update has had time to land.
  let result!: Awaited<ReturnType<typeof renderWithProviders>>;
  await act(async () => {
    result = await renderWithProviders(element, options);
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
  await result.waitUntilReady();
  return result;
}

function makeModel(id: string, provider: string, name?: string): PlumbModel {
  return {
    id,
    provider,
    name: name ?? id,
    api: 'anthropic-messages' as PlumbModel['api'],
    contextWindow: 128_000,
    maxTokens: 8_192,
    reasoning: false,
    input: 'text',
  };
}

const copilotProvider: PlumbProvider = {
  id: 'github-copilot',
  name: 'GitHub Copilot',
  category: PlumbProviderCategory.CODING_PLAN,
  description: 'Coding plan',
  authMethods: [{ type: 'oauth' }],
  allowUnauthenticated: false,
  available: true,
};

const nvidiaProvider: PlumbProvider = {
  id: 'nvidia',
  name: 'NVIDIA',
  category: PlumbProviderCategory.API_KEY,
  description: 'NVIDIA NIM',
  authMethods: [{ type: 'api_key' }],
  allowUnauthenticated: false,
  available: true,
};

const ollamaProvider: PlumbProvider = {
  id: 'ollama',
  name: 'Ollama',
  category: PlumbProviderCategory.LOCAL,
  description: 'Local models',
  authMethods: [],
  allowUnauthenticated: true,
  available: true,
};

const copilotModels = [
  makeModel('gemini-3.5-flash', 'github-copilot'),
  makeModel('claude-sonnet-4.6', 'github-copilot'),
];
const nvidiaModels = [makeModel('meta/llama-3.1-70b', 'nvidia')];
const ollamaModels = [makeModel('qwen2.5-coder', 'ollama')];

let activeStates: PlumbProviderState[];
let getPlumbProviderMock: () => string | null;
let setModelMock: ReturnType<typeof vi.fn>;
let setPlumbProviderMock: ReturnType<typeof vi.fn>;
let refreshAuthMock: ReturnType<typeof vi.fn>;

vi.mock('@plumb/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@plumb/provider')>();
  return {
    ...actual,
    getPlumbProviderRegistry: () => ({
      getActiveProviderStates: () => activeStates,
    }),
    getPlumbModelRegistry: () => ({
      getModelsForProvider: (providerId: string) => {
        if (providerId === 'github-copilot') return copilotModels;
        if (providerId === 'nvidia') return nvidiaModels;
        if (providerId === 'ollama') return ollamaModels;
        return [];
      },
    }),
  };
});

function buildConfig(): Partial<Config> {
  return {
    getPlumbProvider: getPlumbProviderMock,
    setModel: setModelMock,
    setPlumbProvider: setPlumbProviderMock,
    refreshAuth: refreshAuthMock,
    getSessionId: () => 'test-session-id',
    getIdeMode: () => false,
  };
}

describe('PlumbModelDialog', { timeout: 30000 }, () => {
  beforeEach(() => {
    activeStates = [
      {
        provider: copilotProvider,
        authState: 'authenticated',
        credentials: null,
      },
      {
        provider: nvidiaProvider,
        authState: 'authenticated',
        credentials: null,
      },
    ];
    getPlumbProviderMock = () => 'github-copilot';
    setModelMock = vi.fn();
    setPlumbProviderMock = vi.fn();
    refreshAuthMock = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('lists only connected providers, with real model counts — no Gemini-only hardcoded arrays', async () => {
    const { lastFrame } = await renderDialog(
      <PlumbModelDialog onClose={vi.fn()} />,
      { config: buildConfig() as Config, settings: createMockSettings() },
    );

    const frame = lastFrame();
    expect(frame).toContain('Auto');
    expect(frame).toContain('GitHub Copilot');
    expect(frame).toContain('2 models');
    expect(frame).toContain('NVIDIA');
    expect(frame).toContain('1 model');
    // The legacy Gemini-only manual model ids never appear — this dialog's
    // model source is exclusively the mocked registry data above.
    expect(frame).not.toContain('gemini-2.5-pro');
    expect(frame).not.toContain('gemma-4-31b-it');
  });

  it('does not show an unconfigured/unauthenticated provider', async () => {
    activeStates = [
      {
        provider: copilotProvider,
        authState: 'authenticated',
        credentials: null,
      },
    ];
    const { lastFrame } = await renderDialog(
      <PlumbModelDialog onClose={vi.fn()} />,
      { config: buildConfig() as Config, settings: createMockSettings() },
    );

    expect(lastFrame()).not.toContain('NVIDIA');
  });

  it('selecting a provider opens its model catalog via SearchableModelPicker', async () => {
    const { stdin, lastFrame, waitUntilReady } = await renderDialog(
      <PlumbModelDialog onClose={vi.fn()} />,
      { config: buildConfig() as Config, settings: createMockSettings() },
    );

    // Auto (0), GitHub Copilot (1)
    await pressKey(stdin, KEY_DOWN_ARROW);
    await pressKey(stdin, KEY_ENTER);
    await waitUntilReady();

    const frame = lastFrame();
    expect(frame).toContain('GitHub Copilot — 2 models');
    expect(frame).toContain('gemini-3.5-flash');
    expect(frame).toContain('claude-sonnet-4.6');
  });

  it('selecting a model updates provider and model atomically and switches provider when changed', async () => {
    const onClose = vi.fn();
    const { stdin, waitUntilReady } = await renderDialog(
      <PlumbModelDialog onClose={onClose} />,
      { config: buildConfig() as Config, settings: createMockSettings() },
    );

    // Auto (0), GitHub Copilot (1), NVIDIA (2) → select NVIDIA
    await pressKey(stdin, KEY_DOWN_ARROW);
    await pressKey(stdin, KEY_DOWN_ARROW);
    await pressKey(stdin, KEY_ENTER);
    await waitUntilReady();

    // NVIDIA has one model — Enter selects it immediately.
    await pressKey(stdin, KEY_ENTER);
    await waitUntilReady();

    expect(setPlumbProviderMock).toHaveBeenCalledWith('nvidia');
    expect(setModelMock).toHaveBeenCalledWith('meta/llama-3.1-70b', true);
    expect(refreshAuthMock).toHaveBeenCalled();
  });

  it('Esc from the model drilldown returns to the provider list', async () => {
    const { stdin, lastFrame, waitUntilReady } = await renderDialog(
      <PlumbModelDialog onClose={vi.fn()} />,
      { config: buildConfig() as Config, settings: createMockSettings() },
    );

    await pressKey(stdin, KEY_DOWN_ARROW);
    await pressKey(stdin, KEY_ENTER);
    await waitUntilReady();
    expect(lastFrame()).toContain('GitHub Copilot — 2 models');

    await pressKey(stdin, KEY_ESCAPE);
    await waitUntilReady();
    expect(lastFrame()).toContain('Select Model');
    expect(lastFrame()).not.toContain('GitHub Copilot — 2 models');
  });

  it('Auto never selects a model from an unconfigured provider — only from the usable list', async () => {
    activeStates = [
      {
        provider: nvidiaProvider,
        authState: 'authenticated',
        credentials: null,
      },
    ];
    getPlumbProviderMock = () => null;
    const { stdin, waitUntilReady } = await renderDialog(
      <PlumbModelDialog onClose={vi.fn()} />,
      { config: buildConfig() as Config, settings: createMockSettings() },
    );

    // Auto (0) is the only usable-provider-driven choice; select it.
    await pressKey(stdin, KEY_ENTER);
    await waitUntilReady();

    expect(setPlumbProviderMock).toHaveBeenCalledWith('nvidia');
    expect(setModelMock).toHaveBeenCalledWith('meta/llama-3.1-70b', true);
  });

  it('Auto shows an error instead of applying anything when no providers are usable', async () => {
    activeStates = [];
    const { stdin, lastFrame, waitUntilReady } = await renderDialog(
      <PlumbModelDialog onClose={vi.fn()} />,
      { config: buildConfig() as Config, settings: createMockSettings() },
    );

    await pressKey(stdin, KEY_ENTER);
    await waitUntilReady();

    expect(lastFrame()).toContain('No connected providers');
    expect(setModelMock).not.toHaveBeenCalled();
    expect(refreshAuthMock).not.toHaveBeenCalled();
  });

  it('integration: three connected providers, drill into one, switch to another — no auth prompts appear', async () => {
    activeStates = [
      {
        provider: copilotProvider,
        authState: 'authenticated',
        credentials: null,
      },
      {
        provider: nvidiaProvider,
        authState: 'authenticated',
        credentials: null,
      },
      {
        provider: ollamaProvider,
        authState: 'authenticated',
        credentials: null,
      },
    ];

    const { stdin, lastFrame, waitUntilReady } = await renderDialog(
      <PlumbModelDialog onClose={vi.fn()} />,
      { config: buildConfig() as Config, settings: createMockSettings() },
    );

    // All three provider groups are listed alongside Auto — none hidden,
    // none hallucinated.
    const providerListFrame = lastFrame();
    expect(providerListFrame).toContain('Auto');
    expect(providerListFrame).toContain('GitHub Copilot');
    expect(providerListFrame).toContain('NVIDIA');
    expect(providerListFrame).toContain('Ollama');
    expect(providerListFrame).not.toContain('Press Enter to get a device code');
    expect(providerListFrame).not.toContain('Sign in');

    // Auto (0), GitHub Copilot (1) — open its catalog.
    await pressKey(stdin, KEY_DOWN_ARROW);
    await pressKey(stdin, KEY_ENTER);
    await waitUntilReady();
    expect(lastFrame()).toContain('GitHub Copilot — 2 models');

    // Pick claude-sonnet-4.6 (second row).
    await pressKey(stdin, KEY_DOWN_ARROW);
    await pressKey(stdin, KEY_ENTER);
    await waitUntilReady();

    expect(setPlumbProviderMock).toHaveBeenCalledWith('github-copilot');
    expect(setModelMock).toHaveBeenCalledWith('claude-sonnet-4.6', true);
    expect(refreshAuthMock).toHaveBeenCalledTimes(1);

    // Re-open for the second switch, as the real /model flow would after
    // the dialog closes and is reopened.
    setPlumbProviderMock.mockClear();
    setModelMock.mockClear();
    refreshAuthMock.mockClear();

    const second = await renderDialog(<PlumbModelDialog onClose={vi.fn()} />, {
      config: buildConfig() as Config,
      settings: createMockSettings(),
    });

    // Auto (0), GitHub Copilot (1), NVIDIA (2) — switch providers entirely.
    await pressKey(second.stdin, KEY_DOWN_ARROW);
    await pressKey(second.stdin, KEY_DOWN_ARROW);
    await pressKey(second.stdin, KEY_ENTER);
    await second.waitUntilReady();
    await pressKey(second.stdin, KEY_ENTER);
    await second.waitUntilReady();

    expect(setPlumbProviderMock).toHaveBeenCalledWith('nvidia');
    expect(setModelMock).toHaveBeenCalledWith('meta/llama-3.1-70b', true);
    // Provider changed alongside the model — never left on the prior
    // provider with a new provider's model (Phase 8's core invariant).
    expect(setPlumbProviderMock).not.toHaveBeenCalledWith('github-copilot');
  });
});
