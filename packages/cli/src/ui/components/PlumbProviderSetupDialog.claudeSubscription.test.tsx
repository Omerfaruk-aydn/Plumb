/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression: claude-subscription (Agent SDK-backed, PLUMB-only synthetic)
 * has no PLUMB-initiated login flow — the generic AuthStep (which only
 * understands oauth/api_key/device_code/env) previously rendered an empty
 * box with a misleading "Type API key and press Enter" footer, and
 * handleProviderSelect always routed it to the broken generic authenticate
 * step regardless of its real connection state. This exercises the real
 * bespoke probe-and-route path added to fix that.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { renderWithProviders } from '../../test-utils/render.js';
import { PlumbProviderSetupDialog } from './PlumbProviderSetupDialog.js';
import { PlumbProviderCategory } from '@google/gemini-cli-provider';
import type {
  PlumbProvider,
  ClaudeSubscriptionStatusResult,
} from '@google/gemini-cli-provider';

const ENTER = String.fromCharCode(13);
const DOWN_ARROW = String.fromCharCode(27) + '[B';

const { mockGetClaudeSubscriptionStatus } = vi.hoisted(() => ({
  mockGetClaudeSubscriptionStatus:
    vi.fn<() => Promise<ClaudeSubscriptionStatusResult>>(),
}));

vi.mock('@google/gemini-cli-provider', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@google/gemini-cli-provider')>();
  return {
    ...actual,
    getClaudeSubscriptionStatus: mockGetClaudeSubscriptionStatus,
  };
});

const claudeSubscriptionProvider: PlumbProvider = {
  id: 'claude-subscription',
  name: 'Claude Subscription',
  category: PlumbProviderCategory.OAUTH_ACCOUNT,
  description: 'Claude Pro/Max/Team/Enterprise subscription via Agent SDK',
  authMethods: [{ type: 'none' }],
  available: false,
  group: 'OAuth Providers',
};

const mockProviders: PlumbProvider[] = [claudeSubscriptionProvider];
const mockCategoryGroups = new Map([
  ['OAuth Providers', [claudeSubscriptionProvider]],
]);

async function pressKey(stdin: { write: (data: string) => void }, key: string) {
  await act(async () => {
    vi.advanceTimersByTime(100);
    stdin.write(key);
  });
}

describe('PlumbProviderSetupDialog — Claude Subscription (Agent SDK)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockGetClaudeSubscriptionStatus.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('routes straight to model-select when the Agent SDK reports an active connected subscription', async () => {
    mockGetClaudeSubscriptionStatus.mockResolvedValue({
      status: 'CONNECTED_SUBSCRIPTION',
    });

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
    // connection-type: Coding Plan is first, so Down once to OAuth Account.
    await pressKey(stdin, DOWN_ARROW);
    await waitUntilReady();
    await pressKey(stdin, ENTER);
    await waitUntilReady();
    // provider-select -> claude-subscription (only entry in the group)
    await pressKey(stdin, ENTER);
    await waitUntilReady();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    await waitUntilReady();

    expect(mockGetClaudeSubscriptionStatus).toHaveBeenCalledTimes(1);
    const frame = lastFrame();
    // Step 4 is model-select — never the broken generic "Authenticate" step.
    expect(frame).toContain('Step 4');
    expect(frame).not.toContain('Authenticate: Claude Subscription');
  });

  it('shows a real, actionable NOT_LOGGED_IN message instead of the generic broken AuthStep', async () => {
    mockGetClaudeSubscriptionStatus.mockResolvedValue({
      status: 'NOT_LOGGED_IN',
    });

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
    await pressKey(stdin, DOWN_ARROW);
    await waitUntilReady();
    await pressKey(stdin, ENTER);
    await waitUntilReady();
    await pressKey(stdin, ENTER);
    await waitUntilReady();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    await waitUntilReady();

    const frame = lastFrame();
    expect(frame).toContain('claude login');
    expect(frame).not.toContain('Type API key and press Enter');
  });

  it('retries the probe on Enter after a failed/unresolved status', async () => {
    mockGetClaudeSubscriptionStatus
      .mockResolvedValueOnce({ status: 'AGENT_SDK_UNAVAILABLE' })
      .mockResolvedValueOnce({ status: 'CONNECTED_SUBSCRIPTION' });

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
    await pressKey(stdin, DOWN_ARROW);
    await waitUntilReady();
    await pressKey(stdin, ENTER);
    await waitUntilReady();
    await pressKey(stdin, ENTER);
    await waitUntilReady();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    await waitUntilReady();
    expect(mockGetClaudeSubscriptionStatus).toHaveBeenCalledTimes(1);

    // Retry
    await pressKey(stdin, ENTER);
    await waitUntilReady();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    await waitUntilReady();

    expect(mockGetClaudeSubscriptionStatus).toHaveBeenCalledTimes(2);
    expect(lastFrame()).toContain('Step 4');
  });
});
