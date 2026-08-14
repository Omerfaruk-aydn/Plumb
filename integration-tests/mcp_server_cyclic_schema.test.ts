/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, afterEach, beforeEach } from 'vitest';
import { TestRig } from './test-helper.js';

// Create a minimal MCP server that doesn't require external dependencies
// This implements the MCP protocol directly using Node.js built-ins
const serverScript = `#!/usr/bin/env node
/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

const readline = require('readline');
const fs = require('fs');

// Debug logging to stderr (only when MCP_DEBUG or VERBOSE is set)
const debugEnabled = process.env['MCP_DEBUG'] === 'true' || process.env['VERBOSE'] === 'true';
function debug(msg) {
  if (debugEnabled) {
    fs.writeSync(2, \`[MCP-DEBUG] \${msg}\\n\`);
  }
}

debug('MCP server starting...');

// Simple JSON-RPC implementation for MCP
class SimpleJSONRPC {
  constructor() {
    this.handlers = new Map();
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });

    this.rl.on('line', (line) => {
      debug(\`Received line: \${line}\`);
      try {
        const message = JSON.parse(line);
        debug(\`Parsed message: \${JSON.stringify(message)}\`);
        this.handleMessage(message);
      } catch (e) {
        debug(\`Parse error: \${e.message}\`);
      }
    });
  }

  send(message) {
    const msgStr = JSON.stringify(message);
    debug(\`Sending message: \${msgStr}\`);
    process.stdout.write(msgStr + '\\n');
  }

  async handleMessage(message) {
    if (message.method && this.handlers.has(message.method)) {
      try {
        const result = await this.handlers.get(message.method)(message.params || {});
        if (message.id !== undefined) {
          this.send({
            jsonrpc: '2.0',
            id: message.id,
            result
          });
        }
      } catch (error) {
        if (message.id !== undefined) {
          this.send({
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32603,
              message: error.message
            }
          });
        }
      }
    } else if (message.id !== undefined) {
      this.send({
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32601,
          message: 'Method not found'
        }
      });
    }
  }

  on(method, handler) {
    this.handlers.set(method, handler);
  }
}

// Create MCP server
const rpc = new SimpleJSONRPC();

// Handle initialize
rpc.on('initialize', async (params) => {
  debug('Handling initialize request');
  return {
    protocolVersion: '2024-11-05',
    capabilities: {
      tools: {}
    },
    serverInfo: {
      name: 'cyclic-schema-server',
      version: '1.0.0'
    }
  };
});

// Handle tools/list
rpc.on('tools/list', async () => {
  debug('Handling tools/list request');
  return {
    tools: [{
      name: 'tool_with_cyclic_schema',
      inputSchema: {
        type: 'object',
        properties: {
          data: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                child: { $ref: '#/properties/data/items' },
              },
            },
          },
        },
      }
    }]
  };
});

// Send initialization notification
rpc.send({
  jsonrpc: '2.0',
  method: 'initialized'
});
`;

describe('mcp server with cyclic tool schema is detected', () => {
  let rig: TestRig;

  beforeEach(() => {
    rig = new TestRig();
  });

  afterEach(async () => await rig.cleanup());

  it('mcp tool list should include tool with cyclic tool schema', async () => {
    // Setup test directory with MCP server configuration
    await rig.setup('cyclic-schema-mcp-server', {
      settings: {
        mcpServers: {
          'cyclic-schema-server': {
            command: 'node',
            args: ['mcp-server.cjs'],
          },
        },
      },
    });

    // Create server script in the test directory
    const testServerPath = join(rig.testDir!, 'mcp-server.cjs');
    writeFileSync(testServerPath, serverScript);

    // Make the script executable (though running with 'node' should work anyway)
    if (process.platform !== 'win32') {
      const { chmodSync } = await import('node:fs');
      chmodSync(testServerPath, 0o755);
    }

    const run = await rig.runInteractive();

    await run.type('/mcp list');
    await run.type('\r');

    await run.expectText('tool_with_cyclic_schema');
  });
});
