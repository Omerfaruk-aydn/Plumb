/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Production-shaped regression for the live-observed Claude Subscription
 * acceptance false failure:
 *
 *   auth.status CONNECTED_SUBSCRIPTION, real Agent SDK stream started and
 *   completed, safe.error none — yet result: LIVE_TEST_FAILED.
 *
 * Root cause (pinned here end-to-end): the transport read assistant content
 * from a top-level `content` field the pinned Agent SDK (0.1.77) never
 * populates — SDKAssistantMessage nests it at `message.message.content` —
 * so every real assistant reply was silently dropped and the harness's
 * honest success predicate (stream completed AND text seen) correctly
 * failed. This test mocks ONLY the Agent SDK package boundary (with the
 * EXACT pinned SDK message shape) and the filesystem home; the harness,
 * plumbModelStream dispatch, and streamClaudeSubscription transport are all
 * the real production modules. Against the broken transport it fails
 * (no text -> LIVE_TEST_FAILED); with the fix it passes.
 *
 * Never prints account secrets, tokens, or raw SDK internals.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initializePlumbProviders } from '@google/gemini-cli-core';
import { runProviderAcceptanceTest } from './providerAcceptanceHarness.js';

const mockQuery = vi.fn();

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

function makeSdkQuery(messages: unknown[], accountInfo?: unknown) {
  const query = (async function* () {
    for (const m of messages) yield m;
  })() as AsyncGenerator<unknown> & {
    accountInfo?: () => Promise<unknown>;
    close?: () => void;
  };
  query.accountInfo = accountInfo
    ? async () => accountInfo
    : async () => undefined;
  query.close = vi.fn();
  return query;
}

/** The EXACT pinned Agent SDK 0.1.77 SDKAssistantMessage/SDKResultMessage
 * shapes (see sdk.d.ts): assistant content nested under the inner API
 * assistant message; usage on the result envelope. */
function successfulSdkTurn(text: string): unknown[] {
  return [
    {
      type: 'assistant',
      uuid: '00000000-0000-4000-8000-0000000000a1',
      session_id: 'session-live-1',
      parent_tool_use_id: null,
      message: {
        id: 'msg_live_1',
        role: 'assistant',
        model: 'claude-opus-4-8',
        content: [{ type: 'text', text }],
        stop_reason: 'end_turn',
      },
    },
    {
      type: 'result',
      subtype: 'success',
      result: text,
      usage: { input_tokens: 12, output_tokens: 1 },
    },
  ];
}
describe('providerAcceptanceHarness — claude-subscription against the real transport (production-shaped)', () => {
  let isolatedHome: string;
  let previousHome: string | undefined;
  let lines: string[];

  beforeEach(async () => {
    isolatedHome = fs.mkdtempSync(
      path.join(os.tmpdir(), 'plumb-claude-acceptance-'),
    );
    previousHome = process.env['GEMINI_CLI_HOME'];
    process.env['GEMINI_CLI_HOME'] = isolatedHome;
    mockQuery.mockReset();
    lines = [];
    await initializePlumbProviders();
  });

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env['GEMINI_CLI_HOME'];
    } else {
      process.env['GEMINI_CLI_HOME'] = previousHome;
    }
    fs.rmSync(isolatedHome, { recursive: true, force: true });
  });

  it('classifies a genuine successful Agent SDK stream as LIVE_VERIFIED', async () => {
    // Status probe (accountInfo with a subscription) then the real stream.
    mockQuery
      .mockReturnValueOnce(
        makeSdkQuery([], {
          email: 'user@example.com',
          organization: 'Example Org',
          subscriptionType: 'max',
        }),
      )
      .mockReturnValueOnce(makeSdkQuery(successfulSdkTurn('OK')));

    const code = await runProviderAcceptanceTest('claude-subscription', {
      report: (line) => lines.push(line),
    });

    const joined = lines.join('\n');
    expect(code).toBe(0);
    expect(joined).toContain('auth.status: CONNECTED_SUBSCRIPTION');
    expect(joined).toContain('transport.dialect: claude-agent-sdk');
    expect(joined).toContain('stream.started: true');
    expect(joined).toContain('stream.completed: true');
    // By design for this provider (Agent SDK owns auth; not an HTTP Bearer
    // provider) — the harness must not force generic HTTP semantics.
    expect(joined).toContain('authorization.header.present: false');
    expect(joined).toContain('request.endpoint: none');
    expect(joined).toContain('safe.error: none');
    expect(joined).toContain('terminal.restored: true');
    expect(joined).toContain('result: LIVE_VERIFIED');
    // Both SDK calls happened: the status probe and the real stream.
    expect(mockQuery).toHaveBeenCalledTimes(2);
    // Account secrets/identity never printed verbatim.
    expect(joined).not.toContain('user@example.com');
    expect(joined).not.toContain('Example Org');
  }, 30_000);

  it('still fails honestly when the SDK stream completes without any text (no fabricated success)', async () => {
    mockQuery
      .mockReturnValueOnce(
        makeSdkQuery([], { subscriptionType: 'max' }),
      )
      .mockReturnValueOnce(
        makeSdkQuery([
          {
            type: 'result',
            subtype: 'success',
            result: '',
            usage: { input_tokens: 4, output_tokens: 0 },
          },
        ]),
      );

    const code = await runProviderAcceptanceTest('claude-subscription', {
      report: (line) => lines.push(line),
    });

    const joined = lines.join('\n');
    expect(code).toBe(1);
    expect(joined).toContain('stream.completed: true');
    expect(joined).toContain('result: LIVE_TEST_FAILED');
  }, 30_000);
});

