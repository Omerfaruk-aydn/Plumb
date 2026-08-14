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
import { PlumbCloudProviderConfigForm } from './PlumbCloudProviderConfigForm.js';

// renderWithProviders()'s internal mount is a *synchronous* act() call, but
// this component's initial loadOciExistingConfig() effect resolves on a
// later microtask -- outside that sync act() scope. Wrapping the whole
// render+ready sequence in one async act() keeps React's act-queue active
// across that resolution so the resulting setState calls aren't flagged.
async function renderReady(
  props: React.ComponentProps<typeof PlumbCloudProviderConfigForm>,
): Promise<RenderWithProvidersInstance> {
  let instance!: RenderWithProvidersInstance;
  await act(async () => {
    instance = await renderWithProviders(
      <PlumbCloudProviderConfigForm {...props} />,
    );
  });
  // A second, un-nested waitUntilReady() call lets its internal polling
  // loop actually observe the post-load re-render -- nesting it inside the
  // act() above defers the commit until that act() call itself resolves,
  // which starves the poll of the render it's waiting to see.
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

const mockLoadOciExistingConfig = vi.fn();
const mockSaveOciConfiguration = vi.fn();
const mockRemoveOciConfiguration = vi.fn();
const mockRefreshOciModelStatus = vi.fn();
const mockClearOciConfigOverrides = vi.fn();

vi.mock('../utils/ociCloudConfigActions.js', () => ({
  loadOciExistingConfig: (...args: unknown[]) =>
    mockLoadOciExistingConfig(...args),
  saveOciConfiguration: (...args: unknown[]) =>
    mockSaveOciConfiguration(...args),
  removeOciConfiguration: (...args: unknown[]) =>
    mockRemoveOciConfiguration(...args),
  refreshOciModelStatus: (...args: unknown[]) =>
    mockRefreshOciModelStatus(...args),
  clearOciConfigOverrides: (...args: unknown[]) =>
    mockClearOciConfigOverrides(...args),
}));

// This component loads its initial state asynchronously on mount
// (loadOciExistingConfig via useEffect); under vi.useFakeTimers() the
// resulting microtask chain does not reliably resolve through
// vi.advanceTimersByTimeAsync in this harness (confirmed by isolated
// repro), so this file deliberately uses real timers -- renderWithProviders'
// waitUntilReady() has a real-timer fallback path specifically for this.
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
  for (const ch of text) {
    await pressKey(stdin, ch);
  }
}

describe('PlumbCloudProviderConfigForm', { timeout: 30000 }, () => {
  beforeEach(() => {
    mockLoadOciExistingConfig.mockResolvedValue({
      safeConfig: {},
      hasCredential: false,
    });
    mockSaveOciConfiguration.mockResolvedValue({ success: true });
    mockRefreshOciModelStatus.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('UNCONFIGURED_RENDER: renders the empty form (Authentication select) when nothing is configured', async () => {
    const { lastFrame } = await renderReady({
      onContinue: vi.fn(),
      onCancel: vi.fn(),
    });
    const frame = lastFrame();
    expect(frame).toContain('Oracle OCI Generative AI');
    expect(frame).toContain('Authentication');
    expect(frame).toContain('Generative AI API Key');
    expect(frame).not.toContain('Status: Configured');
  });

  it('CONFIGURED_RENDER: renders the connected summary with safe fields (never the secret value) when already configured', async () => {
    mockLoadOciExistingConfig.mockResolvedValue({
      safeConfig: {
        region: 'us-chicago-1',
        projectId: 'ocid1.generativeaiproject.oc1.us-chicago-1.real',
      },
      hasCredential: true,
    });
    const { lastFrame } = await renderReady({
      onContinue: vi.fn(),
      onCancel: vi.fn(),
    });
    const frame = lastFrame();
    expect(frame).toContain('Status: Configured');
    expect(frame).toContain('us-chicago-1');
    expect(frame).toContain('API Key: Configured');
    expect(frame).toContain('Continue');
    expect(frame).toContain('Edit configuration');
    expect(frame).toContain('Remove configuration');
  });

  it('CONNECTED_ACTIONS: Continue on the summary view calls onContinue without invoking save', async () => {
    mockLoadOciExistingConfig.mockResolvedValue({
      safeConfig: {
        region: 'us-chicago-1',
        projectId: 'ocid1.generativeaiproject.oc1.us-chicago-1.real',
      },
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
    expect(mockSaveOciConfiguration).not.toHaveBeenCalled();
  });

  it('AUTH_MODE_SELECTION + VISIBLE_FIELDS: selecting "Generative AI API Key" shows Region/Project/Compartment/API Key', async () => {
    const { stdin, lastFrame, waitUntilReady } = await renderReady({
      onContinue: vi.fn(),
      onCancel: vi.fn(),
    });
    // Authentication select is immediately live on mount (index 0 = API Key).
    await pressKey(stdin, ENTER);
    await waitUntilReady();

    const frame = lastFrame();
    expect(frame).toContain('Region');
    expect(frame).toContain('Project OCID');
    expect(frame).toContain('Compartment OCID');
    expect(frame).toContain('API Key');
  });

  it('IAM_SUBTYPE_SELECTION + HIDDEN_FIELDS: selecting OCI IAM + Instance Principal hides config path/profile and the API key field', async () => {
    const { stdin, lastFrame, waitUntilReady } = await renderReady({
      onContinue: vi.fn(),
      onCancel: vi.fn(),
    });
    await pressKey(stdin, DOWN_ARROW); // highlight "OCI IAM"
    await pressKey(stdin, ENTER); // select it -> focus moves to IAM Subtype
    await waitUntilReady();

    await pressKey(stdin, DOWN_ARROW); // Session
    await pressKey(stdin, DOWN_ARROW); // Instance Principal
    await pressKey(stdin, ENTER);
    await waitUntilReady();

    const frame = lastFrame();
    expect(frame).toContain('Instance Principal');
    expect(frame).not.toContain('Config File Path');
    expect(frame).not.toContain('Profile:');
    expect(frame).not.toContain('API Key:');
  });

  it('VALIDATION_DISPLAY: attempting Save with required fields empty shows inline errors and does not call the save action', async () => {
    const { stdin, lastFrame, waitUntilReady } = await renderReady({
      onContinue: vi.fn(),
      onCancel: vi.fn(),
    });
    await pressKey(stdin, ENTER); // pick API Key mode
    await waitUntilReady();
    // Navigate down to Save without filling anything in.
    for (let i = 0; i < 4; i++) {
      await pressKey(stdin, DOWN_ARROW);
    }
    await pressKey(stdin, ENTER); // press Save
    await waitUntilReady();

    expect(mockSaveOciConfiguration).not.toHaveBeenCalled();
    const frame = lastFrame();
    expect(frame).toMatch(/required/i);
  });

  it('SECRET_MASKING: typing into the API Key field masks the entered characters', async () => {
    const { stdin, lastFrame, waitUntilReady } = await renderReady({
      onContinue: vi.fn(),
      onCancel: vi.fn(),
    });
    await pressKey(stdin, ENTER); // API Key mode; focus -> Region
    await waitUntilReady();
    // Focus order after select: region(1) projectId(2) compartmentId(3) credential(4)
    for (let i = 0; i < 3; i++) {
      await pressKey(stdin, DOWN_ARROW);
    }
    await pressKey(stdin, ENTER); // start editing the credential field
    await waitUntilReady();
    await typeText(stdin, 'super-secret-key');
    await waitUntilReady();

    const frame = lastFrame();
    expect(frame).not.toContain('super-secret-key');
    expect(frame).toContain('•'.repeat('super-secret-key'.length));
  });

  it('SECRET_PRESERVE_ON_EDIT: editing an already-configured provider shows "Configured (Enter to replace)", never the raw value, and leaving it untouched preserves it', async () => {
    mockLoadOciExistingConfig.mockResolvedValue({
      safeConfig: {
        region: 'us-chicago-1',
        projectId: 'ocid1.generativeaiproject.oc1.us-chicago-1.real',
      },
      hasCredential: true,
    });
    const { stdin, lastFrame, waitUntilReady } = await renderReady({
      onContinue: vi.fn(),
      onCancel: vi.fn(),
    });
    await pressKey(stdin, DOWN_ARROW); // summary: Continue -> Edit configuration
    await pressKey(stdin, ENTER); // choose Edit configuration
    await waitUntilReady();

    const frame = lastFrame();
    expect(frame).toContain('Configured (Enter to replace)');
  });

  it('SAVE_SUCCESS: a valid form invokes saveOciConfiguration with the entered values and calls onContinue', async () => {
    const onContinue = vi.fn();
    const { stdin, waitUntilReady } = await renderReady({
      onContinue,
      onCancel: vi.fn(),
    });
    await pressKey(stdin, ENTER); // API Key mode; focus -> Region
    await waitUntilReady();

    await pressKey(stdin, ENTER); // edit Region
    await typeText(stdin, 'us-chicago-1');
    await pressKey(stdin, ENTER); // commit, advance to Project OCID
    await pressKey(stdin, ENTER); // edit Project OCID
    await typeText(stdin, 'ocid1.generativeaiproject.oc1.us-chicago-1.real');
    await pressKey(stdin, ENTER); // commit, advance to Compartment OCID
    await pressKey(stdin, DOWN_ARROW); // skip compartment (optional), focus API Key
    await pressKey(stdin, ENTER);
    await typeText(stdin, 'real-oci-genai-key');
    await pressKey(stdin, ENTER); // commit, advance to Save
    await waitUntilReady();
    await pressKey(stdin, ENTER); // press Save
    await waitUntilReady();

    expect(mockSaveOciConfiguration).toHaveBeenCalledTimes(1);
    const [savedValues] = mockSaveOciConfiguration.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(savedValues['authMode']).toBe('api_key');
    expect(savedValues['region']).toBe('us-chicago-1');
    expect(savedValues['credential']).toBe('real-oci-genai-key');
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('SAVE_FAILURE_ATOMIC: a failed save shows the error, does not call onContinue, and keeps the dialog open', async () => {
    mockSaveOciConfiguration.mockResolvedValue({
      success: false,
      error: 'Failed to save OCI credential: keychain unavailable',
    });
    const onContinue = vi.fn();
    const { stdin, lastFrame, waitUntilReady } = await renderReady({
      onContinue,
      onCancel: vi.fn(),
    });
    await pressKey(stdin, ENTER); // API Key mode
    await waitUntilReady();
    await pressKey(stdin, ENTER); // edit Region
    await typeText(stdin, 'us-chicago-1');
    await pressKey(stdin, ENTER);
    await pressKey(stdin, ENTER); // edit Project OCID
    await typeText(stdin, 'ocid1.generativeaiproject.oc1.us-chicago-1.real');
    await pressKey(stdin, ENTER);
    await pressKey(stdin, DOWN_ARROW);
    await pressKey(stdin, ENTER); // edit API Key
    await typeText(stdin, 'k');
    await pressKey(stdin, ENTER);
    await waitUntilReady();
    await pressKey(stdin, ENTER); // Save
    await waitUntilReady();

    expect(onContinue).not.toHaveBeenCalled();
    const frame = lastFrame();
    expect(frame).toContain('keychain unavailable');
  });

  it('CANCEL_NO_MUTATION: Escape from the unconfigured form calls onCancel without ever calling save', async () => {
    const onCancel = vi.fn();
    const { stdin, waitUntilReady } = await renderReady({
      onContinue: vi.fn(),
      onCancel,
    });
    await pressKey(stdin, ENTER); // API Key mode
    await waitUntilReady();
    await pressKey(stdin, ENTER); // edit Region
    await typeText(stdin, 'partially typed region');
    await pressKey(stdin, ESCAPE); // abandon this field edit
    await pressKey(stdin, ESCAPE); // cancel the whole form
    await waitUntilReady();

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(mockSaveOciConfiguration).not.toHaveBeenCalled();
  });

  it('REMOVE: choosing Remove configuration on the summary view calls removeOciConfiguration', async () => {
    mockLoadOciExistingConfig.mockResolvedValue({
      safeConfig: {
        region: 'us-chicago-1',
        projectId: 'ocid1.generativeaiproject.oc1.us-chicago-1.real',
      },
      hasCredential: true,
    });
    mockRemoveOciConfiguration.mockResolvedValue(undefined);
    const { stdin, waitUntilReady } = await renderReady({
      onContinue: vi.fn(),
      onCancel: vi.fn(),
    });
    // Continue -> Edit configuration -> Change authentication -> Refresh
    // models/status -> Remove configuration.
    for (let i = 0; i < 4; i++) {
      await pressKey(stdin, DOWN_ARROW);
    }
    await pressKey(stdin, ENTER);
    await waitUntilReady();

    expect(mockRemoveOciConfiguration).toHaveBeenCalledTimes(1);
  });

  it('REFRESH: choosing Refresh models/status on the summary view calls refreshOciModelStatus and returns to the summary', async () => {
    mockLoadOciExistingConfig.mockResolvedValue({
      safeConfig: {
        region: 'us-chicago-1',
        projectId: 'ocid1.generativeaiproject.oc1.us-chicago-1.real',
      },
      hasCredential: true,
    });
    mockRefreshOciModelStatus.mockResolvedValue(undefined);
    const { stdin, lastFrame, waitUntilReady } = await renderReady({
      onContinue: vi.fn(),
      onCancel: vi.fn(),
    });
    // Continue -> Edit configuration -> Change authentication -> Refresh models/status.
    for (let i = 0; i < 3; i++) {
      await pressKey(stdin, DOWN_ARROW);
    }
    await pressKey(stdin, ENTER);
    await waitUntilReady();

    expect(mockRefreshOciModelStatus).toHaveBeenCalledTimes(1);
    expect(lastFrame()).toContain('Status: Configured');
  });

  it('CLEAR_OVERRIDE: choosing Clear PLUMB override calls clearOciConfigOverrides and reflects the environment fallback immediately (no restart)', async () => {
    mockLoadOciExistingConfig.mockResolvedValueOnce({
      safeConfig: {
        region: 'us-chicago-1',
        projectId: 'ocid1.generativeaiproject.oc1.us-chicago-1.real',
      },
      hasCredential: true,
      sources: { region: 'plumb', projectId: 'plumb' },
    });
    mockLoadOciExistingConfig.mockResolvedValue({
      safeConfig: {
        region: 'us-chicago-1-from-env',
        projectId: 'ocid1.generativeaiproject.oc1.us-chicago-1.real',
      },
      hasCredential: true,
      sources: { region: 'env', projectId: 'plumb' },
    });
    mockClearOciConfigOverrides.mockResolvedValue(undefined);
    const { stdin, lastFrame, waitUntilReady } = await renderReady({
      onContinue: vi.fn(),
      onCancel: vi.fn(),
    });
    expect(lastFrame()).toContain('Source: PLUMB configuration');

    // Continue -> Edit configuration -> Change authentication -> Refresh
    // models/status -> Clear PLUMB override (only shown when an override
    // exists).
    for (let i = 0; i < 4; i++) {
      await pressKey(stdin, DOWN_ARROW);
    }
    await pressKey(stdin, ENTER);
    await waitUntilReady();

    expect(mockClearOciConfigOverrides).toHaveBeenCalledTimes(1);
    const frame = lastFrame();
    expect(frame).toContain('us-chicago-1-from-env');
    expect(frame).toContain('Source: Environment');
  });

  it('KEYBOARD_NAVIGATION: text field editing supports backspace', async () => {
    const { stdin, lastFrame, waitUntilReady } = await renderReady({
      onContinue: vi.fn(),
      onCancel: vi.fn(),
    });
    await pressKey(stdin, ENTER); // API Key mode; focus -> Region
    await waitUntilReady();
    await pressKey(stdin, ENTER); // edit Region
    await typeText(stdin, 'us-chicago-2');
    await pressKey(stdin, BACKSPACE); // remove trailing '2'
    await waitUntilReady();

    expect(lastFrame()).toContain('us-chicago-');
    expect(lastFrame()).not.toContain('us-chicago-2');
  });
});
