/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildAntigravityRequest } from './streaming.js';
import type { PlumbModel, PlumbStreamOptions } from '../types.js';

describe('Antigravity request construction behavior stability', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env['PLUMB_ANTIGRAVITY_TRACE_SAFE'];
    delete process.env['PLUMB_ANTIGRAVITY_TRACE_SAFE_FILE'];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('15: existing request construction output is unaffected by trace infrastructure when tracing is disabled', async () => {
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

    // Mock credential store lookup
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
  });
});
