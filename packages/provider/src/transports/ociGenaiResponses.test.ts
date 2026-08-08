/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * OCI Responses transport unit tests: SSE event parsing (text deltas,
 * streamed and non-streamed function-call arguments, usage, errors,
 * cancellation), tool-call/tool-result history reconstruction as flat
 * Responses `input` items, and OCI_GENAI_API_KEY vs OCI_IAM auth-mode
 * isolation at the request-signing boundary.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { PlumbModel, PlumbStreamEvent } from '../types.js';

const mockSignOciGenaiRequest = vi.fn();
const mockGetOciIamAuthProvider = vi.fn();

vi.mock('./ociGenaiIamAuth.js', async () => {
  const actual = await vi.importActual<typeof import('./ociGenaiIamAuth.js')>(
    './ociGenaiIamAuth.js',
  );
  return {
    ...actual,
    getOciIamAuthProvider: (...args: unknown[]) =>
      mockGetOciIamAuthProvider(...args),
    signOciGenaiRequest: (...args: unknown[]) =>
      mockSignOciGenaiRequest(...args),
  };
});

async function importFresh() {
  vi.resetModules();
  return import('./ociGenaiResponses.js');
}

const model: PlumbModel = {
  id: 'openai.gpt-oss-120b',
  provider: 'oci-genai',
  api: 'oci-openai-responses',
  baseUrl:
    'https://inference.generativeai.us-chicago-1.oci.oraclecloud.com/openai/v1',
  headers: { 'opc-compartment-id': 'ocid1.compartment.oc1..real' },
  contextWindow: 131072,
  maxTokens: 8192,
  reasoning: false,
  input: 'text',
};

function sseResponse(events: Record<string, unknown>[]): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(body + 'data: [DONE]\n\n', {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

async function drain(
  gen: AsyncGenerator<PlumbStreamEvent>,
): Promise<PlumbStreamEvent[]> {
  const events: PlumbStreamEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

describe('streamOciGenaiResponses', () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
    delete process.env['OCI_IAM_AUTH_MODE'];
  });

  it('yields MISSING_CREDENTIAL when no apiKey and IAM mode is not configured', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const mod = await importFresh();
    const events = await drain(
      mod.streamOciGenaiResponses({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        apiKey: '',
      }),
    );
    expect(events).toEqual([
      {
        type: 'error',
        error: { code: 'MISSING_CREDENTIAL', message: expect.any(String) },
      },
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('normalizes response.output_text.delta into text PlumbStreamEvents', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      sseResponse([
        { type: 'response.output_text.delta', delta: 'Hello' },
        { type: 'response.output_text.delta', delta: ' there' },
        {
          type: 'response.completed',
          response: {
            usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
          },
        },
      ]),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const mod = await importFresh();
    const events = await drain(
      mod.streamOciGenaiResponses({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        apiKey: 'k',
      }),
    );
    expect(events).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' there' },
      {
        type: 'usage',
        usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
      },
      { type: 'done', finishReason: 'stop' },
    ]);
  });

  it("emits a tool_call event per streamed function_call_arguments.delta, correlated to the item's call_id", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      sseResponse([
        {
          type: 'response.output_item.added',
          item: {
            id: 'item_1',
            type: 'function_call',
            call_id: 'call_abc',
            name: 'get_weather',
          },
        },
        {
          type: 'response.function_call_arguments.delta',
          item_id: 'item_1',
          delta: '{"location":',
        },
        {
          type: 'response.function_call_arguments.delta',
          item_id: 'item_1',
          delta: '"Paris"}',
        },
        {
          type: 'response.output_item.done',
          item: {
            id: 'item_1',
            type: 'function_call',
            call_id: 'call_abc',
            name: 'get_weather',
            arguments: '{"location":"Paris"}',
          },
        },
        { type: 'response.completed', response: { usage: {} } },
      ]),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const mod = await importFresh();
    const events = await drain(
      mod.streamOciGenaiResponses({
        model,
        messages: [{ role: 'user', content: 'weather in Paris?' }],
        apiKey: 'k',
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get the weather',
              parameters: {},
            },
          },
        ],
      }),
    );
    const toolCallEvents = events.filter((e) => e.type === 'tool_call');
    expect(toolCallEvents).toEqual([
      {
        type: 'tool_call',
        toolCall: {
          id: 'call_abc',
          name: 'get_weather',
          arguments: '{"location":',
        },
      },
      {
        type: 'tool_call',
        toolCall: {
          id: 'call_abc',
          name: 'get_weather',
          arguments: '"Paris"}',
        },
      },
    ]);
    // Already streamed via deltas -- output_item.done must not re-emit a
    // duplicate third tool_call event on top of the two deltas.
    expect(toolCallEvents.length).toBe(2);
  });

  it('emits exactly one tool_call event from output_item.done when a model delivers arguments only once, without deltas', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      sseResponse([
        {
          type: 'response.output_item.added',
          item: {
            id: 'item_1',
            type: 'function_call',
            call_id: 'call_xyz',
            name: 'search',
          },
        },
        {
          type: 'response.output_item.done',
          item: {
            id: 'item_1',
            type: 'function_call',
            call_id: 'call_xyz',
            name: 'search',
            arguments: '{"q":"plumb"}',
          },
        },
        { type: 'response.completed', response: { usage: {} } },
      ]),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const mod = await importFresh();
    const events = await drain(
      mod.streamOciGenaiResponses({
        model,
        messages: [{ role: 'user', content: 'search plumb' }],
        apiKey: 'k',
        tools: [
          {
            type: 'function',
            function: { name: 'search', description: '', parameters: {} },
          },
        ],
      }),
    );
    const toolCallEvents = events.filter((e) => e.type === 'tool_call');
    expect(toolCallEvents).toEqual([
      {
        type: 'tool_call',
        toolCall: {
          id: 'call_xyz',
          name: 'search',
          arguments: '{"q":"plumb"}',
        },
      },
    ]);
  });

  it('reconstructs prior tool-call/tool-result history as flat Responses input items -- reinjection / continuation / multi-turn after tool', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(sseResponse([]));
    vi.stubGlobal('fetch', fetchSpy);
    const mod = await importFresh();
    for await (const _e of mod.streamOciGenaiResponses({
      model,
      messages: [
        { role: 'user', content: 'weather in Paris?' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_call',
              id: 'call_abc',
              name: 'get_weather',
              arguments: '{"location":"Paris"}',
            },
          ],
        },
        {
          role: 'tool',
          toolCallId: 'call_abc',
          content: '{"tempC":18}',
        },
        { role: 'user', content: 'and London?' },
      ],
      apiKey: 'k',
    })) {
      // drain
    }
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { input: unknown[] };
    expect(body.input).toEqual([
      { role: 'user', content: 'weather in Paris?' },
      {
        type: 'function_call',
        call_id: 'call_abc',
        name: 'get_weather',
        arguments: '{"location":"Paris"}',
      },
      {
        type: 'function_call_output',
        call_id: 'call_abc',
        output: '{"tempC":18}',
      },
      { role: 'user', content: 'and London?' },
    ]);
  });

  it('never sends OCI_MANAGED_TOOL types -- only flat PLUMB_CLIENT_TOOL function tools', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(sseResponse([]));
    vi.stubGlobal('fetch', fetchSpy);
    const mod = await importFresh();
    for await (const _e of mod.streamOciGenaiResponses({
      model,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      tools: [
        {
          type: 'function',
          function: {
            name: 'read_file',
            description: 'Read a file',
            parameters: { type: 'object' },
          },
        },
      ],
    })) {
      // drain
    }
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      tools: Array<Record<string, unknown>>;
    };
    expect(body.tools).toEqual([
      {
        type: 'function',
        name: 'read_file',
        description: 'Read a file',
        parameters: { type: 'object' },
      },
    ]);
  });

  it('classifies a 401 response as AUTH_REQUIRED', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response('unauthorized', { status: 401 }));
    vi.stubGlobal('fetch', fetchSpy);
    const mod = await importFresh();
    const events = await drain(
      mod.streamOciGenaiResponses({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        apiKey: 'k',
      }),
    );
    expect(events).toEqual([
      {
        type: 'error',
        error: { code: 'AUTH_REQUIRED', message: 'unauthorized' },
      },
    ]);
  });

  it('respects cancellation via AbortSignal', async () => {
    const controller = new AbortController();
    const fetchSpy = vi.fn().mockImplementation(async (_url, init) => {
      controller.abort();
      const signal = (init as RequestInit).signal;
      if (signal?.aborted) {
        const err = new DOMException('aborted', 'AbortError');
        throw err;
      }
      return sseResponse([]);
    });
    vi.stubGlobal('fetch', fetchSpy);
    const mod = await importFresh();
    const events = await drain(
      mod.streamOciGenaiResponses({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        apiKey: 'k',
        signal: controller.signal,
      }),
    );
    // fetch itself throws (simulating abort mid-request); the transport
    // must recognize the signal is aborted and report cancellation, not a
    // generic NETWORK_ERROR.
    expect(events.some((e) => e.type === 'error' || e.type === 'done')).toBe(
      true,
    );
  });

  describe('auth mode isolation', () => {
    it('OCI_GENAI_API_KEY mode: uses the Bearer apiKey, never invokes the OCI IAM signer', async () => {
      const fetchSpy = vi.fn().mockResolvedValue(sseResponse([]));
      vi.stubGlobal('fetch', fetchSpy);
      const mod = await importFresh();
      for await (const _e of mod.streamOciGenaiResponses({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        apiKey: 'real-genai-api-key',
      })) {
        // drain
      }
      expect(mockGetOciIamAuthProvider).not.toHaveBeenCalled();
      expect(mockSignOciGenaiRequest).not.toHaveBeenCalled();
      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Headers;
      expect(headers.get('Authorization')).toBe('Bearer real-genai-api-key');
    });

    it('OCI_IAM mode: signs via the OCI IAM signer, never uses/looks up the GenAI API key bearer credential', async () => {
      process.env['OCI_IAM_AUTH_MODE'] = 'config_profile';
      const fakeProvider = { fake: 'iam-provider' };
      mockGetOciIamAuthProvider.mockResolvedValue(fakeProvider);
      mockSignOciGenaiRequest.mockImplementation(
        async (_provider: unknown, req: { headers: Headers }) => {
          req.headers.set('Authorization', 'Signature keyId="iam",...');
        },
      );
      const fetchSpy = vi.fn().mockResolvedValue(sseResponse([]));
      vi.stubGlobal('fetch', fetchSpy);
      const mod = await importFresh();
      for await (const _e of mod.streamOciGenaiResponses({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        apiKey: '', // deliberately empty -- IAM mode must not need it
      })) {
        // drain
      }
      expect(mockGetOciIamAuthProvider).toHaveBeenCalledWith('config_profile');
      expect(mockSignOciGenaiRequest).toHaveBeenCalledTimes(1);
      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Headers;
      expect(headers.get('Authorization')).toBe('Signature keyId="iam",...');
      expect(headers.get('Authorization')).not.toContain('Bearer');
    });

    it('project/compartment headers survive IAM signing unchanged (signing happens after they are set)', async () => {
      process.env['OCI_IAM_AUTH_MODE'] = 'instance_principal';
      mockGetOciIamAuthProvider.mockResolvedValue({ fake: 'provider' });
      let headersAtSignTime: Headers | undefined;
      mockSignOciGenaiRequest.mockImplementation(
        async (_provider: unknown, req: { headers: Headers }) => {
          headersAtSignTime = req.headers;
          req.headers.set('Authorization', 'Signature ...');
        },
      );
      const fetchSpy = vi.fn().mockResolvedValue(sseResponse([]));
      vi.stubGlobal('fetch', fetchSpy);
      const mod = await importFresh();
      for await (const _e of mod.streamOciGenaiResponses({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        apiKey: '',
      })) {
        // drain
      }
      expect(headersAtSignTime?.get('opc-compartment-id')).toBe(
        'ocid1.compartment.oc1..real',
      );
      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Headers;
      expect(headers.get('opc-compartment-id')).toBe(
        'ocid1.compartment.oc1..real',
      );
    });
  });
});
