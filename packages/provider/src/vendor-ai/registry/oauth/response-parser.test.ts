/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { parseAuthJsonResponse } from './response-parser.js';

describe('parseAuthJsonResponse', () => {
  it('parses a plain JSON object', () => {
    const value = parseAuthJsonResponse('{"device_code":"abc","ok":true}', {
      provider: 'github-copilot',
      label: 'test',
    });
    expect(value).toEqual({ device_code: 'abc', ok: true });
  });

  it('parses a JSON string that wraps a JSON payload (tolerant unwrap)', () => {
    // Some device-code endpoints reply with a quoted scalar whose inner
    // content is itself JSON (the shape behind the historical Copilot crash).
    const value = parseAuthJsonResponse(
      '"{\\"device_code\\":\\"d123\\",\\"user_code\\":\\"ABCD-EF\\"}"',
      { provider: 'github-copilot', label: 'test' },
    );
    expect(value).toEqual({
      device_code: 'd123',
      user_code: 'ABCD-EF',
    });
  });

  it('returns a scalar JSON value as-is when it is not wrapping JSON', () => {
    const value = parseAuthJsonResponse('"device_cod..."', {
      provider: 'github-copilot',
      label: 'test',
    });
    expect(value).toBe('device_cod...');
  });

  it('throws a descriptive OAuthError (not SyntaxError) for an HTML body', () => {
    let caught: unknown;
    try {
      parseAuthJsonResponse(
        '<!DOCTYPE html><html><body>Sign in to continue</body></html>',
        {
          provider: 'github-copilot',
          label: 'GitHub device authorization',
          status: 200,
        },
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).name).toBe('OAuthError');
    expect((caught as Error).message).toContain('HTML page instead of JSON');
    expect((caught as Error).message).toContain('GitHub device authorization');
  });

  it('throws a descriptive OAuthError for arbitrary non-JSON garbage', () => {
    let caught: unknown;
    try {
      parseAuthJsonResponse('device_cod 42', {
        provider: 'kimi',
        label: 'Kimi device token poll',
        status: 400,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).name).toBe('OAuthError');
    expect((caught as Error).message).toContain('non-JSON');
    expect((caught as Error).message).toContain('device_cod 42');
  });

  it('strips a UTF-8 BOM before parsing', () => {
    const value = parseAuthJsonResponse('\uFEFF{"token":"t"}', {
      provider: 'kimi',
      label: 'test',
    });
    expect(value).toEqual({ token: 't' });
  });
});
