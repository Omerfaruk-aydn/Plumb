/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { renderWithProviders } from '../../test-utils/render.js';
import { PlumbProviderSetupDialog } from './PlumbProviderSetupDialog.js';
import { PlumbProviderCategory } from '@plumb/provider';
import type {
  PlumbProvider,
  PlumbModel,
  ClaudeSubscriptionStatusResult,
} from '@plumb/provider';

const ENTER = String.fromCharCode(13);
const DOWN_ARROW = String.fromCharCode(27) + '[B';

const { mockGetClaudeSubscriptionStatus, mockRunClaudeSubscriptionReauth } =
  vi.hoisted(() => ({
    mockGetClaudeSubscriptionStatus:
      vi.fn<() => Promise<ClaudeSubscriptionStatusResult>>(),
    mockRunClaudeSubscriptionReauth: vi.fn<
      () => Promise<{
        outcome:
          | 'COMPLETED'
          | 'CLI_NOT_FOUND'
          | 'SPAWN_FAILED'
          | 'NONZERO_EXIT';
        exitCode?: number | null;
        detail?: string;
      }>
    >(),
  }));

vi.mock('@plumb/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@plumb/provider')>();
  return {
    ...actual,
    getClaudeSubscriptionStatus: mockGetClaudeSubscriptionStatus,
    runClaudeSubscriptionReauth: mockRunClaudeSubscriptionReauth,
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
    mockRunClaudeSubscriptionReauth.mockReset();
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

  it("retries the read-only probe on 'r' after a failed/unresolved status, without launching the official CLI", async () => {
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

    // Retry via 'r' -- must re-probe only, never spawn the official CLI.
    await pressKey(stdin, 'r');
    await waitUntilReady();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    await waitUntilReady();

    expect(mockGetClaudeSubscriptionStatus).toHaveBeenCalledTimes(2);
    expect(mockRunClaudeSubscriptionReauth).not.toHaveBeenCalled();
    expect(lastFrame()).toContain('Step 4');
  });

  // Bug 1 regression: "Re-authenticate" (and the initial NOT_LOGGED_IN
  // screen's Enter key) must perform a REAL action -- handing the terminal
  // to the official Claude CLI's `setup-token` command -- never a dead end
  // that just re-runs the same read-only probe with no way to actually sign
  // in.
  it('Enter on the authenticate step launches the official Claude CLI sign-in and re-probes on success', async () => {
    mockGetClaudeSubscriptionStatus
      .mockResolvedValueOnce({ status: 'NOT_LOGGED_IN' })
      .mockResolvedValueOnce({ status: 'CONNECTED_SUBSCRIPTION' });
    mockRunClaudeSubscriptionReauth.mockResolvedValue({
      outcome: 'COMPLETED',
      exitCode: 0,
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
    expect(mockGetClaudeSubscriptionStatus).toHaveBeenCalledTimes(1);

    // Real re-auth action, not the dead-end "Press Enter to retry" text.
    await pressKey(stdin, ENTER);
    await waitUntilReady();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    await waitUntilReady();

    expect(mockRunClaudeSubscriptionReauth).toHaveBeenCalledTimes(1);
    // Success re-probes the real status rather than assuming from exit code.
    expect(mockGetClaudeSubscriptionStatus).toHaveBeenCalledTimes(2);
    expect(lastFrame()).toContain('Step 4');
  });

  it('shows an honest error (never a fake success) when the official CLI cannot be launched', async () => {
    mockGetClaudeSubscriptionStatus.mockResolvedValueOnce({
      status: 'NOT_LOGGED_IN',
    });
    mockRunClaudeSubscriptionReauth.mockResolvedValue({
      outcome: 'CLI_NOT_FOUND',
      detail: 'The official Claude CLI was not found.',
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

    await pressKey(stdin, ENTER);
    await waitUntilReady();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    await waitUntilReady();

    expect(mockRunClaudeSubscriptionReauth).toHaveBeenCalledTimes(1);
    // getClaudeSubscriptionStatus is NOT called again -- CLI_NOT_FOUND/
    // SPAWN_FAILED are launch failures, not "maybe it worked" ambiguity.
    expect(mockGetClaudeSubscriptionStatus).toHaveBeenCalledTimes(1);
    expect(lastFrame()).toContain('The official Claude CLI was not found.');
  });

  // Regression: onRefreshFullModels (called on every CONNECTED_SUBSCRIPTION
  // probe -- see probeClaudeSubscription) returns the SAME already-known
  // model list, not just newly-discovered entries. Concatenating it onto
  // the dialog's initial `fullModels` prop without deduping doubled every
  // entry in the Step 4 picker (e.g. "Claude Sonnet 5" listed twice).
  it('does not double-list models when onRefreshFullModels returns the same models already passed via fullModels', async () => {
    mockGetClaudeSubscriptionStatus.mockResolvedValue({
      status: 'CONNECTED_SUBSCRIPTION',
    });
    const fixtureModels: PlumbModel[] = [
      {
        id: 'default',
        provider: 'claude-subscription',
        api: 'claude-agent-sdk',
        name: 'Default (recommended)',
        contextWindow: 200_000,
        maxTokens: 16_000,
        input: 'text',
      },
      {
        id: 'claude-sonnet-5',
        provider: 'claude-subscription',
        api: 'claude-agent-sdk',
        name: 'Claude Sonnet 5',
        contextWindow: 200_000,
        maxTokens: 64_000,
        input: 'text',
      },
    ];
    const onRefreshFullModels = vi.fn().mockResolvedValue(fixtureModels);

    const { stdin, lastFrame, waitUntilReady } = await renderWithProviders(
      <PlumbProviderSetupDialog
        onComplete={vi.fn()}
        onCancel={vi.fn()}
        providers={mockProviders}
        categoryGroups={mockCategoryGroups}
        models={[]}
        fullModels={fixtureModels}
        onRefreshFullModels={onRefreshFullModels}
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

    expect(onRefreshFullModels).toHaveBeenCalledTimes(1);
    const frame = lastFrame();
    // The dialog also always merges in the CLAUDE_SUBSCRIPTION_MODELS pinned
    // floor as a safety net (currently 3 entries with no overlap against
    // this fixture), so the real assertion here is "no duplicates", not an
    // exact count tied to the floor list's size.
    expect(frame?.match(/Default \(recommended\)/g)?.length).toBe(1);
    expect(frame?.match(/Claude Sonnet 5/g)?.length).toBe(1);
  });
});
