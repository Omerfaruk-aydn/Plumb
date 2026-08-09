/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { installBunGlobal } from '../../omp-shims/bun-runtime.js';
import { loginKilo } from './kilo.js';

installBunGlobal();

describe('Kilo device authorization', () => {
  it('surfaces the verification code and returns the approved OAuth token', async () => {
    const onAuth = vi.fn();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 'KILO-CODE',
            verificationUrl: 'https://app.kilo.ai/device',
            expiresIn: 60,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ status: 'approved', token: 'kilo-oauth-canary' }),
          { status: 200 },
        ),
      );

    await expect(
      loginKilo({ fetch: fetchImpl, onAuth }),
    ).resolves.toMatchObject({
      access: 'kilo-oauth-canary',
      refresh: '',
    });
    expect(onAuth).toHaveBeenCalledWith({
      url: 'https://app.kilo.ai/device',
      instructions: 'Enter code: KILO-CODE',
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://api.kilo.ai/api/device-auth/codes/KILO-CODE',
    );
  });

  it('honors cancellation before polling and never persists a token', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          code: 'CANCEL-ME',
          verificationUrl: 'https://app.kilo.ai/device',
          expiresIn: 60,
        }),
        { status: 200 },
      ),
    );

    await expect(
      loginKilo({ fetch: fetchImpl, signal: controller.signal }),
    ).rejects.toThrow(/cancel/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
