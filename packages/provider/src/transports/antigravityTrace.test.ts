/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  antigravityTraceEnabled,
  makeAntigravityTraceId,
  writeSafeTraceEvent,
  computeCanonicalStructureHash,
  computeRequestStructureHash,
  computeBodyStructureHash,
  traceAntigravityRequestConstruction,
  traceAntigravityFinalHttpRequest,
  traceAntigravityHttpResponse,
  traceAntigravityError,
  extractContentsMetadata,
  extractToolsMetadata,
} from './antigravityTrace.js';
import type { PlumbModel, PlumbStreamOptions } from '../types.js';

describe('antigravityTrace safe JSONL tracing facility', () => {
  let tmpDir: string;
  let traceFilePath: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plumb-trace-test-'));
    traceFilePath = path.join(tmpDir, 'trace.jsonl');
    process.env['PLUMB_ANTIGRAVITY_TRACE_SAFE'] = '1';
    process.env['PLUMB_ANTIGRAVITY_TRACE_SAFE_FILE'] = traceFilePath;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('1 & 8: safe trace file works directly via fs even while stdio (stdout/stderr) are patched', () => {
    // Patch stdout/stderr to throw or ignore writes
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => {
      throw new Error('stdio patched!');
    });

    writeSafeTraceEvent({
      traceId: 'ag-test1',
      source: 'NORMAL_CHAT',
      phase: 'REQUEST_CONSTRUCTION',
      test: 'file-sink-direct',
    });

    expect(fs.existsSync(traceFilePath)).toBe(true);
    const content = fs.readFileSync(traceFilePath, 'utf-8');
    expect(content).toContain('"traceId":"ag-test1"');
    expect(content).toContain('"source":"NORMAL_CHAT"');

    errSpy.mockRestore();
  });

  it('2: trace file remains valid JSONL line by line', () => {
    writeSafeTraceEvent({
      traceId: 'ag-1',
      source: 'NORMAL_CHAT',
      phase: 'REQUEST_CONSTRUCTION',
    });
    writeSafeTraceEvent({
      traceId: 'ag-1',
      source: 'NORMAL_CHAT',
      phase: 'FINAL_HTTP_REQUEST',
    });

    const lines = fs.readFileSync(traceFilePath, 'utf-8').trim().split('\n');

    expect(lines.length).toBe(2);
    for (const l of lines) {
      expect(() => JSON.parse(l)).not.toThrow();
    }
  });

  it('3 & 4 & 5 & 6: zero secrets, zero project ID values, zero prompt text, zero system prompt text appear in file', () => {
    const fakeToken = 'ya29.secret_oauth_access_token_123456789';
    const fakeProjectId = 'secret-gcp-project-id-98765';
    const fakePrompt =
      'Top secret user prompt containing confidential trade secret code';
    const fakeSystemPrompt =
      'Top secret system prompt instruction for high confidentiality';

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
      messages: [{ role: 'user', content: fakePrompt }],
      systemPrompt: fakeSystemPrompt,
      apiKey: fakeToken,
      traceSource: 'NORMAL_CHAT',
    };

    const descriptor = {
      url: 'https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse',
      headers: {
        Authorization: `Bearer ${fakeToken}`,
        'Content-Type': 'application/json',
      },
      body: {
        project: fakeProjectId,
        model: 'gpt-oss-120b-medium',
        request: {
          contents: [{ role: 'user', parts: [{ text: fakePrompt }] }],
          systemInstruction: { parts: [{ text: fakeSystemPrompt }] },
        },
      },
    };

    traceAntigravityFinalHttpRequest({
      traceId: 'ag-secret-test',
      source: 'NORMAL_CHAT',
      model: testModel,
      descriptor,
      options: testOptions,
      resolvedCredential: {
        classification: 'VALID_CREDENTIAL',
        credential: {
          scope: 'antigravity',
          projectId: fakeProjectId,
          access: fakeToken,
        },
      },
    });

    const fileContent = fs.readFileSync(traceFilePath, 'utf-8');

    expect(fileContent).not.toContain(fakeToken);
    expect(fileContent).not.toContain(fakeProjectId);
    expect(fileContent).not.toContain(fakePrompt);
    expect(fileContent).not.toContain(fakeSystemPrompt);

    // Verify structural metadata recorded instead
    expect(fileContent).toContain('"roles":["user"]');
    expect(fileContent).toContain('"systemInstruction":{"present":true}');
    expect(fileContent).toContain('"projectIdPresent":true');
    expect(fileContent).toContain('"authorizationPresent":true');
  });

  it('7 & 8: trace source tags NORMAL_CHAT and LIVE_PROBE correctly', () => {
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
      messages: [{ role: 'user', content: 'hello' }],
      apiKey: 'tok',
    };

    traceAntigravityRequestConstruction({
      traceId: 'ag-normal',
      source: 'NORMAL_CHAT',
      model: testModel,
      options: { ...testOptions, traceSource: 'NORMAL_CHAT' },
    });

    traceAntigravityRequestConstruction({
      traceId: 'ag-probe',
      source: 'LIVE_PROBE',
      model: testModel,
      options: { ...testOptions, traceSource: 'LIVE_PROBE' },
    });

    const lines = fs
      .readFileSync(traceFilePath, 'utf-8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));

    expect(lines[0].source).toBe('NORMAL_CHAT');
    expect(lines[1].source).toBe('LIVE_PROBE');
  });

  it('9 & 10: final descriptor captured immediately before fetch and HTTP status captured in response', () => {
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
      messages: [{ role: 'user', content: 'test' }],
      apiKey: 'tok',
    };
    const descriptor = {
      url: 'https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent',
      headers: { Authorization: 'Bearer tok' },
      body: { model: 'gpt-oss-120b-medium' },
    };

    traceAntigravityFinalHttpRequest({
      traceId: 'ag-fetch-test',
      source: 'NORMAL_CHAT',
      model: testModel,
      descriptor,
      options: testOptions,
    });

    const response = new Response(null, {
      status: 200,
      statusText: 'OK',
      headers: {
        'content-type': 'text/event-stream',
        'x-request-id': 'req-999',
      },
    });

    traceAntigravityHttpResponse({
      traceId: 'ag-fetch-test',
      source: 'NORMAL_CHAT',
      response,
    });

    const events = fs
      .readFileSync(traceFilePath, 'utf-8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));

    expect(events[0].phase).toBe('FINAL_HTTP_REQUEST');
    expect(events[0].request.structureHash).toBeDefined();
    expect(events[0].body.structureHash).toBeDefined();

    expect(events[1].phase).toBe('HTTP_RESPONSE');
    expect(events[1].status).toBe(200);
    expect(events[1].safeHeaders['x-request-id']).toBe('req-999');
  });

  it('13: content-generator instance metadata works for NORMAL_CHAT and is null for LIVE_PROBE', () => {
    const testModel: PlumbModel = {
      id: 'gpt-oss-120b-medium',
      provider: 'google-antigravity',
      api: 'google-gemini-cli',
      contextWindow: 200000,
      maxTokens: 8192,
      reasoning: true,
      input: 'text',
    };

    traceAntigravityRequestConstruction({
      traceId: 'ag-gen-1',
      source: 'NORMAL_CHAT',
      model: testModel,
      options: {
        model: testModel,
        messages: [],
        apiKey: 'tok',
      },
      generatorInstance: {
        instanceId: 'cg-12345',
        providerAtConstruction: 'antigravity',
        modelAtConstruction: 'gpt-oss-120b-medium',
        currentProvider: 'antigravity',
        currentModel: 'gpt-oss-120b-medium',
      },
    });

    traceAntigravityRequestConstruction({
      traceId: 'ag-probe-1',
      source: 'LIVE_PROBE',
      model: testModel,
      options: {
        model: testModel,
        messages: [],
        apiKey: 'tok',
      },
      generatorInstance: null,
    });

    const events = fs
      .readFileSync(traceFilePath, 'utf-8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));

    expect(events[0].contentGenerator.instanceId).toBe('cg-12345');
    expect(events[0].contentGenerator.providerAtConstruction).toBe(
      'antigravity',
    );
    expect(events[1].contentGenerator).toBeNull();
  });

  it('14: trace disabled -> zero file writes', () => {
    process.env['PLUMB_ANTIGRAVITY_TRACE_SAFE'] = '0';
    const filePathUnused = path.join(tmpDir, 'unused-trace.jsonl');
    process.env['PLUMB_ANTIGRAVITY_TRACE_SAFE_FILE'] = filePathUnused;

    writeSafeTraceEvent({
      traceId: 'ag-should-not-write',
      source: 'NORMAL_CHAT',
      phase: 'REQUEST_CONSTRUCTION',
    });

    expect(fs.existsSync(filePathUnused)).toBe(false);
  });

  it('extracts contents and tools structural metadata accurately without content', () => {
    const contentsMeta = extractContentsMetadata([
      { role: 'user', content: 'hello' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'hi' },
          { type: 'thinking', text: 'thinking text' },
        ],
      },
      { role: 'tool', content: 'tool result string' },
    ]);

    expect(contentsMeta.count).toBe(3);
    expect(contentsMeta.roles).toEqual(['user', 'assistant', 'tool']);
    expect(contentsMeta.partTypeCounts['text']).toBe(3);
    expect(contentsMeta.partTypeCounts['thinking']).toBe(1);

    const toolsMeta = extractToolsMetadata([
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'secret description that must not leak',
          parameters: { secret: 123 },
        },
      },
    ]);

    expect(toolsMeta.count).toBe(1);
    expect(toolsMeta.typeNames).toEqual(['get_weather']);
  });
});
