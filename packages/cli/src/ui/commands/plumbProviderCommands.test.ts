/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  providerCommand,
  loginCommand,
  modelsCommand,
  accountsCommand,
  localModelsCommand,
} from './plumbProviderCommands.js';
import type { CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';

vi.mock('@plumb/provider', () => ({
  ensurePlumbCredentialStore: vi.fn().mockResolvedValue({
    listAuthenticatedProviders: vi.fn().mockResolvedValue([]),
  }),
  getPlumbModelRegistry: vi.fn().mockReturnValue({
    discoverLocalModels: vi.fn().mockResolvedValue([]),
  }),
}));

describe('plumbProviderCommands', () => {
  let mockContext: CommandContext;

  beforeEach(() => {
    mockContext = createMockCommandContext();
  });

  function lastAddItemCall() {
    const addItem = mockContext.ui.addItem as ReturnType<typeof vi.fn>;
    expect(addItem).toHaveBeenCalled();
    const call = addItem.mock.calls.at(-1)!;
    return call[0] as { type: string; text: string };
  }

  describe('/provider', () => {
    it('reports a usage error with a real `text` field when the "set" subcommand is called without an id', async () => {
      const setSubCommand = providerCommand.subCommands?.find(
        (c) => c.name === 'set',
      );
      await setSubCommand!.action!(mockContext, '');
      const item = lastAddItemCall();
      expect(item.type).toBe('error');
      expect(item.text).toBe('Usage: /provider set <provider-id>');
      // The old bug: `content` instead of `text`, which InfoMessage cannot
      // render (crashes on `text.split`). Guard against regressing to it.
      expect((item as Record<string, unknown>)['content']).toBeUndefined();
    });

    it('confirms the provider was set with a real `text` field', async () => {
      await providerCommand.action!(mockContext, 'set my-provider');
      const item = lastAddItemCall();
      expect(item.type).toBe('info');
      expect(item.text).toContain('my-provider');
      expect(typeof item.text).toBe('string');
    });

    it('shows help text with a real `text` field for an unrecognized argument', async () => {
      await providerCommand.action!(mockContext, 'not-a-real-subcommand');
      const item = lastAddItemCall();
      expect(item.type).toBe('info');
      expect(item.text).toContain('/provider set <id>');
    });
  });

  describe('/login', () => {
    it('announces the auth flow starting with a real `text` field', async () => {
      await loginCommand.action!(mockContext, 'my-provider');
      const item = lastAddItemCall();
      expect(item.type).toBe('info');
      expect(item.text).toContain('my-provider');
    });
  });

  describe('/models', () => {
    it('reports a usage error with a real `text` field when the "set" subcommand is called without an id', async () => {
      mockContext.services.agentContext = {
        config: { setModel: vi.fn() },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
      const setSubCommand = modelsCommand.subCommands?.find(
        (c) => c.name === 'set',
      );
      await setSubCommand!.action!(mockContext, '');
      const item = lastAddItemCall();
      expect(item.type).toBe('error');
      expect(item.text).toBe('Usage: /models set <model-id>');
    });

    it('confirms the model was set with a real `text` field', async () => {
      const setModel = vi.fn();
      mockContext.services.agentContext = {
        config: { setModel },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
      await modelsCommand.action!(mockContext, 'set my-model');
      expect(setModel).toHaveBeenCalledWith('my-model', true);
      const item = lastAddItemCall();
      expect(item.type).toBe('info');
      expect(item.text).toBe('Model set to "my-model".');
    });
  });

  describe('/accounts', () => {
    it('reports the empty state with a real `text` field', async () => {
      await accountsCommand.action!(mockContext, '');
      const item = lastAddItemCall();
      expect(item.type).toBe('info');
      expect(item.text).toContain('No authenticated providers');
    });
  });

  describe('/local-models', () => {
    it('reports the empty state with a real `text` field', async () => {
      await localModelsCommand.action!(mockContext, '');
      const item = lastAddItemCall();
      expect(item.type).toBe('info');
      expect(item.text).toContain('No local models found');
    });
  });
});
