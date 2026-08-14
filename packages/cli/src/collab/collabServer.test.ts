/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'node:http';
import {
  CollabServer,
  RING_BUFFER_CAPACITY,
  INITIAL_LOAD_COUNT,
} from './collabServer.js';
import { renderCollabPage } from './collabPage.js';

function get(
  port: number,
  path: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
  });
}

/** Opens an SSE connection and resolves once the `init` event has arrived. */
function connectSse(
  port: number,
): Promise<{ res: http.IncomingMessage; initData: unknown; raw: string[] }> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/events' },
      (res) => {
        let buffer = '';
        const raw: string[] = [];
        const onData = (chunk: Buffer) => {
          buffer += chunk.toString();
          const initMatch = buffer.match(/event: init\ndata: (.*)\n\n/);
          if (initMatch) {
            res.removeListener('data', onData);
            raw.push(buffer);
            resolve({ res, initData: JSON.parse(initMatch[1]), raw });
          }
        };
        res.on('data', onData);
      },
    );
    req.on('error', reject);
  });
}

describe('CollabServer', () => {
  let server: CollabServer;
  const testPorts: number[] = [];

  afterEach(async () => {
    await server?.stop();
  });

  it('starts and reports a running status with the bound port', async () => {
    server = new CollabServer();
    const status = await server.start(41000);
    testPorts.push(41000);

    expect(status.running).toBe(true);
    expect(status.port).toBe(41000);
    expect(server.isRunning()).toBe(true);
  });

  it('serves the collab HTML page on / and matches the expected shell (HTML snapshot)', async () => {
    server = new CollabServer();
    const status = await server.start(41010);

    const { status: httpStatus, body } = await get(status.port!, '/');
    expect(httpStatus).toBe(200);
    expect(body).toBe(renderCollabPage());
    expect(body).toContain('<title>PLUMB collab session</title>');
    expect(body).toContain("new EventSource('/events')");
  });

  it('streams a pushed message to a connected SSE client', async () => {
    server = new CollabServer();
    const status = await server.start(41020);
    const { res, initData } = await connectSse(status.port!);
    expect(initData).toEqual([]);

    const received = new Promise<string>((resolve) => {
      res.on('data', (chunk: Buffer) => resolve(chunk.toString()));
    });

    server.pushMessage({ role: 'user', text: 'hello', timestamp: 1 });
    const chunk = await received;
    expect(chunk).toContain('event: message');
    expect(chunk).toContain('"text":"hello"');
    res.destroy();
  });

  it('falls back to the next port when the preferred one is taken (port++ conflict handling)', async () => {
    const blocker = new CollabServer();
    await blocker.start(41030);

    server = new CollabServer();
    const status = await server.start(41030);

    expect(status.port).toBe(41031);
    await blocker.stop();
  });

  it('caps the ring buffer at 500 and only replays the last 200 on connect', async () => {
    server = new CollabServer();
    const status = await server.start(41040);

    for (let i = 0; i < 600; i++) {
      server.pushMessage({ role: 'user', text: `msg-${i}`, timestamp: i });
    }
    expect(server.getBufferedMessages().length).toBe(RING_BUFFER_CAPACITY);
    expect(server.getBufferedMessages()[0].text).toBe('msg-100');

    const { initData } = await connectSse(status.port!);
    expect((initData as unknown[]).length).toBe(INITIAL_LOAD_COUNT);
    const initial = initData as Array<{ text: string }>;
    expect(initial[0].text).toBe('msg-400');
    expect(initial[initial.length - 1].text).toBe('msg-599');
  });

  it('tracks two concurrent viewers and decrements on disconnect', async () => {
    server = new CollabServer();
    const status = await server.start(41050);

    expect(server.getStatus().viewerCount).toBe(0);
    const client1 = await connectSse(status.port!);
    expect(server.getStatus().viewerCount).toBe(1);
    const client2 = await connectSse(status.port!);
    expect(server.getStatus().viewerCount).toBe(2);

    client1.res.destroy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.getStatus().viewerCount).toBe(1);

    client2.res.destroy();
  });

  it('cleans up all client sockets and stops accepting connections on stop()', async () => {
    server = new CollabServer();
    const status = await server.start(41060);
    const port = status.port!;
    await connectSse(port);
    expect(server.getStatus().viewerCount).toBe(1);

    await server.stop();
    expect(server.isRunning()).toBe(false);
    expect(server.getStatus().viewerCount).toBe(0);

    await expect(get(port, '/')).rejects.toThrow();
  });

  it('is idempotent: stopping twice concurrently does not throw (stop race)', async () => {
    server = new CollabServer();
    await server.start(41070);

    await expect(
      Promise.all([server.stop(), server.stop()]),
    ).resolves.toBeDefined();
    expect(server.isRunning()).toBe(false);
  });

  it('start() is a no-op when already running', async () => {
    server = new CollabServer();
    const first = await server.start(41080);
    const second = await server.start(41080);
    expect(second).toEqual(first);
  });
});
