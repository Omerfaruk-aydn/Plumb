/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression: providers whose real credential is entirely ambient
 * environment variables (e.g. Amazon Bedrock -- AWS_ACCESS_KEY_ID/
 * AWS_SECRET_ACCESS_KEY/AWS_REGION, no PLUMB-collected API key, no OAuth)
 * previously had authMethods that fell into none of AuthStep's
 * hasOAuth/hasApiKey/hasDeviceCode branches, AND the authenticate-step
 * Enter handler had no branch for "env-only, nothing to type" either --
 * so pressing Enter with an empty input was silently swallowed
 * (the same class of dead-end fixed for claude-subscription, but
 * triggered by a plain data shape any real provider could have, not a
 * synthetic-provider special case).
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
  id: 'amazon-bedrock',
  name: 'Amazon Bedrock',
  category: PlumbProviderCategory.API_KEY,
  description: 'AWS Bedrock managed inference',
  authMethods: [
    { type: 'env', envVars: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'] },
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

describe('PlumbProviderSetupDialog — env-only auth methods (e.g. Amazon Bedrock)', () => {
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
    // provider-select -> amazon-bedrock (only entry)
    await pressKey(stdin, ENTER);
    await waitUntilReady();

    const authFrame = lastFrame();
    expect(authFrame).toContain('AWS_ACCESS_KEY_ID');
    expect(authFrame).not.toContain('Type API key and press Enter');

    // The actual regression: Enter here previously did nothing at all.
    await pressKey(stdin, ENTER);
    await waitUntilReady();

    expect(lastFrame()).toContain('Step 4');
  });
});
