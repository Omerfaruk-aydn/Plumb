/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import type React from 'react';
import {
  renderWithProviders,
  type RenderWithProvidersInstance,
} from '../../test-utils/render.js';
import { waitFor } from '../../test-utils/async.js';
import { PlumbAzureCloudConfigForm } from './PlumbAzureCloudConfigForm.js';

async function renderReady(
  props: React.ComponentProps<typeof PlumbAzureCloudConfigForm>,
): Promise<RenderWithProvidersInstance> {
  let instance!: RenderWithProvidersInstance;
  await act(async () => {
    instance = await renderWithProviders(
      <PlumbAzureCloudConfigForm {...props} />,
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
const BACKSPACE = String.fromCharCode(127);

const mockLoadAzureExistingConfig = vi.fn();
const mockSaveAzureConfiguration = vi.fn();
const mockRemoveAzureConfiguration = vi.fn();
const mockRefreshAzureModelStatus = vi.fn();

vi.mock('../utils/azureCloudConfigActions.js', () => ({
  loadAzureExistingConfig: (...args: unknown[]) =>
    mockLoadAzureExistingConfig(...args),
  saveAzureConfiguration: (...args: unknown[]) =>
    mockSaveAzureConfiguration(...args),
  removeAzureConfiguration: (...args: unknown[]) =>
    mockRemoveAzureConfiguration(...args),
  refreshAzureModelStatus: (...args: unknown[]) =>
    mockRefreshAzureModelStatus(...args),
}));

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

describe('PlumbAzureCloudConfigForm', { timeout: 30000 }, () => {
  beforeEach(() => {
    mockLoadAzureExistingConfig.mockResolvedValue({
      endpoint: '',
      deployments: [],
      hasCredential: false,
    });
    mockSaveAzureConfiguration.mockResolvedValue({ success: true });
    mockRefreshAzureModelStatus.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('UNCONFIGURED_RENDER: renders the empty form', async () => {
    const { lastFrame } = await renderReady({
      onContinue: vi.fn(),
      onCancel: vi.fn(),
    });
    const frame = lastFrame();
    expect(frame).toContain('Azure OpenAI');
    expect(frame).toContain('Endpoint');
    expect(frame).toContain('+ Add deployment');
    expect(frame).not.toContain('Status: Configured');
  });

  it('CONFIGURED_RENDER: renders the connected summary with deployments, never the secret value', async () => {
    mockLoadAzureExistingConfig.mockResolvedValue({
      endpoint: 'my-resource',
      deployments: [{ modelId: 'gpt-4o', deploymentName: 'prod-4o' }],
      hasCredential: true,
    });
    const { lastFrame } = await renderReady({
      onContinue: vi.fn(),
      onCancel: vi.fn(),
    });
    const frame = lastFrame();
    expect(frame).toContain('Status: Configured');
    expect(frame).toContain('my-resource');
    expect(frame).toContain('gpt-4o');
    expect(frame).toContain('prod-4o');
    expect(frame).toContain('API Key: Configured');
  });

  it('CONNECTED_ACTIONS: Continue on the summary view calls onContinue without invoking save', async () => {
    mockLoadAzureExistingConfig.mockResolvedValue({
      endpoint: 'my-resource',
      deployments: [],
      hasCredential: true,
    });
    const onContinue = vi.fn();
    const { stdin, waitUntilReady } = await renderReady({
      onContinue,
      onCancel: vi.fn(),
    });
    await pressKey(stdin, ENTER); // first summary action = Continue
    await waitUntilReady();
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(mockSaveAzureConfiguration).not.toHaveBeenCalled();
  });

  it('VALIDATION_DISPLAY: attempting Save with nothing filled in shows an error and does not call save', async () => {
    const { stdin, lastFrame, waitUntilReady } = await renderReady({
      onContinue: vi.fn(),
      onCancel: vi.fn(),
    });
    // endpoint(0) credential(1) add-deployment(2) save(3) cancel(4)
    for (let i = 0; i < 3; i++) {
      await pressKey(stdin, DOWN_ARROW);
    }
    await pressKey(stdin, ENTER); // press Save
    await waitUntilReady();

    expect(mockSaveAzureConfiguration).not.toHaveBeenCalled();
    expect(lastFrame()).toMatch(/required/i);
  });

  it('SECRET_MASKING: typing into the API key field masks the entered characters', async () => {
    const { stdin, lastFrame, waitUntilReady } = await renderReady({
      onContinue: vi.fn(),
      onCancel: vi.fn(),
    });
    await pressKey(stdin, DOWN_ARROW); // focus credential
    await pressKey(stdin, ENTER); // start editing
    await waitUntilReady();
    await typeText(stdin, 'azure-secret');
    await waitUntilReady();

    const frame = lastFrame();
    expect(frame).not.toContain('azure-secret');
    expect(frame).toContain('•'.repeat('azure-secret'.length));
  });

  it('ADD_DEPLOYMENT: adding a deployment records the model->deployment mapping and it appears in a successful save', async () => {
    const onContinue = vi.fn();
    const { stdin, waitUntilReady } = await renderReady({
      onContinue,
      onCancel: vi.fn(),
    });
    await pressKey(stdin, ENTER); // edit endpoint
    await typeText(stdin, 'my-resource');
    await pressKey(stdin, ENTER); // commit, advance to credential
    await pressKey(stdin, ENTER); // edit credential
    await typeText(stdin, 'azure-key');
    await pressKey(stdin, ENTER); // commit, advance to add-deployment
    await pressKey(stdin, ENTER); // add deployment -> editing model id
    await typeText(stdin, 'gpt-4o');
    await pressKey(stdin, ENTER); // commit model id, advance to deployment name
    await typeText(stdin, 'prod-4o');
    await pressKey(stdin, ENTER); // commit deployment name
    await waitUntilReady();
    await pressKey(stdin, DOWN_ARROW); // deployment row -> add-deployment
    await pressKey(stdin, DOWN_ARROW); // add-deployment -> Save
    await pressKey(stdin, ENTER); // press Save
    await waitUntilReady();

    expect(mockSaveAzureConfiguration).toHaveBeenCalledTimes(1);
    const [savedValues] = mockSaveAzureConfiguration.mock.calls[0] as [
      { deployments: Array<{ modelId: string; deploymentName: string }> },
    ];
    expect(savedValues.deployments).toEqual([
      { modelId: 'gpt-4o', deploymentName: 'prod-4o' },
    ]);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('REMOVE_DEPLOYMENT: pressing Backspace on a deployment row removes it', async () => {
    mockLoadAzureExistingConfig.mockResolvedValue({
      endpoint: 'my-resource',
      deployments: [{ modelId: 'gpt-4o', deploymentName: 'prod-4o' }],
      hasCredential: true,
    });
    const { stdin, lastFrame, waitUntilReady } = await renderReady({
      onContinue: vi.fn(),
      onCancel: vi.fn(),
    });
    await pressKey(stdin, DOWN_ARROW); // Continue -> Edit configuration
    await pressKey(stdin, ENTER);
    await waitUntilReady();
    // endpoint(0) credential(1) deployment-0(2) add-deployment(3) ...
    await pressKey(stdin, DOWN_ARROW);
    await pressKey(stdin, DOWN_ARROW); // focus the deployment row
    await pressKey(stdin, BACKSPACE); // remove it
    await waitUntilReady();

    expect(lastFrame()).not.toContain('prod-4o');
  });

  it('SAVE_FAILURE_ATOMIC: a failed save shows the error and does not call onContinue', async () => {
    mockSaveAzureConfiguration.mockResolvedValue({
      success: false,
      error: 'Failed to save Azure credential: keychain unavailable',
    });
    const onContinue = vi.fn();
    const { stdin, lastFrame, waitUntilReady } = await renderReady({
      onContinue,
      onCancel: vi.fn(),
    });
    await pressKey(stdin, ENTER);
    await typeText(stdin, 'my-resource');
    await pressKey(stdin, ENTER);
    await pressKey(stdin, ENTER);
    await typeText(stdin, 'azure-key');
    await pressKey(stdin, ENTER);
    await waitUntilReady();
    await pressKey(stdin, DOWN_ARROW); // skip add-deployment
    await pressKey(stdin, ENTER); // Save
    await waitUntilReady();

    expect(onContinue).not.toHaveBeenCalled();
    expect(lastFrame()).toContain('keychain unavailable');
  });

  it('CANCEL_NO_MUTATION: Escape from the unconfigured form calls onCancel without ever calling save', async () => {
    const onCancel = vi.fn();
    const { stdin, waitUntilReady } = await renderReady({
      onContinue: vi.fn(),
      onCancel,
    });
    await pressKey(stdin, ENTER);
    await typeText(stdin, 'partial');
    await pressKey(stdin, ESCAPE);
    await pressKey(stdin, ESCAPE);
    await waitUntilReady();

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(mockSaveAzureConfiguration).not.toHaveBeenCalled();
  });

  it('REMOVE: choosing Remove configuration on the summary view calls removeAzureConfiguration', async () => {
    mockLoadAzureExistingConfig.mockResolvedValue({
      endpoint: 'my-resource',
      deployments: [],
      hasCredential: true,
    });
    mockRemoveAzureConfiguration.mockResolvedValue(undefined);
    const { stdin, waitUntilReady } = await renderReady({
      onContinue: vi.fn(),
      onCancel: vi.fn(),
    });
    // Continue -> Edit configuration -> Refresh models/status -> Remove configuration.
    for (let i = 0; i < 3; i++) {
      await pressKey(stdin, DOWN_ARROW);
    }
    await pressKey(stdin, ENTER);
    await waitUntilReady();

    expect(mockRemoveAzureConfiguration).toHaveBeenCalledTimes(1);
  });
});
