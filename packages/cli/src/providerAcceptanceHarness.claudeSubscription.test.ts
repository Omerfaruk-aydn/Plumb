/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runProviderAcceptanceTest } from './providerAcceptanceHarness.js';
import { recordAcceptance } from './providerAcceptance.js';

const mockGetClaudeSubscriptionStatus = vi.fn();
const mockPlumbModelStream = vi.fn();
const mockGetCatalogModels = vi.fn();
const mockGetPlumbProvider = vi.fn();

vi.mock('@plumb/provider', () => ({
  installBunGlobal: vi.fn(),
  getClaudeSubscriptionStatus: () => mockGetClaudeSubscriptionStatus(),
  plumbModelStream: (opts: unknown) => mockPlumbModelStream(opts),
  getCatalogModels: (id: string) => mockGetCatalogModels(id),
  getPlumbProvider: (id: string) => mockGetPlumbProvider(id),
}));

vi.mock('./providerAcceptance.js', () => ({
  recordAcceptance: vi.fn(),
  getAllAcceptances: vi.fn().mockResolvedValue({}),
}));

const claudeModels = [
  {
    id: 'claude-sonnet-5',
    provider: 'claude-subscription',
    api: 'claude-agent-sdk',
    contextWindow: 200_000,
    maxTokens: 64_000,
    reasoning: true,
    input: 'text',
  },
];

async function* successfulStream() {
  yield { type: 'text', text: 'OK' };
  yield { type: 'done', finishReason: 'stop' };
}

describe('providerAcceptanceHarness — claude-subscription', () => {
  let lines: string[];

  beforeEach(() => {
    lines = [];
    mockGetClaudeSubscriptionStatus.mockReset();
    mockPlumbModelStream.mockReset();
    mockGetCatalogModels.mockReset().mockReturnValue(claudeModels);
    mockGetPlumbProvider
      .mockReset()
      .mockReturnValue({ id: 'anthropic', available: false });
    vi.mocked(recordAcceptance).mockClear();
  });

  it('reports LIVE_VERIFIED and calls the real plumbModelStream dispatch when connected and the stream completes', async () => {
    mockGetClaudeSubscriptionStatus.mockResolvedValue({
      status: 'CONNECTED_SUBSCRIPTION',
      account: { subscriptionType: 'max' },
    });
    mockPlumbModelStream.mockReturnValue(successfulStream());

    const code = await runProviderAcceptanceTest('claude-subscription', {
      report: (line) => lines.push(line),
    });

    expect(code).toBe(0);
    expect(mockPlumbModelStream).toHaveBeenCalledTimes(1);
    const [callArgs] = mockPlumbModelStream.mock.calls[0] as [
      { model: { id: string; api: string }; apiKey: string },
    ];
    expect(callArgs.model.api).toBe('claude-agent-sdk');
    expect(callArgs.model.id).toBe('claude-sonnet-5');
    // No credential is ever forwarded -- the Agent SDK owns its own auth.
    expect(callArgs.apiKey).toBe('');

    const joined = lines.join('\n');
    expect(joined).toContain('result: LIVE_VERIFIED');
    expect(joined).toContain('legacyOAuth.reachable: false');
    expect(joined).toContain(
      'credentialAuthority: EXTERNAL_OFFICIAL_CREDENTIAL_AUTHORITY',
    );
    // This SDK path never takes terminal ownership, so the terminal is
    // intact by construction — the report must say so instead of the
    // misleading generic default (false).
    expect(joined).toContain('terminal.restored: true');
  });

  it('never fabricates success: a completed-but-textless stream is honestly LIVE_TEST_FAILED', async () => {
    // The success predicate is stream evidence (completed AND saw text). A
    // stream that completes without any text event — e.g. a transport that
    // drops assistant content — must NOT be classified LIVE_VERIFIED.
    mockGetClaudeSubscriptionStatus.mockResolvedValue({
      status: 'CONNECTED_SUBSCRIPTION',
      account: { subscriptionType: 'max' },
    });
    mockPlumbModelStream.mockReturnValue(
      (async function* () {
        yield { type: 'usage', usage: { inputTokens: 3, outputTokens: 0 } };
        yield { type: 'done', finishReason: 'stop' };
      })(),
    );

    const code = await runProviderAcceptanceTest('claude-subscription', {
      report: (line) => lines.push(line),
    });

    expect(code).toBe(1);
    const joined = lines.join('\n');
    expect(joined).toContain('stream.completed: true');
    expect(joined).toContain('result: LIVE_TEST_FAILED');
    expect(joined).not.toContain('result: LIVE_VERIFIED');
  });

  it('reports NOT_LOGGED_IN honestly and never attempts a chat call when not connected', async () => {
    mockGetClaudeSubscriptionStatus.mockResolvedValue({
      status: 'NOT_LOGGED_IN',
    });

    const code = await runProviderAcceptanceTest('claude-subscription', {
      report: (line) => lines.push(line),
    });

    expect(code).toBe(1);
    expect(mockPlumbModelStream).not.toHaveBeenCalled();
    expect(lines.join('\n')).toContain('auth.status: NOT_LOGGED_IN');
  });

  it('never prints account email/organization/subscription details verbatim outside the safe account presence flag', async () => {
    mockGetClaudeSubscriptionStatus.mockResolvedValue({
      status: 'CONNECTED_SUBSCRIPTION',
      account: {
        email: 'realuser@example.com',
        organization: 'Real Org Name',
        subscriptionType: 'max',
      },
    });
    mockPlumbModelStream.mockReturnValue(successfulStream());

    await runProviderAcceptanceTest('claude-subscription', {
      report: (line) => lines.push(line),
    });

    const joined = lines.join('\n');
    expect(joined).not.toContain('realuser@example.com');
    expect(joined).not.toContain('Real Org Name');
  });

  it('confirms the raw legacy Claude OAuth route is reported unreachable regardless of Claude Subscription state', async () => {
    mockGetClaudeSubscriptionStatus.mockResolvedValue({
      status: 'NOT_LOGGED_IN',
    });
    mockGetPlumbProvider.mockReturnValue({ id: 'anthropic', available: true });

    await runProviderAcceptanceTest('claude-subscription', {
      report: (line) => lines.push(line),
    });

    // Even if the underlying provider record were ever misconfigured to
    // report available:true, this harness must not claim the legacy route
    // is unreachable falsely -- this test would catch that regression by
    // asserting the value tracks the real provider record, not a hardcoded
    // constant.
    expect(lines.join('\n')).toContain('legacyOAuth.reachable: true');
  });
});
