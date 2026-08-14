/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { plumbModelStream, hasPlumbTransport } from './streaming.js';
import type { PlumbKnownApi, PlumbModel, PlumbStreamEvent } from '../types.js';

async function drain(api: PlumbKnownApi): Promise<PlumbStreamEvent[]> {
  const model: PlumbModel = {
    id: 'test-model',
    provider: 'nonexistent-test-provider' as PlumbModel['provider'],
    api,
    contextWindow: 4096,
    maxTokens: 1024,
    reasoning: false,
    input: 'text',
  };
  const events: PlumbStreamEvent[] = [];
  for await (const e of plumbModelStream({
    model,
    messages: [{ role: 'user', content: 'hi' }],
    apiKey: 'k',
  })) {
    events.push(e);
  }
  return events;
}

describe('transport safety invariant: no silent generic-OpenAI fallback', () => {
  it('every PlumbKnownApi member is either a registered transport or a deliberate OpenAI-compatible alias', () => {
    const registered: PlumbKnownApi[] = [
      'openai-completions',
      'openrouter',
      'openai-responses',
      'anthropic-messages',
      'claude-agent-sdk',
      'watsonx-chat',
      'oci-openai-responses',
      'bedrock-converse-stream',
      'azure-openai-responses',
      'google-generative-ai',
      'ollama-chat',
      'openai-codex-responses',
      'cursor-agent',
      'devin-agent',
      'gitlab-duo-agent',
    ];
    for (const api of registered) {
      expect(hasPlumbTransport(api)).toBe(true);
    }
    // google-gemini-cli / google-vertex are dispatched via the switch's
    // explicit case (googleCloudCodeAssistStream / googleGenerativeAiStream
    // + the Vertex prep step), not the transportFactories map -- proven by
    // the dedicated googleVertexRouting/streaming tests, not here.
  });

  it('a brand-new, never-registered dialect (the exact Bedrock/Azure failure shape) fails loudly instead of silently using generic OpenAI credentials', async () => {
    // Simulates exactly what happened before the Bedrock/Azure fixes: a new
    // model.api value reaches plumbModelStream with no registered
    // transport and no explicit switch case. TypeScript can't catch this
    // at the call site (a real catalog update could introduce a new api
    // string before the transport code catches up), so the runtime
    // dispatch itself must refuse to guess -- never silently reuse
    // openAICompatibleStream.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const events = await drain(
        'totally-new-unregistered-dialect' as unknown as PlumbKnownApi,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(
        events.some(
          (e) =>
            e.type === 'error' && e.error?.code === 'TRANSPORT_NOT_REGISTERED',
        ),
      ).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
