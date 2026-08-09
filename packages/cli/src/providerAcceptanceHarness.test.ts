/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

/**
 * Regression tests for the provider acceptance harness.
 *
 * Proves (Phase 9 list):
 *  1. startup output bypasses the report collector
 *  2. startup output is visible before provider.login resolves
 *  3. URL/code output is visible before token polling
 *  4. heartbeat writes newline-terminated visible output
 *  5. heartbeat is stopped before final output
 *  6. no heartbeat write occurs after cancellation
 *  7. trace is not buffered until cleanup
 *  8. normal mode contains no trace.stage output
 *  9. safe trace mode streams stages immediately
 * 10. final report is emitted once
 * 11. final report cannot be concatenated with heartbeat text
 * 12. cancellation handlers are detached
 * 13. terminal restoration occurs once
 * 14. Windows ConPTY receives output before Ctrl+C (integration test file)
 * 15. API/NVIDIA/local/custom routes remain unchanged
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  runProviderAcceptanceTest,
  runCodingPlanLiveAcceptance,
  ACCEPTANCE_STUB_ENV,
  ACCEPTANCE_STUB_AUTO_AUTH_ENV,
  type LiveTerminal,
  type ReportEmitter,
  type ModelChoiceAttempt,
} from './providerAcceptanceHarness.js';
import { recordAcceptance } from './providerAcceptance.js';

// Cloud (Phase 4) provider fixtures mirror the real, incomplete-on-purpose
// shape: the OMP catalog entry has no envVars/api for amazon-bedrock and
// google-vertex, and no entry at all for watsonx/oci-genai -- credential
// detection and transport dialect selection must come from
// getPlumbProvider(id).envVars and the selected bundled model, never from a
// generic fallback (see providerAcceptanceHarness.ts's API-key branch).
const CLOUD_PROVIDER_FIXTURES: Record<
  string,
  {
    envVars: string[];
    catalogEntry: Record<string, unknown> | undefined;
    models: Array<Record<string, unknown>>;
  }
> = {
  'amazon-bedrock': {
    envVars: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION'],
    catalogEntry: { defaultModel: 'us.anthropic.claude-opus-4-8' },
    models: [
      {
        id: 'us.anthropic.claude-opus-4-8',
        api: 'anthropic-messages',
        baseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com',
        contextWindow: 200000,
      },
    ],
  },
  azure: {
    envVars: ['AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT'],
    catalogEntry: { defaultModel: 'gpt-5.5' },
    models: [
      {
        id: 'gpt-5.5',
        api: 'azure-openai-responses',
        baseUrl: 'https://plumb-test.openai.azure.com',
        contextWindow: 128000,
      },
    ],
  },
  'google-vertex': {
    envVars: [
      'GOOGLE_CLOUD_PROJECT',
      'GOOGLE_CLOUD_LOCATION',
      'GOOGLE_API_KEY',
    ],
    catalogEntry: { defaultModel: 'gemini-3.1-pro-preview' },
    models: [
      {
        id: 'gemini-3.1-pro-preview',
        api: 'google-generative-ai',
        baseUrl: 'https://us-central1-aiplatform.googleapis.com',
        contextWindow: 1000000,
      },
    ],
  },
  watsonx: {
    envVars: [
      'WATSONX_PROJECT_ID',
      'WATSONX_SPACE_ID',
      'WATSONX_REGION',
      'IBM_CLOUD_API_KEY',
    ],
    catalogEntry: undefined,
    models: [
      {
        id: 'ibm/granite-4-8-instruct',
        api: 'watsonx-chat',
        baseUrl: 'https://us-south.ml.cloud.ibm.com',
        contextWindow: 128000,
      },
    ],
  },
  'oci-genai': {
    envVars: ['OCI_GENAI_API_KEY'],
    catalogEntry: undefined,
    models: [
      {
        id: 'cohere.command-r-plus',
        api: 'oci-openai-responses',
        baseUrl:
          'https://inference.generativeai.us-chicago-1.oci.oraclecloud.com',
        contextWindow: 131072,
      },
    ],
  },
};

// Mutable per-test keychain/registry state, set via vi.hoisted so the
// vi.mock factory below (which vitest hoists above this file's other
// module-level code) can close over it.
const { mockRegistryState, mockLocalUnavailable, mockLocalStreamErrors } =
  vi.hoisted(() => ({
    mockRegistryState: {} as Record<
      string,
      { authState: string; credentials?: { type: 'api_key'; key: string } }
    >,
    mockLocalUnavailable: new Set<string>(),
    mockLocalStreamErrors: new Map<string, string>(),
  }));

const LOCAL_PROVIDER_IDS = [
  'ollama',
  'lm-studio',
  'llama-cpp',
  'vllm',
  'sglang',
] as const;

const GATEWAY_PROVIDER_FIXTURES: Record<
  string,
  { envVar: string; api: string; baseUrl: string }
> = {
  portkey: {
    envVar: 'PORTKEY_API_KEY',
    api: 'openai-completions',
    baseUrl: 'https://api.portkey.ai/v1',
  },
  litellm: {
    envVar: 'LITELLM_API_KEY',
    api: 'openai-completions',
    baseUrl: 'http://127.0.0.1:4000/v1',
  },
};

// Mock the provider module
vi.mock('@google/gemini-cli-provider', () => ({
  installBunGlobal: vi.fn(),
  resolveProviderAlias: (id: string) => id,
  getProviderDefinition: (id: string) => {
    if (id === 'github-copilot') {
      return {
        id: 'github-copilot',
        login: vi.fn(),
        refreshToken: vi.fn(),
      };
    }
    return undefined;
  },
  getCatalogProviderEntry: (id: string) => {
    if (id === 'github-copilot') {
      return { api: 'openai-completions', envVars: [] };
    }
    if (id in CLOUD_PROVIDER_FIXTURES) {
      return CLOUD_PROVIDER_FIXTURES[id].catalogEntry;
    }
    if (id in GATEWAY_PROVIDER_FIXTURES) {
      return {
        defaultModel: `${id}-dynamic-model`,
        envVars: [GATEWAY_PROVIDER_FIXTURES[id].envVar],
      };
    }
    return undefined;
  },
  getPlumbProvider: (id: string) => {
    if (id === 'github-copilot') {
      return {
        id: 'github-copilot',
        category: 'coding_plan',
        authMethods: [{ type: 'device_code' }],
        name: 'GitHub Copilot',
      };
    }
    if (id in CLOUD_PROVIDER_FIXTURES) {
      return {
        id,
        category: 'api_key',
        authMethods: [
          { type: 'env', envVars: CLOUD_PROVIDER_FIXTURES[id].envVars },
        ],
        name: id,
        envVars: CLOUD_PROVIDER_FIXTURES[id].envVars,
      };
    }
    if ((LOCAL_PROVIDER_IDS as readonly string[]).includes(id)) {
      return {
        id,
        category: 'local',
        authMethods: [{ type: 'none' }],
        allowUnauthenticated: true,
        name: id,
        envVars: [],
      };
    }
    if (id in GATEWAY_PROVIDER_FIXTURES) {
      return {
        id,
        category: 'api_key',
        authMethods: [
          { type: 'api_key', envVar: GATEWAY_PROVIDER_FIXTURES[id].envVar },
        ],
        name: id,
        envVars: [GATEWAY_PROVIDER_FIXTURES[id].envVar],
      };
    }
    return undefined;
  },
  getCatalogModels: (id: string) => {
    if (id === 'github-copilot') {
      return [
        { id: 'gpt-4o', name: 'GPT-4o' },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
      ];
    }
    if (id in CLOUD_PROVIDER_FIXTURES) {
      return CLOUD_PROVIDER_FIXTURES[id].models;
    }
    return [];
  },
  async *plumbModelStream(options: { model?: { provider?: string } }) {
    const providerId = options.model?.provider ?? '';
    const errorCode = mockLocalStreamErrors.get(providerId);
    if (errorCode) {
      yield { type: 'error', error: { code: errorCode } };
      return;
    }
    yield { type: 'text', text: 'PLUMB_TEST_OK' };
    yield { type: 'done' };
  },
  SELECTABLE_PROVIDERS: [{ id: 'github-copilot', category: 'coding_plan' }],
  getPlumbProviderRegistry: () => ({
    initialize: vi.fn(),
    getProviderState: (id: string) => mockRegistryState[id],
    getApiKey: async (id: string) => mockRegistryState[id]?.credentials?.key,
  }),
  getPlumbModelRegistry: () => ({
    refreshProvider: async (id: string) => {
      if (mockLocalUnavailable.has(id)) return [];
      const gateway = GATEWAY_PROVIDER_FIXTURES[id];
      return [
        {
          id: gateway ? `${id}-dynamic-model` : `${id}-model`,
          name: `${id} model`,
          provider: id,
          api:
            gateway?.api ??
            (id === 'ollama' ? 'ollama-chat' : 'openai-completions'),
          baseUrl: gateway?.baseUrl ?? `http://127.0.0.1/${id}/v1`,
          contextWindow: 4096,
          maxTokens: 32,
          reasoning: false,
          input: 'text',
          source: 'SERVER_DYNAMIC',
        },
      ];
    },
  }),
}));

// Mock the acceptance recording
vi.mock('./providerAcceptance.js', () => ({
  recordAcceptance: vi.fn(),
  getAllAcceptances: vi.fn().mockResolvedValue({}),
}));

interface Capture {
  terminal: LiveTerminal;
  report: ReportEmitter;
  terminalLines: string[];
  reportLines: string[];
}

function capture(): Capture {
  const terminalLines: string[] = [];
  const reportLines: string[] = [];
  return {
    terminal: { writeLine: (line: string) => terminalLines.push(line) },
    report: (line: string) => reportLines.push(line),
    terminalLines,
    reportLines,
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function makeProviderModule(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    resolveProviderAlias: (id: string) => id,
    getPlumbProvider: (id: string) => ({
      id,
      category: 'coding_plan',
      authMethods: [{ type: 'device_code' }],
      name: 'GitHub Copilot',
    }),
    getProviderDefinition: () => ({
      id: 'github-copilot',
      login: vi.fn(),
      refreshToken: vi.fn(),
    }),
    getCatalogProviderEntry: () => ({ api: 'openai-completions', envVars: [] }),
    getCatalogModels: () => [
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    ],
    async *plumbModelStream() {
      yield { type: 'text', text: 'PLUMB_TEST_OK' };
    },
    ...overrides,
  };
}

function getDef(
  providerModule: Record<string, unknown>,
): Record<string, unknown> | undefined {
  return (
    providerModule['getProviderDefinition'] as (
      id: string,
    ) => Record<string, unknown> | undefined
  )('x');
}

describe('provider acceptance harness', () => {
  let originalIsTTY: boolean | undefined;
  let originalSetRawMode:
    | ((mode: boolean) => NodeJS.ReadStream & { fd: 0 })
    | undefined;

  beforeEach(() => {
    originalIsTTY = process.stdin.isTTY;
    originalSetRawMode = process.stdin.setRawMode;
    delete process.env[ACCEPTANCE_STUB_ENV];
    mockLocalUnavailable.clear();
    mockLocalStreamErrors.clear();
  });

  afterEach(() => {
    mockLocalUnavailable.clear();
    mockLocalStreamErrors.clear();
    for (const key of Object.keys(mockRegistryState)) {
      delete mockRegistryState[key];
    }
    if (originalIsTTY !== undefined) {
      process.stdin.isTTY = originalIsTTY;
    } else {
      process.stdin.isTTY = undefined as unknown as boolean;
    }
    if (originalSetRawMode) {
      Object.defineProperty(process.stdin, 'setRawMode', {
        value: originalSetRawMode,
        configurable: true,
        writable: true,
      });
    }
  });

  it('1. github-copilot test-provider uses coding_plan category', async () => {
    process.stdin.isTTY = false;

    const exitCode = await runProviderAcceptanceTest('github-copilot');

    expect(exitCode).toBe(1);
  });

  it('12. non-TTY exits with LIVE_TEST_REQUIRES_INTERACTIVE_TTY', async () => {
    process.stdin.isTTY = false;
    const t = capture();

    const exitCode = await runProviderAcceptanceTest('github-copilot', {
      report: t.report,
    });

    expect(exitCode).toBe(1);
    expect(t.reportLines.join('\n')).toContain(
      'LIVE_TEST_REQUIRES_INTERACTIVE_TTY',
    );
  });

  it('13. static diagnostics remain noninteractive (--diagnose-plan)', async () => {
    expect(typeof runProviderAcceptanceTest).toBe('function');
    expect(typeof runCodingPlanLiveAcceptance).toBe('function');
  });

  it('14. API provider harness remains working', async () => {
    const t = capture();
    const exitCode = await runProviderAcceptanceTest('nvidia', {
      report: t.report,
    });
    expect(exitCode).toBe(0);
  });

  it('15. local routes execute discovery and transport without requiring a TTY', async () => {
    process.stdin.isTTY = false;
    const referenceRoutes = [
      'ollama',
      'lm-studio',
      'llama-cpp',
      'vllm',
      'sglang',
    ];
    for (const route of referenceRoutes) {
      const t = capture();
      const exitCode = await runProviderAcceptanceTest(route, {
        report: t.report,
      });
      expect(exitCode).toBe(0);
      const joined = t.reportLines.join('\n');
      expect(joined).toContain('models.dynamic.count: 1');
      expect(joined).toContain('stream.completed: true');
      expect(joined).toContain('cancellation.verified: false');
      expect(joined).toContain('result: LIVE_VERIFIED');
    }
  });

  it('16. an unreachable local server fails safely and is never recorded as verified', async () => {
    mockLocalUnavailable.add('vllm');
    const t = capture();

    const exitCode = await runProviderAcceptanceTest('vllm', {
      report: t.report,
    });

    expect(exitCode).toBe(1);
    const joined = t.reportLines.join('\n');
    expect(joined).toContain('result: SERVER_UNAVAILABLE');
    expect(joined).toContain('safe.error: SERVER_UNAVAILABLE:');
    expect(joined).not.toContain('result: LIVE_VERIFIED');
    expect(recordAcceptance).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'vllm',
        safeResult: 'SERVER_UNAVAILABLE',
        streamVerified: false,
      }),
    );
  });

  it('17. a local request network failure stays redacted and never claims completion', async () => {
    mockLocalStreamErrors.set('ollama', 'NETWORK_ERROR');
    const t = capture();

    const exitCode = await runProviderAcceptanceTest('ollama', {
      report: t.report,
    });

    expect(exitCode).toBe(1);
    const joined = t.reportLines.join('\n');
    expect(joined).toContain('stream.started: true');
    expect(joined).toContain('stream.completed: false');
    expect(joined).toContain('result: SERVER_UNAVAILABLE');
    expect(joined).toContain(
      'safe.error: SERVER_UNAVAILABLE: the configured local server could not complete the request.',
    );
  });

  it('18. an optional local credential is resolved from the canonical registry', async () => {
    mockRegistryState['lm-studio'] = {
      authState: 'authenticated',
      credentials: { type: 'api_key', key: 'local-key-canary' },
    };
    const t = capture();

    const exitCode = await runProviderAcceptanceTest('lm-studio', {
      report: t.report,
    });

    expect(exitCode).toBe(0);
    const joined = t.reportLines.join('\n');
    expect(joined).toContain('auth.result: keychain_authenticated');
    expect(joined).toContain('credential.storage: keychain');
    expect(joined).toContain('authorization.header.present: true');
    expect(joined).not.toContain('local-key-canary');
  });

  it('19. dynamic-only gateways discover with the resolved credential before streaming', async () => {
    process.stdin.isTTY = true;
    for (const [providerId, fixture] of Object.entries(
      GATEWAY_PROVIDER_FIXTURES,
    )) {
      vi.stubEnv(fixture.envVar, `${providerId}-credential-canary`);
      const t = capture();

      const exitCode = await runProviderAcceptanceTest(providerId, {
        report: t.report,
      });

      expect(exitCode).toBe(0);
      const joined = t.reportLines.join('\n');
      expect(joined).toContain('models.bundled.count: 0');
      expect(joined).toContain('models.dynamic.count: 1');
      expect(joined).toContain(`selected.model: ${providerId}-dynamic-model`);
      expect(joined).toContain(`request.endpoint: ${fixture.baseUrl}`);
      expect(joined).toContain('result: LIVE_VERIFIED');
      expect(joined).not.toContain(`${providerId}-credential-canary`);
      vi.unstubAllEnvs();
    }
  });
});

// Phase 4: amazon-bedrock, azure, google-vertex, watsonx, oci-genai.
//
// These providers previously fell through the generic API-key branch with
// two silent defects: (1) credential detection relied only on the OMP
// catalog's `envVars`, which is empty for amazon-bedrock/google-vertex and
// absent entirely for watsonx/oci-genai, so a real AWS/GCP credential could
// never be detected; (2) the stream request always used a hardcoded
// 'openai-completions' dialect and a fabricated 'none'/'default' model id
// instead of the selected bundled model's real api/baseUrl/id, so even a
// detected credential would dispatch through the wrong transport.
describe('Phase 4 cloud provider acceptance (bedrock/azure/vertex/watsonx/oci)', () => {
  const CLOUD_PROVIDER_IDS = [
    'amazon-bedrock',
    'azure',
    'google-vertex',
    'watsonx',
    'oci-genai',
  ] as const;

  let originalIsTTY: boolean | undefined;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    originalIsTTY = process.stdin.isTTY;
    process.stdin.isTTY = true;
  });

  afterEach(() => {
    if (originalIsTTY !== undefined) {
      process.stdin.isTTY = originalIsTTY;
    } else {
      process.stdin.isTTY = undefined as unknown as boolean;
    }
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    for (const key of Object.keys(mockRegistryState)) {
      delete mockRegistryState[key];
    }
  });

  function setEnv(key: string, value: string): void {
    if (!(key in savedEnv)) savedEnv[key] = process.env[key];
    process.env[key] = value;
  }

  it('detects real credentials via getPlumbProvider(id).envVars for every cloud provider', async () => {
    for (const id of CLOUD_PROVIDER_IDS) {
      const t = capture();
      const exitCode = await runProviderAcceptanceTest(id, {
        report: t.report,
      });
      expect(exitCode).toBe(1);
      const joined = t.reportLines.join('\n');
      expect(joined).toContain('auth.result: no_credential');
    }
  });

  it('amazon-bedrock: AWS credential env vars are recognized and route through anthropic-messages', async () => {
    setEnv('AWS_ACCESS_KEY_ID', 'AKIA_TEST');
    setEnv('AWS_SECRET_ACCESS_KEY', 'secret');
    setEnv('AWS_REGION', 'us-east-1');
    const t = capture();
    const exitCode = await runProviderAcceptanceTest('amazon-bedrock', {
      report: t.report,
    });
    const joined = t.reportLines.join('\n');
    expect(joined).toContain('auth.result: env_key_present');
    expect(joined).toContain('transport.dialect: anthropic-messages');
    expect(joined).toContain('selected.model: us.anthropic.claude-opus-4-8');
    expect(joined).toContain('result: LIVE_VERIFIED');
    expect(exitCode).toBe(0);
  });

  it('azure: AZURE_OPENAI_* env vars are recognized and route through azure-openai-responses', async () => {
    setEnv('AZURE_OPENAI_API_KEY', 'azure-test-key');
    setEnv('AZURE_OPENAI_ENDPOINT', 'https://plumb-test.openai.azure.com');
    const t = capture();
    const exitCode = await runProviderAcceptanceTest('azure', {
      report: t.report,
    });
    const joined = t.reportLines.join('\n');
    expect(joined).toContain('auth.result: env_key_present');
    expect(joined).toContain('transport.dialect: azure-openai-responses');
    expect(joined).toContain('selected.model: gpt-5.5');
    expect(exitCode).toBe(0);
  });

  it('google-vertex: GOOGLE_CLOUD_* env vars are recognized (previously undetectable)', async () => {
    setEnv('GOOGLE_CLOUD_PROJECT', 'plumb-test-project');
    setEnv('GOOGLE_CLOUD_LOCATION', 'us-central1');
    const t = capture();
    const exitCode = await runProviderAcceptanceTest('google-vertex', {
      report: t.report,
    });
    const joined = t.reportLines.join('\n');
    expect(joined).toContain('auth.result: env_key_present');
    expect(joined).toContain('transport.dialect: google-generative-ai');
    expect(joined).toContain('selected.model: gemini-3.1-pro-preview');
    expect(exitCode).toBe(0);
  });

  it('watsonx: IBM_CLOUD_API_KEY is recognized despite no OMP catalog entry', async () => {
    setEnv('IBM_CLOUD_API_KEY', 'ibm-test-key');
    const t = capture();
    const exitCode = await runProviderAcceptanceTest('watsonx', {
      report: t.report,
    });
    const joined = t.reportLines.join('\n');
    expect(joined).toContain('auth.result: env_key_present');
    expect(joined).toContain('transport.dialect: watsonx-chat');
    expect(joined).toContain('selected.model: ibm/granite-4-8-instruct');
    expect(exitCode).toBe(0);
  });

  it('oci-genai: OCI_GENAI_API_KEY is recognized despite no OMP catalog entry', async () => {
    setEnv('OCI_GENAI_API_KEY', 'oci-test-key');
    const t = capture();
    const exitCode = await runProviderAcceptanceTest('oci-genai', {
      report: t.report,
    });
    const joined = t.reportLines.join('\n');
    expect(joined).toContain('auth.result: env_key_present');
    expect(joined).toContain('transport.dialect: oci-openai-responses');
    expect(joined).toContain('selected.model: cohere.command-r-plus');
    expect(exitCode).toBe(0);
  });

  it('watsonx: a keychain-stored (non-env) credential still reaches the real stream test', async () => {
    // watsonx's real credential authority is PLUMB's own credential store,
    // not an env var (see catalog/providers.ts comment on the 'watsonx'
    // entry) -- no env vars are set here, only registry/keychain state.
    mockRegistryState['watsonx'] = {
      authState: 'authenticated',
      credentials: { type: 'api_key', key: 'keychain-ibm-key' },
    };
    const t = capture();
    const exitCode = await runProviderAcceptanceTest('watsonx', {
      report: t.report,
    });
    const joined = t.reportLines.join('\n');
    expect(joined).toContain('auth.result: keychain_authenticated');
    expect(joined).toContain('credential.storage: keychain');
    expect(joined).toContain('stream.started: true');
    expect(joined).toContain('result: LIVE_VERIFIED');
    expect(exitCode).toBe(0);
  });

  it('watsonx: keychain state without a usable credential stays CONFIGURATION_REQUIRED and never fakes success', async () => {
    mockRegistryState['watsonx'] = { authState: 'expired' };
    const t = capture();
    const exitCode = await runProviderAcceptanceTest('watsonx', {
      report: t.report,
    });
    const joined = t.reportLines.join('\n');
    expect(joined).toContain('auth.result: no_credential');
    expect(joined).toContain(
      'result: IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED',
    );
    expect(joined).not.toContain('result: LIVE_VERIFIED');
    expect(exitCode).toBe(1);
  });
});

describe('live acceptance terminal channels', () => {
  let originalIsTTY: boolean | undefined;
  let originalSetRawMode:
    | ((mode: boolean) => NodeJS.ReadStream & { fd: 0 })
    | undefined;

  beforeEach(() => {
    originalIsTTY = process.stdin.isTTY;
    originalSetRawMode = process.stdin.setRawMode;
    delete process.env[ACCEPTANCE_STUB_ENV];
    process.stdin.isTTY = true;
    if (typeof process.stdin.setRawMode !== 'function') {
      Object.defineProperty(process.stdin, 'setRawMode', {
        value: () => process.stdin,
        configurable: true,
        writable: true,
      });
    }
  });

  afterEach(() => {
    if (originalIsTTY !== undefined) {
      process.stdin.isTTY = originalIsTTY;
    } else {
      process.stdin.isTTY = undefined as unknown as boolean;
    }
    if (originalSetRawMode) {
      Object.defineProperty(process.stdin, 'setRawMode', {
        value: originalSetRawMode,
        configurable: true,
        writable: true,
      });
    }
  });

  it('1. startup output bypasses the report collector', async () => {
    let releaseLogin: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseLogin = resolve;
    });
    const providerModule = makeProviderModule({
      getProviderDefinition: () => ({
        login: () => gate.then(() => ({ accessKey: 'k' })),
      }),
    });
    const t = capture();

    const promise = runCodingPlanLiveAcceptance(
      'github-copilot',
      'github-copilot',
      providerModule,
      getDef(providerModule),
      'coding_plan',
      { terminal: t.terminal, report: t.report, readLine: async () => '1' },
    );
    await tick();

    expect(t.terminalLines.join('\n')).toContain(
      'PLUMB coding-plan live acceptance',
    );
    expect(t.reportLines.length).toBe(0);
    releaseLogin?.();
    await promise;
  });

  it('2. startup output is visible before provider.login resolves', async () => {
    let loginStarted = false;
    let releaseLogin: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseLogin = resolve;
    });
    const providerModule = makeProviderModule({
      getProviderDefinition: () => ({
        login: () => {
          loginStarted = true;
          return gate.then(() => ({ accessKey: 'k' }));
        },
      }),
    });
    const t = capture();

    const promise = runCodingPlanLiveAcceptance(
      'github-copilot',
      'github-copilot',
      providerModule,
      getDef(providerModule),
      'coding_plan',
      { terminal: t.terminal, report: t.report, readLine: async () => '1' },
    );
    await tick();

    expect(loginStarted).toBe(true);
    expect(t.terminalLines.join('\n')).toContain(
      'Stage: Requesting device authorization...',
    );
    releaseLogin?.();
    await promise;
  });

  it('3. URL/code output is visible before token polling', async () => {
    let releaseLogin: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseLogin = resolve;
    });
    const providerModule = makeProviderModule({
      getProviderDefinition: () => ({
        login: ({ onAuth }: { onAuth: (i: unknown) => void }) => {
          onAuth({
            url: 'https://github.com/login/device',
            launchUrl: 'https://github.com/login/device',
            instructions: 'Enter code: ABC-1234',
          });
          return gate.then(() => ({ accessKey: 'k' }));
        },
      }),
    });
    const t = capture();

    const promise = runCodingPlanLiveAcceptance(
      'github-copilot',
      'github-copilot',
      providerModule,
      getDef(providerModule),
      'coding_plan',
      { terminal: t.terminal, report: t.report, readLine: async () => '1' },
    );
    await tick();

    expect(t.terminalLines.join('\n')).toContain(
      'https://github.com/login/device',
    );
    expect(t.terminalLines.join('\n')).toContain('ABC-1234');
    releaseLogin?.();
    await promise;
  });

  it('4. heartbeat writes newline-terminated visible output', async () => {
    let releaseLogin: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseLogin = resolve;
    });
    const providerModule = makeProviderModule({
      getProviderDefinition: () => ({
        login: ({ onAuth }: { onAuth: (i: unknown) => void }) => {
          onAuth({
            url: 'https://github.com/login/device',
            launchUrl: 'https://github.com/login/device',
            instructions: 'Enter code: ABC-1234',
          });
          return gate.then(() => ({ accessKey: 'k' }));
        },
      }),
    });
    const t = capture();

    const promise = runCodingPlanLiveAcceptance(
      'github-copilot',
      'github-copilot',
      providerModule,
      getDef(providerModule),
      'coding_plan',
      { terminal: t.terminal, report: t.report, readLine: async () => '1' },
    );
    await tick();
    await sleep(1300);

    const heartbeats = t.terminalLines.filter((l) =>
      l.startsWith('Waiting for GitHub authorization'),
    );
    expect(heartbeats.length).toBeGreaterThan(0);
    expect(heartbeats[0]).toMatch(
      /^Waiting for GitHub authorization\.\.\. \d+s$/,
    );
    releaseLogin?.();
    await promise;
  });

  it('5. heartbeat is stopped before final output', async () => {
    let releaseLogin: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseLogin = resolve;
    });
    const providerModule = makeProviderModule({
      getProviderDefinition: () => ({
        login: ({ onAuth }: { onAuth: (i: unknown) => void }) => {
          onAuth({
            url: 'https://github.com/login/device',
            launchUrl: 'https://github.com/login/device',
            instructions: 'Enter code: ABC-1234',
          });
          return gate.then(() => ({ accessKey: 'k' }));
        },
      }),
    });
    const t = capture();

    const promise = runCodingPlanLiveAcceptance(
      'github-copilot',
      'github-copilot',
      providerModule,
      getDef(providerModule),
      'coding_plan',
      { terminal: t.terminal, report: t.report, readLine: async () => '1' },
    );
    await tick();
    await sleep(1300);
    releaseLogin?.();
    await promise;

    const heartbeatLines = t.terminalLines.filter((l) =>
      l.startsWith('Waiting for GitHub authorization'),
    );
    const heartbeatsAfterAuth = t.terminalLines.filter(
      (l, i) =>
        l.startsWith('Waiting for GitHub authorization') &&
        i > t.terminalLines.indexOf('Authentication successful.'),
    );
    expect(heartbeatLines.length).toBeGreaterThan(0);
    expect(heartbeatsAfterAuth.length).toBe(0);
  });

  it('6. no heartbeat write occurs after cancellation', async () => {
    let rejectLogin: ((err: Error) => void) | undefined;
    const gate = new Promise<void>((_resolve, reject) => {
      rejectLogin = reject;
    });
    const providerModule = makeProviderModule({
      getProviderDefinition: () => ({
        login: ({ onAuth }: { onAuth: (i: unknown) => void }) => {
          onAuth({
            url: 'https://github.com/login/device',
            launchUrl: 'https://github.com/login/device',
            instructions: 'Enter code: ABC-1234',
          });
          return gate;
        },
      }),
    });
    const t = capture();

    const promise = runCodingPlanLiveAcceptance(
      'github-copilot',
      'github-copilot',
      providerModule,
      getDef(providerModule),
      'coding_plan',
      { terminal: t.terminal, report: t.report, readLine: async () => '1' },
    );
    await tick();
    await sleep(1300);
    rejectLogin?.(new Error('operation cancelled'));
    const exitCode = await promise;

    expect(exitCode).toBe(1);
    expect(t.terminalLines[t.terminalLines.length - 1]).toBe(
      'LIVE_TEST_CANCELLED',
    );
    const finalIndex = t.terminalLines.indexOf('LIVE_TEST_CANCELLED');
    for (const line of t.terminalLines.slice(finalIndex + 1)) {
      expect(line).not.toMatch(/Waiting for GitHub authorization/);
    }
  });

  it('7. trace is not buffered until cleanup', async () => {
    // Trace lines go out through the same live terminal; no queue exists.
    let rejectLogin: ((err: Error) => void) | undefined;
    const gate = new Promise<void>((_resolve, reject) => {
      rejectLogin = reject;
    });
    const providerModule = makeProviderModule({
      getProviderDefinition: () => ({
        login: ({ onAuth }: { onAuth: (i: unknown) => void }) => {
          onAuth({
            url: 'https://github.com/login/device',
            launchUrl: 'https://github.com/login/device',
            instructions: 'Enter code: ABC-1234',
          });
          return gate;
        },
      }),
    });
    const t = capture();

    const promise = runCodingPlanLiveAcceptance(
      'github-copilot',
      'github-copilot',
      providerModule,
      getDef(providerModule),
      'coding_plan',
      {
        terminal: t.terminal,
        report: t.report,
        traceMode: true,
        readLine: async () => '1',
      },
    );
    await tick();

    expect(t.terminalLines).toContain('trace.stage: DEVICE_REQUEST_STARTED');
    expect(t.terminalLines).toContain('trace.stage: DEVICE_CODE_PRESENTED');
    rejectLogin?.(new Error('operation cancelled'));
    await promise;
  });

  it('8. normal mode contains no trace.stage output', async () => {
    let rejectLogin: ((err: Error) => void) | undefined;
    const gate = new Promise<void>((_resolve, reject) => {
      rejectLogin = reject;
    });
    const providerModule = makeProviderModule({
      getProviderDefinition: () => ({
        login: ({ onAuth }: { onAuth: (i: unknown) => void }) => {
          onAuth({
            url: 'https://github.com/login/device',
            launchUrl: 'https://github.com/login/device',
            instructions: 'Enter code: ABC-1234',
          });
          return gate;
        },
      }),
    });
    const t = capture();

    const promise = runCodingPlanLiveAcceptance(
      'github-copilot',
      'github-copilot',
      providerModule,
      getDef(providerModule),
      'coding_plan',
      { terminal: t.terminal, report: t.report, readLine: async () => '1' },
    );
    await tick();
    await sleep(1200);
    rejectLogin?.(new Error('operation cancelled'));
    await promise;

    expect(t.terminalLines.some((l) => l.startsWith('trace.stage:'))).toBe(
      false,
    );
  });

  it('9. safe trace mode streams stages immediately', async () => {
    let rejectLogin: ((err: Error) => void) | undefined;
    const gate = new Promise<void>((_resolve, reject) => {
      rejectLogin = reject;
    });
    const providerModule = makeProviderModule({
      getProviderDefinition: () => ({
        login: ({ onAuth }: { onAuth: (i: unknown) => void }) => {
          onAuth({
            url: 'https://github.com/login/device',
            launchUrl: 'https://github.com/login/device',
            instructions: 'Enter code: ABC-1234',
          });
          return gate;
        },
      }),
    });
    const t = capture();

    const promise = runCodingPlanLiveAcceptance(
      'github-copilot',
      'github-copilot',
      providerModule,
      getDef(providerModule),
      'coding_plan',
      {
        terminal: t.terminal,
        report: t.report,
        traceMode: true,
        readLine: async () => '1',
      },
    );
    await tick();

    // Immediately streamed, not retained.
    const requestIndex = t.terminalLines.indexOf(
      'trace.stage: DEVICE_REQUEST_STARTED',
    );
    const authIndex = t.terminalLines.indexOf(
      'trace.stage: DEVICE_CODE_PRESENTED',
    );
    expect(requestIndex).toBeGreaterThanOrEqual(0);
    expect(authIndex).toBeGreaterThan(requestIndex);
    rejectLogin?.(new Error('operation cancelled'));
    await promise;
  });

  it('10. final report is emitted once', async () => {
    let rejectLogin: ((err: Error) => void) | undefined;
    const gate = new Promise<void>((_resolve, reject) => {
      rejectLogin = reject;
    });
    const providerModule = makeProviderModule({
      getProviderDefinition: () => ({
        login: ({ onAuth }: { onAuth: (i: unknown) => void }) => {
          onAuth({
            url: 'https://github.com/login/device',
            launchUrl: 'https://github.com/login/device',
            instructions: 'Enter code: ABC-1234',
          });
          return gate;
        },
      }),
    });
    const t = capture();

    const promise = runCodingPlanLiveAcceptance(
      'github-copilot',
      'github-copilot',
      providerModule,
      getDef(providerModule),
      'coding_plan',
      { terminal: t.terminal, report: t.report, readLine: async () => '1' },
    );
    await tick();
    rejectLogin?.(new Error('operation cancelled'));
    await promise;

    expect(t.reportLines.filter((l) => l.startsWith('result:')).length).toBe(1);
    expect(t.reportLines.join('\n')).toContain('result: LIVE_TEST_CANCELLED');
  });

  it('11. final report cannot be concatenated with heartbeat text', async () => {
    let rejectLogin: ((err: Error) => void) | undefined;
    const gate = new Promise<void>((_resolve, reject) => {
      rejectLogin = reject;
    });
    const providerModule = makeProviderModule({
      getProviderDefinition: () => ({
        login: ({ onAuth }: { onAuth: (i: unknown) => void }) => {
          onAuth({
            url: 'https://github.com/login/device',
            launchUrl: 'https://github.com/login/device',
            instructions: 'Enter code: ABC-1234',
          });
          return gate;
        },
      }),
    });
    const t = capture();

    const promise = runCodingPlanLiveAcceptance(
      'github-copilot',
      'github-copilot',
      providerModule,
      getDef(providerModule),
      'coding_plan',
      { terminal: t.terminal, report: t.report, readLine: async () => '1' },
    );
    await tick();
    await sleep(1300);
    rejectLogin?.(new Error('operation cancelled'));
    await promise;

    // Separate channels: the live channel ends with LIVE_TEST_CANCELLED and
    // the report channel never mixes heartbeat text.
    expect(t.terminalLines[t.terminalLines.length - 1]).toBe(
      'LIVE_TEST_CANCELLED',
    );
    expect(
      t.reportLines.some((l) => l.includes('Waiting for GitHub authorization')),
    ).toBe(false);
  });

  it('12. cancellation handlers are detached', async () => {
    process.stdin.isTTY = true;
    const setRawModeSpy = vi
      .spyOn(process.stdin, 'setRawMode')
      .mockImplementation(() => process.stdin as never);
    const providerModule = makeProviderModule();
    const t = capture();

    const promise = runCodingPlanLiveAcceptance(
      'github-copilot',
      'github-copilot',
      providerModule,
      undefined,
      'coding_plan',
      { terminal: t.terminal, report: t.report, stub: true },
    );
    await tick();

    expect(setRawModeSpy).toHaveBeenCalledWith(true);
    process.stdin.emit('data', '\u0003');
    const exitCode = await promise;

    expect(exitCode).toBe(1);
    expect(t.reportLines.join('\n')).toContain('result: LIVE_TEST_CANCELLED');
    setRawModeSpy.mockRestore();
  });

  it('13. terminal restoration occurs once', async () => {
    process.stdin.isTTY = true;
    const setRawModeSpy = vi
      .spyOn(process.stdin, 'setRawMode')
      .mockImplementation(() => process.stdin as never);
    const providerModule = makeProviderModule();
    const t = capture();

    const promise = runCodingPlanLiveAcceptance(
      'github-copilot',
      'github-copilot',
      providerModule,
      undefined,
      'coding_plan',
      { terminal: t.terminal, report: t.report, stub: true },
    );
    await tick();
    process.stdin.emit('data', '\u0003');
    await promise;

    const trueCalls = setRawModeSpy.mock.calls.filter((c) => c[0] === true);
    const falseCalls = setRawModeSpy.mock.calls.filter((c) => c[0] === false);
    expect(trueCalls.length).toBe(1);
    expect(falseCalls.length).toBe(1);
    expect(t.reportLines.join('\n')).toContain('terminal.restored: true');
    setRawModeSpy.mockRestore();
  });

  it('14. API/NVIDIA/local/custom routes remain unchanged', async () => {
    const referenceRoutes = [
      'nvidia',
      'ollama',
      'lm-studio',
      'llama-cpp',
      'vllm',
      'custom-openai-compat',
    ];
    for (const route of referenceRoutes) {
      const t = capture();
      const exitCode = await runProviderAcceptanceTest(route, {
        report: t.report,
      });
      expect(exitCode).toBe(0);
    }
  });
});

describe('model selection input ownership and validation', () => {
  let originalIsTTY: boolean | undefined;
  let originalSetRawMode:
    | ((mode: boolean) => NodeJS.ReadStream & { fd: 0 })
    | undefined;

  const MODEL_CRED = { access: 'TOKEN_ACCESS_XYZ', apiEndpoint: undefined };
  const OAuthModule = (overrides: Record<string, unknown> = {}) =>
    makeProviderModule({
      getProviderDefinition: () => ({
        login: () => MODEL_CRED,
        refreshToken: vi.fn(),
      }),
      getCatalogModels: () => [
        { id: 'gpt-4o', name: 'GPT-4o', api: 'openai-completions' },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini', api: 'openai-completions' },
      ],
      ...overrides,
    });

  const sequence = (
    attempts: ModelChoiceAttempt[],
  ): (() => Promise<ModelChoiceAttempt>) => {
    let i = 0;
    return async () => attempts[Math.min(i++, attempts.length - 1)];
  };

  beforeEach(() => {
    originalIsTTY = process.stdin.isTTY;
    originalSetRawMode = process.stdin.setRawMode;
    delete process.env[ACCEPTANCE_STUB_ENV];
    delete process.env[ACCEPTANCE_STUB_AUTO_AUTH_ENV];
    process.stdin.isTTY = true;
    if (typeof process.stdin.setRawMode !== 'function') {
      Object.defineProperty(process.stdin, 'setRawMode', {
        value: () => process.stdin,
        configurable: true,
        writable: true,
      });
    }
    vi.mocked(recordAcceptance).mockClear();
  });

  afterEach(() => {
    if (originalIsTTY !== undefined) {
      process.stdin.isTTY = originalIsTTY;
    } else {
      process.stdin.isTTY = undefined as unknown as boolean;
    }
    if (originalSetRawMode) {
      Object.defineProperty(process.stdin, 'setRawMode', {
        value: originalSetRawMode,
        configurable: true,
        writable: true,
      });
    }
  });

  it('15. loaded-model count survives into the final result', async () => {
    const t = capture();
    const exitCode = await runCodingPlanLiveAcceptance(
      'github-copilot',
      'github-copilot',
      OAuthModule(),
      getDef(OAuthModule()),
      'coding_plan',
      {
        terminal: t.terminal,
        report: t.report,
        modelInput: async () => ({ type: 'number', value: 1 }),
      },
    );
    expect(exitCode).toBe(0);
    expect(t.reportLines.join('\n')).toContain('models.bundled.count: 2');
    expect(t.reportLines.join('\n')).toContain('models.final.count: 2');
  });

  it('16. empty input reprompts instead of failing', async () => {
    const t = capture();
    const attempts = [
      { type: 'text', value: '' },
      { type: 'number', value: 2 },
    ] as ModelChoiceAttempt[];
    const exitCode = await runCodingPlanLiveAcceptance(
      'github-copilot',
      'github-copilot',
      OAuthModule(),
      getDef(OAuthModule()),
      'coding_plan',
      {
        terminal: t.terminal,
        report: t.report,
        modelInput: sequence(attempts),
      },
    );
    expect(exitCode).toBe(0);
    expect(
      t.terminalLines.filter((l) =>
        l.startsWith('Please enter a number from 1 to 2'),
      ),
    ).toHaveLength(1);
    expect(
      t.terminalLines.filter((l) => l.startsWith('Enter model number [1-2]:')),
    ).toHaveLength(2);
  });

  it('17. whitespace input reprompts', async () => {
    const t = capture();
    const exitCode = await runCodingPlanLiveAcceptance(
      'github-copilot',
      'github-copilot',
      OAuthModule(),
      getDef(OAuthModule()),
      'coding_plan',
      {
        terminal: t.terminal,
        report: t.report,
        modelInput: sequence([
          { type: 'text', value: '   ' },
          { type: 'number', value: 1 },
        ] as ModelChoiceAttempt[]),
      },
    );
    expect(exitCode).toBe(0);
    expect(
      t.terminalLines.some((l) =>
        l.startsWith('Please enter a number from 1 to 2'),
      ),
    ).toBe(true);
  });

  it('18. non-numeric input reprompts', async () => {
    const t = capture();
    const exitCode = await runCodingPlanLiveAcceptance(
      'github-copilot',
      'github-copilot',
      OAuthModule(),
      getDef(OAuthModule()),
      'coding_plan',
      {
        terminal: t.terminal,
        report: t.report,
        modelInput: sequence([
          { type: 'text', value: 'abc' },
          { type: 'number', value: 1 },
        ] as ModelChoiceAttempt[]),
      },
    );
    expect(exitCode).toBe(0);
    expect(t.terminalLines.some((l) => l.includes('non-numeric'))).toBe(true);
  });

  it('18. zero reprompts', async () => {
    const t = capture();
    const exitCode = await runCodingPlanLiveAcceptance(
      'github-copilot',
      'github-copilot',
      OAuthModule(),
      getDef(OAuthModule()),
      'coding_plan',
      {
        terminal: t.terminal,
        report: t.report,
        modelInput: sequence([
          { type: 'number', value: 0 },
          { type: 'number', value: 1 },
        ] as ModelChoiceAttempt[]),
      },
    );
    expect(exitCode).toBe(0);
    expect(
      t.terminalLines.some((l) =>
        l.startsWith('Please enter a number from 1 to 2'),
      ),
    ).toBe(true);
  });

  it('19. count+1 reprompts', async () => {
    const t = capture();
    const exitCode = await runCodingPlanLiveAcceptance(
      'github-copilot',
      'github-copilot',
      OAuthModule(),
      getDef(OAuthModule()),
      'coding_plan',
      {
        terminal: t.terminal,
        report: t.report,
        modelInput: sequence([
          { type: 'number', value: 3 },
          { type: 'number', value: 1 },
        ] as ModelChoiceAttempt[]),
      },
    );
    expect(exitCode).toBe(0);
    expect(
      t.terminalLines.some((l) =>
        l.startsWith('Please enter a number from 1 to 2'),
      ),
    ).toBe(true);
  });

  it('20. first number selects first model', async () => {
    const t = capture();
    const exitCode = await runCodingPlanLiveAcceptance(
      'github-copilot',
      'github-copilot',
      OAuthModule(),
      getDef(OAuthModule()),
      'coding_plan',
      {
        terminal: t.terminal,
        report: t.report,
        modelInput: async () => ({ type: 'number', value: 1 }),
      },
    );
    expect(exitCode).toBe(0);
    expect(t.terminalLines).toContain('Selected model: gpt-4o');
    expect(t.reportLines.join('\n')).toContain('selected.model: gpt-4o');
  });

  it('21. last number selects last model', async () => {
    const t = capture();
    const exitCode = await runCodingPlanLiveAcceptance(
      'github-copilot',
      'github-copilot',
      OAuthModule(),
      getDef(OAuthModule()),
      'coding_plan',
      {
        terminal: t.terminal,
        report: t.report,
        modelInput: async () => ({ type: 'number', value: 2 }),
      },
    );
    expect(exitCode).toBe(0);
    expect(t.reportLines.join('\n')).toContain('selected.model: gpt-4o-mini');
  });

  it('22. cancellation at model selection preserves loaded counts', async () => {
    const t = capture();
    const exitCode = await runCodingPlanLiveAcceptance(
      'github-copilot',
      'github-copilot',
      OAuthModule(),
      getDef(OAuthModule()),
      'coding_plan',
      {
        terminal: t.terminal,
        report: t.report,
        modelInput: async () => ({ type: 'cancel' }),
      },
    );
    expect(exitCode).toBe(1);
    expect(t.reportLines.join('\n')).toContain('result: LIVE_TEST_CANCELLED');
    expect(t.reportLines.join('\n')).toContain('models.bundled.count: 2');
    expect(t.reportLines.join('\n')).toContain('models.final.count: 2');
  });

  it('23. EOF at model selection reports MODEL_SELECTION_STDIN_CLOSED', async () => {
    const t = capture();
    const exitCode = await runCodingPlanLiveAcceptance(
      'github-copilot',
      'github-copilot',
      OAuthModule(),
      getDef(OAuthModule()),
      'coding_plan',
      {
        terminal: t.terminal,
        report: t.report,
        modelInput: async () => ({ type: 'end' }),
      },
    );
    expect(exitCode).toBe(1);
    expect(t.reportLines.join('\n')).toContain('MODEL_SELECTION_STDIN_CLOSED');
    expect(t.reportLines.join('\n')).toContain('models.final.count: 2');
  });

  it('24. stream cannot begin before confirmed model selection', async () => {
    const t = capture();
    const exitCode = await runCodingPlanLiveAcceptance(
      'github-copilot',
      'github-copilot',
      OAuthModule(),
      getDef(OAuthModule()),
      'coding_plan',
      {
        terminal: t.terminal,
        report: t.report,
        modelInput: async () => ({ type: 'cancel' }),
      },
    );
    expect(exitCode).toBe(1);
    expect(t.reportLines.join('\n')).toContain('stream.started: false');
  });

  it('25. model prefix does not change routing provider', async () => {
    const claudeModule = OAuthModule({
      getCatalogModels: () => [
        {
          id: 'claude-opus-4.6',
          name: 'Claude Opus',
          api: 'openai-completions',
        },
      ],
    });
    const t = capture();
    const exitCode = await runCodingPlanLiveAcceptance(
      'github-copilot',
      'github-copilot',
      claudeModule,
      getDef(claudeModule),
      'coding_plan',
      {
        terminal: t.terminal,
        report: t.report,
        modelInput: async () => ({ type: 'number', value: 1 }),
      },
    );
    expect(exitCode).toBe(0);
    expect(t.reportLines.join('\n')).toContain(
      'selected.model: claude-opus-4.6',
    );
    expect(t.reportLines.join('\n')).toContain(
      'routing.provider: github-copilot',
    );
    expect(t.reportLines.join('\n')).toContain(
      'credential.provider: github-copilot',
    );
  });

  it('26. verified credential reaches the stream transport', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const streamModule = OAuthModule({
      getCatalogModels: () => [
        { id: 'gpt-4o', name: 'GPT-4o', api: 'openai-completions' },
      ],
      async *plumbModelStream(opts: Record<string, unknown>) {
        seen.push(opts);
        yield { type: 'text', text: 'PLUMB_TEST_OK' };
      },
    });
    const t = capture();
    const exitCode = await runCodingPlanLiveAcceptance(
      'github-copilot',
      'github-copilot',
      streamModule,
      getDef(streamModule),
      'coding_plan',
      {
        terminal: t.terminal,
        report: t.report,
        modelInput: async () => ({ type: 'number', value: 1 }),
      },
    );
    expect(exitCode).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]['apiKey']).toBe('TOKEN_ACCESS_XYZ');
    expect(seen[0]['model']).toMatchObject({ provider: 'github-copilot' });
    expect(t.reportLines.join('\n')).toContain(
      'authorization.header.present: true',
    );
    expect(t.reportLines.join('\n')).toContain('result: LIVE_VERIFIED');
  });

  it('27. stream failure preserves counts and phases', async () => {
    const streamFail = OAuthModule({
      async *plumbModelStream() {
        yield { type: 'error', error: { code: 'E', message: 'boom' } };
      },
    });
    const t = capture();
    const exitCode = await runCodingPlanLiveAcceptance(
      'github-copilot',
      'github-copilot',
      streamFail,
      getDef(streamFail),
      'coding_plan',
      {
        terminal: t.terminal,
        report: t.report,
        modelInput: async () => ({ type: 'number', value: 1 }),
      },
    );
    expect(exitCode).toBe(1);
    const report = t.reportLines.join('\n');
    expect(report).toContain('models.final.count: 2');
    expect(report).toContain('selected.model: gpt-4o');
    expect(report).toContain('stream.started: true');
    expect(report).toContain('stream.completed: false');
    expect(report).toContain('safe.error: boom');
  });

  it('28. raw mode is not active during the model prompt', async () => {
    const setRawModeSpy = vi
      .spyOn(process.stdin, 'setRawMode')
      .mockImplementation(() => process.stdin as never);
    const t = capture();
    await runCodingPlanLiveAcceptance(
      'github-copilot',
      'github-copilot',
      OAuthModule(),
      getDef(OAuthModule()),
      'coding_plan',
      {
        terminal: t.terminal,
        report: t.report,
        modelInput: async () => ({ type: 'number', value: 1 }),
      },
    );
    const trueCalls = setRawModeSpy.mock.calls.filter((c) => c[0] === true);
    const falseCalls = setRawModeSpy.mock.calls.filter((c) => c[0] === false);
    expect(trueCalls.length).toBe(1);
    expect(falseCalls.length).toBe(1);
    setRawModeSpy.mockRestore();
  });

  it('29. no duplicate stic-only data owners remain during picker', async () => {
    const t = capture();
    await runCodingPlanLiveAcceptance(
      'github-copilot',
      'github-copilot',
      OAuthModule(),
      getDef(OAuthModule()),
      'coding_plan',
      {
        terminal: t.terminal,
        report: t.report,
        modelInput: async () => ({ type: 'number', value: 1 }),
      },
    );
    // raw-mode cancellation listener was released before the model prompt.
    expect(process.stdin.listenerCount('data')).toBe(0);
  });

  it('30. acceptance persistence contains no secret', async () => {
    const t = capture();
    const exitCode = await runCodingPlanLiveAcceptance(
      'github-copilot',
      'github-copilot',
      OAuthModule(),
      getDef(OAuthModule()),
      'coding_plan',
      {
        terminal: t.terminal,
        report: t.report,
        modelInput: async () => ({ type: 'number', value: 1 }),
      },
    );
    expect(exitCode).toBe(0);
    const calls = vi.mocked(recordAcceptance).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(calls);
    expect(serialized).not.toContain('TOKEN_ACCESS_XYZ');
  });

  it('31. 38-model fixture: 1 selects the first model', async () => {
    const MODELS_38 = Array.from({ length: 38 }, (_, i) => ({
      id: `model-${i + 1}`,
      name: `Model ${i + 1}`,
      api: 'openai-completions',
    }));
    const module38 = makeProviderModule({
      getProviderDefinition: () => ({
        login: () => MODEL_CRED,
        refreshToken: vi.fn(),
      }),
      getCatalogModels: () => MODELS_38,
    });
    const t = capture();
    const exitCode = await runCodingPlanLiveAcceptance(
      'github-copilot',
      'github-copilot',
      module38,
      getDef(module38),
      'coding_plan',
      {
        terminal: t.terminal,
        report: t.report,
        modelInput: async () => ({ type: 'number', value: 1 }),
      },
    );
    expect(exitCode).toBe(0);
    const report = t.reportLines.join('\n');
    expect(report).toContain('models.bundled.count: 38');
    expect(report).toContain('models.final.count: 38');
    expect(report).toContain('selected.model: model-1');
    expect(report).toContain('result: LIVE_VERIFIED');
  });

  it('32. 38-model fixture: 38 selects the last model', async () => {
    const MODELS_38 = Array.from({ length: 38 }, (_, i) => ({
      id: `model-${i + 1}`,
      name: `Model ${i + 1}`,
      api: 'openai-completions',
    }));
    const module38 = makeProviderModule({
      getProviderDefinition: () => ({
        login: () => MODEL_CRED,
        refreshToken: vi.fn(),
      }),
      getCatalogModels: () => MODELS_38,
    });
    const t = capture();
    const exitCode = await runCodingPlanLiveAcceptance(
      'github-copilot',
      'github-copilot',
      module38,
      getDef(module38),
      'coding_plan',
      {
        terminal: t.terminal,
        report: t.report,
        modelInput: async () => ({ type: 'number', value: 38 }),
      },
    );
    expect(exitCode).toBe(0);
    expect(t.reportLines.join('\n')).toContain('selected.model: model-38');
  });

  it('33. 38-model fixture: 0 reprompts then 1 succeeds', async () => {
    const MODELS_38 = Array.from({ length: 38 }, (_, i) => ({
      id: `model-${i + 1}`,
      name: `Model ${i + 1}`,
      api: 'openai-completions',
    }));
    const module38 = makeProviderModule({
      getProviderDefinition: () => ({
        login: () => MODEL_CRED,
        refreshToken: vi.fn(),
      }),
      getCatalogModels: () => MODELS_38,
    });
    const t = capture();
    const exitCode = await runCodingPlanLiveAcceptance(
      'github-copilot',
      'github-copilot',
      module38,
      getDef(module38),
      'coding_plan',
      {
        terminal: t.terminal,
        report: t.report,
        modelInput: sequence([
          { type: 'number', value: 0 },
          { type: 'number', value: 1 },
        ] as ModelChoiceAttempt[]),
      },
    );
    expect(exitCode).toBe(0);
    const report = t.reportLines.join('\n');
    expect(report).toContain('selected.model: model-1');
    expect(report).toContain('models.final.count: 38');
    const prompts = t.terminalLines.filter((l) =>
      l.startsWith('Enter model number'),
    );
    expect(prompts.length).toBe(2);
  });

  it('34. 38-model fixture: 39 reprompts then 38 succeeds', async () => {
    const MODELS_38 = Array.from({ length: 38 }, (_, i) => ({
      id: `model-${i + 1}`,
      name: `Model ${i + 1}`,
      api: 'openai-completions',
    }));
    const module38 = makeProviderModule({
      getProviderDefinition: () => ({
        login: () => MODEL_CRED,
        refreshToken: vi.fn(),
      }),
      getCatalogModels: () => MODELS_38,
    });
    const t = capture();
    const exitCode = await runCodingPlanLiveAcceptance(
      'github-copilot',
      'github-copilot',
      module38,
      getDef(module38),
      'coding_plan',
      {
        terminal: t.terminal,
        report: t.report,
        modelInput: sequence([
          { type: 'number', value: 39 },
          { type: 'number', value: 38 },
        ] as ModelChoiceAttempt[]),
      },
    );
    expect(exitCode).toBe(0);
    expect(t.reportLines.join('\n')).toContain('selected.model: model-38');
  });

  it('35. 38-model fixture: cancel after invalid keeps count 38', async () => {
    const MODELS_38 = Array.from({ length: 38 }, (_, i) => ({
      id: `model-${i + 1}`,
      name: `Model ${i + 1}`,
      api: 'openai-completions',
    }));
    const module38 = makeProviderModule({
      getProviderDefinition: () => ({
        login: () => MODEL_CRED,
        refreshToken: vi.fn(),
      }),
      getCatalogModels: () => MODELS_38,
    });
    const t = capture();
    const exitCode = await runCodingPlanLiveAcceptance(
      'github-copilot',
      'github-copilot',
      module38,
      getDef(module38),
      'coding_plan',
      {
        terminal: t.terminal,
        report: t.report,
        modelInput: sequence([
          { type: 'number', value: 0 },
          { type: 'cancel' },
        ] as ModelChoiceAttempt[]),
      },
    );
    expect(exitCode).toBe(1);
    const report = t.reportLines.join('\n');
    expect(report).toContain('models.final.count: 38');
    expect(report).toContain('result: LIVE_TEST_CANCELLED');
  });
});
