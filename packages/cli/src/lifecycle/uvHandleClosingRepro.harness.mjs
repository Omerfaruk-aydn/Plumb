/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../../');

const provider = await import(
  pathToFileURL(
    path.join(repoRoot, 'packages/provider/dist/index.js'),
  ).href
);
const cliProbe = await import(
  pathToFileURL(
    path.join(repoRoot, 'packages/cli/dist/src/toolRouteProbe.js'),
  ).href
);

function sseChunk(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

/** Minimal in-memory fake credential store -- NOT the real secure store, no
 * user credentials/settings touched. Every fixture provider below uses
 * credentialPlacement 'none', so nothing here is ever actually read for
 * auth; it exists only to satisfy PlumbProviderRegistry.initialize()'s
 * hard dependency on a registered store factory. */
class FakeCredentialStore {
  async getCredentials() { return []; }
  async getApiKey() { return undefined; }
  async hasCredentials() { return false; }
  async listAuthenticatedProviders() { return []; }
  async storeCredential() {}
  async storeOAuthCredential() {}
  async storeApiKeyCredential() {}
  async removeCredentials() {}
  async removeCredential() { return false; }
  async clearAll() {}
  async setProviderMetadata() {}
  async getProviderMetadata() { return null; }
  async healthCheck() { return { available: true, usingFallback: false }; }
}
provider.registerPlumbCredentialStoreFactory(() =>
  Promise.resolve(new FakeCredentialStore()),
);

function startServer(behavior) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (behavior === 'fail400') {
          // The exact GPT-5.5-shaped Copilot upstream body that preceded
          // every observed UV_HANDLE_CLOSING crash.
          res.writeHead(400, {
            'content-type': 'application/json',
            connection: 'close',
          });
          res.end(
            JSON.stringify({
              error: {
                type: 'invalid_request_error',
                param: 'model',
                message: 'The requested model is not supported.',
              },
            }),
          );
          return;
        }
        const parsed = JSON.parse(body || '{}');
        const isContinuation = Array.isArray(parsed.messages)
          ? parsed.messages.some((m) => m.role === 'tool')
          : false;
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        if (isContinuation) {
          res.write(sseChunk({ choices: [{ delta: { content: 'Done.' } }] }));
          res.write(
            sseChunk({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
          );
        } else {
          res.write(
            sseChunk({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_1',
                        function: {
                          name: 'plumb_tool_probe',
                          arguments: '{}',
                        },
                      },
                    ],
                  },
                },
              ],
            }),
          );
          res.write(
            sseChunk({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
          );
        }
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function registerCustomProvider(behavior, modelId) {
  const server = await startServer(behavior);
  const port = server.address().port;
  const id = `custom:${randomUUID()}`;
  const definition = provider.normalizeCustomProviderDefinition({
    version: provider.CUSTOM_PROVIDER_DEFINITION_VERSION,
    id,
    displayName: `uv-repro-${behavior}`,
    dialect: 'openai-completions',
    baseUrl: `http://127.0.0.1:${port}`,
    credentialPlacement: 'none',
    safeHeaders: {},
    manualModels: [
      {
        id: modelId,
        toolsSupported: true,
        contextWindow: 8192,
        maxTokens: 4096,
      },
    ],
  });
  provider.upsertCustomProviderDefinition(definition);
  provider.getPlumbModelRegistry().hydrateCustomProviderModels();
  return { id, server };
}

function activeHandleCount() {
  try {
    return process._getActiveHandles().length;
  } catch {
    return -1;
  }
}

async function runProbe(label, id, modelId) {
  const before = activeHandleCount();
  const outcome = await cliProbe.runToolRouteProbeResult(id, modelId);
  const after = activeHandleCount();
  return { label, code: outcome.code, exitCode: outcome.exitCode, before, after };
}

async function main() {
  const reverse = process.argv[2] === 'reverse';
  const a = await registerCustomProvider('success', 'model-a');
  const b = await registerCustomProvider('fail400', 'model-b');
  const c = await registerCustomProvider('success', 'model-c');

  const order = reverse ? [c, b, a] : [a, b, c];
  const labels = reverse ? ['C', 'B', 'A'] : ['A', 'B', 'C'];
  const modelIds = reverse
    ? ['model-c', 'model-b', 'model-a']
    : ['model-a', 'model-b', 'model-c'];

  const results = [];
  for (let i = 0; i < order.length; i++) {
    results.push(await runProbe(labels[i], order[i].id, modelIds[i]));
  }

  for (const entry of [a, b, c]) {
    await new Promise((resolve) => entry.server.close(resolve));
  }

  // Machine-readable summary on its own line -- the test harness parses
  // this; everything above is human-readable trace output.
  console.log('HARNESS_RESULT_JSON:' + JSON.stringify({ results }));
}

main().then(
  () => {
    process.exitCode = 0;
  },
  (err) => {
    console.error('HARNESS_FATAL_ERROR:', err);
    process.exitCode = 1;
  },
);
