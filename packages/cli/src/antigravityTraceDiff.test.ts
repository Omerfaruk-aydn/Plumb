/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runDiffAntigravityTrace } from './runtimeDiagnostics.js';

describe('runDiffAntigravityTrace CLI command', () => {
  let tmpDir: string;
  let traceFilePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plumb-diff-test-'));
    traceFilePath = path.join(tmpDir, 'trace.jsonl');
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('11: diff command finds known synthetic differences between NORMAL_CHAT and LIVE_PROBE', async () => {
    const normalReq = {
      traceId: 'ag-normal-1',
      source: 'NORMAL_CHAT',
      phase: 'FINAL_HTTP_REQUEST',
      provider: {
        plumbId: 'google-antigravity',
        catalogId: 'google-antigravity',
      },
      model: {
        displayId: 'gpt-oss-120b-medium',
        requestModelId: 'gpt-oss-120b-medium',
        api: 'google-gemini-cli',
        wireModel: 'gpt-oss-120b-medium',
      },
      credential: {
        scope: 'antigravity',
        classification: 'VALID_CREDENTIAL',
        runtimeUsable: true,
        projectIdPresent: true,
      },
      endpoint: {
        origin: 'https://daily-cloudcode-pa.googleapis.com',
        pathname: '/v1internal:streamGenerateContent',
        selector: 'DEFAULT_ENDPOINT',
        source: 'GOOGLE_GEMINI_CLI_DEFAULT',
      },
      request: {
        origin: 'https://daily-cloudcode-pa.googleapis.com',
        pathname: '/v1internal:streamGenerateContent',
        method: 'POST',
        queryKeys: ['alt'],
        headerNames: ['authorization', 'content-type'],
        authorizationPresent: true,
        structureHash: 'hash-normal-req',
      },
      body: {
        topLevelKeys: ['model', 'project', 'request'],
        projectPresent: true,
        model: 'gpt-oss-120b-medium',
        requestPresent: true,
        requestIdPresent: true,
        sessionIdPresent: true,
        labelsPresent: true,
        userAgent: 'antigravity',
        requestType: 'agent',
        structureHash: 'hash-normal-body',
      },
      contents: {
        count: 3,
        roles: ['user', 'assistant', 'user'],
        partTypeCounts: { text: 3 },
      },
      tools: { count: 1, typeNames: ['get_weather'] },
      systemInstruction: { present: true },
    };

    const normalResp = {
      traceId: 'ag-normal-1',
      source: 'NORMAL_CHAT',
      phase: 'HTTP_RESPONSE',
      status: 404,
      statusText: 'Not Found',
      contentType: 'text/html',
      safeHeaders: {},
      safeClassification: 'ENDPOINT_NOT_FOUND',
    };

    const probeReq = {
      ...normalReq,
      traceId: 'ag-probe-1',
      source: 'LIVE_PROBE',
      contents: { count: 1, roles: ['user'], partTypeCounts: { text: 1 } },
      tools: { count: 0, typeNames: [] },
      systemInstruction: { present: false },
      body: { ...normalReq.body, structureHash: 'hash-probe-body' },
    };

    const probeResp = {
      traceId: 'ag-probe-1',
      source: 'LIVE_PROBE',
      phase: 'HTTP_RESPONSE',
      status: 200,
      statusText: 'OK',
      contentType: 'text/event-stream',
      safeHeaders: { 'x-request-id': 'probe-req-1' },
      safeClassification: 'HTTP_200',
    };

    const lines = [
      JSON.stringify(normalReq),
      JSON.stringify(normalResp),
      JSON.stringify(probeReq),
      JSON.stringify(probeResp),
    ].join('\n');

    fs.writeFileSync(traceFilePath, lines, 'utf-8');

    let stdoutBuf = '';
    const stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((str) => {
        stdoutBuf += String(str);
        return true;
      });

    const code = await runDiffAntigravityTrace(traceFilePath);
    stdoutSpy.mockRestore();

    expect(code).toBe(0);
    expect(stdoutBuf).toContain('NORMAL_CHAT_STATUS: 404');
    expect(stdoutBuf).toContain('LIVE_PROBE_STATUS: 200');
    expect(stdoutBuf).toContain('DIFF_COUNT:');
    expect(stdoutBuf).toContain('DIFF contents.count:');
    expect(stdoutBuf).toContain('DIFF systemInstruction.present:');

    // Verify raw secrets or prompts do NOT appear
    expect(stdoutBuf).not.toContain('Authorization');
    expect(stdoutBuf).not.toContain('Bearer');
  });

  it('12: identical descriptors produce DIFF_COUNT: 0 and FINAL_SAFE_DESCRIPTOR_DIFFERENCE: ZERO', async () => {
    const baseReq = {
      traceId: 'ag-same-1',
      source: 'NORMAL_CHAT',
      phase: 'FINAL_HTTP_REQUEST',
      provider: {
        plumbId: 'google-antigravity',
        catalogId: 'google-antigravity',
      },
      model: {
        displayId: 'gpt-oss-120b-medium',
        requestModelId: 'gpt-oss-120b-medium',
        api: 'google-gemini-cli',
        wireModel: 'gpt-oss-120b-medium',
      },
      credential: {
        scope: 'antigravity',
        classification: 'VALID_CREDENTIAL',
        runtimeUsable: true,
        projectIdPresent: true,
      },
      endpoint: {
        origin: 'https://daily-cloudcode-pa.googleapis.com',
        pathname: '/v1internal:streamGenerateContent',
        selector: 'DEFAULT_ENDPOINT',
        source: 'GOOGLE_GEMINI_CLI_DEFAULT',
      },
      request: {
        origin: 'https://daily-cloudcode-pa.googleapis.com',
        pathname: '/v1internal:streamGenerateContent',
        method: 'POST',
        queryKeys: ['alt'],
        headerNames: ['authorization', 'content-type'],
        authorizationPresent: true,
        structureHash: 'same-req-hash',
      },
      body: {
        topLevelKeys: ['model', 'project', 'request'],
        projectPresent: true,
        model: 'gpt-oss-120b-medium',
        requestPresent: true,
        requestIdPresent: true,
        sessionIdPresent: true,
        labelsPresent: true,
        userAgent: 'antigravity',
        requestType: 'agent',
        structureHash: 'same-body-hash',
      },
      contents: { count: 1, roles: ['user'], partTypeCounts: { text: 1 } },
      tools: { count: 0, typeNames: [] },
      systemInstruction: { present: false },
    };

    const baseResp = {
      traceId: 'ag-same-1',
      source: 'NORMAL_CHAT',
      phase: 'HTTP_RESPONSE',
      status: 200,
      statusText: 'OK',
      contentType: 'text/event-stream',
      safeHeaders: {},
      safeClassification: 'HTTP_200',
    };

    const probeReq = { ...baseReq, traceId: 'ag-same-2', source: 'LIVE_PROBE' };
    const probeResp = {
      ...baseResp,
      traceId: 'ag-same-2',
      source: 'LIVE_PROBE',
    };

    const lines = [
      JSON.stringify(baseReq),
      JSON.stringify(baseResp),
      JSON.stringify(probeReq),
      JSON.stringify(probeResp),
    ].join('\n');

    fs.writeFileSync(traceFilePath, lines, 'utf-8');

    let stdoutBuf = '';
    const stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((str) => {
        stdoutBuf += String(str);
        return true;
      });

    const code = await runDiffAntigravityTrace(traceFilePath);
    stdoutSpy.mockRestore();

    expect(code).toBe(0);
    expect(stdoutBuf).toContain('NORMAL_CHAT_STATUS: 200');
    expect(stdoutBuf).toContain('LIVE_PROBE_STATUS: 200');
    expect(stdoutBuf).toContain('DIFF_COUNT: 0');
    expect(stdoutBuf).toContain('FINAL_SAFE_DESCRIPTOR_DIFFERENCE:');
    expect(stdoutBuf).toContain('ZERO');
  });

  it('fails cleanly when trace file is missing or lacks completed traces', async () => {
    let stderrBuf = '';
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((str) => {
        stderrBuf += String(str);
        return true;
      });

    const codeMissing = await runDiffAntigravityTrace(
      path.join(tmpDir, 'nonexistent.jsonl'),
    );
    expect(codeMissing).toBe(1);
    expect(stderrBuf).toContain(
      'diff-antigravity-trace: FAIL: trace file not found',
    );

    stderrBuf = '';
    fs.writeFileSync(
      traceFilePath,
      '{"traceId":"ag-1","source":"NORMAL_CHAT","phase":"REQUEST_CONSTRUCTION"}\n',
      'utf-8',
    );

    const codeIncomplete = await runDiffAntigravityTrace(traceFilePath);
    expect(codeIncomplete).toBe(1);
    expect(stderrBuf).toContain(
      'diff-antigravity-trace: FAIL: missing completed NORMAL_CHAT trace',
    );

    stderrSpy.mockRestore();
  });
});
