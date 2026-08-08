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

  describe('Claude Antigravity Tool Matrix & Role Normalization Production-Shaped Suite', () => {
    const sixteenPlumbTools = [
      {
        functionDeclarations: [
          {
            name: 'update_topic',
            description: 'Update topic',
            parameters: {
              type: 'object',
              properties: { title: { type: 'string' } },
            },
          },
        ],
      },
      {
        functionDeclarations: [
          {
            name: 'list_directory',
            description: 'List dir',
            parameters: {
              type: 'object',
              properties: { path: { type: 'string' } },
            },
          },
        ],
      },
      {
        functionDeclarations: [
          {
            name: 'read_file',
            description: 'Read file',
            parameters: {
              type: 'object',
              properties: { file_path: { type: 'string' } },
            },
          },
        ],
      },
      {
        functionDeclarations: [
          {
            name: 'grep_search',
            description: 'Grep search',
            parameters: {
              type: 'object',
              properties: { pattern: { type: 'string' } },
            },
          },
        ],
      },
      {
        functionDeclarations: [
          {
            name: 'glob',
            description: 'Glob search',
            parameters: {
              type: 'object',
              properties: { pattern: { type: 'string' } },
            },
          },
        ],
      },
      {
        functionDeclarations: [
          {
            name: 'replace',
            description: 'Replace content',
            parameters: {
              type: 'object',
              properties: { file_path: { type: 'string' } },
            },
          },
        ],
      },
      {
        functionDeclarations: [
          {
            name: 'write_file',
            description: 'Write file',
            parameters: {
              type: 'object',
              properties: { file_path: { type: 'string' } },
            },
          },
        ],
      },
      {
        functionDeclarations: [
          {
            name: 'web_fetch',
            description: 'Web fetch',
            parameters: {
              type: 'object',
              properties: { url: { type: 'string' } },
            },
          },
        ],
      },
      {
        functionDeclarations: [
          {
            name: 'run_shell_command',
            description: 'Run shell',
            parameters: {
              type: 'object',
              properties: { command: { type: 'string' } },
            },
          },
        ],
      },
      {
        functionDeclarations: [
          {
            name: 'list_background_processes',
            description: 'List bg',
            parameters: { type: 'object', properties: {} },
          },
        ],
      },
      {
        functionDeclarations: [
          {
            name: 'read_background_output',
            description: 'Read bg',
            parameters: {
              type: 'object',
              properties: { pid: { type: 'integer' } },
            },
          },
        ],
      },
      {
        functionDeclarations: [
          {
            name: 'google_web_search',
            description: 'Google web search',
            parameters: {
              type: 'object',
              properties: { query: { type: 'string' } },
            },
          },
        ],
      },
      {
        functionDeclarations: [
          {
            name: 'ask_user',
            description: 'Ask user',
            parameters: {
              type: 'object',
              properties: { questions: { type: 'array' } },
            },
          },
        ],
      },
      {
        functionDeclarations: [
          {
            name: 'enter_plan_mode',
            description: 'Enter plan',
            parameters: {
              type: 'object',
              properties: { reason: { type: 'string' } },
            },
          },
        ],
      },
      {
        functionDeclarations: [
          {
            name: 'invoke_agent',
            description: 'Invoke agent',
            parameters: {
              type: 'object',
              properties: { prompt: { type: 'string' } },
            },
          },
        ],
      },
      {
        functionDeclarations: [
          {
            name: 'activate_skill',
            description: 'Activate skill',
            parameters: {
              type: 'object',
              properties: { name: { type: 'string' } },
            },
          },
        ],
      },
    ];

    interface InnerAntigravityRequest {
      contents: Array<{ role: string; parts: Array<{ text?: string }> }>;
      tools?: Array<{ functionDeclarations: Array<{ name: string }> }>;
    }

    it('Variant A: 1 user, 0 tools (Claude Sonnet 4.6)', async () => {
      const generator = new PlumbContentGenerator(
        'antigravity',
        'claude-sonnet-4-6',
        '',
      );
      const req: GenerateContentParameters = {
        model: 'unused',
        contents: [{ role: 'user', parts: [{ text: 'Hello Claude' }] }],
      };
      const captured = await captureFetch(async () => {
        const stream = await generator.generateContentStream(
          req,
          'prompt-id',
          LlmRole.MAIN,
        );
        for await (const chunk of stream) {
          expect(chunk).toBeDefined();
        }
      });
      const inner = (
        captured.body as unknown as { request: InnerAntigravityRequest }
      ).request;
      expect(inner.contents).toHaveLength(1);
      expect(inner.contents[0].role).toBe('user');
      expect(inner.contents[0].parts[0].text).toBe('Hello Claude');
    });

    it('Variant B: 2 adjacent user, 0 tools (Claude Sonnet 4.6)', async () => {
      const generator = new PlumbContentGenerator(
        'antigravity',
        'claude-sonnet-4-6',
        '',
      );
      const req: GenerateContentParameters = {
        model: 'unused',
        contents: [
          { role: 'user', parts: [{ text: 'System context part' }] },
          { role: 'user', parts: [{ text: 'User prompt part' }] },
        ],
      };
      const captured = await captureFetch(async () => {
        const stream = await generator.generateContentStream(
          req,
          'prompt-id',
          LlmRole.MAIN,
        );
        for await (const chunk of stream) {
          expect(chunk).toBeDefined();
        }
      });
      const inner = (
        captured.body as unknown as { request: InnerAntigravityRequest }
      ).request;
      // Consecutive user turns MUST be merged into 1 user turn with 2 parts to avoid HTTP 400
      expect(inner.contents).toHaveLength(1);
      expect(inner.contents[0].role).toBe('user');
      expect(inner.contents[0].parts).toHaveLength(2);
      expect(inner.contents[0].parts[0].text).toBe('System context part');
      expect(inner.contents[0].parts[1].text).toBe('User prompt part');
    });

    it('Variant C: 1 user, 1 minimal valid tool (Claude Sonnet 4.6)', async () => {
      const generator = new PlumbContentGenerator(
        'antigravity',
        'claude-sonnet-4-6',
        '',
      );
      const req: GenerateContentParameters = {
        model: 'unused',
        contents: [{ role: 'user', parts: [{ text: 'Use a tool' }] }],
        config: {
          tools: [sixteenPlumbTools[0]],
        } as unknown as NonNullable<GenerateContentParameters['config']>,
      };
      const captured = await captureFetch(async () => {
        const stream = await generator.generateContentStream(
          req,
          'prompt-id',
          LlmRole.MAIN,
        );
        for await (const chunk of stream) {
          expect(chunk).toBeDefined();
        }
      });
      const inner = (
        captured.body as unknown as { request: InnerAntigravityRequest }
      ).request;
      expect(inner.contents).toHaveLength(1);
      expect(inner.tools).toBeTruthy();
      expect(inner.tools![0].functionDeclarations).toHaveLength(1);
      expect(inner.tools![0].functionDeclarations[0].name).toBe('update_topic');
    });

    it('Variant D: 1 user, all 16 PLUMB tools (Claude Sonnet 4.6)', async () => {
      const generator = new PlumbContentGenerator(
        'antigravity',
        'claude-sonnet-4-6',
        '',
      );
      const req: GenerateContentParameters = {
        model: 'unused',
        contents: [{ role: 'user', parts: [{ text: 'Use 16 tools' }] }],
        config: {
          tools: sixteenPlumbTools,
        } as unknown as NonNullable<GenerateContentParameters['config']>,
      };
      const captured = await captureFetch(async () => {
        const stream = await generator.generateContentStream(
          req,
          'prompt-id',
          LlmRole.MAIN,
        );
        for await (const chunk of stream) {
          expect(chunk).toBeDefined();
        }
      });
      const inner = (
        captured.body as unknown as { request: InnerAntigravityRequest }
      ).request;
      expect(inner.contents).toHaveLength(1);
      expect(inner.tools).toBeTruthy();
      expect(inner.tools![0].functionDeclarations).toHaveLength(16);
    });

    it('Variant E: 2 adjacent user, 1 minimal valid tool (Claude Sonnet 4.6)', async () => {
      const generator = new PlumbContentGenerator(
        'antigravity',
        'claude-sonnet-4-6',
        '',
      );
      const req: GenerateContentParameters = {
        model: 'unused',
        contents: [
          { role: 'user', parts: [{ text: 'System context part' }] },
          { role: 'user', parts: [{ text: 'User prompt part' }] },
        ],
        config: {
          tools: [sixteenPlumbTools[0]],
        } as unknown as NonNullable<GenerateContentParameters['config']>,
      };
      const captured = await captureFetch(async () => {
        const stream = await generator.generateContentStream(
          req,
          'prompt-id',
          LlmRole.MAIN,
        );
        for await (const chunk of stream) {
          expect(chunk).toBeDefined();
        }
      });
      const inner = (
        captured.body as unknown as { request: InnerAntigravityRequest }
      ).request;
      expect(inner.contents).toHaveLength(1);
      expect(inner.contents[0].parts).toHaveLength(2);
      expect(inner.tools).toBeTruthy();
    });

    it('Variant F: 2 adjacent user, all 16 tools (Claude Sonnet 4.6)', async () => {
      const generator = new PlumbContentGenerator(
        'antigravity',
        'claude-sonnet-4-6',
        '',
      );
      const req: GenerateContentParameters = {
        model: 'unused',
        contents: [
          { role: 'user', parts: [{ text: 'System context part' }] },
          { role: 'user', parts: [{ text: 'User prompt part' }] },
        ],
        config: {
          tools: sixteenPlumbTools,
        } as unknown as NonNullable<GenerateContentParameters['config']>,
      };
      const captured = await captureFetch(async () => {
        const stream = await generator.generateContentStream(
          req,
          'prompt-id',
          LlmRole.MAIN,
        );
        for await (const chunk of stream) {
          expect(chunk).toBeDefined();
        }
      });
      const inner = (
        captured.body as unknown as { request: InnerAntigravityRequest }
      ).request;
      expect(inner.contents).toHaveLength(1);
      expect(inner.contents[0].parts).toHaveLength(2);
      expect(inner.tools).toBeTruthy();
      expect(inner.tools![0].functionDeclarations).toHaveLength(16);
    });

    it('GPT & Gemini regression suite: ZERO regression for adjacent roles & tools', async () => {
      for (const modelId of ['gemini-3.6-flash', 'gpt-oss-120b-medium']) {
        const generator = new PlumbContentGenerator('antigravity', modelId, '');
        const req: GenerateContentParameters = {
          model: 'unused',
          contents: [
            { role: 'user', parts: [{ text: 'Ctx' }] },
            { role: 'user', parts: [{ text: 'Prompt' }] },
          ],
          config: {
            tools: sixteenPlumbTools,
          } as unknown as NonNullable<GenerateContentParameters['config']>,
        };
        const captured = await captureFetch(async () => {
          const stream = await generator.generateContentStream(
            req,
            'prompt-id',
            LlmRole.MAIN,
          );
          for await (const chunk of stream) {
            expect(chunk).toBeDefined();
          }
        });
        const inner = (
          captured.body as unknown as { request: InnerAntigravityRequest }
        ).request;
        expect(inner.contents).toHaveLength(1);
        expect(inner.tools![0].functionDeclarations).toHaveLength(16);
      }
    });
  });
});
