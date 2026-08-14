/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { getCatalogModels } from './catalog/model-catalog.js';
import { PLUMB_PROVIDERS, SELECTABLE_PROVIDERS } from './catalog/providers.js';
import { resolveRouteToolPolicy } from './tool-policy.js';
import type {
  PlumbEffectiveToolRouteContract,
  PlumbEffectiveToolRouteInput,
  PlumbDialectToolProtocolFacts,
  PlumbKnownApi,
  PlumbModel,
  PlumbProtocolCapability,
  PlumbProtocolCapabilitySource,
  PlumbProviderProtocolMatrix,
  PlumbProviderProtocolMatrixRow,
  PlumbProviderArchitectureFamily,
  PlumbRouteEndpointFamily,
  PlumbStructuredToolProtocol,
} from './types.js';

const CLOUD_PROVIDER_IDS = new Set([
  'amazon-bedrock',
  'azure',
  'google-vertex',
  'watsonx',
  'oci-genai',
]);
const GATEWAY_PROVIDER_IDS = new Set([
  'openrouter',
  'portkey',
  'litellm',
  'cloudflare-ai-gateway',
  'vercel-ai-gateway',
  'kilo',
  'zenmux',
]);

interface DialectContract {
  readonly protocol: PlumbStructuredToolProtocol;
  readonly family: PlumbRouteEndpointFamily;
  readonly path: (wireModelId: string) => string;
  /** Parser/replay status is only claimed where PLUMB has a normalized implementation. */
  readonly parser: PlumbProtocolCapability['status'];
  readonly replay: PlumbProtocolCapability['status'];
  readonly structured: PlumbProtocolCapability['status'];
  readonly fragmentAssembly: PlumbProtocolCapability['status'];
  readonly callIdPreservation: PlumbProtocolCapability['status'];
  readonly forcedToolChoice: PlumbProtocolCapability['status'];
  readonly namedToolChoice: PlumbProtocolCapability['status'];
}

type DialectFacts = Partial<
  Pick<
    DialectContract,
    | 'structured'
    | 'parser'
    | 'replay'
    | 'fragmentAssembly'
    | 'callIdPreservation'
    | 'forcedToolChoice'
    | 'namedToolChoice'
  >
>;

const DIALECT_CONTRACTS: Readonly<Record<PlumbKnownApi, DialectContract>> = {
  'openai-completions': dialect(
    'OPENAI_CHAT_FUNCTION_TOOLS',
    'OPENAI_CHAT_COMPLETIONS',
    '/chat/completions',
  ),
  'openai-responses': dialect(
    'OPENAI_RESPONSES_FUNCTION_TOOLS',
    'OPENAI_RESPONSES',
    '/responses',
  ),
  'openai-codex-responses': dialect(
    'OPENAI_CHAT_FUNCTION_TOOLS',
    'OPENAI_CHAT_COMPLETIONS',
    '/chat/completions',
    { structured: 'UNKNOWN' },
  ),
  'azure-openai-responses': dialect(
    'OPENAI_RESPONSES_FUNCTION_TOOLS',
    'OPENAI_RESPONSES',
    '/responses',
  ),
  'oci-openai-responses': dialect(
    'OPENAI_RESPONSES_FUNCTION_TOOLS',
    'OPENAI_RESPONSES',
    '/responses',
  ),
  openrouter: dialect(
    'OPENAI_CHAT_FUNCTION_TOOLS',
    'OPENAI_CHAT_COMPLETIONS',
    '/chat/completions',
  ),
  'anthropic-messages': dialect(
    'ANTHROPIC_MESSAGES_TOOLS',
    'ANTHROPIC_MESSAGES',
    '/messages',
  ),
  'bedrock-converse-stream': dialect(
    'BEDROCK_CONVERSE_TOOL_USE',
    'AWS_BEDROCK_CONVERSE',
    (wire) => `/model/${encodeURIComponent(wire)}/converse-stream`,
  ),
  'google-generative-ai': dialect(
    'GOOGLE_FUNCTION_DECLARATIONS',
    'GOOGLE_GENERATIVE_LANGUAGE',
    (wire) => `/models/${encodeURIComponent(wire)}:streamGenerateContent`,
    { callIdPreservation: 'UNKNOWN' },
  ),
  'google-gemini-cli': dialect(
    'GOOGLE_FUNCTION_DECLARATIONS',
    'GOOGLE_GENERATIVE_LANGUAGE',
    ':streamGenerateContent',
    { callIdPreservation: 'UNKNOWN' },
  ),
  'google-vertex': dialect(
    'GOOGLE_FUNCTION_DECLARATIONS',
    'GOOGLE_VERTEX_PREDICTION',
    ':streamGenerateContent',
    { callIdPreservation: 'UNSUPPORTED' },
  ),
  'ollama-chat': dialect(
    'OPENAI_CHAT_FUNCTION_TOOLS',
    'OPENAI_CHAT_COMPLETIONS',
    '/chat/completions',
    {
      forcedToolChoice: 'UNKNOWN',
      namedToolChoice: 'UNKNOWN',
      callIdPreservation: 'UNKNOWN',
    },
  ),
  'claude-agent-sdk': dialect(
    'CLAUDE_AGENT_SDK_MCP',
    'CLAUDE_AGENT_SDK',
    'in-process:query',
    {
      parser: 'NOT_APPLICABLE',
      replay: 'UNKNOWN',
      fragmentAssembly: 'NOT_APPLICABLE',
      callIdPreservation: 'UNKNOWN',
      forcedToolChoice: 'UNSUPPORTED',
      namedToolChoice: 'UNSUPPORTED',
    },
  ),
  'watsonx-chat': dialect(
    'WATSONX_CHAT_TOOLS',
    'IBM_WATSONX_CHAT',
    'sdk:text/chat',
    { forcedToolChoice: 'UNSUPPORTED', namedToolChoice: 'UNSUPPORTED' },
  ),
  'cursor-agent': dialect(
    'PROVIDER_AGENT_TOOLS',
    'PROVIDER_AGENT',
    'provider-agent:cursor',
    unknownDialectFacts(),
  ),
  'devin-agent': dialect(
    'PROVIDER_AGENT_TOOLS',
    'PROVIDER_AGENT',
    'provider-agent:devin',
    unknownDialectFacts(),
  ),
  'gitlab-duo-agent': dialect(
    'PROVIDER_AGENT_TOOLS',
    'PROVIDER_AGENT',
    'provider-agent:gitlab-duo',
    unknownDialectFacts(),
  ),
};

const DIALECT_PROTOCOL_FACTS: Readonly<
  Record<PlumbKnownApi, PlumbDialectToolProtocolFacts>
> = {
  'openai-completions': protocolFacts(
    'openai-completions',
    'openAICompatibleStream',
    'tools[].function{name,description,parameters}',
    'tool_choice:auto|required|none|function{name}',
    'choices[].delta.tool_calls[]',
    'OpenAI delta.tool_calls index accumulator',
    'role=tool + tool_call_id',
    'assistant.tool_calls[] then role=tool messages',
  ),
  'openai-responses': protocolFacts(
    'openai-responses',
    'streamOpenAIResponses',
    'flat tools[]{type=function,name,description,parameters}',
    'tool_choice:auto|required|none|{type=function,name}',
    'response.output_item.* + response.function_call_arguments.*',
    'Responses item_id/call_id argument accumulator',
    'function_call_output{call_id,output}',
    'function_call then function_call_output input items',
    'SEPARATE_NOT_ADVERTISED',
  ),
  'openai-codex-responses': protocolFacts(
    'openai-codex-responses',
    'openAICompatibleStream (active alias)',
    'tools[].function{name,description,parameters}',
    'OpenAI Chat tool_choice serialization',
    'choices[].delta.tool_calls[] (active alias)',
    'OpenAI delta.tool_calls index accumulator',
    'role=tool + tool_call_id',
    'assistant.tool_calls[] then role=tool messages',
    'UNKNOWN',
  ),
  'azure-openai-responses': protocolFacts(
    'azure-openai-responses',
    'streamAzureResponses',
    'flat Responses function tools',
    'Responses tool_choice',
    'Azure Responses function-call SSE events',
    'Azure item_id to native call_id accumulator',
    'function_call_output{call_id,output}',
    'flat Responses input items',
    'SEPARATE_NOT_ADVERTISED',
  ),
  'oci-openai-responses': protocolFacts(
    'oci-openai-responses',
    'streamOciGenaiResponses',
    'flat PLUMB_CLIENT_TOOL function tools',
    'Responses tool_choice',
    'OCI Responses function-call SSE events',
    'OCI item_id to native call_id accumulator',
    'function_call_output{call_id,output}',
    'flat Responses input items',
    'SEPARATE_NOT_ADVERTISED',
  ),
  openrouter: protocolFacts(
    'openrouter',
    'openAICompatibleStream',
    'tools[].function{name,description,parameters}',
    'route-scoped OpenAI Chat tool_choice',
    'choices[].delta.tool_calls[]',
    'OpenAI delta.tool_calls index accumulator',
    'role=tool + tool_call_id',
    'assistant.tool_calls[] then role=tool messages',
  ),
  'anthropic-messages': protocolFacts(
    'anthropic-messages',
    'anthropicMessagesStream',
    'tools[]{name,description,input_schema}',
    'tool_choice{type:auto|any|none|tool,name?}',
    'content_block_start/delta tool_use blocks',
    'Anthropic content block partial_json accumulator',
    'user content tool_result{tool_use_id,content}',
    'assistant tool_use then user tool_result blocks',
    'SEPARATE_NOT_ADVERTISED',
  ),
  'bedrock-converse-stream': protocolFacts(
    'bedrock-converse-stream',
    'streamBedrockConverse',
    'toolConfig.tools[].toolSpec{inputSchema.json}',
    'toolConfig.toolChoice{auto|any|tool{name}}',
    'contentBlockStart/Delta/Stop toolUse',
    'Bedrock contentBlockIndex input accumulator',
    'toolResult{toolUseId,content}',
    'assistant toolUse then user toolResult blocks',
  ),
  'google-generative-ai': protocolFacts(
    'google-generative-ai',
    'googleGenerativeAiStream',
    'tools[].functionDeclarations[]',
    'toolConfig.functionCallingConfig',
    'candidates[].content.parts[].functionCall',
    'Gemini complete functionCall part parser',
    'user functionResponse part',
    'model functionCall then user functionResponse parts',
  ),
  'google-gemini-cli': protocolFacts(
    'google-gemini-cli',
    'googleCloudCodeAssistStream',
    'request.tools[].functionDeclarations[]',
    'request.toolConfig.functionCallingConfig',
    'response.candidates[].content.parts[].functionCall',
    'Cloud Code Assist wrapped Gemini part parser',
    'user functionResponse part',
    'model functionCall then user functionResponse parts',
  ),
  'google-vertex': protocolFacts(
    'google-vertex',
    'googleGenerativeAiStream + prepareVertexModel',
    'tools[].functionDeclarations[]',
    'toolConfig.functionCallingConfig',
    'candidates[].content.parts[].functionCall',
    'Vertex Gemini part parser',
    'user functionResponse part (native id omitted)',
    'model functionCall then user functionResponse parts',
  ),
  'ollama-chat': protocolFacts(
    'ollama-chat',
    'openAICompatibleStream (registered active adapter)',
    'OpenAI Chat tools[].function',
    'route/server-dependent OpenAI Chat tool_choice',
    'choices[].delta.tool_calls[]',
    'OpenAI delta.tool_calls index accumulator',
    'role=tool + tool_call_id',
    'assistant.tool_calls[] then role=tool messages',
  ),
  'claude-agent-sdk': protocolFacts(
    'claude-agent-sdk',
    'streamClaudeSubscription',
    'official SDK MCP tool bridge',
    'no generic selector; MCP allowedTools authority',
    'Agent SDK assistant/tool bridge events',
    'official SDK/MCP bridge (not text parsing)',
    'MCP tool result returned to Agent SDK query',
    'in-process Agent SDK continuation',
    'OFFICIAL_MCP_BRIDGE_ONLY',
  ),
  'watsonx-chat': protocolFacts(
    'watsonx-chat',
    'streamWatsonx official SDK',
    'TextChatParameterTools[] function definitions',
    'omitted: SDK route does not expose selector here',
    'choices[].delta.tool_calls[]',
    'watsonx tool index accumulator',
    'OpenAI-shaped role=tool replay via SDK messages',
    'assistant tool_calls then tool messages',
  ),
  'cursor-agent': unknownAgentFacts('cursor-agent'),
  'devin-agent': unknownAgentFacts('devin-agent'),
  'gitlab-duo-agent': unknownAgentFacts('gitlab-duo-agent'),
};

function protocolFacts(
  dialect: PlumbKnownApi,
  activeAdapter: string,
  toolDeclarationSerialization: string,
  toolChoiceSerialization: string,
  structuredResponseShape: string,
  streamParser: string,
  toolResultRepresentation: string,
  continuationRepresentation: string,
  providerNativeToolsPolicy: PlumbDialectToolProtocolFacts['providerNativeToolsPolicy'] = 'PLUMB_CLIENT_TOOLS_ONLY',
): PlumbDialectToolProtocolFacts {
  return {
    dialect,
    activeAdapter,
    toolDeclarationSerialization,
    toolChoiceSerialization,
    structuredResponseShape,
    streamParser,
    toolResultRepresentation,
    continuationRepresentation,
    providerNativeToolsPolicy,
    reasoningCompatibility: 'UNKNOWN',
    parallelCalls: 'UNKNOWN',
  };
}

function unknownAgentFacts(
  dialect: PlumbKnownApi,
): PlumbDialectToolProtocolFacts {
  return protocolFacts(
    dialect,
    'openAICompatibleStream (active alias; native agent adapter unproven)',
    'OpenAI Chat function tools when route advertises them',
    'route-scoped OpenAI Chat selector; native agent policy unknown',
    'choices[].delta.tool_calls[] on active alias',
    'OpenAI delta parser; native agent parser unknown',
    'OpenAI role=tool replay on active alias',
    'OpenAI Chat continuation on active alias',
    'UNKNOWN',
  );
}

function dialect(
  protocol: PlumbStructuredToolProtocol,
  family: PlumbRouteEndpointFamily,
  path: string | ((wireModelId: string) => string),
  facts: DialectFacts = {},
): DialectContract {
  return {
    protocol,
    family,
    path: typeof path === 'string' ? () => path : path,
    parser: 'SUPPORTED',
    replay: 'SUPPORTED',
    structured: 'SUPPORTED',
    fragmentAssembly: 'SUPPORTED',
    callIdPreservation: 'SUPPORTED',
    forcedToolChoice: 'SUPPORTED',
    namedToolChoice: 'SUPPORTED',
    ...facts,
  };
}

function unknownDialectFacts(): DialectFacts {
  return {
    structured: 'UNKNOWN',
    parser: 'UNKNOWN',
    replay: 'UNKNOWN',
    fragmentAssembly: 'UNKNOWN',
    callIdPreservation: 'UNKNOWN',
    forcedToolChoice: 'UNKNOWN',
    namedToolChoice: 'UNKNOWN',
  };
}

const UNKNOWN: PlumbProtocolCapability = {
  status: 'UNKNOWN',
  source: 'UNKNOWN',
};

function capability(
  value: boolean | undefined,
  source: PlumbProtocolCapabilitySource,
): PlumbProtocolCapability {
  return {
    status:
      value === true
        ? 'SUPPORTED'
        : value === false
          ? 'UNSUPPORTED'
          : 'UNKNOWN',
    source: value === undefined ? 'UNKNOWN' : source,
  };
}

function capabilityFromStatus(
  status: PlumbProtocolCapability['status'],
  source: PlumbProtocolCapabilitySource,
): PlumbProtocolCapability {
  return {
    status,
    source: status === 'UNKNOWN' ? 'UNKNOWN' : source,
  };
}

function choiceCapability(
  routeSupported: boolean,
  routeSource: PlumbProtocolCapabilitySource,
  dialectStatus: PlumbProtocolCapability['status'],
): PlumbProtocolCapability {
  if (!routeSupported) return capability(false, routeSource);
  return capabilityFromStatus(dialectStatus, 'DIALECT_IMPLEMENTATION');
}

/**
 * Resolve the wire id after the catalog's effort route. This is kept in route
 * scope because two effort selections can address different upstream models.
 */
export function resolveEffectiveWireModelId(
  model: Pick<PlumbModel, 'id' | 'requestModelId' | 'thinking'>,
  reasoningEffort?: string,
): string {
  return (
    (reasoningEffort
      ? model.thinking?.effortRouting?.[reasoningEffort]
      : undefined) ??
    model.requestModelId ??
    model.id
  );
}

/** A deterministic cache key that can never collapse to a bare model id. */
export function makeEffectiveToolRouteKey(
  route: Pick<
    PlumbEffectiveToolRouteContract['scope'],
    'providerId' | 'modelId' | 'wireModelId' | 'dialect' | 'endpoint'
  >,
): string {
  return JSON.stringify([
    route.providerId,
    route.modelId,
    route.dialect,
    route.endpoint.family,
    route.endpoint.baseUrl ?? '',
    route.endpoint.path,
    route.wireModelId,
  ]);
}

/** Build the canonical effective contract from the complete selected route. */
export function buildEffectiveToolRouteContract(
  input: PlumbEffectiveToolRouteInput,
): PlumbEffectiveToolRouteContract {
  const { model, providerId } = input;
  if (!providerId.trim()) throw new Error('providerId is required');
  if (!model.id.trim()) throw new Error('model.id is required');

  const dialectContract = DIALECT_CONTRACTS[model.api];
  const wireModelId = resolveEffectiveWireModelId(model, input.reasoningEffort);
  const baseUrl = normalizeEndpoint(input.endpointOverride ?? model.baseUrl);
  const endpoint = {
    ...(baseUrl ? { baseUrl } : {}),
    path: dialectContract?.path(wireModelId) ?? 'unknown',
    family: dialectContract?.family ?? ('UNKNOWN' as const),
    source: input.endpointOverride
      ? ('CALLER_OVERRIDE' as const)
      : model.baseUrl
        ? ('MODEL' as const)
        : dialectContract
          ? ('DIALECT_DEFAULT' as const)
          : ('UNKNOWN' as const),
  };
  const scopeWithoutKey = {
    providerId,
    modelId: model.id,
    wireModelId,
    dialect: model.api,
    endpoint,
  };
  const scope = {
    ...scopeWithoutKey,
    cacheKey: makeEffectiveToolRouteKey(scopeWithoutKey),
  };
  const policy = resolveRouteToolPolicy({
    ...model,
    provider: providerId,
    baseUrl,
  });
  const modelToolSource = model.toolsCapabilitySource ?? 'UNKNOWN';
  const baseModelTools = capability(model.toolsSupported, modelToolSource);
  const structuredCapability = dialectContract
    ? capabilityFromStatus(dialectContract.structured, 'DIALECT_IMPLEMENTATION')
    : UNKNOWN;
  const parser = dialectContract
    ? capabilityFromStatus(dialectContract.parser, 'DIALECT_IMPLEMENTATION')
    : UNKNOWN;
  const replay = dialectContract
    ? capabilityFromStatus(dialectContract.replay, 'DIALECT_IMPLEMENTATION')
    : UNKNOWN;

  return {
    scope,
    baseModelTools,
    structuredProtocol: {
      kind: dialectContract?.protocol ?? 'UNKNOWN',
      capability: structuredCapability,
    },
    toolChoice: {
      emission: policy.emission,
      // Emission/default behavior does not prove that the endpoint implements
      // model-controlled auto selection. Keep this explicitly unknown.
      auto: UNKNOWN,
      required: dialectContract
        ? choiceCapability(
            policy.forcedToolChoiceSupported,
            policy.source,
            dialectContract.forcedToolChoice,
          )
        : UNKNOWN,
      named: dialectContract
        ? choiceCapability(
            policy.namedToolChoiceSupported,
            policy.source,
            dialectContract.namedToolChoice,
          )
        : UNKNOWN,
    },
    strictToolSchema: resolveStrictToolSchema(model),
    parallelToolCalls: capability(
      policy.parallelToolCallsSupported,
      policy.source,
    ),
    reasoningWithTools: model.reasoning
      ? UNKNOWN
      : { status: 'NOT_APPLICABLE', source: 'MODEL_METADATA' },
    replay: {
      capability: replay,
      assistantToolCalls: replay,
      toolResults: replay,
    },
    parser: {
      capability: parser,
      output: 'NORMALIZED_TOOL_CALL_EVENT',
      fragmentAssembly: dialectContract
        ? capabilityFromStatus(
            dialectContract.fragmentAssembly,
            'DIALECT_IMPLEMENTATION',
          )
        : UNKNOWN,
      callIdPreservation: dialectContract
        ? capabilityFromStatus(
            dialectContract.callIdPreservation,
            'DIALECT_IMPLEMENTATION',
          )
        : UNKNOWN,
    },
    provenance: {
      baseModelTools: modelToolSource,
      routePolicy: policy.source,
      structuredProtocol: dialectContract
        ? 'DIALECT_IMPLEMENTATION'
        : 'UNKNOWN',
    },
  };
}

function resolveStrictToolSchema(model: PlumbModel): PlumbProtocolCapability {
  const explicit =
    model.openaiCompat?.strictTools ?? model.anthropicCompat?.strictTools;
  return capability(
    explicit,
    explicit === undefined ? 'UNKNOWN' : 'OMP_COMPAT',
  );
}

function normalizeEndpoint(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.trim().replace(/\/+$/, '') || undefined;
}

/**
 * Route-scoped cache. It accepts complete contracts only, making a bare-model
 * `get(modelId)` API impossible and preventing cross-provider/endpoint bleed.
 */
export interface PlumbEffectiveToolRouteCache<T> {
  get(route: PlumbEffectiveToolRouteContract): T | undefined;
  set(route: PlumbEffectiveToolRouteContract, value: T): void;
  delete(route: PlumbEffectiveToolRouteContract): boolean;
  clear(): void;
  readonly size: number;
}

export function createEffectiveToolRouteCache<
  T,
>(): PlumbEffectiveToolRouteCache<T> {
  const values = new Map<string, T>();
  return {
    get: (route) => values.get(route.scope.cacheKey),
    set: (route, value) => values.set(route.scope.cacheKey, value),
    delete: (route) => values.delete(route.scope.cacheKey),
    clear: () => values.clear(),
    get size() {
      return values.size;
    },
  };
}

function matrixRow(
  provider: (typeof PLUMB_PROVIDERS)[number],
  selectableIds: ReadonlySet<string>,
): PlumbProviderProtocolMatrixRow {
  const models = getCatalogModels(provider.id);
  const contracts = models.map((model) =>
    buildEffectiveToolRouteContract({ providerId: provider.id, model }),
  );
  let supported = 0;
  let unsupported = 0;
  let unknown = 0;
  for (const contract of contracts) {
    if (contract.baseModelTools.status === 'SUPPORTED') supported++;
    else if (contract.baseModelTools.status === 'UNSUPPORTED') unsupported++;
    else unknown++;
  }
  const selectable = selectableIds.has(provider.id);
  const dialects = uniqueSorted(contracts.map((c) => c.scope.dialect));
  return {
    providerId: provider.id,
    providerName: provider.name,
    architectureFamily: resolveArchitectureFamily(provider),
    registered: true,
    selectable,
    availabilityStatus: selectable ? 'SELECTABLE' : 'REGISTERED_NOT_SELECTABLE',
    ...(provider.availabilityReason
      ? { availabilityReason: provider.availabilityReason }
      : {}),
    modelRouteCount: contracts.length,
    ...(models[0]?.id ? { representativeModel: models[0].id } : {}),
    dialects,
    endpointFamilies: uniqueSorted(
      contracts.map((c) => c.scope.endpoint.family),
    ),
    structuredProtocols: uniqueSorted(
      contracts.map((c) => c.structuredProtocol.kind),
    ),
    toolChoicePolicies: uniqueSorted(
      contracts.map((c) => c.toolChoice.emission),
    ),
    protocolFacts: dialects.map((dialectName) => {
      const routeContracts = contracts.filter(
        (contract) => contract.scope.dialect === dialectName,
      );
      return {
        ...DIALECT_PROTOCOL_FACTS[dialectName],
        reasoningCompatibility: aggregateCapabilityStatus(
          routeContracts.map((contract) => contract.reasoningWithTools.status),
        ),
        parallelCalls: aggregateCapabilityStatus(
          routeContracts.map((contract) => contract.parallelToolCalls.status),
        ),
      };
    }),
    baseModelTools: { supported, unsupported, unknown },
  };
}

function resolveArchitectureFamily(
  provider: (typeof PLUMB_PROVIDERS)[number],
): PlumbProviderArchitectureFamily {
  if (provider.category === 'custom_endpoint') return 'CUSTOM';
  if (provider.category === 'local') return 'LOCAL';
  if (CLOUD_PROVIDER_IDS.has(provider.id)) return 'CLOUD';
  if (GATEWAY_PROVIDER_IDS.has(provider.id)) return 'GATEWAY';
  if (provider.id === 'claude-subscription') return 'SUBSCRIPTION';
  if (provider.category === 'coding_plan') return 'CODING_PLAN';
  if (provider.category === 'oauth_account') return 'OAUTH';
  return 'DIRECT_API';
}

function aggregateCapabilityStatus(
  statuses: readonly PlumbProtocolCapability['status'][],
): PlumbProtocolCapability['status'] {
  if (statuses.length === 0) return 'UNKNOWN';
  const distinct = new Set(statuses);
  return distinct.size === 1 ? statuses[0] : 'UNKNOWN';
}

function uniqueSorted<T extends string>(values: readonly T[]): readonly T[] {
  return [...new Set(values)].sort() as T[];
}

/**
 * Generate directly from the PLUMB registry projection. There is exactly one
 * row per registered PLUMB provider, including non-selectable rows.
 */
export function generatePlumbProviderProtocolMatrix(): PlumbProviderProtocolMatrix {
  const selectableIds = new Set(SELECTABLE_PROVIDERS.map((p) => p.id));
  const providers = PLUMB_PROVIDERS.map((provider) =>
    matrixRow(provider, selectableIds),
  );
  return {
    source: 'PLUMB_PROVIDERS',
    counts: {
      registeredProviders: PLUMB_PROVIDERS.length,
      selectableProviders: SELECTABLE_PROVIDERS.length,
      providerRows: providers.length,
      modelRoutes: providers.reduce((sum, row) => sum + row.modelRouteCount, 0),
    },
    providers,
  };
}

/** Generated internal snapshot; regenerate by importing the current registry. */
export const PLUMB_PROVIDER_PROTOCOL_MATRIX =
  generatePlumbProviderProtocolMatrix();

/** Function form is convenient for diagnostics and preserves readonly output. */
export function getPlumbProviderProtocolMatrix(): PlumbProviderProtocolMatrix {
  return PLUMB_PROVIDER_PROTOCOL_MATRIX;
}
