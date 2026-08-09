/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression: providers whose real credential is entirely ambient
 * environment variables (no PLUMB-collected API key, no OAuth)
 * previously had authMethods that fell into none of AuthStep's
 * hasOAuth/hasApiKey/hasDeviceCode branches, AND the authenticate-step
 * Enter handler had no branch for "env-only, nothing to type" either --
 * so pressing Enter with an empty input was silently swallowed
 * (the same class of dead-end fixed for claude-subscription, but
 * triggered by a plain data shape any real provider could have).
 *
 * Uses a synthetic provider id/env-var shape (not 'amazon-bedrock' --
 * Bedrock now has its own rich cloud-configuration screen, see
 * PlumbCloudProviderConfigForm.tsx/CLOUD_CONFIGURATION_PROVIDER_IDS) so
 * this keeps exercising the generic env-only 'authenticate' step
 * regardless of which real providers later grow a cloud-config screen.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { renderWithProviders } from '../../test-utils/render.js';
import { PlumbProviderSetupDialog } from './PlumbProviderSetupDialog.js';
import { PlumbProviderCategory } from '@google/gemini-cli-provider';
import type { PlumbProvider } from '@google/gemini-cli-provider';

const ENTER = String.fromCharCode(13);
const DOWN_ARROW = String.fromCharCode(27) + '[B';

const envOnlyProvider: PlumbProvider = {
  id: 'test-env-only-provider',
  name: 'Test Env-Only Provider',
  category: PlumbProviderCategory.API_KEY,
  description:
    'Synthetic provider whose credential is entirely ambient env vars',
  authMethods: [
    {
      type: 'env',
      envVars: ['TEST_ENV_ONLY_ACCESS_KEY', 'TEST_ENV_ONLY_SECRET'],
    },
  ],
  available: true,
  allowUnauthenticated: false,
};

const mockProviders: PlumbProvider[] = [envOnlyProvider];
const mockCategoryGroups = new Map([['API Providers', [envOnlyProvider]]]);

async function pressKey(stdin: { write: (data: string) => void }, key: string) {
  await act(async () => {
    vi.advanceTimersByTime(100);
    stdin.write(key);
  });
}

describe('PlumbProviderSetupDialog — env-only auth methods', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('Enter on the authenticate step proceeds to model-select instead of being silently swallowed', async () => {
    const { stdin, lastFrame, waitUntilReady } = await renderWithProviders(
      <PlumbProviderSetupDialog
        onComplete={vi.fn()}
        onCancel={vi.fn()}
        providers={mockProviders}
        categoryGroups={mockCategoryGroups}
        models={[]}
      />,
    );

    await waitUntilReady();
    // connection-type -> API Key Provider category (3rd item: Coding Plan, OAuth, API Key)
    await pressKey(stdin, DOWN_ARROW);
    await pressKey(stdin, DOWN_ARROW);
    await waitUntilReady();
    await pressKey(stdin, ENTER);
    await waitUntilReady();
    // provider-select -> test-env-only-provider (only entry)
    await pressKey(stdin, ENTER);
    await waitUntilReady();

    const authFrame = lastFrame();
    expect(authFrame).toContain('TEST_ENV_ONLY_ACCESS_KEY');
    expect(authFrame).not.toContain('Type API key and press Enter');

    // The actual regression: Enter here previously did nothing at all.
    await pressKey(stdin, ENTER);
    await waitUntilReady();

    expect(lastFrame()).toContain('Step 4');
  });
});
