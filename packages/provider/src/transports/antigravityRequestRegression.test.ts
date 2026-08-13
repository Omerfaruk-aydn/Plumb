/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildAntigravityRequest } from './streaming.js';
import type { PlumbModel, PlumbStreamOptions } from '../types.js';

vi.mock('../registry/provider-registry.js', () => ({
  getPlumbProviderRegistry: () => ({
    getProviderState: vi.fn(),
  }),
}));

vi.mock('../auth/credential-resolver.js', () => ({
  resolveUsablePlumbCredential: vi.fn().mockResolvedValue({
    classification: 'VALID_CREDENTIAL',
    credential: {
      scope: 'antigravity',
      access: 'mock-access-token',
      projectId: 'mock-project-id',
    },
  }),
}));

describe('Antigravity request construction behavior stability', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env['PLUMB_ANTIGRAVITY_TRACE_SAFE'];
    delete process.env['PLUMB_ANTIGRAVITY_TRACE_SAFE_FILE'];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it(
    '15: existing request construction output is unaffected by trace infrastructure when tracing is disabled',
    { timeout: 15000 },
    async () => {
      const testModel: PlumbModel = {
        id: 'gpt-oss-120b-medium',
        provider: 'google-antigravity',
        api: 'google-gemini-cli',
        contextWindow: 200000,
        maxTokens: 8192,
        reasoning: true,
        input: 'text',
      };

      const testOptions: PlumbStreamOptions = {
        model: testModel,
        messages: [{ role: 'user', content: 'test message' }],
        apiKey: 'test-key',
        systemPrompt: 'test system prompt',
      };

      const resultWithoutTrace = await buildAntigravityRequest(testOptions);
      expect(resultWithoutTrace.ok).toBe(true);

      if (resultWithoutTrace.ok) {
        expect(resultWithoutTrace.descriptor.url).toContain(
          'v1internal:streamGenerateContent',
        );
        expect(resultWithoutTrace.descriptor.headers['Authorization']).toBe(
          'Bearer mock-access-token',
        );
        expect(resultWithoutTrace.descriptor.headers['Content-Type']).toBe(
          'application/json',
        );
        expect(resultWithoutTrace.descriptor.headers['User-Agent']).toContain(
          'antigravity',
        );

        const body = resultWithoutTrace.descriptor.body as any;
        expect(body.project).toBe('mock-project-id');
        expect(body.model).toBe('gpt-oss-120b-medium');
        expect(body.request).toBeDefined();
      }
    },
  );

  it('preserves native function call/result replay and named tool choice', async () => {
    const testModel: PlumbModel = {
      id: 'gemini-3-pro',
      provider: 'google-antigravity',
      api: 'google-gemini-cli',
      contextWindow: 200000,
      maxTokens: 8192,
      reasoning: true,
      toolsSupported: true,
      input: 'text',
    };
    const result = await buildAntigravityRequest({
      model: testModel,
      messages: [
        { role: 'user', content: 'Inspect.' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I will inspect.' },
            {
              type: 'tool_call',
              id: 'call_1',
              name: 'plumb_tool_probe',
              arguments: '{}',
            },
          ],
        },
        {
          role: 'tool',
          name: 'plumb_tool_probe',
          toolCallId: 'call_1',
          content: 'PLUMB_TOOL_PROBE_OK',
        },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'plumb_tool_probe',
            description: 'Harmless diagnostic',
            parameters: {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
          },
        },
      ],
      toolChoice: { mode: 'named', name: 'plumb_tool_probe' },
      apiKey: 'unused',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const body = result.descriptor.body as {
      request: {
        contents: Array<{
          role: string;
          parts: Array<Record<string, unknown>>;
        }>;
        toolConfig?: {
          functionCallingConfig?: {
            mode?: string;
            allowedFunctionNames?: string[];
          };
        };
      };
    };
    const modelParts = body.request.contents.find(
      (content) => content.role === 'model',
    )?.parts;
    expect(modelParts).toContainEqual({
      functionCall: { name: 'plumb_tool_probe', args: {} },
      thoughtSignature: expect.any(String),
    });
    const resultParts = body.request.contents.find(
      (content) =>
        content.role === 'user' &&
        content.parts.some((part) => 'functionResponse' in part),
    )?.parts;
    expect(resultParts).toContainEqual({
      functionResponse: {
        name: 'plumb_tool_probe',
        response: { output: 'PLUMB_TOOL_PROBE_OK' },
      },
    });
    expect(body.request.toolConfig).toEqual({
      functionCallingConfig: {
        mode: 'ANY',
        allowedFunctionNames: ['plumb_tool_probe'],
      },
    });
  });
});
