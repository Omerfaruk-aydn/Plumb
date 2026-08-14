/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import type React from 'react';
import {
  renderWithProviders,
  type RenderWithProvidersInstance,
} from '../../test-utils/render.js';
import { waitFor } from '../../test-utils/async.js';
import { PlumbGenericCloudConfigForm } from './PlumbGenericCloudConfigForm.js';
import { BEDROCK_CONFIG_SCHEMA, VERTEX_CONFIG_SCHEMA } from '@plumb/provider';
import type { GenericCloudConfigActions } from '../utils/genericCloudConfigActions.js';

async function renderReady(
  props: React.ComponentProps<typeof PlumbGenericCloudConfigForm>,
): Promise<RenderWithProvidersInstance> {
  let instance!: RenderWithProvidersInstance;
  await act(async () => {
    instance = await renderWithProviders(
      <PlumbGenericCloudConfigForm {...props} />,
    );
  });
  await instance.waitUntilReady();
  await waitFor(() => {
    expect(instance.lastFrame()).not.toContain('Loading configuration…');
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

function makeMockActions(): {
  actions: GenericCloudConfigActions;
  load: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
  clearOverrides: ReturnType<typeof vi.fn>;
} {
  const load = vi.fn().mockResolvedValue({
    safeConfig: {},
    hasCredential: false,
    sources: {},
  });
  const save = vi.fn().mockResolvedValue({ success: true });
  const remove = vi.fn().mockResolvedValue(undefined);
  const refresh = vi.fn().mockResolvedValue(undefined);
  const clearOverrides = vi.fn().mockResolvedValue(undefined);
  return {
    actions: {
      load,
      save,
      remove,
      refresh,
      clearOverrides,
      getFieldSources: vi.fn().mockReturnValue({}),
    },
    load,
    save,
    remove,
    refresh,
    clearOverrides,
  };
}

describe(
  'PlumbGenericCloudConfigForm (Bedrock schema)',
  { timeout: 30000 },
  () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('UNCONFIGURED_RENDER: renders the auth-mode select with no credential field (Bedrock has none)', async () => {
      const { actions } = makeMockActions();
      const { lastFrame } = await renderReady({
        title: 'Amazon Bedrock',
        schema: BEDROCK_CONFIG_SCHEMA,
        actions,
        onContinue: vi.fn(),
        onCancel: vi.fn(),
      });
      const frame = lastFrame();
      expect(frame).toContain('Amazon Bedrock');
      expect(frame).toContain('AWS Default Credential Chain');
      expect(frame).not.toContain('Status: Configured');
    });

    it('CONFIGURED_RENDER: renders the connected summary with safe fields', async () => {
      const { actions, load } = makeMockActions();
      load.mockResolvedValue({
        safeConfig: { authMode: 'default_chain', region: 'us-east-1' },
        hasCredential: false,
        sources: { region: 'plumb' },
      });
      const { lastFrame } = await renderReady({
        title: 'Amazon Bedrock',
        schema: BEDROCK_CONFIG_SCHEMA,
        actions,
        onContinue: vi.fn(),
        onCancel: vi.fn(),
      });
      const frame = lastFrame();
      expect(frame).toContain('Status: Configured');
      expect(frame).toContain('us-east-1');
      expect(frame).toContain('Source: PLUMB configuration');
      expect(frame).toContain('Continue');
      expect(frame).toContain('Remove configuration');
    });

    it('AUTH_MODE_SELECTION: switching to Profile mode shows the Profile Name field', async () => {
      const { actions } = makeMockActions();
      const { stdin, lastFrame, waitUntilReady } = await renderReady({
        title: 'Amazon Bedrock',
        schema: BEDROCK_CONFIG_SCHEMA,
        actions,
        onContinue: vi.fn(),
        onCancel: vi.fn(),
      });
      await pressKey(stdin, DOWN_ARROW); // highlight "AWS Profile"
      await pressKey(stdin, ENTER); // select it
      await waitUntilReady();

      const frame = lastFrame();
      expect(frame).toContain('Profile Name');
    });

    it('VALIDATION_DISPLAY: attempting Save without region shows an inline error and does not call save', async () => {
      const { actions, save } = makeMockActions();
      const { stdin, lastFrame, waitUntilReady } = await renderReady({
        title: 'Amazon Bedrock',
        schema: BEDROCK_CONFIG_SCHEMA,
        actions,
        onContinue: vi.fn(),
        onCancel: vi.fn(),
      });
      await pressKey(stdin, ENTER); // pick default_chain
      await waitUntilReady();
      await pressKey(stdin, DOWN_ARROW); // Save
      await pressKey(stdin, ENTER);
      await waitUntilReady();

      expect(save).not.toHaveBeenCalled();
      expect(lastFrame()).toMatch(/required/i);
    });

    it('SAVE_SUCCESS: a valid form invokes actions.save and calls onContinue', async () => {
      const { actions, save } = makeMockActions();
      const onContinue = vi.fn();
      const { stdin, waitUntilReady } = await renderReady({
        title: 'Amazon Bedrock',
        schema: BEDROCK_CONFIG_SCHEMA,
        actions,
        onContinue,
        onCancel: vi.fn(),
      });
      await pressKey(stdin, ENTER); // default_chain
      await waitUntilReady();
      await pressKey(stdin, ENTER); // edit region
      await typeText(stdin, 'us-east-1');
      await pressKey(stdin, ENTER); // commit, advance to Save
      await waitUntilReady();
      await pressKey(stdin, ENTER); // press Save
      await waitUntilReady();

      expect(save).toHaveBeenCalledTimes(1);
      const [savedValues] = save.mock.calls[0] as [Record<string, unknown>];
      expect(savedValues['authMode']).toBe('default_chain');
      expect(savedValues['region']).toBe('us-east-1');
      expect(onContinue).toHaveBeenCalledTimes(1);
    });

    it('CANCEL_NO_MUTATION: Escape calls onCancel without ever calling save', async () => {
      const { actions, save } = makeMockActions();
      const onCancel = vi.fn();
      const { stdin, waitUntilReady } = await renderReady({
        title: 'Amazon Bedrock',
        schema: BEDROCK_CONFIG_SCHEMA,
        actions,
        onContinue: vi.fn(),
        onCancel,
      });
      await pressKey(stdin, ENTER);
      await waitUntilReady();
      await pressKey(stdin, ENTER);
      await typeText(stdin, 'partial');
      await pressKey(stdin, ESCAPE);
      await pressKey(stdin, ESCAPE);
      await waitUntilReady();

      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(save).not.toHaveBeenCalled();
    });

    it('REMOVE: choosing Remove configuration calls actions.remove', async () => {
      const { actions, load, remove } = makeMockActions();
      load.mockResolvedValue({
        safeConfig: { authMode: 'default_chain', region: 'us-east-1' },
        hasCredential: false,
        sources: {},
      });
      const { stdin, waitUntilReady } = await renderReady({
        title: 'Amazon Bedrock',
        schema: BEDROCK_CONFIG_SCHEMA,
        actions,
        onContinue: vi.fn(),
        onCancel: vi.fn(),
      });
      // Continue -> Edit -> Change authentication -> Refresh -> Remove.
      for (let i = 0; i < 4; i++) {
        await pressKey(stdin, DOWN_ARROW);
      }
      await pressKey(stdin, ENTER);
      await waitUntilReady();

      expect(remove).toHaveBeenCalledTimes(1);
    });
  },
);

describe(
  'PlumbGenericCloudConfigForm (Vertex schema -- has a secret field)',
  { timeout: 30000 },
  () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('SECRET_MASKING: typing into the API key field masks the entered characters', async () => {
      const { actions } = makeMockActions();
      const { stdin, lastFrame, waitUntilReady } = await renderReady({
        title: 'Google Vertex AI',
        schema: VERTEX_CONFIG_SCHEMA,
        actions,
        onContinue: vi.fn(),
        onCancel: vi.fn(),
      });
      await pressKey(stdin, DOWN_ARROW); // highlight "API Key" mode
      await pressKey(stdin, ENTER); // select it
      await waitUntilReady();
      // Focus order after select: project(1) location(2) credential(3)
      for (let i = 0; i < 2; i++) {
        await pressKey(stdin, DOWN_ARROW);
      }
      await pressKey(stdin, ENTER); // start editing credential
      await waitUntilReady();
      await typeText(stdin, 'vertex-secret');
      await waitUntilReady();

      const frame = lastFrame();
      expect(frame).not.toContain('vertex-secret');
      expect(frame).toContain('•'.repeat('vertex-secret'.length));
    });

    it('SECRET_PRESERVE_ON_EDIT: an already-configured credential shows "Configured (Enter to replace)"', async () => {
      const { actions, load } = makeMockActions();
      load.mockResolvedValue({
        safeConfig: {
          authMode: 'api_key',
          project: 'p',
          location: 'us-central1',
        },
        hasCredential: true,
        sources: {},
      });
      const { stdin, lastFrame, waitUntilReady } = await renderReady({
        title: 'Google Vertex AI',
        schema: VERTEX_CONFIG_SCHEMA,
        actions,
        onContinue: vi.fn(),
        onCancel: vi.fn(),
      });
      await pressKey(stdin, DOWN_ARROW); // Continue -> Edit configuration
      await pressKey(stdin, ENTER);
      await waitUntilReady();

      expect(lastFrame()).toContain('Configured (Enter to replace)');
    });
  },
);
