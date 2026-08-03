/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { renderWithProviders } from '../../test-utils/render.js';
import { PlumbProviderSetupDialog } from './PlumbProviderSetupDialog.js';
import { PlumbProviderCategory } from '@google/gemini-cli-provider';
import type { PlumbProvider } from '@google/gemini-cli-provider';

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
      { id: 'nvidia/llama-3.1-nemotron-70b-instruct', name: 'Nemotron', provider: 'nvidia' },
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
});
