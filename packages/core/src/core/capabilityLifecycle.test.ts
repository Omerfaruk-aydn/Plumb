/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Capability lifecycle regression coverage: cold-start, refresh,
 * account-switch, and provider/model switch-matrix isolation.
 *
 * PlumbContentGenerator.generateContentStream re-derives
 * Config.setActiveModelToolsCapability from the registry's
 * `findModel(provider, modelId)` result on EVERY turn (see
 * plumbContentGenerator.ts: "Keep Config's tool-capability authority ...
 * in sync with what the registry actually resolved for this exact
 * provider+model on every turn -- not just at selection time"). This is
 * a live re-derivation, not an accumulated cache, so it structurally
 * cannot "self-heal on request #2": request #1 already reads the live
 * registry result. These tests pin that contract down across the
 * specific lifecycle scenarios the audit calls out.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GenerateContentParameters } from '@google/genai';
import { LlmRole } from '../telemetry/llmRole.js';
import { Config } from '../config/config.js';

const testRequest: GenerateContentParameters = {
  model: 'unused',
  contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
};
const testRole = LlmRole.MAIN;

const {
  mockFindModel,
  mockResolveProviderAlias,
  mockPlumbModelStream,
  mockLoadCache,
} = vi.hoisted(() => ({
  mockFindModel: vi.fn(),
  mockResolveProviderAlias: vi.fn((id: string) => id),
  mockPlumbModelStream: vi.fn(async function* () {
    yield { type: 'done', finishReason: 'stop' };
  }),
  mockLoadCache: vi.fn(),
}));

vi.mock('@google/gemini-cli-provider', () => ({
  getPlumbModelRegistry: () => ({
    findModel: mockFindModel,
    loadCache: mockLoadCache,
  }),
  resolveProviderAlias: mockResolveProviderAlias,
  getLocalProviderEndpointDefinition: vi.fn(),
  resolveLocalProviderBaseUrl: vi.fn(),
  plumbModelStream: mockPlumbModelStream,
}));

vi.mock('./claudeSubscriptionToolBridge.js', () => ({
  createClaudeSubscriptionToolExecutor: vi.fn(),
}));

vi.mock('../utils/gitUtils', () => ({
  isGitRepository: vi.fn().mockReturnValue(false),
}));

import { PlumbContentGenerator } from './plumbContentGenerator.js';

/** Minimal real-Config-shaped stand-in, same pattern as promptToolCoherence.test.ts. */
function buildConfig(): Config {
  const config = {
    plumbProviderId: 'seed', // PLUMB-routed (non-null) for every test below
    activeModelToolsSupported: undefined,
    activeModelToolsCapabilitySource: 'UNKNOWN',
  } as unknown as Config;

  type Bindable = Record<string, (...args: never[]) => unknown>;
  const proto = Config.prototype as unknown as Bindable;
  const target = config as unknown as Bindable;
  for (const method of [
    'getPlumbProvider',
    'setPlumbProvider',
    'getActiveModelToolsCapability',
    'setActiveModelToolsCapability',
    'getEffectiveToolsAdvertisable',
  ]) {
    target[method] = proto[method].bind(config);
  }
  return config;
}

async function driveOneTurn(
  gcConfig: Config,
  provider: string,
  modelId: string,
  registryModel: { toolsSupported?: boolean; toolsCapabilitySource?: string },
) {
  mockFindModel.mockReturnValueOnce({
    id: modelId,
    provider,
    api: 'openai-completions',
    contextWindow: 100_000,
    maxTokens: 4096,
    ...registryModel,
  });
  const generator = new PlumbContentGenerator(
    provider,
    modelId,
    'api-key',
    gcConfig,
  );
  const stream = await generator.generateContentStream(
    testRequest,
    'prompt-id',
    testRole,
  );
  for await (const _ of stream) {
    // drain
  }
}

describe('capability lifecycle', () => {
  beforeEach(() => {
    mockFindModel.mockReset();
    mockResolveProviderAlias.mockClear();
    mockPlumbModelStream.mockClear();
    mockLoadCache.mockReset();
  });

  it('COLD_START: the very first resolution after a clean Config init reports correct capability -- no "self-heals on request #2" pattern', async () => {
    const gcConfig = buildConfig();
    // Before any turn: capability is UNKNOWN (Config's initial state), gate is closed.
    expect(gcConfig.getEffectiveToolsAdvertisable()).toBe(false);

    await driveOneTurn(gcConfig, 'opencode-zen', 'grok-4.5', {
      toolsSupported: true,
      toolsCapabilitySource: 'PROVIDER_DYNAMIC',
    });

    // Request #1 itself already reflects the real capability -- not just
    // request #2 onward.
    expect(gcConfig.getEffectiveToolsAdvertisable()).toBe(true);
    expect(gcConfig.getActiveModelToolsCapability()).toEqual({
      supported: true,
      source: 'PROVIDER_DYNAMIC',
    });
  });

  it('REFRESH: UNKNOWN -> true flips prompt+wire tool state together on the very next turn after a model-list/capability refresh', async () => {
    const gcConfig = buildConfig();

    await driveOneTurn(gcConfig, 'opencode-zen', 'some-model', {
      toolsSupported: undefined,
      toolsCapabilitySource: undefined,
    });
    expect(gcConfig.getEffectiveToolsAdvertisable()).toBe(false);

    // Simulate a Ctrl+R-style refresh: the registry now resolves the same
    // model with real, newly-discovered capability metadata.
    await driveOneTurn(gcConfig, 'opencode-zen', 'some-model', {
      toolsSupported: true,
      toolsCapabilitySource: 'PROVIDER_DYNAMIC',
    });
    expect(gcConfig.getEffectiveToolsAdvertisable()).toBe(true);
  });

  it('REFRESH: true -> false/unknown also flips immediately (capability can regress, e.g. a provider revoking function-calling for an id)', async () => {
    const gcConfig = buildConfig();

    await driveOneTurn(gcConfig, 'opencode-zen', 'some-model', {
      toolsSupported: true,
      toolsCapabilitySource: 'PROVIDER_DYNAMIC',
    });
    expect(gcConfig.getEffectiveToolsAdvertisable()).toBe(true);

    await driveOneTurn(gcConfig, 'opencode-zen', 'some-model', {
      toolsSupported: undefined,
      toolsCapabilitySource: undefined,
    });
    expect(gcConfig.getEffectiveToolsAdvertisable()).toBe(false);
  });

  it('ACCOUNT_SWITCH: for an account-scoped provider, a capability resolved under account A does not leak into the resolution reported after switching to account B for the same model id', async () => {
    const gcConfig = buildConfig();

    // Account A's registry resolution for this model: tools supported.
    await driveOneTurn(gcConfig, 'claude-subscription', 'opus', {
      toolsSupported: true,
      toolsCapabilitySource: 'PINNED_REFERENCE',
    });
    expect(gcConfig.getEffectiveToolsAdvertisable()).toBe(true);

    // Switch accounts: the registry now resolves the SAME provider+model
    // id under account B, whose live discovery reports no capability
    // metadata at all (e.g. B's org has no MCP bridge exposed). The next
    // turn must reflect B's real state, not bleed A's `true` forward.
    await driveOneTurn(gcConfig, 'claude-subscription', 'opus', {
      toolsSupported: undefined,
      toolsCapabilitySource: undefined,
    });
    expect(gcConfig.getEffectiveToolsAdvertisable()).toBe(false);
  });

  it('PROVIDER_MODEL_SWITCH_MATRIX: SUPPORTED A -> UNKNOWN B -> UNSUPPORTED C -> SUPPORTED A, zero bleed at every step', async () => {
    const gcConfig = buildConfig();

    await driveOneTurn(gcConfig, 'provider-a', 'model-a', {
      toolsSupported: true,
      toolsCapabilitySource: 'PROVIDER_DYNAMIC',
    });
    expect(gcConfig.getEffectiveToolsAdvertisable()).toBe(true);

    await driveOneTurn(gcConfig, 'provider-b', 'model-b', {
      toolsSupported: undefined,
      toolsCapabilitySource: undefined,
    });
    expect(gcConfig.getEffectiveToolsAdvertisable()).toBe(false);

    await driveOneTurn(gcConfig, 'provider-c', 'model-c', {
      toolsSupported: false,
      toolsCapabilitySource: 'BUNDLED_CATALOG',
    });
    expect(gcConfig.getEffectiveToolsAdvertisable()).toBe(false);

    await driveOneTurn(gcConfig, 'provider-a', 'model-a', {
      toolsSupported: true,
      toolsCapabilitySource: 'PROVIDER_DYNAMIC',
    });
    expect(gcConfig.getEffectiveToolsAdvertisable()).toBe(true);
  });

  it('PROVIDER_MODEL_SWITCH_MATRIX: the same display model id resolved through two different providers stays isolated (no cross-provider bleed keyed only on modelId)', async () => {
    const gcConfig = buildConfig();

    // Same modelId "grok-4.5" under two different providers with opposite capability.
    await driveOneTurn(gcConfig, 'provider-x', 'grok-4.5', {
      toolsSupported: true,
      toolsCapabilitySource: 'PROVIDER_DYNAMIC',
    });
    expect(gcConfig.getEffectiveToolsAdvertisable()).toBe(true);

    await driveOneTurn(gcConfig, 'provider-y', 'grok-4.5', {
      toolsSupported: false,
      toolsCapabilitySource: 'BUNDLED_CATALOG',
    });
    expect(gcConfig.getEffectiveToolsAdvertisable()).toBe(false);

    await driveOneTurn(gcConfig, 'provider-x', 'grok-4.5', {
      toolsSupported: true,
      toolsCapabilitySource: 'PROVIDER_DYNAMIC',
    });
    expect(gcConfig.getEffectiveToolsAdvertisable()).toBe(true);
  });
});
