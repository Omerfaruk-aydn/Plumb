/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '../../test-utils/render.js';
import { useModelDialogData } from './useModelDialogData.js';
import type { PlumbProviderState } from '@plumb/provider';

let activeStates: PlumbProviderState[];
let getModelsForProviderMock: ReturnType<typeof vi.fn>;
let discoverProviderModelsMock: ReturnType<typeof vi.fn>;
let markProviderActiveMock: ReturnType<typeof vi.fn>;
let claudeSubscriptionStatusMock: ReturnType<typeof vi.fn>;

vi.mock('@plumb/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@plumb/provider')>();
  return {
    ...actual,
    getPlumbProviderRegistry: () => ({
      getActiveProviderStates: () => activeStates,
      markProviderActiveWithoutCredential: markProviderActiveMock,
    }),
    getPlumbModelRegistry: () => ({
      getModelsForProvider: getModelsForProviderMock,
      discoverProviderModels: discoverProviderModelsMock,
    }),
    // Must be mocked: the real implementation spawns the official Claude
    // CLI as a subprocess, which would make every test in this file both
    // slow and dependent on the developer's own sign-in state.
    getClaudeSubscriptionStatus: () => claudeSubscriptionStatusMock(),
  };
});

function makeState(
  providerId: string,
  credentials: PlumbProviderState['credentials'],
): PlumbProviderState {
  return {
    provider: { id: providerId, name: providerId } as never,
    authState: 'authenticated',
    credentials,
  };
}

describe('useModelDialogData', () => {
  beforeEach(() => {
    getModelsForProviderMock = vi.fn(() => []);
    discoverProviderModelsMock = vi.fn().mockResolvedValue([]);
    markProviderActiveMock = vi.fn();
    claudeSubscriptionStatusMock = vi
      .fn()
      .mockResolvedValue({ status: 'NOT_LOGGED_IN' });
  });

  it('does not call discoverProviderModels when no active provider carries a credential', async () => {
    activeStates = [makeState('ollama', null)];
    const { waitUntilReady } = await renderHook(() => useModelDialogData(true));
    await waitUntilReady();
    // Give the background-refresh microtask queue a tick even though it
    // should short-circuit before ever reaching discoverProviderModels.
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(discoverProviderModelsMock).not.toHaveBeenCalled();
  });

  it('refreshes dynamic discovery for an authenticated api_key provider', async () => {
    activeStates = [
      makeState('google-vertex', {
        type: 'api_key',
        provider: 'google-vertex',
        key: 'vertex-key',
      }),
    ];
    const { waitUntilReady } = await renderHook(() => useModelDialogData(true));
    await waitUntilReady();
    // Wait long enough for the post-render `setData` from the
    // background refresh to complete too — the hook now does an
    // extra state update after discovery, so the test must let
    // the act() boundary settle.
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(discoverProviderModelsMock).toHaveBeenCalledWith(
      'google-vertex',
      'vertex-key',
      undefined,
    );
  });

  it('refreshes dynamic discovery for an authenticated oauth provider using the access token', async () => {
    activeStates = [
      makeState('anthropic', {
        type: 'oauth',
        provider: 'anthropic',
        access: 'anthropic-access-token',
        refresh: 'r',
        expires: Date.now() + 3600_000,
      }),
    ];
    const { waitUntilReady } = await renderHook(() => useModelDialogData(true));
    await waitUntilReady();
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(discoverProviderModelsMock).toHaveBeenCalledWith(
      'anthropic',
      undefined,
      'anthropic-access-token',
    );
  });

  it('does not throw or hang when discoverProviderModels rejects', async () => {
    discoverProviderModelsMock = vi
      .fn()
      .mockRejectedValue(new Error('network down'));
    activeStates = [
      makeState('google-vertex', {
        type: 'api_key',
        provider: 'google-vertex',
        key: 'vertex-key',
      }),
    ];
    const { result, waitUntilReady } = await renderHook(() =>
      useModelDialogData(true),
    );
    await waitUntilReady();
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(result.current.loading).toBe(false);
  });

  it('returns empty data immediately when closed, without touching the registry', async () => {
    activeStates = [];
    const { result, waitUntilReady } = await renderHook(() =>
      useModelDialogData(false),
    );
    await waitUntilReady();

    expect(result.current).toEqual({ usableProviders: [], loading: true });
    expect(discoverProviderModelsMock).not.toHaveBeenCalled();
  });

  // ─── REGRESSION: claude-subscription must be in the refresh path ────
  //
  // Claude Subscription is a synthetic OAuth-only provider whose
  // auth state is owned by the official Agent SDK (no PLUMB-side
  // api_key or oauth token), so it never enters the credentialed
  // refresh list. Without an explicit refresh entry the dialog
  // would be stuck on the static 2-model OFFICIAL_STATIC_METADATA
  // floor even when the live `Query.supportedModels()` call would
  // return a different account/plan-aware list — the exact "still
  // only 2 models" bug from the production report. The Agent SDK
  // never receives PLUMB credentials, so refresh is a bare
  // providerId (no apiKey, no oauthToken).
  it('REGRESSION (claude-subscription refresh): calls discoverProviderModels for claude-subscription even when its state carries no PLUMB credentials', async () => {
    activeStates = [makeState('claude-subscription', null)];
    const { waitUntilReady } = await renderHook(() => useModelDialogData(true));
    await waitUntilReady();
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(discoverProviderModelsMock).toHaveBeenCalledWith(
      'claude-subscription',
    );
  });
});
