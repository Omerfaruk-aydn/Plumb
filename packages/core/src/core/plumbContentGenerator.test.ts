/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GenerateContentParameters } from '@google/genai';
import { LlmRole } from '../telemetry/llmRole.js';

const testRequest: GenerateContentParameters = {
  model: 'unused',
  contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
};
const testRole = LlmRole.MAIN;

const { mockFindModel, mockResolveProviderAlias, mockPlumbModelStream } =
  vi.hoisted(() => ({
    mockFindModel: vi.fn(),
    mockResolveProviderAlias: vi.fn((id: string) =>
      id === 'antigravity' ? 'google-antigravity' : id,
    ),
    mockPlumbModelStream: vi.fn(async function* (_args: {
      model: { provider: string };
    }) {
      yield { candidates: [{ content: { parts: [], role: 'model' } }] };
    }),
  }));

vi.mock('@google/gemini-cli-provider', () => ({
  getPlumbModelRegistry: () => ({ findModel: mockFindModel }),
  resolveProviderAlias: mockResolveProviderAlias,
  plumbModelStream: mockPlumbModelStream,
}));

import { PlumbContentGenerator } from './plumbContentGenerator.js';

describe('PlumbContentGenerator', () => {
  beforeEach(() => {
    mockFindModel.mockReset();
    mockResolveProviderAlias.mockClear();
    mockPlumbModelStream.mockClear();
  });

  it('routes the transport using the canonical OMP provider id from the registry lookup, not the raw PLUMB presentation id', async () => {
    // The catalog projects `google-antigravity` (the OMP id) onto
    // PlumbModel.provider even though callers select it via the PLUMB
    // presentation id "antigravity" (see catalog/providers.ts PLUMB_TO_OMP_ID).
    mockFindModel.mockReturnValue({
      id: 'claude-sonnet-4-6',
      provider: 'google-antigravity',
      api: 'google-antigravity',
      contextWindow: 200000,
      maxTokens: 65536,
      reasoning: true,
      input: 'text',
    });

    const generator = new PlumbContentGenerator(
      'antigravity',
      'claude-sonnet-4-6',
      'api-key',
    );

    const stream = await generator.generateContentStream(
      testRequest,
      'prompt-id',
      testRole,
    );
    for await (const _ of stream) {
      // drain
    }

    expect(mockPlumbModelStream).toHaveBeenCalledTimes(1);
    const { model } = mockPlumbModelStream.mock.calls[0][0];
    expect(model.provider).toBe('google-antigravity');
  });

  it('falls back to resolving the alias itself when the registry has no match', async () => {
    mockFindModel.mockReturnValue(undefined);

    const generator = new PlumbContentGenerator(
      'antigravity',
      'claude-sonnet-4-6',
      'api-key',
    );

    const stream = await generator.generateContentStream(
      testRequest,
      'prompt-id',
      testRole,
    );
    for await (const _ of stream) {
      // drain
    }

    const { model } = mockPlumbModelStream.mock.calls[0][0];
    expect(model.provider).toBe('google-antigravity');
  });

  it('preserves an unaliased provider id unchanged', async () => {
    mockFindModel.mockReturnValue({
      id: 'gpt-oss-120b-medium',
      provider: 'nvidia',
      api: 'openai-completions',
    });

    const generator = new PlumbContentGenerator(
      'nvidia',
      'gpt-oss-120b-medium',
      'api-key',
    );

    const stream = await generator.generateContentStream(
      testRequest,
      'prompt-id',
      testRole,
    );
    for await (const _ of stream) {
      // drain
    }

    const { model } = mockPlumbModelStream.mock.calls[0][0];
    expect(model.provider).toBe('nvidia');
  });
});
