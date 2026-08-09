/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import { setProviderConfigResolver } from './providerConfigResolver.js';
import {
  buildGatewayProviderSaveOperation,
  getGatewayProviderConfigSchema,
  resolveGatewayProviderBaseUrl,
  validateGatewayProviderConfig,
} from './gatewayProviderConfig.js';

describe('gateway provider configuration', () => {
  afterEach(() => setProviderConfigResolver(undefined));

  it('uses persisted LiteLLM endpoint configuration on the next resolution', () => {
    setProviderConfigResolver(
      (providerId): Readonly<Record<string, string>> =>
        providerId === 'litellm'
          ? { baseUrl: 'http://proxy-box:4000/v1/' }
          : {},
    );
    expect(resolveGatewayProviderBaseUrl('litellm')).toBe(
      'http://proxy-box:4000/v1',
    );
  });

  it('offers explicit Portkey routing authorities', () => {
    expect(
      getGatewayProviderConfigSchema('portkey')?.authModes.map(
        (mode) => mode.id,
      ),
    ).toEqual(['model-id', 'provider', 'config']);
  });

  it('keeps Portkey credentials out of safe configuration', () => {
    const values = {
      authMode: 'provider',
      baseUrl: 'https://api.portkey.ai/v1/',
      routingValue: 'openai',
      credential: 'portkey-secret-canary',
    };
    expect(validateGatewayProviderConfig('portkey', values)).toEqual({});
    const operation = buildGatewayProviderSaveOperation('portkey', values);
    expect(operation).toEqual({
      safeConfig: {
        authMode: 'provider',
        baseUrl: 'https://api.portkey.ai/v1',
        routingMode: 'provider',
        portkeyProvider: 'openai',
      },
      credential: 'portkey-secret-canary',
    });
    expect(JSON.stringify(operation.safeConfig)).not.toContain(
      'portkey-secret-canary',
    );
  });

  it('rejects credential-bearing URLs and header-injection routing values', () => {
    expect(
      validateGatewayProviderConfig('portkey', {
        authMode: 'provider',
        baseUrl: 'https://user:secret@api.portkey.ai/v1',
        routingValue: 'openai\r\nx-evil: yes',
        credential: 'key',
      }),
    ).toMatchObject({
      baseUrl: 'Do not embed credentials in the Base URL.',
      routingValue: 'Routing values must not contain line breaks.',
    });
  });

  it('builds a Cloudflare gateway endpoint without persisting its token', () => {
    const values = {
      authMode: 'stored-provider-credentials',
      accountId: '0123456789abcdef0123456789abcdef',
      gatewayId: 'production-gateway',
      credential: 'cf-gateway-token-canary',
    };
    expect(
      validateGatewayProviderConfig('cloudflare-ai-gateway', values),
    ).toEqual({});
    const operation = buildGatewayProviderSaveOperation(
      'cloudflare-ai-gateway',
      values,
    );
    expect(operation).toEqual({
      safeConfig: {
        authMode: 'stored-provider-credentials',
        accountId: '0123456789abcdef0123456789abcdef',
        gatewayId: 'production-gateway',
        baseUrl:
          'https://gateway.ai.cloudflare.com/v1/0123456789abcdef0123456789abcdef/production-gateway/anthropic',
      },
      credential: 'cf-gateway-token-canary',
    });
    expect(JSON.stringify(operation.safeConfig)).not.toContain(
      'cf-gateway-token-canary',
    );
  });

  it('rejects invalid Cloudflare path identifiers', () => {
    expect(
      validateGatewayProviderConfig('cloudflare-ai-gateway', {
        authMode: 'stored-provider-credentials',
        accountId: '../account',
        gatewayId: 'gateway/escape',
        credential: 'token',
      }),
    ).toMatchObject({
      accountId: 'Enter a valid 32-character Cloudflare account ID.',
      gatewayId:
        'Gateway IDs may contain only letters, numbers, underscores, and hyphens.',
    });
  });
});
