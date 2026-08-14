/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F21 (PLUMB-UI-DEVRIM-PROMPT.md): `/collab` local HTTP+SSE server -- lets a
 * browser watch the current PLUMB session live, read-only. Zero dependencies
 * (node:http only). A ring buffer keeps the last 500 messages; new
 * connections replay the last 200 (`init` event) and then stream live.
 */
import * as http from 'node:http';
import { EventEmitter } from 'node:events';
import { renderCollabPage } from './collabPage.js';

export const RING_BUFFER_CAPACITY = 500;
export const INITIAL_LOAD_COUNT = 200;
export const DEFAULT_COLLAB_PORT = 4040;
const MAX_PORT_ATTEMPTS = 20;

export type CollabRole = 'user' | 'assistant' | 'system';

export interface CollabMessage {
  id: number;
  role: CollabRole;
  text: string;
  timestamp: number;
}

export interface CollabStatus {
  running: boolean;
  port: number | null;
  viewerCount: number;
}

function isPortInUseError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'EADDRINUSE'
  );
}

export class CollabServer extends EventEmitter {
  private server: http.Server | null = null;
  private port: number | null = null;
  private messages: CollabMessage[] = [];
  private nextId = 1;
  private clients = new Set<http.ServerResponse>();
  private stopping: Promise<void> | null = null;

  isRunning(): boolean {
    return this.server !== null;
  }

  getStatus(): CollabStatus {
    return {
      running: this.isRunning(),
      port: this.port,
      viewerCount: this.clients.size,
    };
  }

  async start(
    preferredPort: number = DEFAULT_COLLAB_PORT,
  ): Promise<CollabStatus> {
    if (this.server) return this.getStatus();

    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
      const candidatePort = preferredPort + attempt;
      try {
        await this.listenOn(candidatePort);
        this.port = candidatePort;
        this.emit('started', this.getStatus());
        return this.getStatus();
      } catch (error) {
        lastError = error;
        if (!isPortInUseError(error)) {
          throw error;
        }
      }
    }
    throw new Error(
      `No free port found in [${preferredPort}, ${preferredPort + MAX_PORT_ATTEMPTS - 1}]: ${String(lastError)}`,
    );
  }

  private listenOn(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) =>
        this.handleRequest(req, res),
      );
      const onError = (error: Error) => {
        server.removeListener('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.removeListener('error', onError);
        this.server = server;
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, '127.0.0.1');
    });
  }

  async stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    const server = this.server;
    if (!server) return;

    this.stopping = new Promise<void>((resolve) => {
      for (const client of this.clients) {
        try {
          client.end();
        } catch {
          // best-effort close; the socket may already be gone
        }
      }
      this.clients.clear();
      server.close(() => resolve());
    });

    await this.stopping;
    this.server = null;
    this.port = null;
    this.stopping = null;
    this.emit('stopped');
  }

  pushMessage(message: Omit<CollabMessage, 'id'>): CollabMessage {
    const full: CollabMessage = { ...message, id: this.nextId++ };
    this.messages.push(full);
    if (this.messages.length > RING_BUFFER_CAPACITY) {
      this.messages.splice(0, this.messages.length - RING_BUFFER_CAPACITY);
    }
    this.broadcast(full);
    return full;
  }

  getBufferedMessages(): readonly CollabMessage[] {
    return this.messages;
  }

  private broadcast(message: CollabMessage): void {
    const payload = `event: message\ndata: ${JSON.stringify(message)}\n\n`;
    for (const client of this.clients) {
      client.write(payload);
    }
  }

  private handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    const url = req.url ?? '/';

    if (url === '/' || url === '') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderCollabPage());
      return;
    }

    if (url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('retry: 2000\n\n');
      const initial = this.messages.slice(-INITIAL_LOAD_COUNT);
      res.write(`event: init\ndata: ${JSON.stringify(initial)}\n\n`);

      this.clients.add(res);
      this.emit('viewerChange', this.clients.size);

      req.on('close', () => {
        this.clients.delete(res);
        this.emit('viewerChange', this.clients.size);
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

let singleton: CollabServer | null = null;

export function getCollabServer(): CollabServer {
  if (!singleton) {
    singleton = new CollabServer();
  }
  return singleton;
}

/** Test-only: drop the module-level singleton so each test starts fresh. */
export function resetCollabServerForTests(): void {
  singleton = null;
}
