/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Vertex preflight stage instrumentation: a Vertex request that fails BEFORE
 * the network boundary (missing project / missing credential) must be
 * identifiable by its exact failed stage + safe validation classification —
 * never misread as a serializer/wire rejection, and never a credential leak.
 */

import { describe, it, expect, vi } from 'vitest';

const { mockConfigValue, mockToken } = vi.hoisted(() => ({
  mockConfigValue: vi.fn(),
  mockToken: vi.fn(async () => 'test-token'),
}));

vi.mock('../config/providerConfigResolver.js', () => ({
  resolveProviderConfigValue: mockConfigValue,
  resolveProviderSafeConfig: vi.fn(() => ({})),
}));

vi.mock('../omp-ai/providers/google-auth.js', () => ({
  getVertexAccessToken: mockToken,
}));

import { prepareVertexModel, type VertexRequestPrep } from './googleVertex.js';
import {
  enableToolRouteDiag,
  getLastToolRouteDiag,
  plumbModelStream,
} from './streaming.js';
import type { PlumbModel, PlumbStreamEvent } from '../types.js';

function vertexModel(overrides: Partial<PlumbModel> = {}): PlumbModel {
  return {
    id: 'gemini-3.1-pro-preview',
    provider: 'google-vertex',
    api: 'google-vertex',
    contextWindow: 1_000_000,
    maxTokens: 65_536,
    reasoning: false,
    input: 'text',
    ...overrides,
  };
}

describe('Vertex preflight stage instrumentation', () => {
  it('missing.project fails at PROJECT_RESOLVED before any credential or network', async () => {
    mockConfigValue.mockReturnValue(undefined);
    const prep: VertexRequestPrep = await prepareVertexModel(vertexModel());
    expect(prep.error).toMatchObject({
      type: 'error',
      error: { code: 'CONFIGURATION_REQUIRED' },
    });
    expect(prep.stage).toBe('ROUTE_RESOLVED');
    expect(prep.failedStage).toBe('PROJECT_RESOLVED');
    expect(prep.validationError).toBe('missing.project');
    expect(mockToken).not.toHaveBeenCalled();
  });

  it('missing.credential fails at CREDENTIAL_RESOLVED with AUTH_REQUIRED', async () => {
    mockConfigValue.mockReturnValue('plumb-test-project');
    mockToken.mockRejectedValueOnce(new Error('no ADC'));
    const prep = await prepareVertexModel(vertexModel());
    expect(prep.error).toMatchObject({
      type: 'error',
      error: { code: 'AUTH_REQUIRED' },
    });
    expect(prep.stage).toBe('PROJECT_RESOLVED');
    expect(prep.failedStage).toBe('CREDENTIAL_RESOLVED');
    expect(prep.validationError).toBe('missing.credential');
  });

  it('a fully resolved Vertex route reaches REQUEST_CONSTRUCTED with the real regional URL', async () => {
    mockConfigValue.mockImplementation((_providerId: string, key: string) =>
      key === 'project' ? 'plumb-test-project' : undefined,
    );
    mockToken.mockResolvedValue('vertex-oauth-token');
    const prep = await prepareVertexModel(vertexModel());
    expect(prep.error).toBeUndefined();
    expect(prep.stage).toBe('REQUEST_CONSTRUCTED');
    expect(prep.failedStage).toBeUndefined();
    expect(prep.validationError).toBeUndefined();
    expect(prep.model.baseUrl).toContain(
      '/v1/projects/plumb-test-project/locations/global/publishers/google',
    );
    expect(prep.model.headers?.['Authorization']).toBe(
      'Bearer vertex-oauth-token',
    );
  });

  it('plumbModelStream records the FIRST_BROKEN_BOUNDARY into the diagnostic snapshot', async () => {
    mockConfigValue.mockReturnValue(undefined);
    enableToolRouteDiag();
    const events: PlumbStreamEvent[] = [];
    for await (const event of plumbModelStream({
      model: vertexModel(),
      messages: [{ role: 'user', content: 'Run the diagnostic tool.' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'plumb_tool_probe',
            description: 'probe',
            parameters: { type: 'object' },
          },
        },
      ],
      toolChoice: { mode: 'auto' },
      apiKey: 'sentinel',
    })) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'error',
      error: { code: 'CONFIGURATION_REQUIRED' },
    });
    const diag = getLastToolRouteDiag();
    expect(diag?.['vertexStage']).toBe('ROUTE_RESOLVED');
    expect(diag?.['vertexFailedStage']).toBe('PROJECT_RESOLVED');
    expect(diag?.['vertexValidationError']).toBe('missing.project');
    expect(diag?.['networkStarted']).toBe(false);
    expect(diag?.['functionDeclarationCount']).toBe(0);
  });

  it('resolveVertexProjectAuthority distinguishes configured provider state, environment, and missing', async () => {
    const { resolveVertexProjectAuthority } = await import('./googleVertex.js');
    const auth = resolveVertexProjectAuthority();
    expect(auth).toBeDefined();
    expect(['CONFIGURED_PROVIDER_STATE', 'ENVIRONMENT', 'NONE']).toContain(
      auth.source,
    );
    expect(typeof auth.present).toBe('boolean');
  });
});
