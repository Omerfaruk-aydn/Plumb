/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '../../test-utils/render.js';
import { useModelDialogData } from './useModelDialogData.js';
import type { PlumbProviderState } from '@google/gemini-cli-provider';

let activeStates: PlumbProviderState[];
let getModelsForProviderMock: ReturnType<typeof vi.fn>;
let discoverProviderModelsMock: ReturnType<typeof vi.fn>;

vi.mock('@google/gemini-cli-provider', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@google/gemini-cli-provider')>();
  return {
    ...actual,
    getPlumbProviderRegistry: () => ({
      getActiveProviderStates: () => activeStates,
    }),
    getPlumbModelRegistry: () => ({
      getModelsForProvider: getModelsForProviderMock,
      discoverProviderModels: discoverProviderModelsMock,
    }),
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
  });

  it('does not call discoverProviderModels when no active provider carries a credential', async () => {
    activeStates = [makeState('ollama', null)];
    const { waitUntilReady } = await renderHook(() => useModelDialogData(true));
    await waitUntilReady();
    // Give the background-refresh microtask queue a tick even though it
    // should short-circuit before ever reaching discoverProviderModels.
    await new Promise((resolve) => setTimeout(resolve, 10));

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
    await new Promise((resolve) => setTimeout(resolve, 10));

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
    await new Promise((resolve) => setTimeout(resolve, 10));

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
    await new Promise((resolve) => setTimeout(resolve, 10));

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
});
