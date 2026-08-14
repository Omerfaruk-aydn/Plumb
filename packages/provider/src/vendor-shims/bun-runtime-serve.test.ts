/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { installBunGlobal } from './bun-runtime.js';

interface BunServer {
  port: number;
  stop: () => void;
}

describe('bun-runtime Bun.serve shim', () => {
  it('hosts a loopback callback server reachable over HTTP', async () => {
    installBunGlobal();
    const bun = (globalThis as unknown as { Bun?: Record<string, unknown> })
      .Bun as Record<string, unknown>;
    expect(typeof bun.serve).toBe('function');

    let receivedUrl = '';
    const server = (
      bun.serve as (o: {
        hostname?: string;
        port?: number;
        fetch: (req: Request) => Response;
      }) => BunServer
    )({
      hostname: 'localhost',
      port: 0,
      fetch: (req: Request) => {
        receivedUrl = req.url;
        return new Response('ok', { status: 200 });
      },
    });
    expect(typeof server.port).toBe('number');

    // Windows loopback occasionally needs a beat before the socket accepts;
    // retry the connect briefly before failing.
    let response: Response | undefined;
    for (let attempt = 0; attempt < 25; attempt += 1) {
      try {
        response = await fetch(
          `http://127.0.0.1:${server.port}/oauth-callback?code=abc`,
        );
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 20));
      }
    }
    expect(response).toBeDefined();
    expect(response!.status).toBe(200);
    expect(await response!.text()).toBe('ok');
    expect(receivedUrl).toContain('/oauth-callback?code=abc');
    server.stop();
  });

  it('exposes Bun.sleep for provisioning loops', async () => {
    installBunGlobal();
    const bun = (globalThis as unknown as { Bun?: Record<string, unknown> })
      .Bun as Record<string, unknown>;
    const start = Date.now();
    await (bun.sleep as (ms: number) => Promise<void>)(10);
    expect(Date.now() - start).toBeGreaterThanOrEqual(8);
  });
});
