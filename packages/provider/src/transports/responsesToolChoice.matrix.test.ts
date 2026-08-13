/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * OpenAI Responses fixture matrix. Every Responses-family route must be
 * validated independently for: tools serialization, auto selector, required
 * selector, named selector (Responses shape `{type:'function', name}` — NEVER
 * the Chat-Completions double-wrapper), and route capability. A shared dialect
 * implementation is allowed; a shared route-capability assumption is not.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  isResponsesApiFamily,
  serializeResponsesTools,
  serializeResponsesToolChoice,
} from './streaming.js';
import {
  deriveDialectToolChoiceCapability,
  deriveRouteToolChoiceCapability,
  resolveProviderRouteToolChoiceProof,
} from '../tool-policy.js';
import type { PlumbToolChoice } from '../types.js';

const probeTool = {
  type: 'function' as const,
  function: {
    name: 'plumb_tool_probe',
    description: 'no-op diagnostic',
    parameters: { type: 'object', properties: {} },
  },
};

const RESPONSES_FAMILY: Array<[string, string]> = [
  ['openai (direct)', 'openai-responses'],
  ['github-copilot', 'openai-responses'],
  ['azure Responses', 'azure-openai-responses'],
  ['OCI Responses', 'oci-openai-responses'],
  ['openai-codex', 'openai-codex-responses'],
];

describe('responses family tools serialization (flat, not wrapped)', () => {
  it.each(RESPONSES_FAMILY)('%s is a Responses family route', (_label, api) => {
    expect(isResponsesApiFamily(api)).toBe(true);
  });

  it.each(['openai-completions', 'openrouter'] as const)(
    '%s is NOT a Responses family route',
    (api) => {
      expect(isResponsesApiFamily(api)).toBe(false);
    },
  );

  it('serializes Responses tools as a flat function list', () => {
    const serialized = serializeResponsesTools([probeTool]) as Array<
      Record<string, unknown>
    >;
    expect(serialized).toHaveLength(1);
    const first = serialized[0];
    expect(first['type']).toBe('function');
    expect(first['name']).toBe('plumb_tool_probe');
    // Responses tools are NOT wrapped in `{function:{...}}`.
    expect(first['function']).toBeUndefined();
  });

  it.each([
    ['auto', { type: 'auto' }],
    ['required', { type: 'required' }],
    ['none', { type: 'none' }],
    ['named', { type: 'function', name: 'plumb_tool_probe' }],
  ] as const)(
    'serializes the %s Responses selector to %j',
    (mode, expected) => {
      const choice: PlumbToolChoice =
        mode === 'named'
          ? { mode: 'named', name: 'plumb_tool_probe' }
          : ({ mode } as PlumbToolChoice);
      expect(serializeResponsesToolChoice(choice)).toEqual(expected);
    },
  );

  it('NEVER emits the Chat-Completions double-wrapper for a named Responses selector', () => {
    const named = serializeResponsesToolChoice({
      mode: 'named',
      name: 'plumb_tool_probe',
    }) as Record<string, unknown>;
    expect(named['function']).toBeUndefined();
    expect(named['name']).toBe('plumb_tool_probe');
  });
});

describe('DIALECT vs ROUTE tool-choice capability (must not conflate)', () => {
  const dialectPolicy = {
    forcedToolChoiceSupported: true,
    namedToolChoiceSupported: true,
    source: 'DIALECT_DEFAULT' as const,
  };

  it('reports dialect-level forced/named as SUPPORTED', () => {
    const d = deriveDialectToolChoiceCapability(dialectPolicy);
    expect(d.required).toBe('SUPPORTED');
    expect(d.named).toBe('SUPPORTED');
    expect(d.source).toBe('DIALECT_DEFAULT');
  });

  it('does NOT upgrade an unverified route to SUPPORTED forced/named', () => {
    const d = deriveDialectToolChoiceCapability(dialectPolicy);
    // github-copilot has no VERIFIED proof => forced/named stay UNKNOWN even
    // though the dialect serializer supports them.
    const r = deriveRouteToolChoiceCapability('github-copilot', d);
    expect(r.routeVerified).toBe(false);
    expect(r.required).toBe('UNKNOWN');
    expect(r.named).toBe('UNKNOWN');
    // auto remains serialize-able (route-safe fallback), never fabricated as
    // a "forced probe".
    expect(r.auto).toBe('SUPPORTED');
  });

  it('preserves VERIFIED OpenCode Go/Zen route forced/named support', () => {
    const d = deriveDialectToolChoiceCapability(dialectPolicy);
    expect(resolveProviderRouteToolChoiceProof('opencode-go')).toBe('VERIFIED');
    expect(resolveProviderRouteToolChoiceProof('opencode-zen')).toBe(
      'VERIFIED',
    );
    const r = deriveRouteToolChoiceCapability('opencode-go', d);
    expect(r.required).toBe('SUPPORTED');
    expect(r.named).toBe('SUPPORTED');
  });

  it('marks Unverified google-vertex forced route as UNKNOWN (honest)', () => {
    const d = deriveDialectToolChoiceCapability(dialectPolicy);
    const r = deriveRouteToolChoiceCapability('google-vertex', d);
    expect(r.routeVerified).toBe(false);
    expect(r.named).toBe('UNKNOWN');
    expect(r.required).toBe('UNKNOWN');
  });
});
describe('wire integration: Responses-family tool_choice shape on the actual request', () => {
  const ORIGINAL_FETCH = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  async function captureBody(
    api: string,
    choice: PlumbToolChoice,
  ): Promise<{ url: string; body: Record<string, unknown> }> {
    let capturedUrl = '';
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = vi.fn(async (url: unknown, init?: unknown) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(String((init as RequestInit)?.body ?? '{}'));
      return new Response('data: [DONE]\n\n', { status: 200 });
    }) as typeof fetch;

    const { plumbModelStream } = await import('./streaming.js');
    const stream = plumbModelStream({
      model: {
        id: 'gpt-5.5',
        provider: 'github-copilot',
        api: api as 'openai-responses',
        baseUrl: 'https://api.githubcopilot.test/v1',
        contextWindow: 128000,
        maxTokens: 4096,
        input: 'text',
        toolsSupported: true,
        toolsCapabilitySource: 'BUNDLED_CATALOG',
      },
      messages: [{ role: 'user', content: 'Run the diagnostic tool.' }],
      tools: [probeTool],
      toolChoice: choice,
      apiKey: 'creds',
    });
    for await (const _e of stream) {
      /* drain */
    }
    return { url: capturedUrl, body: capturedBody };
  }

  it('Copilot (openai-responses) named selector hits the wire as {type:function,name} — NOT the Chat double-wrapper', async () => {
    const { body } = await captureBody('openai-responses', {
      mode: 'named',
      name: 'plumb_tool_probe',
    });
    expect(body['tool_choice']).toEqual({
      type: 'function',
      name: 'plumb_tool_probe',
    });
    const tools = body['tools'] as Array<Record<string, unknown>>;
    expect(tools).toHaveLength(1);
    expect(tools[0]['name']).toBe('plumb_tool_probe');
    expect(tools[0]['function']).toBeUndefined();
  });

  it('openai-completions (Chat) keeps the wrapped tools + double-wrapped named selector', async () => {
    const { body } = await captureBody('openai-completions', {
      mode: 'named',
      name: 'plumb_tool_probe',
    });
    expect(body['tool_choice']).toEqual({
      type: 'function',
      function: { name: 'plumb_tool_probe' },
    });
    const tools = body['tools'] as Array<Record<string, unknown>>;
    expect(tools[0]['function']?.['name']).toBe('plumb_tool_probe');
  });

  it('openai-codex-responses required selector is Responses-shaped', async () => {
    const { body } = await captureBody('openai-codex-responses', {
      mode: 'required',
    });
    expect(body['tool_choice']).toEqual({ type: 'required' });
  });
});
