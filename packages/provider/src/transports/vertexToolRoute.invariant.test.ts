/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCatalogModels } from '../catalog/model-catalog.js';
import {
  plumbModelStream,
  getLastToolRouteDiag,
  enableToolRouteDiag,
  CANONICAL_PROBE_TOOL,
} from './streaming.js';
import { setProviderConfigResolver } from '../config/providerConfigResolver.js';
import { __resetVertexTokenCache } from '../vendor-ai/providers/plumbGoogleAuth.js';
import type { PlumbStreamEvent, PlumbModel } from '../types.js';

describe('google-vertex forced tool-route invariant (production-shaped)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(async () => {
    const { installBunGlobal } = await import('../vendor-shims/bun-runtime.js');
    installBunGlobal();
    process.env['GOOGLE_CLOUD_PROJECT'] = 'plumb-test-project';
    process.env['GOOGLE_CLOUD_LOCATION'] = 'us-central1';
    process.env['GOOGLE_CLOUD_ACCESS_TOKEN'] = 'real-vertex-oauth-token';
    setProviderConfigResolver(undefined);
    __resetVertexTokenCache();
    enableToolRouteDiag();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
    __resetVertexTokenCache();
  });

  it('serializes exactly one plumb_tool_probe function declaration with a native forced selector on the wire', async () => {
    const models = getCatalogModels('google-vertex');
    const vertexModels =
      (models as PlumbModel[]).filter((m) => m.api === 'google-vertex') ?? [];
    // A native Gemini-on-Vertex catalog model that is tool-capable.
    const model = vertexModels.find((m) => m.toolsSupported === true);
    expect(model).toBeDefined();
    expect(model!.toolsSupported).toBe(true);
    fetchSpy = vi
      .fn()
      .mockResolvedValue(
        new Response(
          'data: {"candidates":[{"finishReason":"STOP","content":{"parts":[{"text":"ok"}]}}]}\n\n',
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchSpy);

    const events: PlumbStreamEvent[] = [];
    const stream = plumbModelStream({
      model: model!,
      messages: [{ role: 'user', content: 'Run the diagnostic tool.' }],
      tools: [CANONICAL_PROBE_TOOL],
      toolChoice: { mode: 'named', name: 'plumb_tool_probe' },
      apiKey: '<authenticated>',
      maxTokens: 64,
    });
    for await (const e of stream) events.push(e);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).not.toContain('key=');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer real-vertex-oauth-token');

    const body = JSON.parse(String(init?.body ?? '{}')) as Record<
      string,
      unknown
    >;
    // Canonical probe tool count = 1, serialized as exactly one function
    // declaration.
    const decls = ((body['tools'] as Array<Record<string, unknown>>)?.[0]?.[
      'functionDeclarations'
    ] ?? []) as Array<Record<string, unknown>>;
    expect(decls).toHaveLength(1);
    expect(decls[0]['name']).toBe('plumb_tool_probe');

    // Native forced selector is present as Gemini/Vertex toolConfig — never
    // raw OpenAI tool_choice.
    expect(body['tool_choice']).toBeUndefined();
    const toolConfig = body['toolConfig'] as {
      functionCallingConfig?: {
        mode?: string;
        allowedFunctionNames?: string[];
      };
    };
    expect(toolConfig?.functionCallingConfig?.mode).toBe('ANY');
    expect(toolConfig?.functionCallingConfig?.allowedFunctionNames).toEqual([
      'plumb_tool_probe',
    ]);

    // Diagnostics must be truthful: request.tools.count = 1 on the wire.
    const diag = getLastToolRouteDiag();
    expect(diag?.['requestToolsCount']).toBe(1);
    expect(diag?.['toolChoiceValueCategory']).toBe('named');
    expect(diag?.['toolChoiceSent']).toBe(true);
  });

  it('fails locally with FORCED_SELECTOR_WITH_ZERO_TOOLS (never network) when a forced selector would be emitted with zero serialized tools', async () => {
    const models = getCatalogModels('google-vertex');
    const vertexModels =
      (models as PlumbModel[]).filter((m) => m.api === 'google-vertex') ?? [];
    const model = vertexModels.find((m) => m.toolsSupported === true);
    expect(model).toBeDefined();

    fetchSpy = vi.fn().mockResolvedValue(new Response('data: [DONE]\n\n'));
    vi.stubGlobal('fetch', fetchSpy);

    const events: PlumbStreamEvent[] = [];
    // toolsSupported NOT true => resolveAdvertisedTools suppresses tools to 0
    // while a forced named selector is requested => the invariant must fire
    // locally with a safe, non-network error.
    const stream = plumbModelStream({
      model: { ...model!, toolsSupported: false },
      messages: [{ role: 'user', content: 'Run the diagnostic tool.' }],
      tools: [CANONICAL_PROBE_TOOL],
      toolChoice: { mode: 'named', name: 'plumb_tool_probe' },
      apiKey: '<authenticated>',
      maxTokens: 64,
    });
    for await (const e of stream) events.push(e);

    expect(fetchSpy).not.toHaveBeenCalled();
    const err = events.find((e) => e.type === 'error') as
      | { type: 'error'; error?: { code?: string } }
      | undefined;
    expect(err?.error?.code).toBe('FORCED_SELECTOR_WITH_ZERO_TOOLS');
  });
});
