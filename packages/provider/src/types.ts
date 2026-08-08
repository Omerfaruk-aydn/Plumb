/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * OMP-derived provider and model type system, adapted for PLUMB.
 * Upstream source: D:\Kesit-next (Oh My Pi)
 * Upstream SHA: 368da051e164341a5322ba4f5dc39fc08c9b578d
 * Upstream license: MIT (c) 2025 Mario Zechner, (c) 2025-2026 Can Bölük
 */

// ─── Provider identity ───────────────────────────────────────────────

/** Unique provider identifier string. */
export type PlumbProviderId = string;

/** Provider category for first-run setup grouping. */
export enum PlumbProviderCategory {
  CODING_PLAN = 'coding_plan',
  OAUTH_ACCOUNT = 'oauth_account',
  API_KEY = 'api_key',
  LOCAL = 'local',
  CUSTOM_ENDPOINT = 'custom_endpoint',
}

/** Authentication method descriptor for a provider. */
export type PlumbAuthMethod =
  | { type: 'oauth'; port?: number; pasteCode?: boolean }
  | { type: 'api_key'; envVar?: string; promptLabel?: string }
  | { type: 'device_code' }
  | { type: 'none' }
  | { type: 'env'; envVars: string[] };

/** Provider descriptor — one entry per provider. */
export interface PlumbProvider {
  readonly id: PlumbProviderId;
  readonly name: string;
  readonly category: PlumbProviderCategory;
  readonly description?: string;
  readonly authMethods: PlumbAuthMethod[];
  readonly defaultModel?: string;
  readonly envVars?: string[];
  readonly available: boolean;
  /** Provider-specific display group for the setup UI. */
  readonly group?: string;
  /** Whether this provider can be used without authentication. */
  readonly allowUnauthenticated?: boolean;
  /** Display order in provider lists (lower = first). */
  readonly order?: number;
  /**
   * User-facing reason a provider is unavailable, classifier
   * (BLOCKED_CLIENT_REGISTRATION, IMPLEMENTATION_INCOMPLETE_NOT_SELECTABLE,
   * PROVIDER_HAS_NO_MODEL_ENUMERATION, etc.).
   */
  readonly availabilityReason?: string;
  /** OAuth client registration ownership / posture (PLUMB-only). */
  readonly oauthPosture?:
    | 'PLUMB_OWNED_VALID_REGISTRATION'
    | 'OFFICIAL_PUBLIC_DEVICE_FLOW'
    | 'OFFICIAL_CLI_DELEGATION'
    | 'UPSTREAM_PRODUCT_OWNED_REGISTRATION'
    | 'MISSING_REGISTRATION'
    | 'PROVIDER_POLICY_BLOCKED';
}

// ─── API transport types ─────────────────────────────────────────────

/** Known API transport protocols. */
export type PlumbKnownApi =
  | 'openai-completions'
  | 'openai-responses'
  | 'openai-codex-responses'
  | 'azure-openai-responses'
  | 'anthropic-messages'
  | 'bedrock-converse-stream'
  | 'google-generative-ai'
  | 'google-gemini-cli'
  | 'google-vertex'
  | 'ollama-chat'
  | 'cursor-agent'
  | 'devin-agent'
  | 'gitlab-duo-agent'
  | 'openrouter'
  | 'claude-agent-sdk'
  | 'watsonx-chat';

// ─── Thinking control ─────────────────────────────────────────────────

export type PlumbThinkingControlMode =
  | 'effort'
  | 'budget'
  | 'google-level'
  | 'anthropic-adaptive'
  | 'anthropic-budget-effort';

export interface PlumbThinkingConfig {
  readonly mode?: PlumbThinkingControlMode;
  readonly effortMap?: Record<string, string>;
  readonly effortRouting?: Record<string, string>;
  readonly effortBudgets?: Partial<Record<string, number | null>>;
  readonly suppressWhenOff?: boolean;
  readonly requiresEffort?: boolean;
  readonly supportedEfforts?: string[];
}

// ─── Model types ──────────────────────────────────────────────────────

export interface PlumbUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  totalTokens: number;
  costUsd?: number;
}

export interface PlumbModelPricing {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface PlumbOpenAICompat {
  store?: boolean;
  developerRole?: boolean;
  reasoningEffort?: boolean;
  strictTools?: boolean;
  promptCache?: boolean;
  nativeStructuredOutputs?: boolean;
  supportsTemperature?: boolean;
  supportsTopP?: boolean;
  toolSchemaFlavor?: 'openai' | 'anthropic';
  maxToolCallRounds?: number;
  parallelToolCalls?: boolean;
  imageSupport?: boolean;
  audioSupport?: boolean;
  streamOptions?: boolean;
  serviceTier?: boolean;
  prediction?: boolean;
  webSearchPreview?: boolean;
  inlineResponses?: boolean;
}

export interface PlumbAnthropicCompat {
  strictTools?: boolean;
  adaptiveThinking?: boolean;
  midConversationSystem?: boolean;
  forcedToolChoice?: boolean;
  promptCache?: boolean;
  extendedThinking?: boolean;
  computerUse?: boolean;
  citations?: boolean;
  tokenEfficientTools?: boolean;
}

export interface PlumbBedrockCompat {
  promptCache?: boolean;
}

/** Core model descriptor. */
export interface PlumbModel {
  readonly id: string;
  readonly provider: PlumbProviderId;
  readonly name?: string;
  readonly api: PlumbKnownApi;
  readonly requestModelId?: string;
  readonly contextWindow: number;
  readonly maxTokens: number;
  readonly reasoning: boolean;
  /**
   * Whether this specific model is documented/discovered to support
   * tool/function calling. `undefined` means unknown (no capability
   * metadata available for this model — never treated as `false`).
   * Populated from real provider/model metadata where a discovery adapter
   * reports it (see registry/model-discovery.ts's `DiscoveredModel.toolsSupported`);
   * never guessed from the model name.
   */
  readonly toolsSupported?: boolean;
  readonly input: 'text' | 'text+image' | 'text+image+audio';
  readonly pricing?: PlumbModelPricing;
  readonly thinking?: PlumbThinkingConfig;
  readonly openaiCompat?: PlumbOpenAICompat;
  readonly anthropicCompat?: PlumbAnthropicCompat;
  readonly bedrockCompat?: PlumbBedrockCompat;
  readonly baseUrl?: string;
  /**
   * Optional default request headers that the transport must apply in
   * addition to the standard Authorization/Content-Type/Accept headers.
   * Merged in `buildProviderRequestHeaders` — caller-supplied headers
   * override but never delete Authorization.
   */
  readonly headers?: Record<string, string>;
  readonly isOAuth?: boolean;
  readonly isPreview?: boolean;
  readonly isDeprecated?: boolean;
  readonly description?: string;
  readonly tags?: string[];
}

export interface PlumbModelSpec {
  id: string;
  provider: PlumbProviderId;
  api: PlumbKnownApi;
  requestModelId?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  input?: PlumbModel['input'];
  pricing?: PlumbModelPricing;
  thinking?: PlumbThinkingConfig;
  openaiCompat?: Partial<PlumbOpenAICompat>;
  anthropicCompat?: Partial<PlumbAnthropicCompat>;
  bedrockCompat?: Partial<PlumbBedrockCompat>;
  baseUrl?: string;
  isOAuth?: boolean;
  isPreview?: boolean;
  isDeprecated?: boolean;
  name?: string;
  description?: string;
}

// ─── Credential types ─────────────────────────────────────────────────

export type PlumbCredentialSource =
  | 'runtime'
  | 'config'
  | 'oauth'
  | 'api_key'
  | 'env'
  | 'fallback'
  | 'none';

export interface PlumbOAuthCredential {
  type: 'oauth';
  provider: PlumbProviderId;
  access: string;
  refresh: string;
  expires: number;
  email?: string;
  accountId?: string;
  orgId?: string;
  orgName?: string;
  authorizedAt?: number;
  projectId?: string;
  /** GitHub Copilot enterprise domain, when signed in against a GHE host. */
  enterpriseUrl?: string;
  /** GitHub Copilot API endpoint discovered after device login. */
  apiEndpoint?: string;
}

export interface PlumbApiKeyCredential {
  type: 'api_key';
  provider: PlumbProviderId;
  key: string;
  label?: string;
}

export type PlumbCredential = PlumbOAuthCredential | PlumbApiKeyCredential;

export interface PlumbCredentialEntry {
  provider: PlumbProviderId;
  credential: PlumbCredential;
  source: PlumbCredentialSource;
  lastUsed?: number;
  usageCount?: number;
}

// ─── Streaming types ──────────────────────────────────────────────────

export interface PlumbStreamEvent {
  type:
    | 'text'
    | 'thinking'
    | 'tool_call'
    | 'tool_result'
    | 'usage'
    | 'error'
    | 'done';
  text?: string;
  thinkingText?: string;
  toolCall?: { id: string; name: string; arguments: string };
  toolResult?: { id: string; name: string; result: string; isError?: boolean };
  usage?: PlumbUsage;
  error?: { code: string; message: string; retryable?: boolean };
  finishReason?: string;
}

/**
 * A single tool-execution request handed from a transport (e.g. the Claude
 * Agent SDK's in-process MCP bridge) to the caller-supplied execution
 * authority. Transports never execute tools themselves — they only
 * translate their own SDK/protocol-native tool-call shape into this
 * canonical request and forward it to `PlumbStreamOptions.toolExecutor`.
 */
export interface PlumbToolExecutionRequest {
  toolName: string;
  args: Record<string, unknown>;
  /** Caller-facing correlation id for this single tool invocation. */
  toolCallId: string;
}

/** Coarse outcome of a single tool execution, safe to surface to any transport. */
export type PlumbToolExecutionStatus = 'success' | 'error' | 'cancelled';

export interface PlumbToolExecutionResult {
  status: PlumbToolExecutionStatus;
  /** Human/model-readable result text (already safe to hand back to the model). */
  content: string;
  isError: boolean;
}

/**
 * Caller-supplied tool execution authority. A transport that accepts tool
 * calls (currently only the Claude Agent SDK's in-process MCP bridge) must
 * route every request through exactly one call to this function and use
 * only its result — never execute a tool by any other means. This is the
 * dependency-inversion seam that lets `packages/provider` (which cannot
 * import `packages/core`) delegate to the real, single, canonical
 * CoreToolScheduler-backed execution pipeline that `packages/core` owns.
 */
export type PlumbToolExecutor = (
  request: PlumbToolExecutionRequest,
) => Promise<PlumbToolExecutionResult>;

export interface PlumbStreamOptions {
  model: PlumbModel;
  messages: PlumbMessage[];
  tools?: PlumbTool[];
  apiKey: string;
  signal?: AbortSignal;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  traceSource?: 'NORMAL_CHAT' | 'LIVE_PROBE';
  /**
   * The single execution authority for tool calls a transport's model
   * requests. Only wired for transports whose SDK/protocol requires the
   * caller to supply a tool-execution callback in-process (currently just
   * Claude Agent SDK MCP tools). Absent (or the transport's `tools` list
   * empty) means tool calling stays disabled for that turn — never a
   * silent no-op executor.
   */
  toolExecutor?: PlumbToolExecutor;
  generatorInstance?: {
    instanceId: string;
    providerAtConstruction: string;
    modelAtConstruction: string;
    currentProvider: string;
    currentModel: string;
  } | null;
}

export interface PlumbMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | PlumbContentPart[];
  name?: string;
  toolCallId?: string;
}

export type PlumbContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; imageUrl: string; mimeType?: string }
  | { type: 'tool_call'; id: string; name: string; arguments: string }
  | {
      type: 'tool_result';
      id: string;
      name: string;
      result: string;
      isError?: boolean;
    }
  | { type: 'thinking'; text: string };

export interface PlumbTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export type PlumbStreamFunction = (
  options: PlumbStreamOptions,
) => AsyncGenerator<PlumbStreamEvent>;
