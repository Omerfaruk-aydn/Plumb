/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServer, type Server } from 'node:http';
import { URL } from 'node:url';

export interface OAuthCallbackResult {
  code: string;
  state: string;
}

export interface OAuthCallbackServerOptions {
  port: number;
  path?: string;
  timeoutMs?: number;
}

const OAUTH_SUCCESS_HTML = `<!DOCTYPE html>
<html><head><title>PLUMB - Authorization Complete</title>
<style>body{font-family:system-ui;text-align:center;padding:60px;background:#1a1a2e;color:#e0e0e0}
h1{color:#00d4aa}p{color:#a0a0a0}</style></head>
<body><h1>Authorization Complete</h1>
<p>You can close this window and return to PLUMB.</p></body></html>`;

export function startOAuthCallbackServer(
  options: OAuthCallbackServerOptions,
): Promise<{
  server: Server;
  waitForCode: () => Promise<OAuthCallbackResult>;
}> {
  const { port, path = '/oauth2callback', timeoutMs = 300_000 } = options;

  let resolveCode: (result: OAuthCallbackResult) => void;
  let rejectCode: (err: Error) => void;
  let timeoutId: ReturnType<typeof setTimeout>;

  const codePromise = new Promise<OAuthCallbackResult>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);

    if (url.pathname === path) {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');

      if (code && state) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(OAUTH_SUCCESS_HTML);
        resolveCode({ code, state });
      } else {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Missing parameters</h1></body></html>');
        rejectCode(new Error('OAuth callback missing code or state'));
      }
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  return new Promise((resolve, reject) => {
    server.listen(port, 'localhost', () => {
      timeoutId = setTimeout(() => {
        server.close();
        rejectCode(new Error('OAuth callback timed out'));
      }, timeoutMs);

      resolve({
        server,
        waitForCode: () =>
          codePromise.finally(() => {
            clearTimeout(timeoutId);
            server.close();
          }),
      });
    });

    server.on('error', (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });
  });
}
