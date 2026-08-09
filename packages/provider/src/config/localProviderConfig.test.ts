/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import { setProviderConfigResolver } from './providerConfigResolver.js';
import {
  getLocalProviderEndpointDefinition,
  getLocalProviderConfigSchema,
  validateLocalProviderConfig,
  buildLocalProviderSaveOperation,
  resolveLocalProviderBaseUrl,
  resolveOllamaNativeBaseUrl,
  validateLocalProviderBaseUrl,
} from './localProviderConfig.js';

describe('local provider endpoint configuration', () => {
  afterEach(() => {
    setProviderConfigResolver(undefined);
    delete process.env['LM_STUDIO_BASE_URL'];
  });

  it('uses official OpenAI-compatible /v1 defaults for all five runtimes', () => {
    expect(resolveLocalProviderBaseUrl('ollama')).toBe(
      'http://127.0.0.1:11434/v1',
    );
    expect(resolveLocalProviderBaseUrl('lm-studio')).toBe(
      'http://127.0.0.1:1234/v1',
    );
    expect(resolveLocalProviderBaseUrl('llama-cpp')).toBe(
      'http://127.0.0.1:8080/v1',
    );
    expect(resolveLocalProviderBaseUrl('vllm')).toBe(
      'http://127.0.0.1:8000/v1',
    );
    expect(resolveLocalProviderBaseUrl('sglang')).toBe(
      'http://127.0.0.1:30000/v1',
    );
  });

  it('resolves persisted PLUMB configuration ahead of environment', () => {
    process.env['LM_STUDIO_BASE_URL'] = 'http://env-host:1234/v1';
    setProviderConfigResolver(
      (providerId): Readonly<Record<string, string>> =>
        providerId === 'lm-studio'
          ? { baseUrl: 'http://saved-host:4321/v1' }
          : {},
    );
    expect(resolveLocalProviderBaseUrl('lm-studio')).toBe(
      'http://saved-host:4321/v1',
    );
  });

  it('normalizes an Ollama root for production while preserving its native discovery root', () => {
    setProviderConfigResolver(
      (providerId): Readonly<Record<string, string>> =>
        providerId === 'ollama' ? { baseUrl: 'http://ollama-box:11434' } : {},
    );
    expect(resolveLocalProviderBaseUrl('ollama')).toBe(
      'http://ollama-box:11434/v1',
    );
    expect(resolveOllamaNativeBaseUrl()).toBe('http://ollama-box:11434');
  });

  it('describes the correct transport dialect for safe cold-start reconstruction', () => {
    expect(getLocalProviderEndpointDefinition('ollama')?.api).toBe(
      'ollama-chat',
    );
    expect(getLocalProviderEndpointDefinition('sglang')?.api).toBe(
      'openai-completions',
    );
    expect(getLocalProviderEndpointDefinition('openai')).toBeUndefined();
  });

  it('rejects malformed, secret-bearing, and non-HTTP endpoints', () => {
    expect(validateLocalProviderBaseUrl('not a url')).toBeDefined();
    expect(validateLocalProviderBaseUrl('file:///tmp/socket')).toBeDefined();
    expect(
      validateLocalProviderBaseUrl('http://user:secret@localhost:1234/v1'),
    ).toBeDefined();
    expect(
      validateLocalProviderBaseUrl('http://localhost:1234/v1?token=secret'),
    ).toBeDefined();
    expect(
      validateLocalProviderBaseUrl('http://localhost:1234/v1'),
    ).toBeUndefined();
  });

  it('builds a persisted safe endpoint plus a separately-stored optional bearer credential', () => {
    const schema = getLocalProviderConfigSchema('vllm');
    expect(schema?.authModes.map((mode) => mode.id)).toEqual([
      'none',
      'bearer',
    ]);
    const values = {
      authMode: 'bearer',
      baseUrl: 'http://gpu-box:8000/v1/',
      credential: 'local-secret-canary',
    };
    expect(validateLocalProviderConfig('vllm', values)).toEqual({});
    const operation = buildLocalProviderSaveOperation('vllm', values);
    expect(operation).toEqual({
      safeConfig: {
        authMode: 'bearer',
        baseUrl: 'http://gpu-box:8000/v1',
      },
      credential: 'local-secret-canary',
    });
    expect(JSON.stringify(operation.safeConfig)).not.toContain(
      'local-secret-canary',
    );
  });
});
