/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { plumbModelStream } from './streaming.js';
import type { PlumbModel, PlumbStreamOptions } from '../types.js';

/**
 * Regression: Claude's adaptive-thinking generation (Opus 4.7+, Sonnet 5,
 * Fable 5) rejects `thinking.type: "enabled"` outright --
 *
 *   "thinking.type.enabled is not supported for this model. Use
 *    thinking.type.adaptive and output_config.effort to control thinking
 *    behavior."
 *
 * -- so every such model 400'd on its first turn. The transport now
 * dispatches on the catalog's `thinking.mode`, which is what OMP's own
 * Anthropic provider has always done.
 */

function makeModel(overrides: Partial<PlumbModel> = {}): PlumbModel {
  return {
    id: 'claude-sonnet-5',
    provider: 'anthropic-api',
    api: 'anthropic-messages',
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    reasoning: true,
    input: 'text',
    baseUrl: 'https://api.anthropic.com',
    thinking: {
      mode: 'anthropic-adaptive',
      supportedEfforts: ['low', 'medium', 'high'],
      effortBudgets: { low: 4000, medium: 8000, high: 16000 },
    },
    ...overrides,
  } as PlumbModel;
}

/** Drains the stream and returns the JSON body the transport sent. */
async function captureRequestBody(
  model: PlumbModel,
  options: Partial<PlumbStreamOptions> = {},
): Promise<Record<string, unknown>> {
  let captured: Record<string, unknown> | undefined;

  const fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (_url, init) => {
      captured = JSON.parse(String(init?.body)) as Record<string, unknown>;
      // Minimal well-formed SSE so the transport completes rather than
      // erroring on a malformed stream (which would mask the assertion).
      const sse = 'event: message_stop\ndata: {"type":"message_stop"}\n\n';
      return new Response(sse, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    });

  try {
    for await (const _event of plumbModelStream({
      model,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'test-key',
      ...options,
    } as PlumbStreamOptions)) {
      // drain
    }
  } finally {
    fetchSpy.mockRestore();
  }

  expect(captured, 'transport never issued a request').toBeDefined();
  return captured!;
}

describe('Anthropic adaptive thinking wire format', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends thinking.type "adaptive" (never "enabled") for an adaptive-mode model', async () => {
    const body = await captureRequestBody(makeModel());

    expect(body['thinking']).toEqual({ type: 'adaptive' });
    // The exact shape the API rejects for this model generation.
    expect(body['thinking']).not.toHaveProperty('budget_tokens');
  });

  it('carries a requested effort through output_config, not thinking.budget_tokens', async () => {
    const body = await captureRequestBody(makeModel(), {
      reasoningEffort: 'high',
    });

    expect(body['thinking']).toEqual({ type: 'adaptive' });
    expect(body['output_config']).toEqual({ effort: 'high' });
  });

  it('omits output_config when the requested effort is not one the model lists', async () => {
    const body = await captureRequestBody(
      makeModel({
        thinking: {
          mode: 'anthropic-adaptive',
          supportedEfforts: ['low', 'medium'],
        },
      }),
      { reasoningEffort: 'high' },
    );

    // Better to let the API apply its own default than to assert an effort
    // level this model never advertised.
    expect(body['output_config']).toBeUndefined();
  });

  it('still sends the budget-based shape for a non-adaptive reasoning model', async () => {
    const body = await captureRequestBody(
      makeModel({
        id: 'claude-sonnet-4-5',
        thinking: {
          mode: 'budget',
          supportedEfforts: ['low', 'high'],
          effortBudgets: { low: 4000, high: 16000 },
        },
      }),
    );

    expect(body['thinking']).toMatchObject({ type: 'enabled' });
    expect(body['thinking']).toHaveProperty('budget_tokens');
  });
});
