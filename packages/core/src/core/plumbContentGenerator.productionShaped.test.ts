/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Production-shaped regression for the normal-chat/live-probe Antigravity
 * envelope divergence: unlike plumbContentGenerator.test.ts (which mocks
 * `@google/gemini-cli-provider` entirely), this exercises the REAL provider
 * package — real catalog lookup, real buildRequest, real
 * googleCloudCodeAssistStream — through the same object lifecycle normal
 * chat uses:
 *
 *   PlumbContentGenerator#doStream -> plumbModelStream ->
 *   googleCloudCodeAssistStream -> fetch
 *
 * Only two things are stubbed, both unavoidably (no real OAuth store /
 * network in unit tests): credential resolution and global fetch. Nothing
 * about PlumbContentGenerator, the model registry/catalog, or the
 * Antigravity request builder is mocked.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { LlmRole } from '../telemetry/llmRole.js';
import type { GenerateContentParameters } from '@google/genai';

const validOAuthCredential = {
  type: 'oauth' as const,
  provider: 'google-antigravity',
  access: 'ya29.real-oauth-access-token',
  refresh: 'refresh-token',
  expires: Date.now() + 3_600_000,
  projectId: 'my-real-gcp-project',
};

vi.mock('@google/gemini-cli-provider/dist/auth/credential-resolver.js', () => ({
  resolveUsablePlumbCredential: vi.fn(async () => ({
    classification: 'VALID_CREDENTIAL',
    credential: validOAuthCredential,
    refreshAttempted: false,
  })),
}));

const { PlumbContentGenerator } = await import('./plumbContentGenerator.js');

const testRequest: GenerateContentParameters = {
  model: 'unused',
  contents: [{ role: 'user', parts: [{ text: 'merhaba' }] }],
};

async function captureFetch(run: () => Promise<void>): Promise<{
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}> {
  const originalFetch = globalThis.fetch;
  let captured:
    | {
        url: string;
        headers: Record<string, string>;
        body: Record<string, unknown>;
      }
    | undefined;
  globalThis.fetch = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    captured = {
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    };
    return new Response('data: {"response":{"candidates":[]}}\n\n', {
      status: 200,
    });
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
  if (!captured) throw new Error('fetch was never called');
  return captured;
}

describe('PlumbContentGenerator — production-shaped Antigravity normal-chat envelope', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // The regression: model.provider reaching the transport must be the
  // catalog/OMP id "google-antigravity", not the PLUMB presentation id
  // "antigravity" the caller selects with — even though the credential
  // scope lookup underneath must still resolve via the presentation id.
  for (const modelId of [
    'claude-sonnet-4-6',
    'gpt-oss-120b-medium',
    'gemini-3.6-flash',
  ]) {
    it(`builds the full Antigravity protocol envelope for ${modelId} through the real normal-chat doStream chain`, async () => {
      const generator = new PlumbContentGenerator(
        'antigravity', // PLUMB presentation id, exactly as createContentGenerator passes it
        modelId,
        '',
      );

      const captured = await captureFetch(async () => {
        const stream = await generator.generateContentStream(
          testRequest,
          'prompt-id',
          LlmRole.MAIN,
        );
        for await (const _ of stream) {
          // drain
        }
      });

      // Real pinned Cloud Code Assist endpoint, not a public-API shape.
      expect(captured.url).toBe(
        'https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse',
      );
      expect(captured.headers['Authorization']).toBe(
        `Bearer ${validOAuthCredential.access}`,
      );
      // Only present when the Antigravity discriminator actually fired.
      expect(captured.headers['User-Agent']).toBeTruthy();

      interface AntigravityRequestBody {
        project: string;
        model: string;
        requestId: string;
        userAgent: string;
        requestType: string;
        request: { sessionId: string; labels: Record<string, string> };
      }
      const { project, model, requestId, userAgent, requestType, request } =
        captured.body as unknown as AntigravityRequestBody;

      expect(project).toBe(validOAuthCredential.projectId);
      // The catalog's requestModelId (wire id) is sent when it differs from
      // the display id — see streaming.test.ts "sends the catalog
      // requestModelId (wire id), never the display id".
      expect(typeof model).toBe('string');
      expect(model).not.toBe('');
      expect(typeof requestId).toBe('string');
      expect(requestId).toMatch(/^agent\//);
      expect(userAgent).toBe('antigravity');
      expect(requestType).toBe('agent');

      expect(typeof request.sessionId).toBe('string');
      expect(request.labels).toBeTruthy();

      // No OAuth token leaked into the URL.
      const query = new URL(captured.url).searchParams;
      expect(query.has('key')).toBe(false);
      expect(captured.url).not.toContain(validOAuthCredential.access);
    });
  }
});
