/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression: `claude-subscription` is a PLUMB-only synthetic (Agent
 * SDK-backed) with no OMP catalog descriptor, so it is architecturally
 * excluded from SELECTABLE_PROVIDERS / getProviderSetupGroups() (a hard
 * invariant covered by catalog/providers.test.ts). Without a bespoke
 * injection here, the /login setup UI would never show it at all — it
 * would be fully built, tested, and catalogued, but completely
 * unreachable from the real product.
 */
import { describe, it, expect, vi } from 'vitest';
import { act } from 'react';
import { renderHook } from '../../test-utils/render.js';
import { useProviderSetupData } from './useProviderSetupData.js';
import {
  PlumbProviderCategory,
  type PlumbProvider,
} from '@google/gemini-cli-provider';

const claudeSubscriptionProvider: PlumbProvider = {
  id: 'claude-subscription',
  name: 'Claude Subscription',
  category: PlumbProviderCategory.OAUTH_ACCOUNT,
  description: 'Claude Pro/Max/Team/Enterprise subscription via Agent SDK',
  authMethods: [{ type: 'none' }],
  available: false,
  group: 'OAuth Providers',
};

const watsonxProvider: PlumbProvider = {
  id: 'watsonx',
  name: 'IBM watsonx.ai',
  category: PlumbProviderCategory.API_KEY,
  description: 'IBM watsonx.ai foundation models',
  authMethods: [{ type: 'api_key', envVar: 'IBM_CLOUD_API_KEY' }],
  available: false,
  group: 'API Providers',
};

vi.mock('@google/gemini-cli-provider', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@google/gemini-cli-provider')>();
  return {
    ...actual,
    getPlumbModelRegistry: () => ({
      getAllAvailableModels: () => [],
    }),
    getProviderSetupGroups: () =>
      new Map([
        [
          'OAuth Providers',
          [{ id: 'xai-oauth', name: 'xAI', group: 'OAuth Providers' }],
        ],
      ]),
    getPlumbProvider: (id: string) => {
      if (id === 'claude-subscription') return claudeSubscriptionProvider;
      if (id === 'watsonx') return watsonxProvider;
      return undefined;
    },
  };
});

describe('useProviderSetupData', () => {
  it('injects claude-subscription into the provider list even though it is excluded from SELECTABLE_PROVIDERS', async () => {
    let result: { current: ReturnType<typeof useProviderSetupData> };
    await act(async () => {
      ({ result } = await renderHook(() => useProviderSetupData(true)));
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    expect(
      result!.current.providers.some((p) => p.id === 'claude-subscription'),
    ).toBe(true);
  });

  it('injects claude-subscription into its presentation group (OAuth Providers) in categoryGroups', async () => {
    let result: { current: ReturnType<typeof useProviderSetupData> };
    await act(async () => {
      ({ result } = await renderHook(() => useProviderSetupData(true)));
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    const oauthGroup = result!.current.categoryGroups.get('OAuth Providers');
    expect(oauthGroup).toBeDefined();
    expect(oauthGroup!.some((p) => p.id === 'claude-subscription')).toBe(true);
    // The pre-existing OMP-backed entry in that group must still be there —
    // injection must append, not replace.
    expect(oauthGroup!.some((p) => p.id === 'xai-oauth')).toBe(true);
  });

  it('injects watsonx into the provider list and its presentation group (API Providers), alongside claude-subscription', async () => {
    let result: { current: ReturnType<typeof useProviderSetupData> };
    await act(async () => {
      ({ result } = await renderHook(() => useProviderSetupData(true)));
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    expect(result!.current.providers.some((p) => p.id === 'watsonx')).toBe(
      true,
    );
    const apiGroup = result!.current.categoryGroups.get('API Providers');
    expect(apiGroup).toBeDefined();
    expect(apiGroup!.some((p) => p.id === 'watsonx')).toBe(true);
  });

  it('returns empty data when closed, without injecting claude-subscription', async () => {
    const { result, waitUntilReady } = await renderHook(() =>
      useProviderSetupData(false),
    );
    await waitUntilReady();

    expect(result.current.providers).toEqual([]);
    expect(result.current.categoryGroups.size).toBe(0);
  });
});
