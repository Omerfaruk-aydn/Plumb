/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { renderWithProviders } from '../../test-utils/render.js';
import { PlumbProviderSetupDialog } from './PlumbProviderSetupDialog.js';
import {
  PlumbProviderCategory,
  getPlumbProviderRegistry,
  resetPlumbProviderRegistry,
  registerPlumbCredentialStoreFactory,
  resetPlumbCredentialStore,
} from '@google/gemini-cli-provider';
import type {
  PlumbProvider,
  PlumbCredential,
  IPlumbCredentialStore,
} from '@google/gemini-cli-provider';

enum TerminalKeys {
  ENTER = '\u000D',
  UP_ARROW = '\u001B[A',
  DOWN_ARROW = '\u001B[B',
  ESCAPE = '\u001B',
  BACKSPACE = '\u007F',
}

const mockProviders: PlumbProvider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    category: PlumbProviderCategory.API_KEY,
    description: 'GPT models',
    authMethods: [{ type: 'api_key' }],
    allowUnauthenticated: false,
    envVars: ['OPENAI_API_KEY'],
    available: true,
  },
  {
    id: 'ollama',
    name: 'Ollama',
    category: PlumbProviderCategory.LOCAL,
    description: 'Local models',
    authMethods: [],
    allowUnauthenticated: true,
    available: true,
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    category: PlumbProviderCategory.CODING_PLAN,
    description: 'Coding plan',
    authMethods: [{ type: 'oauth' }],
    allowUnauthenticated: false,
    available: true,
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    category: PlumbProviderCategory.OAUTH_ACCOUNT,
    description: 'Claude models',
    authMethods: [{ type: 'oauth' }],
    allowUnauthenticated: false,
    available: true,
  },
  {
    id: 'custom',
    name: 'Custom API',
    category: PlumbProviderCategory.CUSTOM_ENDPOINT,
    description: 'Custom endpoint',
    authMethods: [{ type: 'api_key' }],
    allowUnauthenticated: false,
    available: true,
  },
];

const mockCategoryGroups = new Map([
  [
    'coding-plan',
    mockProviders.filter(
      (p) => p.category === PlumbProviderCategory.CODING_PLAN,
    ),
  ],
  [
    'oauth',
    mockProviders.filter(
      (p) => p.category === PlumbProviderCategory.OAUTH_ACCOUNT,
    ),
  ],
  [
    'api-key',
    mockProviders.filter((p) => p.category === PlumbProviderCategory.API_KEY),
  ],
  [
    'local',
    mockProviders.filter((p) => p.category === PlumbProviderCategory.LOCAL),
  ],
  [
    'custom-endpoint',
    mockProviders.filter(
      (p) => p.category === PlumbProviderCategory.CUSTOM_ENDPOINT,
    ),
  ],
]);

const mockModels = [
  { id: 'gpt-4', name: 'GPT-4', provider: 'openai' },
  { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', provider: 'openai' },
  { id: 'llama3', name: 'Llama 3', provider: 'ollama' },
];

async function pressKey(stdin: { write: (data: string) => void }, key: string) {
  await act(async () => {
    vi.advanceTimersByTime(100);
    stdin.write(key);
  });
}

describe('PlumbProviderSetupDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('1. renders connection type picker initially', async () => {
    const { lastFrame } = await renderWithProviders(
      <PlumbProviderSetupDialog
        onComplete={vi.fn()}
        onCancel={vi.fn()}
        providers={mockProviders}
        categoryGroups={mockCategoryGroups}
        models={mockModels}
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain('PLUMB Provider Setup');
    expect(frame).toContain('Coding Plan / Subscription');
    expect(frame).toContain('API Key Provider');
    expect(frame).toContain('Local / Keyless Model');
  });

  it('2. Enter selects the first category (Coding Plan)', async () => {
    const { stdin, lastFrame, waitUntilReady } = await renderWithProviders(
      <PlumbProviderSetupDialog
        onComplete={vi.fn()}
        onCancel={vi.fn()}
        providers={mockProviders}
        categoryGroups={mockCategoryGroups}
        models={mockModels}
      />,
    );

    await waitUntilReady();
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();

    const frame = lastFrame();
    expect(frame).toContain('Step 2');
    expect(frame).toContain('Choose provider');
  });

  it('3. Down arrow changes highlighted row', async () => {
    const { stdin, lastFrame, waitUntilReady } = await renderWithProviders(
      <PlumbProviderSetupDialog
        onComplete={vi.fn()}
        onCancel={vi.fn()}
        providers={mockProviders}
        categoryGroups={mockCategoryGroups}
        models={mockModels}
      />,
    );

    await waitUntilReady();
    await pressKey(stdin, TerminalKeys.DOWN_ARROW);
    await waitUntilReady();

    const frame = lastFrame();
    expect(frame).toContain('OAuth Account');
  });

  it('4. Enter selects OAuth provider category', async () => {
    const { stdin, lastFrame, waitUntilReady } = await renderWithProviders(
      <PlumbProviderSetupDialog
        onComplete={vi.fn()}
        onCancel={vi.fn()}
        providers={mockProviders}
        categoryGroups={mockCategoryGroups}
        models={mockModels}
      />,
    );

    await waitUntilReady();
    await pressKey(stdin, TerminalKeys.DOWN_ARROW);
    await waitUntilReady();
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();

    const frame = lastFrame();
    expect(frame).toContain('Step 2');
  });

  it('5. Enter selects API Key provider category', async () => {
    const { stdin, lastFrame, waitUntilReady } = await renderWithProviders(
      <PlumbProviderSetupDialog
        onComplete={vi.fn()}
        onCancel={vi.fn()}
        providers={mockProviders}
        categoryGroups={mockCategoryGroups}
        models={mockModels}
      />,
    );

    await waitUntilReady();
    await pressKey(stdin, TerminalKeys.DOWN_ARROW);
    await pressKey(stdin, TerminalKeys.DOWN_ARROW);
    await waitUntilReady();
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();

    const frame = lastFrame();
    expect(frame).toContain('Step 2');
  });

  it('6. Enter selects Local model category and auto-skips auth on provider select', async () => {
    const { stdin, lastFrame, waitUntilReady } = await renderWithProviders(
      <PlumbProviderSetupDialog
        onComplete={vi.fn()}
        onCancel={vi.fn()}
        providers={mockProviders}
        categoryGroups={mockCategoryGroups}
        models={mockModels}
      />,
    );

    await waitUntilReady();
    // Navigate to Local category (index 3)
    await pressKey(stdin, TerminalKeys.DOWN_ARROW);
    await pressKey(stdin, TerminalKeys.DOWN_ARROW);
    await pressKey(stdin, TerminalKeys.DOWN_ARROW);
    await waitUntilReady();
    // Select Local category → provider-select step
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();

    // Should show provider-select with Ollama
    const frame1 = lastFrame();
    expect(frame1).toContain('Ollama');

    // Select Ollama provider → should auto-skip to model-select
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();

    const frame2 = lastFrame();
    expect(frame2).toContain('Step 4');
    expect(frame2).toContain('Llama 3');
  });

  it('7. Enter selects Custom Endpoint category', async () => {
    const { stdin, lastFrame, waitUntilReady } = await renderWithProviders(
      <PlumbProviderSetupDialog
        onComplete={vi.fn()}
        onCancel={vi.fn()}
        providers={mockProviders}
        categoryGroups={mockCategoryGroups}
        models={mockModels}
      />,
    );

    await waitUntilReady();
    // Navigate to Custom Endpoint (index 4)
    await pressKey(stdin, TerminalKeys.DOWN_ARROW);
    await pressKey(stdin, TerminalKeys.DOWN_ARROW);
    await pressKey(stdin, TerminalKeys.DOWN_ARROW);
    await pressKey(stdin, TerminalKeys.DOWN_ARROW);
    await waitUntilReady();
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();

    const frame = lastFrame();
    expect(frame).toContain('Step 2');
  });

  it('8. Escape cancels the dialog', async () => {
    const onCancel = vi.fn();
    const { stdin, waitUntilReady } = await renderWithProviders(
      <PlumbProviderSetupDialog
        onComplete={vi.fn()}
        onCancel={onCancel}
        providers={mockProviders}
        categoryGroups={mockCategoryGroups}
        models={mockModels}
      />,
    );

    await waitUntilReady();
    await pressKey(stdin, TerminalKeys.ESCAPE);
    await waitUntilReady();

    expect(onCancel).toHaveBeenCalled();
  });

  it('9. Backspace returns to previous step', async () => {
    const { stdin, lastFrame, waitUntilReady } = await renderWithProviders(
      <PlumbProviderSetupDialog
        onComplete={vi.fn()}
        onCancel={vi.fn()}
        providers={mockProviders}
        categoryGroups={mockCategoryGroups}
        models={mockModels}
      />,
    );

    await waitUntilReady();
    // Go to step 2
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();
    expect(lastFrame()).toContain('Step 2');

    // Go back to step 1
    await pressKey(stdin, TerminalKeys.BACKSPACE);
    await waitUntilReady();
    expect(lastFrame()).toContain('PLUMB Provider Setup');
    expect(lastFrame()).not.toContain('Step 2');
  });

  it('10. footer shows navigation hints', async () => {
    const { lastFrame } = await renderWithProviders(
      <PlumbProviderSetupDialog
        onComplete={vi.fn()}
        onCancel={vi.fn()}
        providers={mockProviders}
        categoryGroups={mockCategoryGroups}
        models={mockModels}
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain('ESC to cancel');
    expect(frame).toContain('Enter to select');
  });

  it('11. NVIDIA API-key path never enters oauth-waiting', async () => {
    const nvidia: PlumbProvider = {
      id: 'nvidia',
      name: 'NVIDIA',
      category: PlumbProviderCategory.API_KEY,
      description: 'NVIDIA NIM',
      authMethods: [{ type: 'api_key', envVar: 'NVIDIA_API_KEY' }],
      allowUnauthenticated: false,
      available: true,
      envVars: ['NVIDIA_API_KEY'],
    };
    const providers = [...mockProviders, nvidia];
    const groups = new Map(mockCategoryGroups);
    groups.set(
      'api-key',
      providers.filter((p) => p.category === PlumbProviderCategory.API_KEY),
    );
    const models = [
      ...mockModels,
      {
        id: 'nvidia/llama-3.1-nemotron-70b-instruct',
        name: 'Nemotron',
        provider: 'nvidia',
      },
    ];
    const onComplete = vi.fn();
    const onOAuthLogin = vi.fn().mockResolvedValue({ success: true });

    const { stdin, lastFrame, waitUntilReady } = await renderWithProviders(
      <PlumbProviderSetupDialog
        onComplete={onComplete}
        onCancel={vi.fn()}
        providers={providers}
        categoryGroups={groups}
        models={models}
        onOAuthLogin={onOAuthLogin}
      />,
    );

    await waitUntilReady();
    // API Key Provider category (index 2)
    await pressKey(stdin, TerminalKeys.DOWN_ARROW);
    await pressKey(stdin, TerminalKeys.DOWN_ARROW);
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();

    // Select NVIDIA (second api-key after openai)
    await pressKey(stdin, TerminalKeys.DOWN_ARROW);
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();

    expect(lastFrame()).toContain('Authenticate');
    expect(lastFrame()).not.toContain('Waiting for authorization');

    // Type API key and submit
    for (const ch of 'nvapi-test-key') {
      await pressKey(stdin, ch);
    }
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();

    expect(lastFrame()).not.toContain('Waiting for authorization');
    expect(lastFrame()).not.toContain('oauth-waiting');
    expect(onOAuthLogin).not.toHaveBeenCalled();
    // Model picker should be visible
    expect(lastFrame()).toMatch(/Nemotron|Choose model|Step 4/);
  });

  it('12. Esc at connection-type root cancels without legacy auth text', async () => {
    const onCancel = vi.fn();
    const { stdin, lastFrame, waitUntilReady } = await renderWithProviders(
      <PlumbProviderSetupDialog
        onComplete={vi.fn()}
        onCancel={onCancel}
        providers={mockProviders}
        categoryGroups={mockCategoryGroups}
        models={mockModels}
      />,
    );

    await waitUntilReady();
    expect(lastFrame()).toContain('PLUMB Provider Setup');
    expect(lastFrame()).not.toContain('Get started');
    expect(lastFrame()).not.toContain('Sign in with Google');
    expect(lastFrame()).not.toContain('geminicli.com');

    await pressKey(stdin, TerminalKeys.ESCAPE);
    await waitUntilReady();
    expect(onCancel).toHaveBeenCalled();
  });

  it('13. confirm step Enter fires onComplete exactly once', async () => {
    const nvidia: PlumbProvider = {
      id: 'nvidia',
      name: 'NVIDIA',
      category: PlumbProviderCategory.API_KEY,
      description: 'NVIDIA NIM',
      authMethods: [{ type: 'api_key', envVar: 'NVIDIA_API_KEY' }],
      allowUnauthenticated: false,
      available: true,
      envVars: ['NVIDIA_API_KEY'],
    };
    const providers = [...mockProviders, nvidia];
    const groups = new Map(mockCategoryGroups);
    groups.set(
      'api-key',
      providers.filter((p) => p.category === PlumbProviderCategory.API_KEY),
    );
    const models = [
      ...mockModels,
      {
        id: 'nvidia/llama-3.1-nemotron-70b-instruct',
        name: 'Nemotron',
        provider: 'nvidia',
      },
    ];
    const onComplete = vi.fn();

    const { stdin, lastFrame, waitUntilReady } = await renderWithProviders(
      <PlumbProviderSetupDialog
        onComplete={onComplete}
        onCancel={vi.fn()}
        providers={providers}
        categoryGroups={groups}
        models={models}
      />,
    );

    await waitUntilReady();
    // API Key Provider category (index 2)
    await pressKey(stdin, TerminalKeys.DOWN_ARROW);
    await pressKey(stdin, TerminalKeys.DOWN_ARROW);
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();

    // Select NVIDIA
    await pressKey(stdin, TerminalKeys.DOWN_ARROW);
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();

    // Type API key and submit
    for (const ch of 'nvapi-test-key') {
      await pressKey(stdin, ch);
    }
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();

    // Select first model
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();

    // Confirm step should be visible
    expect(lastFrame()).toContain('Confirm setup');
    expect(lastFrame()).toContain('NVIDIA');
    expect(lastFrame()).toContain('Step 5');

    // Press Enter to confirm
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith({
      kind: 'api-credential',
      providerId: 'nvidia',
      modelId: expect.any(String),
      apiKey: 'nvapi-test-key',
    });
  });

  it('14. confirm step repeated Enter does not double-submit', async () => {
    const ollama: PlumbProvider = {
      id: 'ollama',
      name: 'Ollama',
      category: PlumbProviderCategory.LOCAL,
      description: 'Local models',
      authMethods: [],
      allowUnauthenticated: true,
      available: true,
    };
    const providers = [ollama];
    const groups = new Map(mockCategoryGroups);
    groups.set('local', [ollama]);
    const models = [{ id: 'llama3', name: 'Llama 3', provider: 'ollama' }];
    const onComplete = vi.fn();

    const { stdin, lastFrame, waitUntilReady } = await renderWithProviders(
      <PlumbProviderSetupDialog
        onComplete={onComplete}
        onCancel={vi.fn()}
        providers={providers}
        categoryGroups={groups}
        models={models}
      />,
    );

    await waitUntilReady();
    // Local category (index 3)
    await pressKey(stdin, TerminalKeys.DOWN_ARROW);
    await pressKey(stdin, TerminalKeys.DOWN_ARROW);
    await pressKey(stdin, TerminalKeys.DOWN_ARROW);
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();

    // Select Ollama
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();

    // Select model
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();

    expect(lastFrame()).toContain('Confirm setup');

    // Press Enter multiple times rapidly
    await pressKey(stdin, TerminalKeys.ENTER);
    await pressKey(stdin, TerminalKeys.ENTER);
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('15. Escape at confirm step returns to model selection', async () => {
    const nvidia: PlumbProvider = {
      id: 'nvidia',
      name: 'NVIDIA',
      category: PlumbProviderCategory.API_KEY,
      description: 'NVIDIA NIM',
      authMethods: [{ type: 'api_key', envVar: 'NVIDIA_API_KEY' }],
      allowUnauthenticated: false,
      available: true,
      envVars: ['NVIDIA_API_KEY'],
    };
    const providers = [nvidia];
    const groups = new Map<string, PlumbProvider[]>();
    groups.set('api-key', [nvidia]);
    const models = [
      {
        id: 'nvidia/llama-3.1-nemotron-70b-instruct',
        name: 'Nemotron',
        provider: 'nvidia',
      },
    ];

    const { stdin, lastFrame, waitUntilReady } = await renderWithProviders(
      <PlumbProviderSetupDialog
        onComplete={vi.fn()}
        onCancel={vi.fn()}
        providers={providers}
        categoryGroups={groups}
        models={models}
      />,
    );

    await waitUntilReady();
    // API Key Provider category (index 2)
    await pressKey(stdin, TerminalKeys.DOWN_ARROW);
    await pressKey(stdin, TerminalKeys.DOWN_ARROW);
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();

    // Select NVIDIA
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();

    // Type API key and submit
    for (const ch of 'test') {
      await pressKey(stdin, ch);
    }
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();

    // Select first model -> confirm step
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();

    expect(lastFrame()).toContain('Confirm setup');

    // Backspace returns to model selection
    await pressKey(stdin, TerminalKeys.BACKSPACE);
    await waitUntilReady();

    expect(lastFrame()).toContain('Step 4');
    expect(lastFrame()).not.toContain('Confirm setup');
  });

  it('16. NVIDIA API-key full flow reaches confirm and completes', async () => {
    const nvidia: PlumbProvider = {
      id: 'nvidia',
      name: 'NVIDIA',
      category: PlumbProviderCategory.API_KEY,
      description: 'NVIDIA NIM',
      authMethods: [{ type: 'api_key', envVar: 'NVIDIA_API_KEY' }],
      allowUnauthenticated: false,
      available: true,
      envVars: ['NVIDIA_API_KEY'],
    };
    const providers = [nvidia];
    const groups = new Map<string, PlumbProvider[]>();
    groups.set('api-key', [nvidia]);
    const models = [
      {
        id: 'nvidia/llama-3.1-nemotron-70b-instruct',
        name: 'Nemotron',
        provider: 'nvidia',
      },
    ];
    const onComplete = vi.fn();
    const onOAuthLogin = vi.fn();

    const { stdin, lastFrame, waitUntilReady } = await renderWithProviders(
      <PlumbProviderSetupDialog
        onComplete={onComplete}
        onCancel={vi.fn()}
        providers={providers}
        categoryGroups={groups}
        models={models}
        onOAuthLogin={onOAuthLogin}
      />,
    );

    await waitUntilReady();
    // API Key Provider category (index 2)
    await pressKey(stdin, TerminalKeys.DOWN_ARROW);
    await pressKey(stdin, TerminalKeys.DOWN_ARROW);
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();

    // Select NVIDIA
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();

    expect(lastFrame()).toContain('Authenticate');
    expect(lastFrame()).not.toContain('Waiting for authorization');
    expect(onOAuthLogin).not.toHaveBeenCalled();

    // Type API key and submit
    for (const ch of 'nvapi-test') {
      await pressKey(stdin, ch);
    }
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();

    // Model picker
    expect(lastFrame()).toContain('Step 4');

    // Select model
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();

    // Confirm step
    expect(lastFrame()).toContain('Confirm setup');
    expect(lastFrame()).toContain('NVIDIA');
    expect(lastFrame()).toContain('Step 5');

    // Confirm
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith({
      kind: 'api-credential',
      providerId: 'nvidia',
      modelId: expect.any(String),
      apiKey: 'nvapi-test',
    });
    expect(onOAuthLogin).not.toHaveBeenCalled();
  });

  it('17. confirm step shows error from onComplete', async () => {
    const ollama: PlumbProvider = {
      id: 'ollama',
      name: 'Ollama',
      category: PlumbProviderCategory.LOCAL,
      description: 'Local models',
      authMethods: [],
      allowUnauthenticated: true,
      available: true,
    };
    const providers = [ollama];
    const groups = new Map(mockCategoryGroups);
    groups.set('local', [ollama]);
    const models = [{ id: 'llama3', name: 'Llama 3', provider: 'ollama' }];
    const onComplete = vi.fn().mockImplementation(() => {
      throw new Error('Provider initialization failed');
    });

    const { stdin, lastFrame, waitUntilReady } = await renderWithProviders(
      <PlumbProviderSetupDialog
        onComplete={onComplete}
        onCancel={vi.fn()}
        providers={providers}
        categoryGroups={groups}
        models={models}
      />,
    );

    await waitUntilReady();
    // Local category (index 3)
    await pressKey(stdin, TerminalKeys.DOWN_ARROW);
    await pressKey(stdin, TerminalKeys.DOWN_ARROW);
    await pressKey(stdin, TerminalKeys.DOWN_ARROW);
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();

    // Select Ollama
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();

    // Select model
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();

    // Confirm - should trigger error
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();

    expect(lastFrame()).toContain('Provider initialization failed');
    expect(lastFrame()).toContain('Confirm setup');
  });
});

// ─── Connection-state guard (duplicate-login fix) ───────────────────────
//
// Proves the dialog reads real state from the canonical PlumbProviderRegistry
// before offering login, instead of always restarting device-code/OAuth for
// any selected provider.

function createStubCredentialStore(): IPlumbCredentialStore {
  const creds = new Map<string, PlumbCredential[]>();
  return {
    async getCredentials(providerId) {
      return (creds.get(providerId) ?? []).map((credential) => ({
        provider: providerId,
        credential,
        source: credential.type === 'oauth' ? 'oauth' : 'api_key',
      }));
    },
    async getApiKey(providerId) {
      const list = creds.get(providerId) ?? [];
      const apiKey = list.find((c) => c.type === 'api_key');
      return apiKey?.type === 'api_key' ? apiKey.key : undefined;
    },
    async hasCredentials(providerId) {
      return (creds.get(providerId)?.length ?? 0) > 0;
    },
    async listAuthenticatedProviders() {
      return [...creds.keys()];
    },
    async storeCredential(providerId, credential) {
      const list = creds.get(providerId) ?? [];
      list.push(credential);
      creds.set(providerId, list);
    },
    async storeOAuthCredential(providerId, credential) {
      const list = creds.get(providerId) ?? [];
      list.push(credential);
      creds.set(providerId, list);
    },
    async storeApiKeyCredential(providerId, credential) {
      const list = creds.get(providerId) ?? [];
      list.push(credential);
      creds.set(providerId, list);
    },
    async removeCredentials(providerId) {
      creds.delete(providerId);
    },
    async removeCredential(providerId, credentialType) {
      const list = creds.get(providerId) ?? [];
      const filtered = list.filter((c) => c.type !== credentialType);
      creds.set(providerId, filtered);
      return filtered.length !== list.length;
    },
    async clearAll() {
      creds.clear();
    },
    async setProviderMetadata() {},
    async getProviderMetadata() {
      return null;
    },
    async healthCheck() {
      return { available: true, usingFallback: false };
    },
  };
}

// The shared `mockProviders` fixture above uses illustrative ids ('copilot')
// that never touch the real catalog. These tests exercise the REAL
// PlumbProviderRegistry singleton, which validates provider ids against the
// real catalog (getPlumbProvider) — so this describe block uses the real
// catalog id 'github-copilot' instead.
const registryTestProviders: PlumbProvider[] = mockProviders.map((p) =>
  p.id === 'copilot' ? { ...p, id: 'github-copilot' } : p,
);
const registryTestCategoryGroups = new Map([
  [
    'coding-plan',
    registryTestProviders.filter(
      (p) => p.category === PlumbProviderCategory.CODING_PLAN,
    ),
  ],
  [
    'oauth',
    registryTestProviders.filter(
      (p) => p.category === PlumbProviderCategory.OAUTH_ACCOUNT,
    ),
  ],
  [
    'api-key',
    registryTestProviders.filter(
      (p) => p.category === PlumbProviderCategory.API_KEY,
    ),
  ],
  [
    'local',
    registryTestProviders.filter(
      (p) => p.category === PlumbProviderCategory.LOCAL,
    ),
  ],
  [
    'custom-endpoint',
    registryTestProviders.filter(
      (p) => p.category === PlumbProviderCategory.CUSTOM_ENDPOINT,
    ),
  ],
]);

describe('PlumbProviderSetupDialog — connection-state guard', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    resetPlumbCredentialStore();
    resetPlumbProviderRegistry();
    registerPlumbCredentialStoreFactory(() =>
      Promise.resolve(createStubCredentialStore()),
    );
    await getPlumbProviderRegistry().initialize();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    resetPlumbProviderRegistry();
    resetPlumbCredentialStore();
  });

  const validOAuthCredential = (providerId: string): PlumbCredential => ({
    type: 'oauth',
    provider: providerId,
    access: 'gho_test_access',
    refresh: 'gho_test_refresh',
    expires: Date.now() + 3600_000,
  });

  it('shows the Connected step (not device-code auth) for an already-authenticated provider', async () => {
    await getPlumbProviderRegistry().setAuthenticated(
      'github-copilot',
      validOAuthCredential('github-copilot'),
    );

    const onOAuthLogin = vi.fn().mockResolvedValue({ success: true });
    const { stdin, lastFrame, waitUntilReady } = await renderWithProviders(
      <PlumbProviderSetupDialog
        onComplete={vi.fn()}
        onCancel={vi.fn()}
        providers={registryTestProviders}
        categoryGroups={registryTestCategoryGroups}
        models={mockModels}
        onOAuthLogin={onOAuthLogin}
      />,
    );
    await waitUntilReady();

    // Coding Plan category (index 0) → GitHub Copilot (only entry)
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();

    const frame = lastFrame();
    expect(frame).toContain('Connected');
    expect(frame).not.toContain('Press Enter to get a device code');
    expect(onOAuthLogin).not.toHaveBeenCalled();
  });

  it('explicit Re-authenticate action starts the device-code/OAuth step', async () => {
    await getPlumbProviderRegistry().setAuthenticated(
      'github-copilot',
      validOAuthCredential('github-copilot'),
    );

    const onOAuthLogin = vi.fn().mockResolvedValue({ success: true });
    const { stdin, lastFrame, waitUntilReady } = await renderWithProviders(
      <PlumbProviderSetupDialog
        onComplete={vi.fn()}
        onCancel={vi.fn()}
        providers={registryTestProviders}
        categoryGroups={registryTestCategoryGroups}
        models={mockModels}
        onOAuthLogin={onOAuthLogin}
      />,
    );
    await waitUntilReady();

    await pressKey(stdin, TerminalKeys.ENTER); // Coding Plan
    await waitUntilReady();
    await pressKey(stdin, TerminalKeys.ENTER); // GitHub Copilot → Connected step
    await waitUntilReady();
    expect(lastFrame()).toContain('Connected');

    // Connected step items: Continue (0), Re-authenticate (1), Logout (2)
    await pressKey(stdin, TerminalKeys.DOWN_ARROW);
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();

    expect(lastFrame()).toContain('Authenticate: GitHub Copilot');
    expect(onOAuthLogin).not.toHaveBeenCalled();

    // OAuth is only triggered by the explicit Enter inside the auth step,
    // never merely by reaching it.
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();
    expect(onOAuthLogin).toHaveBeenCalledWith('github-copilot');
  });

  it('Logout removes only the selected provider — an unrelated authenticated provider is unaffected', async () => {
    await getPlumbProviderRegistry().setAuthenticated(
      'github-copilot',
      validOAuthCredential('github-copilot'),
    );
    await getPlumbProviderRegistry().setAuthenticated(
      'anthropic',
      validOAuthCredential('anthropic'),
    );

    const onLogout = vi.fn().mockResolvedValue(undefined);
    const { stdin, lastFrame, waitUntilReady } = await renderWithProviders(
      <PlumbProviderSetupDialog
        onComplete={vi.fn()}
        onCancel={vi.fn()}
        providers={registryTestProviders}
        categoryGroups={registryTestCategoryGroups}
        models={mockModels}
        onLogout={onLogout}
      />,
    );
    await waitUntilReady();

    await pressKey(stdin, TerminalKeys.ENTER); // Coding Plan
    await waitUntilReady();
    await pressKey(stdin, TerminalKeys.ENTER); // GitHub Copilot → Connected step
    await waitUntilReady();

    // Connected step items: Continue (0), Re-authenticate (1), Logout (2)
    await pressKey(stdin, TerminalKeys.DOWN_ARROW);
    await pressKey(stdin, TerminalKeys.DOWN_ARROW);
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();

    expect(onLogout).toHaveBeenCalledExactlyOnceWith('github-copilot');
    expect(lastFrame()).toContain('Choose provider');

    // The unrelated provider's registry-authenticated state was never
    // touched by this dialog — onLogout is scoped to the selected provider
    // id only.
    expect(
      getPlumbProviderRegistry().isProviderAuthenticated('anthropic'),
    ).toBe(true);
  });

  it('shows the expired-session variant and still requires explicit re-authentication', async () => {
    await getPlumbProviderRegistry().setAuthenticated(
      'github-copilot',
      validOAuthCredential('github-copilot'),
    );
    // Force the registry to reclassify this credential as expired (60s skew).
    await getPlumbProviderRegistry().setAuthenticated('github-copilot', {
      ...(validOAuthCredential('github-copilot') as PlumbCredential & {
        type: 'oauth';
      }),
      expires: Date.now() - 1000,
    });
    await getPlumbProviderRegistry().ensureValidCredentials('github-copilot');

    const onOAuthLogin = vi.fn().mockResolvedValue({ success: true });
    const { stdin, lastFrame, waitUntilReady } = await renderWithProviders(
      <PlumbProviderSetupDialog
        onComplete={vi.fn()}
        onCancel={vi.fn()}
        providers={registryTestProviders}
        categoryGroups={registryTestCategoryGroups}
        models={mockModels}
        onOAuthLogin={onOAuthLogin}
      />,
    );
    await waitUntilReady();

    await pressKey(stdin, TerminalKeys.ENTER); // Coding Plan
    await waitUntilReady();
    await pressKey(stdin, TerminalKeys.ENTER); // GitHub Copilot → Connected step
    await waitUntilReady();

    const frame = lastFrame();
    expect(frame).toContain('Session expired');
    // No silent re-login — the dialog must not have called onOAuthLogin
    // merely by reaching this step, and "Continue" must not be offered for
    // an expired credential.
    expect(onOAuthLogin).not.toHaveBeenCalled();
    expect(frame).not.toContain('Continue using this account');
  });
});
