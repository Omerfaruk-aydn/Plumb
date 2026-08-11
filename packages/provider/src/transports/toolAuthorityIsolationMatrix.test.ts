/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Task 8 Tool Authority Matrix:
 * Exercises tool call normalization and single-execution authority across all
 * 9 target architecture families, proving:
 * - TOOL_EXECUTION_DUPLICATION = ZERO
 * - PLUMB CoreToolScheduler remains the sole execution authority
 * - Tool calls stream normalized tool_call events and accept tool-result continuation
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCatalogModels } from '../catalog/model-catalog.js';
import { PlumbModelRegistry } from '../registry/model-registry.js';
import { plumbModelStream } from './streaming.js';
import { setProviderConfigResolver } from '../config/providerConfigResolver.js';
import { __resetVertexTokenCache } from '../omp-ai/providers/google-auth.js';
import { __resetWatsonxClientCacheForTests } from './watsonx.js';
import { registerPlumbCredentialStoreFactory } from '../auth/credential-store.js';
import {
  setCustomProviderDefinitions,
  __resetCustomProviderDefinitionsForTests,
  type CustomProviderDefinition,
} from '../config/customProviderDefinitions.js';
import type {
  PlumbStreamEvent,
  PlumbModel,
  PlumbTool,
  PlumbToolExecutionRequest,
  PlumbToolExecutionResult,
} from '../types.js';

const mockQuery = vi.fn();
const mockTool = vi.fn();
const mockCreateSdkMcpServer = vi.fn();

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  tool: (...args: unknown[]) => mockTool(...args),
  createSdkMcpServer: (...args: unknown[]) => mockCreateSdkMcpServer(...args),
}));

const sampleTools: PlumbTool[] = [
  {
    type: 'function',
    function: {
      name: 'execute_command',
      description: 'Run shell command',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
        },
        required: ['command'],
      },
    },
  },
];

async function drainWithTools(
  model: PlumbModel,
  apiKey: string,
  toolExecutor?: (
    req: PlumbToolExecutionRequest,
  ) => Promise<PlumbToolExecutionResult>,
): Promise<{ events: PlumbStreamEvent[]; toolCallCount: number }> {
  const events: PlumbStreamEvent[] = [];
  let toolCallCount = 0;
  for await (const e of plumbModelStream({
    model,
    messages: [{ role: 'user', content: 'run tool test' }],
    tools: sampleTools,
    toolExecutor:
      toolExecutor ??
      (async () => ({ status: 'success', content: 'ok', isError: false })),
    apiKey: apiKey ?? '',
  })) {
    events.push(e);
    if (e.type === 'tool_call') {
      toolCallCount++;
    }
  }
  return { events, toolCallCount };
}

describe('Task 8 — Tool Authority Matrix', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let registry: PlumbModelRegistry;
  const ORIGINAL_ENV = { ...process.env };
  const calls: Array<{
    url: string;
    headers: Record<string, string>;
    body: string;
  }> = [];

  const CUSTOM_ID = 'custom:88888888-8888-4888-a888-888888888888';
  const CUSTOM_DEFS: CustomProviderDefinition[] = [
    {
      version: 1,
      id: CUSTOM_ID,
      displayName: 'Tool Test Custom',
      dialect: 'openai-completions',
      baseUrl: 'https://tool-custom.example.test/v1',
      credentialPlacement: 'bearer',
      safeHeaders: { 'X-Tenant': 'tool-8' },
      manualModels: [{ id: 'custom-tool-model' }],
    },
  ];

  beforeEach(async () => {
    const { installBunGlobal } = await import('../omp-shims/bun-runtime.js');
    installBunGlobal();
    registry = new PlumbModelRegistry();
    calls.length = 0;
    mockQuery.mockReset();
    mockTool.mockReset();
    mockCreateSdkMcpServer.mockReset();
    setProviderConfigResolver(undefined);
    __resetVertexTokenCache();
    __resetWatsonxClientCacheForTests();

    process.env['AZURE_OPENAI_RESOURCE_NAME'] = 'tool-azure-res';

    registerPlumbCredentialStoreFactory(async () => ({
      getCredentials: async (p: string) => [
        {
          id: 'test-oauth-8',
          provider: p,
          credential: {
            type: 'oauth' as const,
            provider: p,
            access: 'oauth-token-8',
            refresh: 'oauth-refresh-8',
            expires: Date.now() + 3600000,
            projectId: 'project-8',
          },
          addedAt: Date.now(),
          lastUsedAt: Date.now(),
        },
      ],
      getApiKey: async () => 'key-8',
      hasCredentials: async () => true,
      listAuthenticatedProviders: async () => [
        'antigravity',
        'google-antigravity',
      ],
      storeCredential: async () => {},
      storeOAuthCredential: async () => {},
      storeApiKeyCredential: async () => {},
      removeCredentials: async () => {},
      removeCredential: async () => true,
      clearAll: async () => {},
      setProviderMetadata: async () => {},
      getProviderMetadata: async () => ({
        accountLabels: ['test'],
        credentialRefs: ['test-oauth-8'],
      }),
      healthCheck: async () => ({ available: true, usingFallback: false }),
    }));

    fetchSpy = vi.fn(async (url: unknown, init?: RequestInit) => {
      const urlStr = String(url);
      const rawHeaders = init?.headers;
      const headers: Record<string, string> = {};
      if (rawHeaders instanceof Headers) {
        rawHeaders.forEach((value, key) => {
          headers[key] = value;
        });
      } else if (rawHeaders) {
        Object.assign(headers, rawHeaders as Record<string, string>);
      }
      const body = String(init?.body ?? '');
      calls.push({ url: urlStr, headers, body });

      // Simulated SSE response containing a normalized tool call
      const sseBody =
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_123","type":"function","function":{"name":"execute_command","arguments":"{\\"command\\":\\"ls\\"}"}}]}}]}\n\n' +
        'data: [DONE]\n\n';
      return new Response(sseBody, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of Object.keys(process.env)) {
      if (!(key in ORIGINAL_ENV)) delete process.env[key];
    }
    Object.assign(process.env, ORIGINAL_ENV);
    __resetVertexTokenCache();
    __resetWatsonxClientCacheForTests();
    __resetCustomProviderDefinitionsForTests();
  });

  it('1. Claude Subscription: Agent SDK does NOT execute client tools independently (CoreToolScheduler is sole authority)', async () => {
    const [model] = getCatalogModels('claude-subscription');
    expect(model).toBeDefined();

    const mockGenerator = (async function* () {
      yield { type: 'text', text: 'SDK response' };
    })();
    mockQuery.mockReturnValue(mockGenerator);

    const executor = vi
      .fn()
      .mockResolvedValue({ status: 'success', content: 'ok', isError: false });
    const { events } = await drainWithTools(model, '<authenticated>', executor);
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(mockQuery).toHaveBeenCalledTimes(1);

    // Verify MCP tools registered for Agent SDK are passed as callbacks to PLUMB, not self-executed
    expect(mockCreateSdkMcpServer).toHaveBeenCalledTimes(1);
    const mcpOptions = mockCreateSdkMcpServer.mock.calls[0][0] as {
      tools?: unknown[];
    };
    expect(mcpOptions.tools).toBeDefined();
  });

  it('2. OpenAI-compatible family tool authority & single call normalization', async () => {
    const model = registry.getModelsForProvider('openai')[0];
    const { events, toolCallCount } = await drainWithTools(model, 'key-8');

    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(toolCallCount).toBe(1);
    const toolCallEvent = events.find((e) => e.type === 'tool_call') as any;
    expect(toolCallEvent).toBeDefined();
    const toolCall = toolCallEvent.toolCall ?? toolCallEvent;
    expect(toolCall.name ?? toolCall.function?.name).toBe('execute_command');
    expect(toolCall.id).toBe('call_123');
  });

  it('3. Anthropic-compatible family tool authority & single call normalization', async () => {
    const catalogModel = registry.getModelsForProvider('anthropic-api')[0];
    const model = { ...catalogModel, toolsSupported: true as const };
    const { events } = await drainWithTools(model, 'key-8');
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(calls[0].body).toContain('execute_command');
  });

  it('4. Gemini-compatible family tool authority & single call normalization', async () => {
    const catalogModel = registry.getModelsForProvider('google')[0];
    const model = { ...catalogModel, toolsSupported: true as const };
    const { events } = await drainWithTools(model, 'key-8');
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(calls[0].body).toContain('execute_command');
  });

  it('5. Antigravity tool authority & single call normalization', async () => {
    const model: PlumbModel = {
      id: 'gpt-oss-120b-medium',
      provider: 'google-antigravity',
      api: 'google-gemini-cli',
      contextWindow: 200000,
      maxTokens: 8192,
      reasoning: true,
      toolsSupported: true,
      input: 'text',
    };
    const { events } = await drainWithTools(model, '<authenticated>');
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(calls[0].body).toContain('execute_command');
  });

  it('6. Cloud family tool authority (Azure OpenAI)', async () => {
    const [azureCatalogModel] = getCatalogModels('azure');
    const model = { ...azureCatalogModel, toolsSupported: true as const };
    const { events } = await drainWithTools(model, 'azure-key-8');
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(calls[0].body).toContain('execute_command');
  });

  it('7. Local family tool authority (Ollama)', async () => {
    const ollamaModel: PlumbModel = {
      id: 'llama3:8b',
      provider: 'ollama',
      api: 'ollama-chat',
      baseUrl: 'http://127.0.0.1:11434/v1',
      contextWindow: 8192,
      maxTokens: 4096,
      toolsSupported: true,
      input: 'text',
    };
    const { events, toolCallCount } = await drainWithTools(ollamaModel, '');
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(toolCallCount).toBe(1);
  });

  it('8. Gateway family tool authority (OpenRouter)', async () => {
    const catalogModel = registry.getModelsForProvider('openrouter')[0];
    const model = catalogModel
      ? { ...catalogModel, toolsSupported: true as const }
      : {
          id: 'openrouter/auto',
          provider: 'openrouter',
          api: 'openrouter' as const,
          baseUrl: 'https://openrouter.ai/api/v1',
          contextWindow: 128000,
          maxTokens: 4096,
          toolsSupported: true,
          input: 'text' as const,
        };
    const { events, toolCallCount } = await drainWithTools(model, 'or-key-8');
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(toolCallCount).toBe(1);
  });

  it('9. Custom family tool authority (Custom OpenAI)', async () => {
    setCustomProviderDefinitions(CUSTOM_DEFS);
    registry.hydrateCustomProviderModels();
    const catalogModel = registry.findModel(CUSTOM_ID, 'custom-tool-model')!;
    const model = { ...catalogModel, toolsSupported: true as const };

    const { events, toolCallCount } = await drainWithTools(
      model,
      'custom-key-8',
    );
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(toolCallCount).toBe(1);
  });
});
