/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { PLUMB_PROVIDERS, SELECTABLE_PROVIDERS } from './catalog/providers.js';
import { getCatalogModel } from './catalog/model-catalog.js';
import {
  buildEffectiveToolRouteContract,
  createEffectiveToolRouteCache,
  generatePlumbProviderProtocolMatrix,
  makeEffectiveToolRouteKey,
  resolveEffectiveWireModelId,
} from './route-contract.js';
import type { PlumbModel } from './types.js';

function model(overrides: Partial<PlumbModel> = {}): PlumbModel {
  return {
    id: 'shared-model',
    provider: 'provider-a',
    api: 'openai-completions',
    baseUrl: 'https://a.example/v1',
    requestModelId: 'wire-shared',
    contextWindow: 32_000,
    maxTokens: 4096,
    input: 'text',
    toolsSupported: true,
    toolsCapabilitySource: 'PINNED_REFERENCE',
    ...overrides,
  };
}

describe('effective provider/model/route tool contract', () => {
  it('keeps base-model capability distinct from the structured route protocol', () => {
    const contract = buildEffectiveToolRouteContract({
      providerId: 'provider-a',
      model: model({ toolsSupported: false }),
    });

    expect(contract.baseModelTools.status).toBe('UNSUPPORTED');
    expect(contract.structuredProtocol).toEqual({
      kind: 'OPENAI_CHAT_FUNCTION_TOOLS',
      capability: {
        status: 'SUPPORTED',
        source: 'DIALECT_IMPLEMENTATION',
      },
    });
  });

  it('never claims model-controlled auto selection from emission defaults', () => {
    const contract = buildEffectiveToolRouteContract({
      providerId: 'nvidia',
      model: model({ provider: 'nvidia' }),
    });

    expect(contract.toolChoice.emission).toBe('REQUIRED_WHEN_TOOLS_PRESENT');
    expect(contract.toolChoice.auto).toEqual({
      status: 'UNKNOWN',
      source: 'UNKNOWN',
    });
    expect(contract.toolChoice.required.status).toBe('SUPPORTED');
    expect(contract.toolChoice.named.status).toBe('SUPPORTED');
  });

  it('captures dialect, endpoint family/path, wire model and provenance', () => {
    const contract = buildEffectiveToolRouteContract({
      providerId: 'amazon-bedrock',
      model: model({
        provider: 'amazon-bedrock',
        api: 'bedrock-converse-stream',
        requestModelId: 'anthropic.claude-v1:0',
        baseUrl: undefined,
      }),
    });

    expect(contract.scope).toMatchObject({
      providerId: 'amazon-bedrock',
      modelId: 'shared-model',
      wireModelId: 'anthropic.claude-v1:0',
      dialect: 'bedrock-converse-stream',
      endpoint: {
        family: 'AWS_BEDROCK_CONVERSE',
        path: '/model/anthropic.claude-v1%3A0/converse-stream',
        source: 'DIALECT_DEFAULT',
      },
    });
    expect(contract.parser.output).toBe('NORMALIZED_TOOL_CALL_EVENT');
    expect(contract.parser.fragmentAssembly.status).toBe('SUPPORTED');
    expect(contract.replay.toolResults.status).toBe('SUPPORTED');
    expect(contract.provenance.baseModelTools).toBe('PINNED_REFERENCE');
  });

  it('keeps strict, parallel, reasoning and replay/parser statuses explicit', () => {
    const contract = buildEffectiveToolRouteContract({
      providerId: 'provider-a',
      model: model({ reasoning: true }),
    });

    expect(contract.strictToolSchema.status).toBe('UNKNOWN');
    expect(contract.parallelToolCalls.status).toBe('UNKNOWN');
    expect(contract.reasoningWithTools.status).toBe('UNKNOWN');
    expect(contract.replay.capability.status).toBe('SUPPORTED');
    expect(contract.parser.capability.status).toBe('SUPPORTED');
  });

  it('does not overclaim active aliases, Gemini ids, or unsupported selectors', () => {
    const codex = buildEffectiveToolRouteContract({
      providerId: 'openai-codex',
      model: model({ api: 'openai-codex-responses' }),
    });
    expect(codex.structuredProtocol.capability.status).toBe('UNKNOWN');
    expect(codex.scope.endpoint.path).toBe('/chat/completions');

    const gemini = buildEffectiveToolRouteContract({
      providerId: 'google',
      model: model({ api: 'google-generative-ai' }),
    });
    expect(gemini.parser.capability.status).toBe('SUPPORTED');
    expect(gemini.parser.callIdPreservation.status).toBe('UNKNOWN');

    const vertex = buildEffectiveToolRouteContract({
      providerId: 'google-vertex',
      model: model({ api: 'google-vertex' }),
    });
    expect(vertex.parser.callIdPreservation.status).toBe('UNSUPPORTED');

    const watsonx = buildEffectiveToolRouteContract({
      providerId: 'watsonx',
      model: model({ api: 'watsonx-chat' }),
    });
    expect(watsonx.toolChoice.required.status).toBe('UNSUPPORTED');
    expect(watsonx.toolChoice.named.status).toBe('UNSUPPORTED');
  });

  it('applies effort routing to wire model without changing the local model id', () => {
    const routed = model({
      requestModelId: 'wire-default',
      thinking: {
        effortRouting: { low: 'wire-low', high: 'wire-high' },
      },
    });
    expect(resolveEffectiveWireModelId(routed, 'high')).toBe('wire-high');

    const contract = buildEffectiveToolRouteContract({
      providerId: 'provider-a',
      model: routed,
      reasoningEffort: 'high',
    });
    expect(contract.scope.modelId).toBe('shared-model');
    expect(contract.scope.wireModelId).toBe('wire-high');
  });

  it('keys and caches by provider + model + dialect + endpoint + wire model', () => {
    const routeA = buildEffectiveToolRouteContract({
      providerId: 'provider-a',
      model: model(),
    });
    const routeB = buildEffectiveToolRouteContract({
      providerId: 'provider-b',
      model: model({ provider: 'provider-b' }),
    });
    const routeEndpoint = buildEffectiveToolRouteContract({
      providerId: 'provider-a',
      model: model(),
      endpointOverride: 'https://other.example/v1/',
    });

    expect(routeA.scope.cacheKey).not.toBe(routeB.scope.cacheKey);
    expect(routeA.scope.cacheKey).not.toBe(routeEndpoint.scope.cacheKey);
    expect(routeA.scope.cacheKey).toBe(makeEffectiveToolRouteKey(routeA.scope));

    const cache = createEffectiveToolRouteCache<number>();
    cache.set(routeA, 1);
    cache.set(routeB, 2);
    cache.set(routeEndpoint, 3);
    expect(cache.size).toBe(3);
    expect(cache.get(routeA)).toBe(1);
    expect(cache.get(routeB)).toBe(2);
    expect(cache.get(routeEndpoint)).toBe(3);
  });

  it('keeps policy/parser/endpoint/model state isolated across provider switches', () => {
    const sequence = [
      ['opencode-zen', 'openai-responses', 'https://opencode.ai/zen/v1'],
      ['nvidia', 'openai-completions', 'https://integrate.api.nvidia.com/v1'],
      ['anthropic-api', 'anthropic-messages', 'https://api.anthropic.com'],
      [
        'google',
        'google-generative-ai',
        'https://generativelanguage.googleapis.com/v1beta',
      ],
      ['vllm', 'openai-completions', 'http://127.0.0.1:8000/v1'],
      ['opencode-go', 'openai-completions', 'https://opencode.ai/go/v1'],
    ] as const;
    const contracts = sequence.map(([providerId, api, baseUrl]) =>
      buildEffectiveToolRouteContract({
        providerId,
        model: model({
          id: 'same-display-model',
          provider: providerId,
          api,
          baseUrl,
        }),
      }),
    );
    expect(
      new Set(contracts.map((contract) => contract.scope.cacheKey)).size,
    ).toBe(sequence.length);
    expect(contracts[0].scope.endpoint.family).toBe('OPENAI_RESPONSES');
    expect(contracts[1].toolChoice.emission).toBe(
      'REQUIRED_WHEN_TOOLS_PRESENT',
    );
    expect(contracts[2].structuredProtocol.kind).toBe(
      'ANTHROPIC_MESSAGES_TOOLS',
    );
    expect(contracts[3].parser.capability.status).toBe('SUPPORTED');
    expect(contracts[4].scope.endpoint.baseUrl).toBe(
      'http://127.0.0.1:8000/v1',
    );
    expect(contracts[5].scope.providerId).toBe('opencode-go');
    expect(contracts[5].toolChoice.emission).toBe('OPTIONAL');
  });

  it('preserves selected PLUMB provider identity when the model uses an OMP alias', () => {
    const anthropic = getCatalogModel('anthropic-api', 'claude-sonnet-4-5');
    expect(anthropic).toBeDefined();
    const contract = buildEffectiveToolRouteContract({
      providerId: 'anthropic-api',
      model: anthropic!,
    });
    expect(contract.scope.providerId).toBe('anthropic-api');
    expect(contract.scope.modelId).toBe(anthropic!.id);
  });
});

describe('generated PLUMB provider protocol matrix', () => {
  it('derives exact registered/selectable counts and one row per registry provider', () => {
    const matrix = generatePlumbProviderProtocolMatrix();
    expect(matrix.counts.registeredProviders).toBe(PLUMB_PROVIDERS.length);
    expect(matrix.counts.selectableProviders).toBe(SELECTABLE_PROVIDERS.length);
    expect(matrix.counts.providerRows).toBe(PLUMB_PROVIDERS.length);
    expect(matrix.providers).toHaveLength(PLUMB_PROVIDERS.length);
    expect(new Set(matrix.providers.map((row) => row.providerId)).size).toBe(
      PLUMB_PROVIDERS.length,
    );
  });

  it('includes every registered provider row in registry order', () => {
    const matrix = generatePlumbProviderProtocolMatrix();
    expect(matrix.providers.map((row) => row.providerId)).toEqual(
      PLUMB_PROVIDERS.map((provider) => provider.id),
    );
  });

  it('reports selectable state and model capability totals honestly', () => {
    const matrix = generatePlumbProviderProtocolMatrix();
    const selectable = new Set(SELECTABLE_PROVIDERS.map((p) => p.id));
    for (const row of matrix.providers) {
      expect(row.selectable).toBe(selectable.has(row.providerId));
      expect(row.availabilityStatus).toBe(
        row.selectable ? 'SELECTABLE' : 'REGISTERED_NOT_SELECTABLE',
      );
      expect(
        row.baseModelTools.supported +
          row.baseModelTools.unsupported +
          row.baseModelTools.unknown,
      ).toBe(row.modelRouteCount);
      expect(row.architectureFamily).toMatch(
        /^(SUBSCRIPTION|CODING_PLAN|OAUTH|DIRECT_API|CLOUD|GATEWAY|LOCAL|CUSTOM)$/,
      );
      expect(row.protocolFacts.map((fact) => fact.dialect)).toEqual(
        row.dialects,
      );
      for (const fact of row.protocolFacts) {
        expect(fact.activeAdapter).not.toBe('');
        expect(fact.toolDeclarationSerialization).not.toBe('');
        expect(fact.toolChoiceSerialization).not.toBe('');
        expect(fact.structuredResponseShape).not.toBe('');
        expect(fact.streamParser).not.toBe('');
        expect(fact.toolResultRepresentation).not.toBe('');
        expect(fact.continuationRepresentation).not.toBe('');
      }
    }
  });

  it('classifies registry architecture families and active adapter facts', () => {
    const matrix = generatePlumbProviderProtocolMatrix();
    const byId = new Map(matrix.providers.map((row) => [row.providerId, row]));
    expect(byId.get('claude-subscription')?.architectureFamily).toBe(
      'SUBSCRIPTION',
    );
    expect(byId.get('amazon-bedrock')?.architectureFamily).toBe('CLOUD');
    expect(byId.get('openrouter')?.architectureFamily).toBe('GATEWAY');
    expect(byId.get('ollama')?.architectureFamily).toBe('LOCAL');
    expect(byId.get('custom-openai-compat')?.architectureFamily).toBe('CUSTOM');
    expect(
      byId
        .get('openai')
        ?.protocolFacts.some(
          (fact) =>
            fact.dialect === 'openai-responses' &&
            fact.activeAdapter === 'streamOpenAIResponses',
        ),
    ).toBe(true);
  });
});
