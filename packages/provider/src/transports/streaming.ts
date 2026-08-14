/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * OMP-derived streaming transport adapter for PLUMB (THIN PLUMB UI FACADE).
 *
 * The event-stream normalization lifecycle is the responsibility of the
 * imported OMP runtime (`omp-ai/utils/event-stream.ts`); the per-provider
 * streaming dispatch is governed by `omp-ai/stream.ts`. This module keeps
 * the PLUMB `PlumbStreamEvent` shape and the transport-registry surface.
 * Upstream source: https://github.com/can1357/oh-my-pi.git
 * Upstream SHA: 4df68d60438423b384b2b47fb3d6835641624757
 * Upstream source: packages/ai/src/stream.ts
 * Upstream source: packages/ai/src/utils/event-stream.ts
 * Upstream license: MIT (c) 2025 Mario Zechner, (c) 2025-2026 Can Bölük
 */

import {
  type PlumbModel,
  type PlumbRouteToolPolicy,
  type PlumbStreamEvent,
  type PlumbStreamOptions,
  type PlumbKnownApi,
  type PlumbTool,
  type PlumbToolChoice,
} from '../types.js';
import {
  describeToolChoiceValue,
  resolveEffectiveToolChoice,
  resolveRouteToolPolicy,
} from '../tool-policy.js';
import { EventStream } from '../omp-ai/utils/event-stream.js';
import {
  classifyGenericHttpError,
  classifyAnthropicHttpError,
  classifyAnthropicSseErrorType,
  classifyGoogleHttpError,
  extractSafeResponsesErrorDetails,
  extractSafeErrorEnvelope,
  type SafeErrorEnvelope,
} from './errorClassification.js';
import { streamClaudeSubscription } from './claudeSubscription.js';
import { streamWatsonx } from './watsonx.js';
import { streamOciGenaiResponses } from './ociGenaiResponses.js';
import { streamBedrockConverse } from './bedrock.js';
import { streamAzureResponses } from './azure.js';
import { streamOpenAIResponses } from './openAIResponses.js';
import { prepareVertexModel } from './googleVertex.js';
import { UNAUTHENTICATED_PROVIDERS } from '../catalog/providers.js';
import { resolveProviderSafeConfig } from '../config/providerConfigResolver.js';
import {
  CUSTOM_CREDENTIAL_HEADER_NAMES,
  getCustomProviderDefinition,
  resolveCustomCredentialHeader,
  type CustomCredentialPlacement,
} from '../config/customProviderDefinitions.js';

// ─── Safe tool-call route diagnostics ─────────────────────────────────
//
// Opt-in only (PLUMB_TOOL_ROUTE_DIAG=1), off by default, zero behavior
// change when unset. Exists so a live request can prove whether the
// upstream provider actually returned structured tool_call deltas.

let toolRouteDiagEnabled = false;
const diagScopes = new Map<string, Record<string, unknown>>();
let activeDiagProbeId: string | undefined;
let defaultLastToolRouteDiag: Record<string, unknown> | undefined;

export function enableToolRouteDiag(): void {
  toolRouteDiagEnabled = true;
}

export function createFreshDiagSnapshot(
  probeId?: string,
): Record<string, unknown> {
  return {
    ...(probeId ? { probeId } : {}),
    requestToolsCount: 0,
    requestModelId: '',
    requestToolChoice: 'absent',
    toolProtocolStatus: 'not_evaluated',
    toolChoicePolicy: 'OPTIONAL',
    toolChoiceSent: false,
    toolChoiceValueCategory: 'absent',
    parallelToolsPolicy: 'unknown',
    responseTextDeltaCount: 0,
    responseToolCallDeltaCount: 0,
    responseFinishReason: 'none',
    normalizedToolCallCount: 0,
    normalizedToolCallNames: [] as string[],
    // Wire-proof structural facts (never prompt/credential/arguments).
    requestFamily: 'not_recorded',
    endpointPath: 'not_recorded',
    toolSerializationShape: 'none',
    functionDeclarationCount: 0,
    functionDeclarationNames: [] as string[],
    functionCallingMode: 'absent',
    allowedFunctionNamesCount: 0,
    allowedFunctionNames: [] as string[],
    toolConfigPresent: false,
    toolsPresent: false,
    httpStatus: 0,
    upstreamErrorCode: 'none',
    upstreamErrorFieldViolations: [] as string[],
    upstreamErrorType: 'none',
    upstreamErrorParam: 'none',
    upstreamErrorMessageSafe: 'none',
    // Safe, provider-neutral structural facts about the raw error body —
    // never the raw body itself. See `extractSafeErrorEnvelope`.
    errorBodyPresent: false,
    errorBodyContentType: 'none',
    errorBodyFormat: 'not_recorded',
    errorBodyByteLength: 0,
    errorTopLevelKeys: [] as string[],
    errorNestedErrorPresent: false,
    errorNestedErrorKeys: [] as string[],
    errorMessageCandidatePaths: [] as string[],
    upstreamErrorTextSafe: 'none',
    hasInput: false,
    inputItemCount: 0,
    parallelToolCallsPresent: false,
    maxOutputTokensFieldName: 'absent',
    reasoningFieldPresent: false,
    anthropicThinkingPresent: false,
    anthropicOutputConfigPresent: false,
    anthropicEffortPresent: false,
    anthropicTemperaturePresent: false,
    anthropicServiceTierPresent: false,
    anthropicSystemPresent: false,
    anthropicMaxTokens: 0,
    anthropicRequestedMaxTokens: 'unspecified',
    anthropicThinkingBudgetRequested: 'not_applicable',
    anthropicThinkingBudgetEffective: 'not_applicable',
    anthropicThinkingBudgetSource: 'NOT_APPLICABLE',
    anthropicThinkingBudgetAdjusted: false,
    anthropicThinkingBudgetAdjustmentReason: 'NONE',
    anthropicThinkingTokenInvariant: 'PASS',
    vertexStage: 'not_recorded',
    vertexFailedStage: 'not_recorded',
    vertexValidationError: 'none',
    networkStarted: false,
  };
}

export function initToolRouteDiag(probeId?: string): Record<string, unknown> {
  const snapshot = createFreshDiagSnapshot(probeId);
  if (probeId) {
    diagScopes.set(probeId, snapshot);
    activeDiagProbeId = probeId;
  }
  defaultLastToolRouteDiag = snapshot;
  return snapshot;
}

export function resetToolRouteDiag(probeId?: string): void {
  if (!toolRouteDiagEnabled) return;
  initToolRouteDiag(probeId);
}

export function getToolRouteDiag(
  probeId?: string,
): Record<string, unknown> | undefined {
  if (probeId && diagScopes.has(probeId)) {
    return diagScopes.get(probeId);
  }
  if (activeDiagProbeId && diagScopes.has(activeDiagProbeId)) {
    return diagScopes.get(activeDiagProbeId);
  }
  return defaultLastToolRouteDiag;
}

export function getLastToolRouteDiag(
  probeId?: string,
): Record<string, unknown> | undefined {
  return getToolRouteDiag(probeId);
}

function resolveDiagTarget(
  context?: string | PlumbStreamOptions,
): Record<string, unknown> | undefined {
  if (!toolRouteDiagEnabled) return undefined;
  const probeId =
    typeof context === 'string'
      ? context
      : (context?.probeId ?? context?.diagnosticProbeId ?? activeDiagProbeId);
  if (probeId) {
    if (!diagScopes.has(probeId)) {
      diagScopes.set(probeId, createFreshDiagSnapshot(probeId));
    }
    activeDiagProbeId = probeId;
    return diagScopes.get(probeId);
  }
  if (!defaultLastToolRouteDiag) {
    defaultLastToolRouteDiag = createFreshDiagSnapshot();
  }
  return defaultLastToolRouteDiag;
}

/** Structural wire facts a transport may record alongside a request. Every
 * field is a shape/path/count — never prompt text, credentials, or tool
 * arguments. */
export interface ToolRouteRequestWireDetails {
  readonly requestFamily:
    | 'openai-chat-completions'
    | 'openai-responses'
    | 'anthropic-messages'
    | 'google-gemini'
    | 'other';
  readonly endpointPath: string;
  readonly toolSerializationShape:
    | 'CHAT_WRAPPED'
    | 'RESPONSES_FLAT'
    | 'ANTHROPIC_TOOLS'
    | 'GEMINI_FUNCTION_DECLARATIONS'
    | 'none';
  readonly functionDeclarationCount?: number;
  readonly functionDeclarationNames?: readonly string[];
  readonly functionCallingMode?: string;
  readonly allowedFunctionNames?: readonly string[];
  readonly toolConfigPresent?: boolean;
  readonly toolsPresent?: boolean;
  /** Responses-family structural facts (names/counts only, no content). */
  readonly hasInput?: boolean;
  readonly inputItemCount?: number;
  readonly parallelToolCallsPresent?: boolean;
  readonly maxOutputTokensFieldName?: string;
  readonly reasoningFieldPresent?: boolean;
  /** Anthropic Messages structural facts (booleans/categories/counts only —
   * never thinking/system/tool-argument content). */
  readonly anthropicThinkingPresent?: boolean;
  readonly anthropicOutputConfigPresent?: boolean;
  readonly anthropicEffortPresent?: boolean;
  readonly anthropicTemperaturePresent?: boolean;
  readonly anthropicServiceTierPresent?: boolean;
  readonly anthropicSystemPresent?: boolean;
  /** Effective (final, on-the-wire) max_tokens. */
  readonly anthropicMaxTokens?: number;
  /** The caller-supplied `maxTokens` option before any invariant
   * resolution — `undefined` means no explicit request. */
  readonly anthropicRequestedMaxTokens?: number;
  readonly anthropicThinkingBudgetRequested?: number;
  readonly anthropicThinkingBudgetEffective?: number;
  readonly anthropicThinkingBudgetSource?: AnthropicThinkingBudgetSource;
  readonly anthropicThinkingBudgetAdjusted?: boolean;
  readonly anthropicThinkingBudgetAdjustmentReason?: AnthropicThinkingAdjustmentReason;
  readonly anthropicThinkingTokenInvariant?: 'PASS' | 'FAIL';
}

export function recordToolRouteRequest(
  toolsCount: number,
  modelId: string,
  options?: PlumbStreamOptions,
  sentChoice?: PlumbToolChoice,
  details?: ToolRouteRequestWireDetails,
): void {
  if (!toolRouteDiagEnabled) return;
  const target = resolveDiagTarget(options);
  if (!target) return;
  target['requestToolsCount'] = toolsCount;
  target['requestModelId'] = modelId;
  if (options) {
    const policy = resolveRouteToolPolicy(options.model);
    target['toolProtocolStatus'] =
      toolsCount > 0 ? 'structured_tools_advertised' : 'no_tools_advertised';
    target['toolChoicePolicy'] = policy.emission;
    target['toolChoiceSent'] = sentChoice !== undefined;
    target['toolChoiceValueCategory'] = describeToolChoiceValue(sentChoice);
    target['requestToolChoice'] = describeToolChoiceValue(sentChoice);
    target['parallelToolsPolicy'] =
      policy.parallelToolCallsSupported === undefined
        ? 'unknown'
        : policy.parallelToolCallsSupported
          ? 'supported'
          : 'unsupported';
  }
  if (details) {
    target['requestFamily'] = details.requestFamily;
    target['endpointPath'] = details.endpointPath;
    target['toolSerializationShape'] = details.toolSerializationShape;
    target['functionDeclarationCount'] = details.functionDeclarationCount ?? 0;
    target['functionDeclarationNames'] = [
      ...(details.functionDeclarationNames ?? []),
    ];
    target['functionCallingMode'] = details.functionCallingMode ?? 'absent';
    target['allowedFunctionNamesCount'] = (
      details.allowedFunctionNames ?? []
    ).length;
    target['allowedFunctionNames'] = [...(details.allowedFunctionNames ?? [])];
    target['toolConfigPresent'] = details.toolConfigPresent ?? false;
    target['toolsPresent'] = details.toolsPresent ?? false;
    target['hasInput'] = details.hasInput ?? false;
    target['inputItemCount'] = details.inputItemCount ?? 0;
    target['parallelToolCallsPresent'] =
      details.parallelToolCallsPresent ?? false;
    target['maxOutputTokensFieldName'] =
      details.maxOutputTokensFieldName ?? 'absent';
    target['reasoningFieldPresent'] = details.reasoningFieldPresent ?? false;
    target['anthropicThinkingPresent'] =
      details.anthropicThinkingPresent ?? false;
    target['anthropicOutputConfigPresent'] =
      details.anthropicOutputConfigPresent ?? false;
    target['anthropicEffortPresent'] = details.anthropicEffortPresent ?? false;
    target['anthropicTemperaturePresent'] =
      details.anthropicTemperaturePresent ?? false;
    target['anthropicServiceTierPresent'] =
      details.anthropicServiceTierPresent ?? false;
    target['anthropicSystemPresent'] = details.anthropicSystemPresent ?? false;
    target['anthropicMaxTokens'] = details.anthropicMaxTokens ?? 0;
    target['anthropicRequestedMaxTokens'] =
      details.anthropicRequestedMaxTokens ?? 'unspecified';
    target['anthropicThinkingBudgetRequested'] =
      details.anthropicThinkingBudgetRequested ?? 'not_applicable';
    target['anthropicThinkingBudgetEffective'] =
      details.anthropicThinkingBudgetEffective ?? 'not_applicable';
    target['anthropicThinkingBudgetSource'] =
      details.anthropicThinkingBudgetSource ?? 'NOT_APPLICABLE';
    target['anthropicThinkingBudgetAdjusted'] =
      details.anthropicThinkingBudgetAdjusted ?? false;
    target['anthropicThinkingBudgetAdjustmentReason'] =
      details.anthropicThinkingBudgetAdjustmentReason ?? 'NONE';
    target['anthropicThinkingTokenInvariant'] =
      details.anthropicThinkingTokenInvariant ?? 'PASS';
    if (details.requestFamily === 'google-gemini') {
      target['vertexStage'] = 'REQUEST_CONSTRUCTED';
    }
  }
}

/**
 * Record a Vertex preflight outcome (stage progression + the exact failed
 * boundary + safe validation classification) into the diagnostic snapshot.
 * Values are stage names and field-name classifications only — never a
 * project id, token, or endpoint value.
 */
export function recordVertexPreflight(
  prep: {
    stage?: string;
    failedStage?: string;
    validationError?: string;
  },
  context?: string | PlumbStreamOptions,
): void {
  if (!toolRouteDiagEnabled) return;
  const target = resolveDiagTarget(context);
  if (!target) return;
  target['vertexStage'] = prep.stage ?? 'not_recorded';
  target['vertexFailedStage'] = prep.failedStage ?? 'none';
  target['vertexValidationError'] = prep.validationError ?? 'none';
}

/** Mark that the transport crossed the network boundary (safe boolean). */
export function recordToolRouteNetworkStarted(
  context?: string | PlumbStreamOptions,
): void {
  if (!toolRouteDiagEnabled) return;
  const target = resolveDiagTarget(context);
  if (!target) return;
  target['networkStarted'] = true;
  target['vertexStage'] = 'NETWORK_STARTED';
}

/** Safe upstream error details (sanitized; never the raw body). */
export interface SafeUpstreamErrorDetails {
  readonly errorType?: string;
  readonly errorParam?: string;
  readonly errorMessageSafe?: string;
}

/**
 * Record the structural result of an upstream HTTP failure (status +
 * canonical classification + sanitized field violations + sanitized error
 * type/param/message) into the active diagnostic snapshot. Never stores the
 * raw error body.
 */
export function recordToolRouteHttpFailure(
  httpStatus: number,
  upstreamErrorCode: string,
  fieldViolations: readonly string[] = [],
  upstream?: SafeUpstreamErrorDetails,
  context?: string | PlumbStreamOptions,
  /** Safe, provider-neutral structural facts about the raw error body —
   * see `extractSafeErrorEnvelope`. Optional so every existing call site
   * (and every caller in a mocked test) keeps working unchanged. */
  envelope?: SafeErrorEnvelope,
): void {
  if (!toolRouteDiagEnabled) return;
  const target = resolveDiagTarget(context);
  if (!target) return;
  target['httpStatus'] = httpStatus;
  target['upstreamErrorCode'] = upstreamErrorCode;
  target['upstreamErrorFieldViolations'] = [...fieldViolations];
  if (upstream) {
    target['upstreamErrorType'] = upstream.errorType ?? 'none';
    target['upstreamErrorParam'] = upstream.errorParam ?? 'none';
    target['upstreamErrorMessageSafe'] = upstream.errorMessageSafe ?? 'none';
  }
  if (envelope) {
    target['errorBodyPresent'] = envelope.bodyPresent;
    target['errorBodyContentType'] = envelope.contentType;
    target['errorBodyFormat'] = envelope.format;
    target['errorBodyByteLength'] = envelope.byteLength;
    target['errorTopLevelKeys'] = [...envelope.topLevelKeys];
    target['errorNestedErrorPresent'] = envelope.nestedErrorPresent;
    target['errorNestedErrorKeys'] = [...envelope.nestedErrorKeys];
    target['errorMessageCandidatePaths'] = [...envelope.messageCandidatePaths];
    target['upstreamErrorTextSafe'] = envelope.textSafe ?? 'none';
    // The narrower, dialect-specific `upstream` extractor is authoritative
    // when it found evidence. When it found nothing but the broader
    // envelope extractor recognized a different safe shape (e.g. a bare
    // {message:"..."} or {error:"..."} body), surface that evidence
    // instead of leaving the field falsely 'none'.
    if (!upstream?.errorType && envelope.errorType) {
      target['upstreamErrorType'] = envelope.errorType;
    }
    if (!upstream?.errorParam && envelope.errorParam) {
      target['upstreamErrorParam'] = envelope.errorParam;
    }
    if (!upstream?.errorMessageSafe && envelope.errorMessageSafe) {
      target['upstreamErrorMessageSafe'] = envelope.errorMessageSafe;
    }
  }
}

function serializeOpenAIToolChoice(choice: PlumbToolChoice): unknown {
  switch (choice.mode) {
    case 'auto':
    case 'required':
    case 'none':
      return choice.mode;
    case 'named':
      return { type: 'function', function: { name: choice.name } };
  }
}

function serializeAnthropicToolChoice(choice: PlumbToolChoice): unknown {
  switch (choice.mode) {
    case 'auto':
    case 'none':
      return { type: choice.mode };
    case 'required':
      return { type: 'any' };
    case 'named':
      return { type: 'tool', name: choice.name };
  }
}

function serializeGeminiFunctionCallingConfig(
  choice: PlumbToolChoice,
): unknown {
  switch (choice.mode) {
    case 'auto':
      return { mode: 'AUTO' };
    case 'required':
      return { mode: 'ANY' };
    case 'none':
      return { mode: 'NONE' };
    case 'named':
      return { mode: 'ANY', allowedFunctionNames: [choice.name] };
  }
}

/**
 * Whether a route family speaks the OpenAI *Responses* wire contract (as
 * opposed to Chat Completions). Responses routes disagree with Chat on both
 * the tool entry shape and the `tool_choice` shape:
 *   - Chat tools:     [{type:'function', function:{name,description,parameters}}]
 *   - Responses tools:[{type:'function', name, description, parameters}]
 *   - Chat tool_choice named: {type:'function', function:{name}}
 *   - Responses tool_choice named: {type:'function', name}
 * Only the Responses family may serialize the Responses shapes.
 */
export function isResponsesApiFamily(api: PlumbKnownApi | string): boolean {
  return (
    api === 'openai-responses' ||
    api === 'openai-codex-responses' ||
    api === 'azure-openai-responses' ||
    api === 'oci-openai-responses'
  );
}

/** Responses route tool declarations (flat function list, not wrapped). */
export function serializeResponsesTools(tools: PlumbTool[]): unknown[] {
  return tools.map((t) => ({
    type: 'function',
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters,
  }));
}

/**
 * Serialize a normalized tool choice for the OpenAI *Responses* wire contract.
 * The named form must be `{type:'function', name}` — NEVER the
 * Chat-Completions-shaped `{type:'function', function:{name}}` that Responses
 * endpoints reject as INVALID_REQUEST.
 */
export function serializeResponsesToolChoice(choice: PlumbToolChoice): unknown {
  switch (choice.mode) {
    case 'auto':
      return { type: 'auto' };
    case 'required':
      return { type: 'required' };
    case 'none':
      return { type: 'none' };
    case 'named':
      return { type: 'function', name: choice.name };
  }
}

export interface ForcedSelectorWithToolsVerdict {
  readonly ok: boolean;
  readonly code: 'OK' | 'FORCED_SELECTOR_WITH_ZERO_TOOLS';
  readonly message?: string;
}

/**
 * Global wire invariant: a forced tool-selection control (required or named,
 * or an auto selector that REQUIRED_WHEN_TOOLS_PRESENT demands) may never be
 * emitted when zero tools are actually serialized on the wire. Failing
 * locally here (before any network I/O) is the single place both the Vertex
 * `request.tools.count=0` and Copilot selector contradictions are caught
 * deterministically.
 */
export function resolveForcedSelectorWithToolsGuard(
  policy: PlumbRouteToolPolicy,
  requested: PlumbToolChoice | undefined,
  effective: { readonly value?: PlumbToolChoice; readonly sent: boolean },
  serializedToolCount: number,
): ForcedSelectorWithToolsVerdict {
  const requestedForced =
    requested?.mode === 'required' || requested?.mode === 'named';
  const effectiveForces =
    effective.sent &&
    !!effective.value &&
    (effective.value.mode === 'required' ||
      effective.value.mode === 'named' ||
      (effective.value.mode === 'auto' &&
        policy.emission === 'REQUIRED_WHEN_TOOLS_PRESENT'));
  if ((requestedForced || effectiveForces) && serializedToolCount === 0) {
    return {
      ok: false,
      code: 'FORCED_SELECTOR_WITH_ZERO_TOOLS',
      message:
        'A forced tool-selection control was requested/emitted but zero tools are serialized on the wire. Refusing to send a selector-with-no-tools request; failing locally before network.',
    };
  }
  return { ok: true, code: 'OK' };
}

export function recordToolRouteTextDelta(
  context?: string | PlumbStreamOptions,
): void {
  if (!toolRouteDiagEnabled) return;
  const target = resolveDiagTarget(context);
  if (!target) return;
  target['responseTextDeltaCount'] =
    ((target['responseTextDeltaCount'] as number) || 0) + 1;
}

export function recordToolRouteToolCallDelta(
  context?: string | PlumbStreamOptions,
): void {
  if (!toolRouteDiagEnabled) return;
  const target = resolveDiagTarget(context);
  if (!target) return;
  target['responseToolCallDeltaCount'] =
    ((target['responseToolCallDeltaCount'] as number) || 0) + 1;
}

export function recordToolRouteFinishReason(
  reason: string,
  context?: string | PlumbStreamOptions,
): void {
  if (!toolRouteDiagEnabled) return;
  const target = resolveDiagTarget(context);
  if (!target) return;
  target['responseFinishReason'] = reason;
}

export function recordToolRouteNormalizedCall(
  name: string,
  context?: string | PlumbStreamOptions,
): void {
  if (!toolRouteDiagEnabled) return;
  const target = resolveDiagTarget(context);
  if (!target) return;
  target['normalizedToolCallCount'] =
    ((target['normalizedToolCallCount'] as number) || 0) + 1;
  const list = (target['normalizedToolCallNames'] as string[]) || [];
  list.push(name);
  target['normalizedToolCallNames'] = list;
}

// ─── Safe Antigravity request/response tracing ────────────────────────
//
// Opt-in only (PLUMB_ANTIGRAVITY_TRACE_SAFE=1), off by default, zero
// behavior change when unset. Exists so a real normal-chat 404 can be
// compared against a real `--test-antigravity-route` 200 at the exact same
// code path both go through (buildAntigravityRequest / this fetch call) —
// never a token, project ID, or message/tool content.

function antigravityTraceEnabled(): boolean {
  return process.env['PLUMB_ANTIGRAVITY_TRACE_SAFE'] === '1';
}

function makeAntigravityTraceId(): string {
  return `ag-${Math.random().toString(36).slice(2, 10)}`;
}

function traceAntigravity(line: string): void {
  if (!antigravityTraceEnabled()) return;
  process.stderr.write(`[antigravity-trace] ${line}\n`);
}

/**
 * Safe (non-secret) summary of a built Antigravity request descriptor,
 * shared by the trace facility here and (structurally mirrored) by the
 * `--diagnose-antigravity-route` CLI diagnostic — same fields, same
 * omissions. Never includes a token, project ID value, or message/tool
 * content.
 */
function describeAntigravityRequestSafely(
  descriptor: AntigravityRequestDescriptor,
): string[] {
  const lines: string[] = [];
  try {
    const url = new URL(descriptor.url);
    lines.push(`request.origin: ${url.origin}`);
    lines.push(`request.pathname: ${url.pathname}`);
    lines.push(
      `request.query.keys: ${[...url.searchParams.keys()].join(',') || '(none)'}`,
    );
  } catch {
    lines.push('request.origin: (unparseable)');
  }
  lines.push(
    `request.headers.names: ${Object.keys(descriptor.headers).join(',')}`,
  );
  lines.push(
    `request.authorization.present: ${descriptor.headers['Authorization'] !== undefined}`,
  );
  const body = descriptor.body;
  if (body && typeof body === 'object') {
    const rec = body as Record<string, unknown>;
    lines.push(`request.body.topLevelKeys: ${Object.keys(rec).join(',')}`);
    lines.push(`request.body.project.present: ${'project' in rec}`);
    const bodyModel = rec['model'];
    lines.push(
      `request.body.model: ${typeof bodyModel === 'string' ? bodyModel : '(unknown)'}`,
    );
    lines.push(`request.body.requestId.present: ${'requestId' in rec}`);
    const inner = rec['request'];
    lines.push(`request.body.request.present: ${'request' in rec}`);
    if (inner && typeof inner === 'object') {
      const innerRec = inner as Record<string, unknown>;
      lines.push(`request.body.sessionId.present: ${'sessionId' in innerRec}`);
      lines.push(`request.body.labels.present: ${'labels' in innerRec}`);
      const contents = innerRec['contents'];
      lines.push(
        `request.contents.count: ${Array.isArray(contents) ? contents.length : 0}`,
      );
      const tools = innerRec['tools'];
      lines.push(
        `request.tools.count: ${Array.isArray(tools) ? tools.length : 0}`,
      );
      lines.push(
        `request.systemInstruction.present: ${'systemInstruction' in innerRec}`,
      );
    }
    lines.push(
      `request.body.userAgent: ${String(rec['userAgent'] ?? '(absent)')}`,
    );
    lines.push(
      `request.body.requestType: ${String(rec['requestType'] ?? '(absent)')}`,
    );
  }
  return lines;
}

// ─── Transport implementations ─────────────────────────────────────────

type PlumbTransportFactory = (
  options: PlumbStreamOptions,
) => AsyncGenerator<PlumbStreamEvent>;

const transportFactories = new Map<PlumbKnownApi, PlumbTransportFactory>();
const PROVIDER_REQUEST_TIMEOUT_MS = 120_000;

function createBoundedRequestSignal(parent?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS);
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

function setHeaderCaseInsensitive(
  headers: Record<string, string>,
  name: string,
  value: string,
): void {
  for (const existing of Object.keys(headers)) {
    if (existing.toLowerCase() === name.toLowerCase()) {
      delete headers[existing];
    }
  }
  headers[name] = value;
}

function deleteHeaderCaseInsensitive(
  headers: Record<string, string>,
  name: string,
): void {
  for (const existing of Object.keys(headers)) {
    if (existing.toLowerCase() === name.toLowerCase()) {
      delete headers[existing];
    }
  }
}

/**
 * Rebuild a custom provider's auth headers from its definition alone. Every
 * credential-bearing header inherited from `model.headers` is cleared first,
 * so a custom endpoint can never be handed another provider's authority --
 * the header inventory and placement rules live in the definition module,
 * which is the single authority both this transport and discovery consult.
 */
function applyCustomCredentialHeader(
  headers: Record<string, string>,
  placement: CustomCredentialPlacement,
  apiKey: string,
): void {
  for (const name of CUSTOM_CREDENTIAL_HEADER_NAMES) {
    deleteHeaderCaseInsensitive(headers, name);
  }
  const credential = resolveCustomCredentialHeader(placement, apiKey);
  if (credential) {
    setHeaderCaseInsensitive(headers, credential.name, credential.value);
  }
}

function normalizePlumbFinishReason(reason: unknown): string | undefined {
  if (typeof reason !== 'string' || !reason) return undefined;
  switch (reason.toLowerCase()) {
    case 'stop':
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'length':
    case 'max_tokens':
      return 'max_tokens';
    case 'tool_calls':
    case 'tool_use':
      return 'tool_calls';
    case 'content_filter':
    case 'safety':
      return 'safety';
    case 'cancelled':
    case 'canceled':
      return 'cancelled';
    default:
      return 'other';
  }
}

/** Register a streaming transport for an API type. */
export function registerPlumbTransport(
  api: PlumbKnownApi,
  factory: PlumbTransportFactory,
): void {
  transportFactories.set(api, factory);
}

/** Check if a transport is registered for an API type. */
export function hasPlumbTransport(api: PlumbKnownApi): boolean {
  return transportFactories.has(api);
}

// ─── OpenAI-compatible streaming ───────────────────────────────────────

/**
 * Generic OpenAI-compatible streaming transport.
 * Works with any provider that exposes a `/v1/chat/completions` endpoint
 * with SSE streaming. This is the fallback for all OpenAI-compatible APIs
 * (OpenAI, OpenRouter, Together, Fireworks, Groq, DeepSeek, Mistral, etc.)
 */
async function* openAICompatibleStream(
  options: PlumbStreamOptions,
): AsyncGenerator<PlumbStreamEvent> {
  const {
    model,
    messages,
    tools,
    apiKey,
    signal,
    maxTokens,
    temperature,
    systemPrompt,
    responseFormat,
    reasoningEffort,
  } = options;

  const baseUrl = model.baseUrl ?? 'https://api.openai.com/v1';
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const requestSignal = createBoundedRequestSignal(signal);

  const body: Record<string, unknown> = {
    model: model.requestModelId ?? model.id,
    messages: buildOpenAIMessages(messages, systemPrompt, !!model.reasoning),
    stream: true,
    stream_options: { include_usage: true },
  };

  if (tools && tools.length > 0 && model.toolsSupported === true) {
    const isResponses = isResponsesApiFamily(model.api);
    body.tools = isResponses
      ? serializeResponsesTools(tools)
      : tools.map((t) => ({
          type: 'function',
          function: t.function,
        }));
    const effectiveChoice = resolveEffectiveToolChoice(
      resolveRouteToolPolicy(model),
      options.toolChoice,
      tools.length,
    );
    if (effectiveChoice.value) {
      // Responses routes (Copilot / Azure / OCI / Codex) must NOT receive the
      // Chat-Completions-shaped `{type:'function', function:{name}}` named
      // selector — that is an INVALID_REQUEST on a `/responses` endpoint.
      body.tool_choice = isResponses
        ? serializeResponsesToolChoice(effectiveChoice.value)
        : serializeOpenAIToolChoice(effectiveChoice.value);
    }
    recordToolRouteRequest(
      tools.length,
      String(body.model),
      options,
      effectiveChoice.value,
      {
        requestFamily: isResponses
          ? 'openai-responses'
          : 'openai-chat-completions',
        endpointPath: '/chat/completions',
        toolSerializationShape: isResponses ? 'RESPONSES_FLAT' : 'CHAT_WRAPPED',
        toolsPresent: true,
      },
    );
  } else {
    recordToolRouteRequest(0, String(body.model), options, undefined, {
      requestFamily: isResponsesApiFamily(model.api)
        ? 'openai-responses'
        : 'openai-chat-completions',
      endpointPath: '/chat/completions',
      toolSerializationShape: 'none',
      toolsPresent: false,
    });
  }
  if (maxTokens) body.max_tokens = maxTokens;
  if (temperature !== undefined && temperature >= 0)
    body.temperature = temperature;
  if (responseFormat) body.response_format = responseFormat;
  if (reasoningEffort) body.reasoning_effort = reasoningEffort;

  // ── Thinking/reasoning request body (OMP compat layer) ────────────
  //
  // OMP resolves a full compat record (thinkingFormat, whenThinking,
  // requiresReasoningContentForToolCalls, reasoningEffortMap, extraBody,
  // ...) at model build time via buildOpenAICompat(). PLUMB doesn't run
  // OMP's buildModel, so we apply the critical metadata-driven subset
  // here based on the model's catalog metadata and the exact OMP compat
  // resolution logic from packages/provider/src/omp-catalog/compat/openai.ts.
  //
  // KEY OMP CONTRACT:
  // - OpenCode providers (opencode-go, opencode-zen): thinkingFormat="openai",
  //   reasoning_effort sent when supportsReasoningEffort=true, NO extraBody.
  //   OPENCODE_WHEN_THINKING enables requiresReasoningContentForToolCalls
  //   only when thinking is engaged.
  // - Direct DeepSeek API: extraBody={thinking:{type:"enabled"}} in addition
  //   to reasoning_effort, supportsToolChoice=false.
  // - Kimi on OpenCode: supportsReasoningEffort=false (no reasoning_effort).
  // - MiMo: reasoningEffortMap={minimal:"low", xhigh:"high"}.
  //
  // DO NOT generalize by model family regex. Use thinking metadata only.
  if (
    model.reasoning &&
    model.thinking?.mode === 'effort' &&
    !reasoningEffort
  ) {
    const efforts = model.thinking.supportedEfforts;
    if (efforts && efforts.length > 0) {
      // Use the highest available effort as default.
      // TODO: consume compat.reasoningEffortMap when available.
      body.reasoning_effort = efforts[efforts.length - 1];
    }
  }

  // ── extraBody merge (OMP compat) ──────────────────────────────────
  //
  // OMP permits provider/model compat metadata to inject extra top-level
  // request fields via compat.extraBody. For DeepSeek on direct API,
  // this is {thinking: {type: "enabled"}}. For OpenCode providers,
  // extraBody is undefined (no extra fields needed).
  //
  // Currently PLUMB doesn't have a model.extraBody field. This is a
  // known gap for direct DeepSeek API support. For OpenCode providers,
  // no extraBody is needed per the OMP contract.

  // A missing/empty credential must fail loudly here — falling through
  // silently produces `Authorization: Bearer ` (no token), which providers
  // like GitHub Copilot reject as "Authorization header is badly formatted"
  // instead of the actual problem (no resolved credential for this provider).
  // Exception: providers explicitly catalogued as allowUnauthenticated (local
  // no-auth servers — Ollama, LM Studio, llama.cpp, vLLM, SGLang) never have
  // a stored credential by design, so an empty apiKey there is expected, not
  // an error.
  const isUnauthenticatedProvider = UNAUTHENTICATED_PROVIDERS.some(
    (p) => p.id === model.provider,
  );
  const customDefinition = getCustomProviderDefinition(model.provider);
  const isKeylessCustom = customDefinition?.credentialPlacement === 'none';
  if (!apiKey && !isUnauthenticatedProvider && !isKeylessCustom) {
    yield {
      type: 'error',
      error: {
        code: 'MISSING_CREDENTIAL',
        message: `No credential available for provider: ${model.provider}. Sign in again via /login ${model.provider}.`,
      },
    };
    return;
  }

  // Azure OpenAI uses api-key header; all others use Authorization: Bearer.
  // The model.headers field can carry provider-specific headers.
  // Provider metadata headers are assembled first; credential authority is
  // applied last so an accidental/malicious case-insensitive auth header in
  // metadata cannot replace the credential selected for this provider.
  const authHeaders: Record<string, string> = { ...(model.headers ?? {}) };
  if (model.provider === 'portkey') {
    const config = resolveProviderSafeConfig('portkey');
    const routingMode = config['routingMode'];
    const routingValue =
      routingMode === 'provider'
        ? config['portkeyProvider']
        : routingMode === 'config'
          ? config['portkeyConfig']
          : undefined;
    if (routingValue && !/[\r\n]/.test(routingValue)) {
      setHeaderCaseInsensitive(
        authHeaders,
        routingMode === 'provider' ? 'x-portkey-provider' : 'x-portkey-config',
        routingValue,
      );
    }
  }
  const isAzure =
    model.provider === 'azure' ||
    (model.baseUrl ?? '').includes('.openai.azure.com');
  if (customDefinition) {
    applyCustomCredentialHeader(
      authHeaders,
      customDefinition.credentialPlacement,
      apiKey,
    );
  } else if (apiKey) {
    if (isAzure) {
      setHeaderCaseInsensitive(authHeaders, 'api-key', apiKey);
    } else if (model.provider === 'portkey') {
      // Portkey gateway authority is not an upstream-provider bearer token.
      setHeaderCaseInsensitive(authHeaders, 'x-portkey-api-key', apiKey);
    } else {
      setHeaderCaseInsensitive(
        authHeaders,
        'Authorization',
        `Bearer ${apiKey}`,
      );
    }
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify(body),
      signal: requestSignal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError' && signal?.aborted) {
      yield { type: 'done', finishReason: 'cancelled' };
      return;
    }
    if (
      (err as Error).name === 'AbortError' ||
      (err as Error).name === 'TimeoutError'
    ) {
      yield {
        type: 'error',
        error: {
          code: 'REQUEST_TIMEOUT',
          message: 'Provider request timed out.',
          retryable: true,
        },
      };
      return;
    }
    yield {
      type: 'error',
      error: { code: 'NETWORK_ERROR', message: (err as Error).message },
    };
    return;
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    const classified = classifyGenericHttpError(response.status, errorText);
    recordToolRouteHttpFailure(response.status, classified.code);
    yield {
      type: 'error',
      error: classified,
    };
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    yield {
      type: 'error',
      error: { code: 'NO_RESPONSE_BODY', message: 'No response body' },
    };
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let finishReason: string | undefined;
  let cancelled = false;
  const pendingToolCalls = new Map<
    number,
    { id: string; name: string; arguments: string }
  >();

  const flushToolCalls = function* (): Generator<PlumbStreamEvent> {
    for (const [, toolCall] of [...pendingToolCalls.entries()].sort(
      ([a], [b]) => a - b,
    )) {
      yield { type: 'tool_call', toolCall };
      recordToolRouteNormalizedCall(toolCall.name);
    }
    pendingToolCalls.clear();
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const choice = parsed.choices?.[0];
          const delta = choice?.delta;

          if (delta?.content) {
            yield { type: 'text', text: delta.content };
          }

          if (delta?.reasoning_content || delta?.thinking) {
            yield {
              type: 'thinking',
              thinkingText: delta.reasoning_content || delta.thinking,
            };
          }

          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (tc.function) {
                const index = tc.index ?? 0;
                const current = pendingToolCalls.get(index) ?? {
                  id: tc.id ?? `call_${index}`,
                  name: '',
                  arguments: '',
                };
                if (tc.id) current.id = tc.id;
                if (tc.function.name) current.name += tc.function.name;
                if (tc.function.arguments) {
                  current.arguments += tc.function.arguments;
                }
                pendingToolCalls.set(index, current);
                recordToolRouteToolCallDelta();
              }
            }
          }

          if (choice?.finish_reason) {
            finishReason = normalizePlumbFinishReason(choice.finish_reason);
            recordToolRouteFinishReason(finishReason ?? 'unknown');
            yield* flushToolCalls();
          }

          if (parsed.usage) {
            yield {
              type: 'usage',
              usage: {
                inputTokens: parsed.usage.prompt_tokens ?? 0,
                outputTokens: parsed.usage.completion_tokens ?? 0,
                reasoningTokens:
                  parsed.usage.completion_tokens_details?.reasoning_tokens,
                totalTokens: parsed.usage.total_tokens ?? 0,
              },
            };
          }
        } catch {
          // Skip unparseable lines
        }
      }
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      if (signal?.aborted) {
        cancelled = true;
      } else {
        yield {
          type: 'error',
          error: {
            code: 'REQUEST_TIMEOUT',
            message: 'Provider request timed out.',
            retryable: true,
          },
        };
        return;
      }
    } else {
      yield {
        type: 'error',
        error: { code: 'STREAM_ERROR', message: (err as Error).message },
      };
      return;
    }
  } finally {
    reader.releaseLock();
  }

  yield* flushToolCalls();
  yield {
    type: 'done',
    finishReason: cancelled ? 'cancelled' : finishReason,
  };
}

// ─── Anthropic thinking / max_tokens invariant ─────────────────────────
//
// Anthropic requires max_tokens to strictly EXCEED thinking.budget_tokens
// whenever extended thinking is enabled. This is the single canonical
// resolver for that invariant — every Anthropic-family caller (direct
// Anthropic, GitHub Copilot, Vertex, any Anthropic-compatible gateway) goes
// through anthropicMessagesStream, so there is exactly one call site; no
// transport re-implements this rule.
//
// Mirrors OMP's `ensureMaxTokensForThinking` (omp-ai/providers/anthropic.ts)
// exactly, for OMP parity: raise max_tokens toward the required floor first
// (never past `modelMaxTokens`, the model's true max output authority —
// the ceiling is NEVER exceeded), only shrink the thinking budget if
// raising alone cannot satisfy the invariant, and only fail (before any
// network call) when no valid budget remains even at the model's true max
// output. OMP applies this cascade uniformly regardless of whether the
// budget came from explicit per-model effort metadata or a bare fallback
// default — this resolver does the same; `thinkingBudgetSource` is a
// diagnostic/reporting field only, never a policy branch.

/** Mirrors OMP's OUTPUT_FALLBACK_BUFFER (omp-ai/stream.ts) — the minimum
 * headroom max_tokens must keep above thinking.budget_tokens. */
export const ANTHROPIC_OUTPUT_FALLBACK_BUFFER = 4000;

/** PLUMB's existing thinking-budget fallback when no per-model effort
 * budget is resolved from catalog metadata. Unchanged value — this task
 * repairs the invariant around it, not the number itself. */
export const ANTHROPIC_DEFAULT_THINKING_BUDGET = 16000;

export type AnthropicThinkingBudgetSource =
  | 'EXPLICIT_MODEL_EFFORT_BUDGET'
  | 'FALLBACK_DEFAULT'
  | 'NOT_APPLICABLE';

export type AnthropicThinkingAdjustmentReason =
  | 'NONE'
  | 'MAX_TOKENS_RAISED'
  | 'THINKING_BUDGET_REDUCED'
  | 'MAX_TOKENS_RAISED_AND_BUDGET_REDUCED';

export interface AnthropicTokenBudgetInput {
  /** The caller-supplied `maxTokens` option, if any — `undefined` means no
   * explicit request (the resolver may freely choose within the model's
   * true max, since there is no caller intent to preserve). */
  readonly requestedMaxTokens?: number;
  /** The model's true max output authority (`PlumbModel.maxTokens`) — the
   * ceiling `effectiveMaxTokens` may NEVER exceed. */
  readonly modelMaxTokens: number;
  readonly thinkingRequested: boolean;
  /** The resolved per-model effort budget (e.g.
   * `model.thinking.effortBudgets['high']`), when catalog metadata defines
   * one. `undefined` means only the bare fallback default is available. */
  readonly thinkingBudgetRequested?: number;
}

export interface AnthropicTokenBudgetResult {
  readonly requestedMaxTokens?: number;
  readonly effectiveMaxTokens: number;
  readonly thinkingRequested: boolean;
  readonly thinkingEnabledEffective: boolean;
  readonly thinkingBudgetRequested?: number;
  readonly thinkingBudgetEffective?: number;
  readonly thinkingBudgetSource: AnthropicThinkingBudgetSource;
  readonly adjusted: boolean;
  readonly adjustmentReason: AnthropicThinkingAdjustmentReason;
  /** `true` when the final request (or thinking-disabled fallback) honestly
   * satisfies Anthropic's invariant. `false` only in the `failClosed` case. */
  readonly invariantPass: boolean;
  /** `true` means the caller MUST NOT send this request — no valid
   * max_tokens/budget_tokens pair exists even at the model's true max
   * output. The caller is responsible for yielding an error and returning
   * before any network call. */
  readonly failClosed: boolean;
}

/**
 * Canonical Anthropic max_tokens / thinking.budget_tokens conflict
 * resolver. See module-level comment above for the policy and its OMP
 * parity justification.
 */
export function resolveAnthropicTokenBudget(
  input: AnthropicTokenBudgetInput,
): AnthropicTokenBudgetResult {
  const { requestedMaxTokens, modelMaxTokens } = input;
  // Model max output authority is never exceeded, whether the caller
  // requested an explicit value or the resolver falls back to it.
  const currentMaxTokens = Math.min(
    requestedMaxTokens ?? modelMaxTokens,
    modelMaxTokens,
  );

  if (!input.thinkingRequested) {
    return {
      requestedMaxTokens,
      effectiveMaxTokens: currentMaxTokens,
      thinkingRequested: false,
      thinkingEnabledEffective: false,
      thinkingBudgetSource: 'NOT_APPLICABLE',
      adjusted: false,
      adjustmentReason: 'NONE',
      invariantPass: true,
      failClosed: false,
    };
  }

  const thinkingBudgetSource: AnthropicThinkingBudgetSource =
    input.thinkingBudgetRequested !== undefined
      ? 'EXPLICIT_MODEL_EFFORT_BUDGET'
      : 'FALLBACK_DEFAULT';
  const budgetTokens =
    input.thinkingBudgetRequested ?? ANTHROPIC_DEFAULT_THINKING_BUDGET;

  if (budgetTokens <= 0) {
    // Mirrors OMP's own `budgetTokens <= 0` no-op guard: no positive budget
    // was resolved, so thinking cannot be meaningfully enabled.
    return {
      requestedMaxTokens,
      effectiveMaxTokens: currentMaxTokens,
      thinkingRequested: true,
      thinkingEnabledEffective: false,
      thinkingBudgetRequested: budgetTokens,
      thinkingBudgetSource,
      adjusted: false,
      adjustmentReason: 'NONE',
      invariantPass: true,
      failClosed: false,
    };
  }

  const raisedMaxTokens = Math.min(
    Math.max(currentMaxTokens, budgetTokens + ANTHROPIC_OUTPUT_FALLBACK_BUFFER),
    modelMaxTokens,
  );
  const maxTokensRaised = raisedMaxTokens !== currentMaxTokens;

  if (budgetTokens + ANTHROPIC_OUTPUT_FALLBACK_BUFFER <= raisedMaxTokens) {
    return {
      requestedMaxTokens,
      effectiveMaxTokens: raisedMaxTokens,
      thinkingRequested: true,
      thinkingEnabledEffective: true,
      thinkingBudgetRequested: budgetTokens,
      thinkingBudgetEffective: budgetTokens,
      thinkingBudgetSource,
      adjusted: maxTokensRaised,
      adjustmentReason: maxTokensRaised ? 'MAX_TOKENS_RAISED' : 'NONE',
      invariantPass: true,
      failClosed: false,
    };
  }

  // Raising alone (bounded by the model's true max output) was not enough
  // — shrink the thinking budget to fit under the raised ceiling.
  const clampedBudget = raisedMaxTokens - ANTHROPIC_OUTPUT_FALLBACK_BUFFER;
  if (clampedBudget <= 0) {
    // No valid pair exists even at the model's true max output. Fail
    // closed — the caller must never send this request.
    return {
      requestedMaxTokens,
      effectiveMaxTokens: raisedMaxTokens,
      thinkingRequested: true,
      thinkingEnabledEffective: false,
      thinkingBudgetRequested: budgetTokens,
      thinkingBudgetSource,
      adjusted: maxTokensRaised,
      adjustmentReason: 'MAX_TOKENS_RAISED_AND_BUDGET_REDUCED',
      invariantPass: false,
      failClosed: true,
    };
  }

  return {
    requestedMaxTokens,
    effectiveMaxTokens: raisedMaxTokens,
    thinkingRequested: true,
    thinkingEnabledEffective: true,
    thinkingBudgetRequested: budgetTokens,
    thinkingBudgetEffective: clampedBudget,
    thinkingBudgetSource,
    adjusted: true,
    adjustmentReason: maxTokensRaised
      ? 'MAX_TOKENS_RAISED_AND_BUDGET_REDUCED'
      : 'THINKING_BUDGET_REDUCED',
    invariantPass: true,
    failClosed: false,
  };
}

// ─── Anthropic Messages streaming ──────────────────────────────────────

async function* anthropicMessagesStream(
  options: PlumbStreamOptions,
): AsyncGenerator<PlumbStreamEvent> {
  const {
    model,
    messages,
    tools,
    apiKey,
    signal,
    maxTokens,
    temperature,
    systemPrompt,
  } = options;

  const baseUrl = model.baseUrl ?? 'https://api.anthropic.com';
  if (
    model.provider === 'cloudflare-ai-gateway' &&
    /<(?:account|gateway)>/i.test(baseUrl)
  ) {
    yield {
      type: 'error',
      error: {
        code: 'ENDPOINT_NOT_CONFIGURED',
        message:
          'Cloudflare AI Gateway requires an account ID and gateway ID. Configure the provider via /login cloudflare-ai-gateway.',
      },
    };
    return;
  }
  const requestSignal = createBoundedRequestSignal(signal);
  // Claude-on-Vertex's baseUrl (already resolved by plumbModelStream's
  // Vertex prep step) is the complete `:streamRawPredict` request URL --
  // appending `/v1/messages` like the direct Anthropic API would produce
  // `...:streamRawPredict/v1/messages`, so it is stripped back off here.
  // Mirrors the upstream OMP dispatcher's own proven
  // `resolveVertexRequest`/`rewriteUrl` fixup (omp-ai/stream.ts).
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/messages`.replace(
    ':streamRawPredict/v1/messages',
    ':streamRawPredict',
  );

  const systemMessages: unknown[] = [];
  const chatMessages: unknown[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemMessages.push({
        type: 'text',
        text: typeof msg.content === 'string' ? msg.content : '',
      });
    } else {
      chatMessages.push(buildAnthropicMessage(msg));
    }
  }

  // Apply thinking config from model
  const thinkingConfig = model.thinking;
  const hasThinking =
    thinkingConfig?.supportedEfforts?.length &&
    thinkingConfig.supportedEfforts.length > 0;

  // Canonical invariant resolution BEFORE the request body is built — see
  // `resolveAnthropicTokenBudget` above. This is the single call site for
  // every Anthropic-family provider; the resolved `effectiveMaxTokens` /
  // `thinkingBudgetEffective` are what actually go on the wire.
  const tokenBudget = resolveAnthropicTokenBudget({
    requestedMaxTokens: maxTokens,
    modelMaxTokens: model.maxTokens ?? 4096,
    thinkingRequested: Boolean(hasThinking),
    thinkingBudgetRequested:
      thinkingConfig?.effortBudgets?.['high'] ?? undefined,
  });

  const body: Record<string, unknown> = {
    model: model.requestModelId ?? model.id,
    messages: chatMessages,
    stream: true,
    max_tokens: tokenBudget.effectiveMaxTokens,
  };

  if (systemPrompt) {
    body.system = systemPrompt;
  } else if (systemMessages.length > 0) {
    body.system = systemMessages;
  }

  const toolsSerialized =
    tools !== undefined && tools.length > 0 && model.toolsSupported === true;
  let anthropicEffectiveChoice: {
    readonly value?: PlumbToolChoice;
    readonly sent: boolean;
    readonly downgraded: boolean;
  } = { sent: false, downgraded: false };
  if (toolsSerialized) {
    body.tools = tools!.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
    anthropicEffectiveChoice = resolveEffectiveToolChoice(
      resolveRouteToolPolicy(model),
      options.toolChoice,
      tools!.length,
    );
    if (anthropicEffectiveChoice.value) {
      body.tool_choice = serializeAnthropicToolChoice(
        anthropicEffectiveChoice.value,
      );
    }
  }
  recordToolRouteRequest(
    toolsSerialized ? tools!.length : 0,
    String(model.requestModelId ?? model.id),
    options,
    anthropicEffectiveChoice.value,
    {
      requestFamily: 'anthropic-messages',
      endpointPath:
        model.provider === 'google-vertex'
          ? ':streamRawPredict'
          : '/v1/messages',
      toolSerializationShape: toolsSerialized ? 'ANTHROPIC_TOOLS' : 'none',
      toolsPresent: toolsSerialized,
      // Structural facts only — booleans/counts, never content. PLUMB's
      // Anthropic transport does not currently construct `output_config`,
      // `service_tier`, or an `effort` field at all (unlike OMP's richer
      // adaptive-thinking dispatcher); those report `false` honestly rather
      // than being omitted, so a differential audit can see PLUMB simply
      // never sends them yet, not that they were dropped for this request.
      anthropicThinkingPresent: Boolean(hasThinking),
      anthropicOutputConfigPresent: false,
      anthropicEffortPresent: false,
      anthropicTemperaturePresent: temperature !== undefined,
      anthropicServiceTierPresent: false,
      anthropicSystemPresent: Boolean(
        systemPrompt || systemMessages.length > 0,
      ),
      anthropicMaxTokens: (body.max_tokens as number | undefined) ?? 0,
      anthropicRequestedMaxTokens: maxTokens,
      anthropicThinkingBudgetRequested: tokenBudget.thinkingBudgetRequested,
      anthropicThinkingBudgetEffective: tokenBudget.thinkingBudgetEffective,
      anthropicThinkingBudgetSource: tokenBudget.thinkingBudgetSource,
      anthropicThinkingBudgetAdjusted: tokenBudget.adjusted,
      anthropicThinkingBudgetAdjustmentReason: tokenBudget.adjustmentReason,
      anthropicThinkingTokenInvariant: tokenBudget.invariantPass
        ? 'PASS'
        : 'FAIL',
    },
  );

  if (tokenBudget.failClosed) {
    // No valid max_tokens/thinking.budget_tokens pair exists even at the
    // model's true max output authority — fail BEFORE any network call
    // rather than let Anthropic reject an invalid request.
    yield {
      type: 'error',
      error: {
        code: 'INVALID_THINKING_TOKEN_BUDGET',
        message:
          "No valid max_tokens/thinking budget pair could be constructed within the model's max output.",
      },
    };
    return;
  }

  if (tokenBudget.thinkingEnabledEffective) {
    body.thinking = {
      type: 'enabled',
      budget_tokens: tokenBudget.thinkingBudgetEffective,
    };
  }

  if (temperature !== undefined) body.temperature = temperature;

  // A missing/empty credential must fail loudly here — sending the request
  // with no auth header at all just produces a less specific upstream error
  // ("missing required Authorization header") for the same underlying
  // problem (no resolved credential for this provider).
  // Claude-on-Vertex authenticates via the Google OAuth Bearer token
  // plumbModelStream's Vertex prep step already injected into
  // model.headers.Authorization -- apiKey here is only PLUMB's generic
  // credential-plumbing sentinel, never a real Vertex secret.
  const isVertex = model.provider === 'google-vertex';
  const customDefinition = getCustomProviderDefinition(model.provider);
  const isKeylessCustom = customDefinition?.credentialPlacement === 'none';
  if (!apiKey && !isVertex && !isKeylessCustom) {
    yield {
      type: 'error',
      error: {
        code: 'MISSING_CREDENTIAL',
        message: `No credential available for provider: ${model.provider}. Sign in again via /login ${model.provider}.`,
      },
    };
    return;
  }

  // GitHub Copilot's Anthropic-compatible proxy requires Authorization:
  // Bearer regardless of credential kind — it does not accept x-api-key
  // (confirmed: sending x-api-key alone produces "missing required
  // Authorization header" from Copilot's endpoint). Native Anthropic API
  // endpoints accept both; x-api-key remains the default there. Vertex
  // requires Authorization: Bearer <Google OAuth token> (already present in
  // model.headers) and must never also send x-api-key with the sentinel
  // apiKey value.
  // The model.headers field can carry provider-specific headers
  // (e.g. anthropic-beta, anthropic-dangerous-direct-browser-access).
  const authHeaders: Record<string, string> = { ...(model.headers ?? {}) };
  if (customDefinition) {
    applyCustomCredentialHeader(
      authHeaders,
      customDefinition.credentialPlacement,
      apiKey,
    );
  } else if (model.provider === 'cloudflare-ai-gateway') {
    setHeaderCaseInsensitive(
      authHeaders,
      'cf-aig-authorization',
      `Bearer ${apiKey}`,
    );
    deleteHeaderCaseInsensitive(authHeaders, 'Authorization');
    deleteHeaderCaseInsensitive(authHeaders, 'x-api-key');
  } else if (model.provider === 'github-copilot') {
    setHeaderCaseInsensitive(authHeaders, 'Authorization', `Bearer ${apiKey}`);
  } else if (!isVertex) {
    setHeaderCaseInsensitive(authHeaders, 'x-api-key', apiKey);
  }

  // Vertex Claude rejects the standard Anthropic body shape: `model` is
  // encoded in the URL path (never the body), and `anthropic_version:
  // "vertex-2023-10-16"` is required in the JSON body instead of the
  // `anthropic-version` HTTP header. Mirrors the upstream OMP dispatcher's
  // own proven `transformVertexAnthropicBody` (omp-ai/stream.ts).
  if (isVertex) {
    delete body.model;
    body.anthropic_version = 'vertex-2023-10-16';
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        ...authHeaders,
      },
      body: JSON.stringify(body),
      signal: requestSignal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError' && signal?.aborted) {
      yield { type: 'done', finishReason: 'cancelled' };
      return;
    }
    if (
      (err as Error).name === 'AbortError' ||
      (err as Error).name === 'TimeoutError'
    ) {
      yield {
        type: 'error',
        error: {
          code: 'REQUEST_TIMEOUT',
          message: 'Provider request timed out.',
          retryable: true,
        },
      };
      return;
    }
    yield {
      type: 'error',
      error: { code: 'NETWORK_ERROR', message: (err as Error).message },
    };
    return;
  }

  if (!response.ok) {
    // Read the body exactly once — every downstream consumer (dialect
    // classification, the narrow Responses-shaped extractor, and the
    // provider-neutral forensic envelope extractor below) operates on this
    // same already-read `errorText` string, never a second `response.text()`
    // call and never `response.clone()`.
    const errorText = await response.text().catch(() => 'Unknown error');
    const contentType = response.headers.get('content-type') ?? undefined;
    const classified = classifyAnthropicHttpError(response.status, errorText);
    // Anthropic's documented error body (`{"error":{"type":...,"message":...}}`)
    // is a subset of the same shape the Responses-family extractor already
    // parses safely (type/param/message, sanitized, 300-char bound); reuse it
    // rather than duplicating the same sanitization logic for Anthropic.
    // Anthropic errors carry no `param`, so errorParam stays 'none' honestly.
    // The envelope extractor additionally records the SAFE STRUCTURE of the
    // body (format/keys/candidate paths) when it doesn't match that shape,
    // so a body Copilot's Anthropic proxy returns in some other envelope is
    // still forensically visible instead of silently reporting 'none'.
    recordToolRouteHttpFailure(
      response.status,
      classified.code,
      [],
      extractSafeResponsesErrorDetails(errorText),
      undefined,
      extractSafeErrorEnvelope(errorText, contentType),
    );
    yield {
      type: 'error',
      error: classified,
    };
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    yield {
      type: 'error',
      error: { code: 'NO_RESPONSE_BODY', message: 'No response body' },
    };
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let finishReason: string | undefined;
  let inputTokens = 0;
  let outputTokens = 0;
  let cancelled = false;
  const pendingToolCalls = new Map<
    number,
    {
      id: string;
      name: string;
      arguments: string;
      hasDelta: boolean;
    }
  >();

  const flushToolCall = function* (index: number): Generator<PlumbStreamEvent> {
    const pending = pendingToolCalls.get(index);
    if (!pending) return;
    pendingToolCalls.delete(index);
    yield {
      type: 'tool_call',
      toolCall: {
        id: pending.id,
        name: pending.name,
        arguments: pending.arguments,
      },
    };
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);

        try {
          const parsed = JSON.parse(data);

          switch (parsed.type) {
            case 'content_block_start': {
              const block = parsed.content_block;
              if (block.type === 'tool_use') {
                const initialInput = block.input;
                pendingToolCalls.set(parsed.index ?? 0, {
                  id: block.id,
                  name: block.name,
                  arguments:
                    initialInput && Object.keys(initialInput).length > 0
                      ? JSON.stringify(initialInput)
                      : '',
                  hasDelta: false,
                });
              }
              break;
            }
            case 'content_block_delta': {
              const delta = parsed.delta;
              if (delta.type === 'text_delta') {
                yield { type: 'text', text: delta.text };
              } else if (delta.type === 'input_json_delta') {
                const index = parsed.index ?? 0;
                const pending = pendingToolCalls.get(index);
                if (pending) {
                  if (!pending.hasDelta) pending.arguments = '';
                  pending.hasDelta = true;
                  pending.arguments += delta.partial_json ?? '';
                }
              } else if (delta.type === 'thinking_delta') {
                yield { type: 'thinking', thinkingText: delta.thinking };
              } else if (delta.type === 'signature_delta') {
                // Signature is internal bookkeeping
              }
              break;
            }
            case 'content_block_stop': {
              yield* flushToolCall(parsed.index ?? 0);
              break;
            }
            case 'message_delta': {
              if (parsed.delta?.stop_reason) {
                finishReason = normalizePlumbFinishReason(
                  parsed.delta.stop_reason,
                );
              }
              if (parsed.usage) {
                outputTokens = parsed.usage.output_tokens ?? outputTokens;
                inputTokens = parsed.usage.input_tokens ?? inputTokens;
                yield {
                  type: 'usage',
                  usage: {
                    inputTokens,
                    outputTokens,
                    totalTokens: inputTokens + outputTokens,
                  },
                };
              }
              break;
            }
            case 'message_start': {
              if (parsed.message?.usage) {
                inputTokens = parsed.message.usage.input_tokens ?? 0;
              }
              break;
            }
            case 'error': {
              const sseMessage =
                parsed.error?.message ?? 'Unknown provider error';
              const canonical = classifyAnthropicSseErrorType(
                parsed.error?.type,
                sseMessage,
              );
              yield {
                type: 'error',
                error: {
                  // Keep the raw documented type as the code when it isn't
                  // one of the currently-mapped values — still a real,
                  // Anthropic-reported classification, not a guess.
                  code: canonical ?? parsed.error?.type ?? 'PROVIDER_ERROR',
                  message: sseMessage,
                },
              };
              return;
            }
          }
        } catch {
          // Skip unparseable lines
        }
      }
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      if (signal?.aborted) {
        cancelled = true;
      } else {
        yield {
          type: 'error',
          error: {
            code: 'REQUEST_TIMEOUT',
            message: 'Provider request timed out.',
            retryable: true,
          },
        };
        return;
      }
    } else {
      yield {
        type: 'error',
        error: { code: 'STREAM_ERROR', message: (err as Error).message },
      };
      return;
    }
  } finally {
    reader.releaseLock();
  }

  for (const index of [...pendingToolCalls.keys()].sort((a, b) => a - b)) {
    yield* flushToolCall(index);
  }
  yield {
    type: 'done',
    finishReason: cancelled ? 'cancelled' : finishReason,
  };
}

// ─── Google Cloud Code Assist streaming (google-gemini-cli / google-antigravity) ──
//
// Real production defect (two rounds): this API family (OAuth-only —
// google-gemini-cli and google-antigravity share it, per the pinned OMP
// implementation in omp-ai/providers/google-gemini-cli.ts) was previously
// routed through googleGenerativeAiStream below, a public-Gemini-API client
// (`?key=<token>`), leaking the OAuth token into the URL and 404ing. A first
// fix pointed the URL/auth at the real endpoint but still built the request
// BODY by hand — missing the envelope fields
// (requestId/sessionId/labels/userAgent/requestType) that
// buildAntigravityRequestEnvelope (private, called from the exported
// buildRequest) generates to mirror the real antigravity/hub client, and
// that Google's backend evidently requires to route the request at all
// (still 404s without them). Delegating to the real exported buildRequest
// here — rather than hand-copying its private envelope logic — makes this
// call byte-identical to the pinned reference by construction, not by
// differential comparison.
//
// Credential note: this API needs both the OAuth access token AND the
// project id. PlumbStreamOptions.apiKey is a single flat string (the
// contract every other transport in this file shares — Copilot, NVIDIA,
// etc. — and PlumbSecureCredentialStore.getApiKey() only ever returns a
// bare access token, dropping projectId). Rather than widen that shared
// contract for one provider family, this reads the full PlumbOAuthCredential
// directly from the canonical PlumbProviderRegistry.
export interface AntigravityRequestDescriptor {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export type AntigravityRequestResult =
  | { ok: true; descriptor: AntigravityRequestDescriptor }
  | { ok: false; error: PlumbStreamEvent };

export type ToolSuppressionReason =
  | 'MODEL_UNSUPPORTED'
  | 'CAPABILITY_UNKNOWN'
  | 'NONE';

/**
 * Resolve tool exposure exactly once before a model request is handed to a
 * dialect serializer. UNKNOWN is deliberately fail-closed: no provider-wide
 * compatibility inference is valid because a provider can host models with
 * different function-calling capability.
 */
export function resolveAdvertisedTools(options: PlumbStreamOptions): {
  tools: PlumbStreamOptions['tools'];
  suppressionReason: ToolSuppressionReason;
} {
  if (options.model.toolsSupported === true) {
    return { tools: options.tools, suppressionReason: 'NONE' };
  }
  return {
    tools: undefined,
    suppressionReason:
      options.model.toolsSupported === false
        ? 'MODEL_UNSUPPORTED'
        : 'CAPABILITY_UNKNOWN',
  };
}

/**
 * Builds the exact request (URL/headers/body) a real google-gemini-cli /
 * google-antigravity chat turn sends — used by BOTH normal chat
 * (googleCloudCodeAssistStream below) and the `plumb --diagnose-antigravity-route`
 * / `--test-antigravity-route` CLI diagnostics, so the two can never silently
 * diverge into "the diagnostic looks right but chat uses something else."
 * Never resolves with the raw accessToken/projectId anywhere but inside the
 * returned descriptor (which callers must sanitize before printing).
 */
export async function buildAntigravityRequest(
  options: PlumbStreamOptions,
  callerTraceId?: string,
): Promise<AntigravityRequestResult> {
  const { model, messages, tools, systemPrompt, maxTokens, temperature } =
    options;

  // Gate tools based on model capability — only send tools when explicitly supported
  const gatedTools = model.toolsSupported === true ? tools : undefined;

  const source = options.traceSource ?? 'NORMAL_CHAT';
  const traceId = antigravityTraceEnabled()
    ? (callerTraceId ?? makeAntigravityTraceId())
    : null;
  if (traceId) {
    const { traceAntigravityRequestConstruction } = await import(
      './antigravityTrace.js'
    );
    traceAntigravityRequestConstruction({
      traceId,
      source,
      model,
      options,
      generatorInstance: options.generatorInstance,
    });
    for (const line of describeAntigravityRequestSafely({
      url: model.baseUrl ?? 'https://daily-cloudcode-pa.googleapis.com',
      headers: {},
      body: null,
    })) {
      traceAntigravity(`traceId=${traceId} ${line}`);
    }
  }

  const { resolvePlumbProviderId } = await import('../catalog/providers.js');
  const { resolveUsablePlumbCredential } = await import(
    '../auth/credential-resolver.js'
  );
  // `model.provider` on a catalog-projected PlumbModel carries the OMP
  // registry id (e.g. `google-antigravity`), but PlumbProviderRegistry
  // credential state is keyed by the PLUMB presentation id (`antigravity`)
  // that login/UI/settings use — resolve back to that id before lookup, or
  // this always misses and falls through to MISSING_CREDENTIAL even when a
  // valid credential is stored.
  const registryProviderId = resolvePlumbProviderId(model.provider);
  // Classifies the stored credential and — only when it is expired but a
  // refresh token is available — performs one silent refresh-token
  // exchange (never a new OAuth/login flow) before returning. Shared with
  // the `--diagnose-antigravity-route` / `--test-antigravity-route`
  // diagnostics so normal chat and diagnostics can never diverge here.
  const resolved = await resolveUsablePlumbCredential(registryProviderId);
  const credential = resolved.credential;

  if (!credential || !credential.access || !credential.projectId) {
    if (traceId) {
      const { traceAntigravityError } = await import('./antigravityTrace.js');
      traceAntigravityError({
        traceId,
        source,
        error: {
          code: 'MISSING_CREDENTIAL',
          message: `No credential available for provider: ${registryProviderId}`,
        },
      });
    }
    return {
      ok: false,
      error: {
        type: 'error',
        error: {
          code: 'MISSING_CREDENTIAL',
          message: `No credential available for provider: ${registryProviderId} (${resolved.classification}). Sign in again via /login ${registryProviderId}.`,
        },
      },
    };
  }
  const accessToken = credential.access;
  const projectId = credential.projectId;

  const gcli = await import('../omp-ai/providers/google-gemini-cli.js');
  const isAntigravity = model.provider === 'google-antigravity';
  // Minimal PLUMB -> OMP message/model/tool conversion. Preserve structured
  // assistant tool calls: OMP's native Gemini converter pairs them with the
  // following toolResult by id and serializes functionCall/functionResponse.
  // This delegates the final wire shape to OMP instead of duplicating native
  // functionCall/functionResponse serialization in the PLUMB facade.
  const now = Date.now();
  const ompMessages: import('../omp-ai/types.js').Message[] = [];
  for (const msg of messages) {
    if (msg.role === 'system') continue;
    const text = contentToText(msg.content);
    if (msg.role === 'user') {
      ompMessages.push({ role: 'user', content: text, timestamp: now });
    } else if (msg.role === 'assistant') {
      const split = splitAssistantContent(msg.content);
      ompMessages.push({
        role: 'assistant',
        content: [
          ...(split.text ? [{ type: 'text' as const, text: split.text }] : []),
          ...split.toolCalls.map((call) => ({
            type: 'toolCall' as const,
            id: call.id,
            name: call.name,
            arguments: safeParseToolArguments(call.arguments) as Record<
              string,
              unknown
            >,
          })),
        ],
        api: model.api,
        provider: model.provider,
        model: model.id,
        timestamp: now,
      } as unknown as import('../omp-ai/types.js').Message);
    } else if (msg.role === 'tool') {
      ompMessages.push({
        role: 'toolResult',
        toolCallId: msg.toolCallId ?? '',
        toolName: msg.name ?? '',
        content: [{ type: 'text', text }],
        isError: false,
        timestamp: now,
      } as unknown as import('../omp-ai/types.js').Message);
    }
  }

  const context: import('../omp-ai/types.js').Context = {
    systemPrompt: systemPrompt ? [systemPrompt] : undefined,
    messages: ompMessages,
    tools: (gatedTools ?? []).map(
      (t) =>
        ({
          name: t.function.name,
          description: t.function.description ?? '',
          parameters: t.function.parameters,
        }) as unknown as import('../omp-ai/types.js').Tool,
    ),
  };

  const ompModel = {
    id: model.id,
    requestModelId: model.requestModelId,
    name: model.name ?? model.id,
    api: 'google-gemini-cli',
    provider: model.provider,
    baseUrl: model.baseUrl ?? gcli.DEFAULT_ENDPOINT,
    reasoning: model.reasoning,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  } as unknown as import('../omp-ai/types.js').Model<'google-gemini-cli'>;

  const effectiveToolChoice = resolveEffectiveToolChoice(
    resolveRouteToolPolicy(model),
    options.toolChoice,
    gatedTools?.length ?? 0,
  ).value;
  const nativeToolChoice:
    | 'auto'
    | 'none'
    | 'any'
    | { mode: 'ANY'; allowedFunctionNames: [string, ...string[]] }
    | undefined =
    effectiveToolChoice?.mode === 'none'
      ? 'none'
      : effectiveToolChoice?.mode === 'required'
        ? 'any'
        : effectiveToolChoice?.mode === 'named'
          ? {
              mode: 'ANY',
              allowedFunctionNames: [effectiveToolChoice.name],
            }
          : effectiveToolChoice?.mode === 'auto'
            ? 'auto'
            : undefined;

  let requestBody: unknown;
  try {
    requestBody = gcli.buildRequest(
      ompModel,
      context,
      projectId,
      { maxTokens, temperature, toolChoice: nativeToolChoice },
      isAntigravity,
    );
  } catch (err) {
    if (traceId) {
      const { traceAntigravityError } = await import('./antigravityTrace.js');
      traceAntigravityError({
        traceId,
        source,
        error: {
          code: 'REQUEST_BUILD_FAILED',
          message: (err as Error).message,
        },
      });
    }
    return {
      ok: false,
      error: {
        type: 'error',
        error: {
          code: 'REQUEST_BUILD_FAILED',
          message: `Failed to build ${model.provider} request: ${(err as Error).message}`,
        },
      },
    };
  }

  const baseUrl = (model.baseUrl ?? gcli.DEFAULT_ENDPOINT).replace(/\/+$/, '');
  const url = `${baseUrl}/v1internal:streamGenerateContent?alt=sse`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  if (isAntigravity) {
    headers['User-Agent'] = gcli.getAntigravityUserAgent();
  }

  const descriptor = { url, headers, body: requestBody };
  return { ok: true, descriptor };
}

export interface SafeFieldViolation {
  field: string;
  description?: string;
}

export interface SafeGoogleErrorDetails {
  code?: number;
  status?: string;
  reason?: string;
  domain?: string;
  detailTypes: string[];
  fieldViolations: SafeFieldViolation[];
  safeMessage?: string;
}

function sanitizeSafeText(str: string, maxLen = 200): string {
  if (!str) return '';
  return str
    .replace(/ya29\.[A-Za-z0-9_-]+/g, '[REDACTED_TOKEN]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, '[REDACTED_BEARER]')
    .replace(/projects\/[A-Za-z0-9._-]+/g, 'projects/[REDACTED]')
    .slice(0, maxLen);
}

function sanitizeSafeDescription(str: string): string {
  if (!str) return '';
  const sanitized = str
    .replace(/ya29\.[A-Za-z0-9_-]+/g, '[REDACTED_TOKEN]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, '[REDACTED_BEARER]')
    .replace(/projects\/[A-Za-z0-9._-]+/g, 'projects/[REDACTED]');
  return sanitized.length > 300 ? `${sanitized.slice(0, 300)}...` : sanitized;
}

export function extractSafeGoogleErrorDetails(
  bodyText: string,
): SafeGoogleErrorDetails {
  const result: SafeGoogleErrorDetails = {
    detailTypes: [],
    fieldViolations: [],
  };

  if (!bodyText || bodyText.trim().length === 0) return result;

  try {
    const parsed = JSON.parse(bodyText);
    const errObj = parsed?.error ?? parsed;
    if (!errObj || typeof errObj !== 'object') return result;

    if (typeof errObj.code === 'number') {
      result.code = errObj.code;
    }
    if (typeof errObj.status === 'string') {
      result.status = sanitizeSafeText(errObj.status, 100);
    }
    if (typeof errObj.message === 'string') {
      result.safeMessage = sanitizeSafeDescription(errObj.message);
    }

    if (Array.isArray(errObj.details)) {
      for (const d of errObj.details) {
        if (!d || typeof d !== 'object') continue;

        if (typeof d['@type'] === 'string') {
          const typeName = d['@type'].split('.').pop() ?? d['@type'];
          if (!result.detailTypes.includes(typeName)) {
            result.detailTypes.push(typeName);
          }
        }

        if (typeof d.reason === 'string') {
          result.reason = sanitizeSafeText(d.reason, 100);
        }
        if (typeof d.domain === 'string') {
          result.domain = sanitizeSafeText(d.domain, 100);
        }

        if (Array.isArray(d.fieldViolations)) {
          for (const fv of d.fieldViolations) {
            if (typeof fv?.field === 'string' && fv.field.length < 250) {
              const cleanField = sanitizeSafeText(fv.field, 250);
              const cleanDesc =
                typeof fv.description === 'string'
                  ? sanitizeSafeDescription(fv.description)
                  : undefined;
              result.fieldViolations.push({
                field: cleanField,
                ...(cleanDesc ? { description: cleanDesc } : {}),
              });
            }
          }
        }
      }
    }
  } catch {
    // Non-JSON response
  }

  return result;
}

export function formatSafeGoogleErrorSummary(
  details: SafeGoogleErrorDetails,
): string[] {
  const lines: string[] = [];
  if (details.status) {
    lines.push(`HTTP_ERROR_STATUS: ${details.status}`);
  }
  if (details.reason) {
    lines.push(`HTTP_ERROR_REASON: ${details.reason}`);
  }
  if (details.domain) {
    lines.push(`HTTP_ERROR_DOMAIN: ${details.domain}`);
  }
  if (details.fieldViolations.length > 0) {
    lines.push(`FIELD_VIOLATION_COUNT: ${details.fieldViolations.length}`);
    details.fieldViolations.forEach((fv, i) => {
      const descPart = fv.description ? `: ${fv.description}` : '';
      lines.push(`FIELD_VIOLATION_${i + 1}: ${fv.field}${descPart}`);
    });
  } else if (details.detailTypes.length > 0) {
    lines.push(`DETAIL_TYPES: ${details.detailTypes.join(', ')}`);
  }
  if (details.safeMessage) {
    lines.push(`HTTP_ERROR_MESSAGE: ${details.safeMessage}`);
  }
  return lines;
}

async function* googleCloudCodeAssistStream(
  options: PlumbStreamOptions,
): AsyncGenerator<PlumbStreamEvent> {
  const source = options.traceSource ?? 'NORMAL_CHAT';
  const traceId = antigravityTraceEnabled() ? makeAntigravityTraceId() : null;

  const result = await buildAntigravityRequest(options, traceId ?? undefined);
  if (!result.ok) {
    if (traceId) {
      traceAntigravity(
        `traceId=${traceId} build.result=FAILED code=${result.error.error?.code ?? '(unknown)'}`,
      );
    }
    yield result.error;
    return;
  }
  const { url, headers, body } = result.descriptor;

  if (traceId) {
    const { traceAntigravityFinalHttpRequest } = await import(
      './antigravityTrace.js'
    );
    traceAntigravityFinalHttpRequest({
      traceId,
      source,
      model: options.model,
      descriptor: result.descriptor,
      options,
      generatorInstance: options.generatorInstance,
    });
    for (const line of describeAntigravityRequestSafely(result.descriptor)) {
      traceAntigravity(`traceId=${traceId} ${line}`);
    }
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch (err) {
    if (traceId) {
      const { traceAntigravityError } = await import('./antigravityTrace.js');
      traceAntigravityError({
        traceId,
        source,
        error: {
          code: 'REQUEST_FAILED',
          message: (err as Error).message,
        },
      });
      traceAntigravity(
        `traceId=${traceId} request.attempted=true fetch.threw=true`,
      );
    }
    if ((err as Error).name === 'AbortError') {
      yield { type: 'done', finishReason: 'cancelled' };
      return;
    }
    yield {
      type: 'error',
      error: { code: 'REQUEST_FAILED', message: (err as Error).message },
    };
    return;
  }

  if (traceId) {
    const { traceAntigravityHttpResponse } = await import(
      './antigravityTrace.js'
    );
    traceAntigravityHttpResponse({
      traceId,
      source,
      response,
    });

    const traceHeaderNames = ['x-goog-trace-id', 'x-request-id', 'server'];
    const safeHeaders = traceHeaderNames
      .map((h) => `${h}=${response.headers.get(h) ?? '(absent)'}`)
      .join(' ');
    traceAntigravity(
      `traceId=${traceId} request.attempted=true HTTP.status=${response.status} HTTP.statusText=${response.statusText} HTTP.contentType=${response.headers.get('content-type') ?? '(none)'} ${safeHeaders}`,
    );
  }

  if (!response.ok) {
    let safeDetails: SafeGoogleErrorDetails | undefined;

    if (response.status >= 400 && response.status < 500) {
      try {
        const bodyText = await response.text();
        safeDetails = extractSafeGoogleErrorDetails(bodyText);
      } catch {
        // Ignored — non-JSON or unparseable 4xx response
      }
    }

    const safeStatus = safeDetails?.status;
    const safeReason = safeDetails?.reason;
    const firstViolation = safeDetails?.fieldViolations[0];
    const safeField = firstViolation
      ? `${firstViolation.field}${firstViolation.description ? `: ${firstViolation.description}` : ''}`
      : undefined;

    const code =
      response.status === 404
        ? 'ENDPOINT_NOT_FOUND'
        : safeStatus
          ? `HTTP_${response.status}_${safeStatus}`
          : `HTTP_${response.status}`;

    if (traceId) {
      traceAntigravity(
        `traceId=${traceId} http.status=${response.status} classification=${code} safeStatus=${safeStatus ?? '(none)'} safeReason=${safeReason ?? '(none)'} safeField=${safeField ?? '(none)'}`,
      );
    }

    const extraDetail = [safeStatus, safeReason, safeField]
      .filter(Boolean)
      .join(' - ');
    yield {
      type: 'error',
      error: {
        code,
        message: `${options.model.provider} request failed (HTTP ${response.status}${extraDetail ? ` - ${extraDetail}` : ''}).`,
      },
    };
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    yield {
      type: 'error',
      error: { code: 'NO_RESPONSE_BODY', message: 'No response body' },
    };
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let finishReason: string | undefined;
  let syntheticToolCallIndex = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);

        try {
          const parsed = JSON.parse(data);
          // Cloud Code Assist wraps the Gemini response shape under
          // `.response` (vs the public API's flat shape) — the only
          // structural difference from googleGenerativeAiStream's parsing.
          const candidate = parsed.response?.candidates?.[0];
          if (!candidate) continue;

          if (candidate.finishReason) {
            finishReason = candidate.finishReason;
          }

          const parts = candidate.content?.parts ?? [];
          for (const part of parts) {
            if (part.text) {
              yield { type: 'text', text: part.text };
            } else if (part.thought) {
              yield { type: 'thinking', thinkingText: part.thought };
            } else if (part.functionCall) {
              const nativeId = part.functionCall.id;
              const callId =
                typeof nativeId === 'string' && nativeId.length > 0
                  ? nativeId
                  : `${part.functionCall.name || 'tool'}__${++syntheticToolCallIndex}`;
              yield {
                type: 'tool_call',
                toolCall: {
                  id: callId,
                  name: part.functionCall.name,
                  arguments: JSON.stringify(part.functionCall.args ?? {}),
                },
              };
            }
          }

          const usageMetadata = parsed.response?.usageMetadata;
          if (usageMetadata) {
            yield {
              type: 'usage',
              usage: {
                inputTokens: usageMetadata.promptTokenCount ?? 0,
                outputTokens: usageMetadata.candidatesTokenCount ?? 0,
                reasoningTokens: usageMetadata.thoughtsTokenCount,
                totalTokens: usageMetadata.totalTokenCount ?? 0,
              },
            };
          }
        } catch {
          // Skip unparseable lines
        }
      }
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      // Graceful cancellation
    } else {
      yield {
        type: 'error',
        error: { code: 'STREAM_ERROR', message: (err as Error).message },
      };
      return;
    }
  } finally {
    reader.releaseLock();
  }

  yield { type: 'done', finishReason };
}

// ─── Google Gemini streaming ───────────────────────────────────────────

async function* googleGenerativeAiStream(
  options: PlumbStreamOptions,
): AsyncGenerator<PlumbStreamEvent> {
  const { model, messages, tools, apiKey, signal, systemPrompt } = options;

  const isVertex = model.provider === 'google-vertex';
  const customDefinition = getCustomProviderDefinition(model.provider);
  const isKeylessCustom = customDefinition?.credentialPlacement === 'none';
  if (!apiKey && !isVertex && !isKeylessCustom) {
    yield {
      type: 'error',
      error: {
        code: 'MISSING_CREDENTIAL',
        message: `No credential available for provider: ${model.provider}. Sign in again via /login ${model.provider}.`,
      },
    };
    return;
  }
  const baseUrl =
    model.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
  // Vertex authenticates via the Google OAuth Bearer token
  // plumbModelStream's Vertex prep step already put in model.headers --
  // never the direct Gemini API's `?key=` query-param scheme.
  const directUrl = `${baseUrl.replace(/\/+$/, '')}/models/${model.requestModelId ?? model.id}:streamGenerateContent?alt=sse`;
  const useQueryKey =
    !isVertex &&
    (!customDefinition || customDefinition.credentialPlacement === 'query-key');
  const url = useQueryKey
    ? `${directUrl}&key=${encodeURIComponent(apiKey)}`
    : directUrl;

  const contents = buildGeminiContents(messages);
  const body: Record<string, unknown> = {
    contents,
    generationConfig: {},
  };

  if (systemPrompt) {
    body.systemInstruction = {
      parts: [{ text: systemPrompt }],
    };
  }

  if (tools && tools.length > 0 && model.toolsSupported === true) {
    const functionDeclarations = tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    }));
    body.tools = [
      {
        functionDeclarations,
      },
    ];
    const effectiveChoice = resolveEffectiveToolChoice(
      resolveRouteToolPolicy(model),
      options.toolChoice,
      tools.length,
    );
    const geminiCallingConfig = effectiveChoice.value
      ? (serializeGeminiFunctionCallingConfig(effectiveChoice.value) as {
          mode?: string;
          allowedFunctionNames?: string[];
        })
      : undefined;
    if (geminiCallingConfig) {
      body.toolConfig = {
        functionCallingConfig: geminiCallingConfig,
      };
    }
    recordToolRouteRequest(
      tools.length,
      String(model.requestModelId ?? model.id),
      options,
      effectiveChoice.value,
      {
        requestFamily: 'google-gemini',
        endpointPath: `/models/${model.requestModelId ?? model.id}:streamGenerateContent`,
        toolSerializationShape: 'GEMINI_FUNCTION_DECLARATIONS',
        functionDeclarationCount: functionDeclarations.length,
        functionDeclarationNames: functionDeclarations.map((d) => d.name),
        functionCallingMode: geminiCallingConfig?.mode ?? 'absent',
        allowedFunctionNames: geminiCallingConfig?.allowedFunctionNames ?? [],
        toolConfigPresent: geminiCallingConfig !== undefined,
        toolsPresent: true,
      },
    );
  } else {
    recordToolRouteRequest(
      0,
      String(model.requestModelId ?? model.id),
      options,
      undefined,
      {
        requestFamily: 'google-gemini',
        endpointPath: `/models/${model.requestModelId ?? model.id}:streamGenerateContent`,
        toolSerializationShape: 'none',
        toolConfigPresent: false,
        toolsPresent: false,
      },
    );
  }

  let response: Response;
  try {
    const authHeaders: Record<string, string> = { ...(model.headers ?? {}) };
    if (customDefinition) {
      applyCustomCredentialHeader(
        authHeaders,
        customDefinition.credentialPlacement,
        apiKey,
      );
    }
    // Cross the instrumented network boundary only here, right before the
    // fetch that carries the serialized request.
    recordToolRouteNetworkStarted();
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      yield { type: 'done', finishReason: 'cancelled' };
      return;
    }
    yield {
      type: 'error',
      error: { code: 'NETWORK_ERROR', message: (err as Error).message },
    };
    return;
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    const safeDetails = extractSafeGoogleErrorDetails(errorText);
    const classified = classifyGoogleHttpError(
      response.status,
      errorText,
      safeDetails,
    );
    recordToolRouteHttpFailure(
      response.status,
      classified.code,
      safeDetails.fieldViolations.map((violation) => violation.field),
    );
    yield {
      type: 'error',
      error: classified,
    };
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    yield {
      type: 'error',
      error: { code: 'NO_RESPONSE_BODY', message: 'No response body' },
    };
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let finishReason: string | undefined;
  let syntheticToolCallIndex = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);

        try {
          const parsed = JSON.parse(data);
          const candidate = parsed.candidates?.[0];
          if (!candidate) continue;

          if (candidate.finishReason) {
            finishReason = candidate.finishReason;
          }

          const parts = candidate.content?.parts ?? [];
          for (const part of parts) {
            if (part.text) {
              yield { type: 'text', text: part.text };
            } else if (part.thought) {
              yield { type: 'thinking', thinkingText: part.thought };
            } else if (part.functionCall) {
              const nativeId = part.functionCall.id;
              const callId =
                typeof nativeId === 'string' && nativeId.length > 0
                  ? nativeId
                  : `${part.functionCall.name || 'tool'}__${++syntheticToolCallIndex}`;
              yield {
                type: 'tool_call',
                toolCall: {
                  id: callId,
                  name: part.functionCall.name,
                  arguments: JSON.stringify(part.functionCall.args ?? {}),
                },
              };
            }
          }

          if (parsed.usageMetadata) {
            yield {
              type: 'usage',
              usage: {
                inputTokens: parsed.usageMetadata.promptTokenCount ?? 0,
                outputTokens: parsed.usageMetadata.candidatesTokenCount ?? 0,
                reasoningTokens: parsed.usageMetadata.thoughtsTokenCount,
                totalTokens: parsed.usageMetadata.totalTokenCount ?? 0,
              },
            };
          }
        } catch {
          // Skip unparseable lines
        }
      }
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      // Graceful cancellation
    } else {
      yield {
        type: 'error',
        error: { code: 'STREAM_ERROR', message: (err as Error).message },
      };
      return;
    }
  } finally {
    reader.releaseLock();
  }

  yield { type: 'done', finishReason };
}

// ─── Ollama streaming ──────────────────────────────────────────────────

async function* ollamaCompatibleStream(
  options: PlumbStreamOptions,
): AsyncGenerator<PlumbStreamEvent> {
  const {
    model,
    messages,
    tools,
    apiKey,
    signal,
    systemPrompt,
    maxTokens,
    temperature,
  } = options;

  const baseUrl = model.baseUrl ?? 'http://127.0.0.1:11434/v1';
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const body: Record<string, unknown> = {
    model: model.requestModelId ?? model.id,
    messages: buildOpenAIMessages(messages, systemPrompt, !!model.reasoning),
    stream: true,
  };

  if (tools && tools.length > 0 && model.toolsSupported === true) {
    body.tools = tools.map((t) => ({
      type: 'function',
      function: t.function,
    }));
  }
  if (maxTokens) body.max_tokens = maxTokens;
  if (temperature !== undefined) body.temperature = temperature;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      yield { type: 'done', finishReason: 'cancelled' };
      return;
    }
    yield {
      type: 'error',
      error: { code: 'REQUEST_FAILED', message: (err as Error).message },
    };
    return;
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    yield {
      type: 'error',
      error: { code: `HTTP_${response.status}`, message: errorText },
    };
    return;
  }

  // Reuse OpenAI-compatible parser for Ollama
  const reader = response.body?.getReader();
  if (!reader) {
    yield {
      type: 'error',
      error: { code: 'NO_RESPONSE_BODY', message: 'No response body' },
    };
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let finishReason: string | undefined;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const choice = parsed.choices?.[0];
          const delta = choice?.delta;

          if (delta?.content) {
            yield { type: 'text', text: delta.content };
          }

          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (tc.function) {
                yield {
                  type: 'tool_call',
                  toolCall: {
                    id: tc.id ?? `call_${tc.index ?? 0}`,
                    name: tc.function.name ?? '',
                    arguments: tc.function.arguments ?? '',
                  },
                };
              }
            }
          }

          if (choice?.finish_reason) {
            finishReason = choice.finish_reason;
          }

          if (parsed.usage) {
            yield {
              type: 'usage',
              usage: {
                inputTokens: parsed.usage.prompt_tokens ?? 0,
                outputTokens: parsed.usage.completion_tokens ?? 0,
                totalTokens: parsed.usage.total_tokens ?? 0,
              },
            };
          }
        } catch {
          // Skip
        }
      }
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      // Graceful
    } else {
      yield {
        type: 'error',
        error: { code: 'STREAM_ERROR', message: (err as Error).message },
      };
      return;
    }
  } finally {
    reader.releaseLock();
  }

  yield { type: 'done', finishReason };
}

// ─── Message builders ──────────────────────────────────────────────────
//
// PlumbMessage.content is `string | PlumbContentPart[]` — the array form
// carries structured `tool_call`/`tool_result`/`image`/`thinking` parts
// (see types.ts). Every dialect below MUST reconstruct its own real wire
// shape for a tool-call/tool-result turn (OpenAI: assistant.tool_calls[] +
// a separate `tool` message keyed by tool_call_id; Anthropic: assistant
// tool_use content blocks + a user message carrying tool_result blocks;
// Gemini: functionCall/functionResponse parts) — flattening these into
// plain text (the previous behavior) silently breaks multi-turn tool use:
// an OpenAI-compatible endpoint rejects a `tool` role message whose
// `tool_call_id` doesn't reference a real preceding `tool_calls[].id`.

interface AssistantContentSplit {
  /** `undefined` when the assistant turn had no text (tool-call-only). */
  text: string | undefined;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
}

/**
 * Splits an assistant message's structured content into its text and
 * tool-call parts. Exported for reuse by transports whose wire format
 * needs the same split but a different final shape than
 * `buildOpenAIMessages` -- currently ociGenaiResponses.ts, whose Responses
 * API `input` array represents a prior tool call as its own flat
 * `function_call` item rather than Chat Completions' nested
 * `assistant.tool_calls[]` -- so there is exactly one place that walks
 * `PlumbContentPart[]` looking for tool-call parts, never a second copy.
 */
export function splitAssistantContent(
  content: PlumbStreamOptions['messages'][number]['content'],
): AssistantContentSplit {
  if (typeof content === 'string') {
    return { text: content || undefined, toolCalls: [] };
  }
  const textParts: string[] = [];
  const toolCalls: AssistantContentSplit['toolCalls'] = [];
  for (const part of content) {
    if (part.type === 'text' && part.text) {
      textParts.push(part.text);
    } else if (part.type === 'tool_call') {
      toolCalls.push({
        id: part.id,
        name: part.name,
        arguments: part.arguments,
      });
    }
    // 'thinking'/'image' parts are not resent as assistant history today —
    // no dialect here expects a prior turn's reasoning trace or an
    // assistant-authored image back on the wire.
  }
  return {
    text: textParts.length > 0 ? textParts.join('\n') : undefined,
    toolCalls,
  };
}

/**
 * Text-only projection of a message's content (system/tool-role turns).
 * Exported for reuse by ociGenaiResponses.ts -- see splitAssistantContent's
 * doc comment above.
 */
export function contentToText(
  content: PlumbStreamOptions['messages'][number]['content'],
): string {
  if (typeof content === 'string') return content;
  const pieces: string[] = [];
  for (const part of content) {
    if (part.type === 'text') pieces.push(part.text);
    else if (part.type === 'tool_result') pieces.push(part.result);
  }
  return pieces.join('\n');
}

/** OpenAI-shaped multimodal user content (falls back to a plain string). */
function buildOpenAIUserContent(
  content: PlumbStreamOptions['messages'][number]['content'],
): unknown {
  if (typeof content === 'string') return content;
  const hasImage = content.some((p) => p.type === 'image');
  if (!hasImage) return contentToText(content);
  const parts: unknown[] = [];
  for (const part of content) {
    if (part.type === 'text') {
      parts.push({ type: 'text', text: part.text });
    } else if (part.type === 'image') {
      parts.push({ type: 'image_url', image_url: { url: part.imageUrl } });
    }
  }
  return parts;
}

/**
 * Builds OpenAI Chat-Completions-shaped messages (assistant.tool_calls[],
 * tool.tool_call_id). Exported for reuse by transports whose wire format is
 * genuinely identical here — currently watsonx.ts, whose TextChatMessages
 * type is OpenAI-message-shaped (see the official SDK's messages.d.ts) —
 * so tool-call/tool-result history reconstruction has exactly one
 * implementation, never a second copy.
 */
export function buildOpenAIMessages(
  messages: PlumbStreamOptions['messages'],
  systemPrompt?: string,
  reasoningCapable?: boolean,
): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt });
  }
  for (const msg of messages) {
    if (msg.role === 'system') {
      result.push({ role: 'system', content: contentToText(msg.content) });
    } else if (msg.role === 'assistant') {
      const { text, toolCalls } = splitAssistantContent(msg.content);
      const entry: Record<string, unknown> = {
        role: 'assistant',
        content: text ?? null,
      };
      if (toolCalls.length > 0) {
        entry['tool_calls'] = toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        }));
      }
      // ── Reasoning content replay (OMP compat) ────────────────────
      //
      // OMP compat: requiresReasoningContentForToolCalls / requires
      // ReasoningContentForAllAssistantTurns for DeepSeek/Kimi
      // reasoning models. Without reasoning_content on assistant
      // tool-call messages, the provider may reject the request or
      // the model may not continue with structured tool calls.
      if (
        reasoningCapable &&
        typeof msg.content !== 'string' &&
        Array.isArray(msg.content)
      ) {
        const thinkingParts = msg.content.filter(
          (p) => p.type === 'thinking' && 'text' in p && p.text,
        );
        if (thinkingParts.length > 0) {
          entry['reasoning_content'] = thinkingParts
            .map((p) => ('text' in p ? p.text : ''))
            .join('\n');
        } else if (toolCalls.length > 0) {
          // Tier 2: no thinking blocks but provider requires
          // reasoning_content on tool-call turns. Emit empty string.
          entry['reasoning_content'] = '';
        }
      }
      // Some backends require non-null content on assistant tool-call
      // messages (OMP compat: requiresAssistantContentForToolCalls).
      if (entry.content === null && entry['tool_calls']) {
        entry.content = '';
      }
      result.push(entry);
    } else if (msg.role === 'user') {
      result.push({
        role: 'user',
        content: buildOpenAIUserContent(msg.content),
      });
    } else if (msg.role === 'tool') {
      result.push({
        role: 'tool',
        content: contentToText(msg.content),
        tool_call_id: msg.toolCallId,
      });
    }
  }
  return result;
}

function buildAnthropicMessage(
  msg: PlumbStreamOptions['messages'][number],
): Record<string, unknown> {
  if (msg.role === 'user') {
    if (typeof msg.content === 'string') {
      return { role: 'user', content: msg.content };
    }
    const blocks: unknown[] = [];
    for (const part of msg.content) {
      if (part.type === 'text' && part.text) {
        blocks.push({ type: 'text', text: part.text });
      } else if (part.type === 'image') {
        const dataUrl = /^data:([^;]+);base64,(.*)$/s.exec(part.imageUrl);
        blocks.push({
          type: 'image',
          source: dataUrl
            ? {
                type: 'base64',
                media_type: dataUrl[1],
                data: dataUrl[2],
              }
            : { type: 'url', url: part.imageUrl },
        });
      }
    }
    return { role: 'user', content: blocks };
  }
  if (msg.role === 'assistant') {
    if (typeof msg.content === 'string') {
      return { role: 'assistant', content: msg.content };
    }
    const blocks: unknown[] = [];
    for (const part of msg.content) {
      if (part.type === 'text' && part.text) {
        blocks.push({ type: 'text', text: part.text });
      } else if (part.type === 'tool_call') {
        blocks.push({
          type: 'tool_use',
          id: part.id,
          name: part.name,
          input: safeParseToolArguments(part.arguments),
        });
      }
    }
    return { role: 'assistant', content: blocks };
  }
  // Anthropic has no `tool` role — a tool result travels as a
  // `tool_result` content block inside a `user`-role message.
  if (msg.role === 'tool') {
    return {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: msg.toolCallId,
          content: contentToText(msg.content),
        },
      ],
    };
  }
  return {
    role: 'user',
    content: typeof msg.content === 'string' ? msg.content : '',
  };
}

function safeParseToolArguments(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function buildGeminiContents(
  messages: PlumbStreamOptions['messages'],
): Record<string, unknown>[] {
  const contents: Record<string, unknown>[] = [];
  for (const msg of messages) {
    if (msg.role === 'system') continue; // Handled by systemInstruction

    if (msg.role === 'tool') {
      // Gemini returns tool results as functionResponse parts inside a
      // `user`-role Content, not a distinct role.
      contents.push({
        role: 'user',
        parts: [
          {
            functionResponse: {
              id: msg.toolCallId,
              name: msg.name ?? '',
              response: { result: contentToText(msg.content) },
            },
          },
        ],
      });
      continue;
    }

    const role = msg.role === 'assistant' ? 'model' : 'user';
    const parts: unknown[] = [];
    if (typeof msg.content === 'string') {
      if (msg.content) parts.push({ text: msg.content });
    } else {
      for (const part of msg.content) {
        if (part.type === 'text' && part.text) {
          parts.push({ text: part.text });
        } else if (part.type === 'tool_call') {
          parts.push({
            functionCall: {
              id: part.id,
              name: part.name,
              args: safeParseToolArguments(part.arguments),
            },
          });
        } else if (part.type === 'image') {
          const dataUrl = /^data:([^;]+);base64,(.*)$/s.exec(part.imageUrl);
          parts.push({
            inlineData: {
              mimeType: dataUrl?.[1] ?? part.mimeType ?? 'image/png',
              data: dataUrl?.[2] ?? part.imageUrl,
            },
          });
        }
      }
    }
    if (parts.length === 0) continue; // Never send an empty Content.
    contents.push({ role, parts });
  }
  return contents;
}

// ─── Dispatch ──────────────────────────────────────────────────────────

/**
 * Stream content from the selected model through its registered transport.
 * Falls back to OpenAI-compatible if no specific transport is registered.
 */
export async function* plumbModelStream(
  options: PlumbStreamOptions,
): AsyncGenerator<PlumbStreamEvent> {
  let { model } = options;
  const api = model.api;

  // Every google-vertex catalog model (across all three dialects it uses --
  // google-vertex/anthropic-messages/openai-completions) carries a template
  // baseUrl with literal {project}/{location} placeholders and requires
  // Google OAuth Bearer auth, never the direct-API x-api-key/?key= schemes
  // the same dialects use elsewhere. Resolve that once here, before any
  // dialect-specific transport runs, so every one of them (unmodified)
  // receives an already-real, already-resolvable model descriptor.
  if (model.provider === 'google-vertex') {
    const prep = await prepareVertexModel(model, options.signal);
    // Record the preflight progression (or the exact failed boundary) into
    // the diagnostic snapshot BEFORE any error is yielded, so a pre-network
    // break (e.g. missing.project) is visible and never misread as a
    // serializer/wire rejection.
    recordVertexPreflight(prep);
    if (prep.error) {
      yield prep.error;
      return;
    }
    model = prep.model;
    options = { ...options, model };
  }

  // This is the single model-facing wire boundary. All registered and
  // fallback transports receive only this resolved list; therefore no
  // provider serializer can advertise a tool when the selected model is
  // unsupported or its capability metadata is UNKNOWN.
  const requestedToolCount = options.tools?.length ?? 0;
  const toolResolution = resolveAdvertisedTools(options);
  options = { ...options, tools: toolResolution.tools };
  if (
    model.toolsSupported === false &&
    requestedToolCount > 0 &&
    (options.tools?.length ?? 0) !== 0
  ) {
    yield {
      type: 'error',
      error: {
        code: 'TOOL_CAPABILITY_INVARIANT',
        message: 'Unsupported model reached the wire boundary with tools.',
      },
    };
    return;
  }

  // Global invariant — FORCED_SELECTOR_WITH_ZERO_TOOLS is forbidden. If a
  // forced tool-selection control (required/named, or the auto selector a
  // REQUIRED_WHEN_TOOLS_PRESENT route demands) is requested/emitted while
  // zero tools are actually serialized on the wire, fail locally here BEFORE
  // any provider-specific serialization or network I/O. This deterministically
  // rejects the Vertex `request.tools.count=0` and Copilot selector-with-no-
  // matching-tools contradictions with a safe, non-network diagnostic.
  const serializedToolCount = options.tools?.length ?? 0;
  const wirePolicy = resolveRouteToolPolicy(options.model);
  const wireEffective = resolveEffectiveToolChoice(
    wirePolicy,
    options.toolChoice,
    serializedToolCount,
  );
  const guard = resolveForcedSelectorWithToolsGuard(
    wirePolicy,
    options.toolChoice,
    wireEffective,
    serializedToolCount,
  );
  if (!guard.ok) {
    yield {
      type: 'error',
      error: {
        code: guard.code,
        message: guard.message ?? 'Forced selector emitted with zero tools.',
      },
    };
    return;
  }

  // Try registered transport first
  const factory = transportFactories.get(api);
  if (factory) {
    yield* factory(options);
    return;
  }

  // Fall back based on API type. Every PlumbKnownApi member must have an
  // explicit case here (either a real transport or a deliberate,
  // documented OpenAI-compatible alias) -- the generic passthrough is never
  // a silent default. This is the direct fix for the class of bug the
  // Bedrock/Azure incidents exposed: an unregistered/misrouted dialect
  // silently sending one provider's credential to a generic
  // `{baseUrl}/chat/completions` endpoint that was never that provider's
  // real API. `_exhaustiveApiCheck` fails the TypeScript build (not just a
  // runtime error) the moment a new PlumbKnownApi member is added without
  // a case here.
  switch (api) {
    case 'anthropic-messages':
      yield* anthropicMessagesStream(options);
      break;
    case 'google-gemini-cli':
      // Covers both google-gemini-cli and google-antigravity providers —
      // see googleCloudCodeAssistStream's comment for why this must not
      // share googleGenerativeAiStream (public-API-only) below.
      yield* googleCloudCodeAssistStream(options);
      break;
    case 'google-generative-ai':
    case 'google-vertex':
      yield* googleGenerativeAiStream(options);
      break;
    case 'ollama-chat':
      yield* ollamaCompatibleStream(options);
      break;
    // Deliberate, tested OpenAI-Chat-Completions-compatible aliases --
    // never an unexamined default.
    case 'openai-completions':
    case 'openrouter':
    case 'cursor-agent':
    case 'devin-agent':
    case 'gitlab-duo-agent':
      yield* openAICompatibleStream(options);
      break;
    case 'claude-agent-sdk':
    case 'openai-responses':
    case 'openai-codex-responses':
    case 'watsonx-chat':
    case 'oci-openai-responses':
    case 'bedrock-converse-stream':
    case 'azure-openai-responses':
      // Always caught by the registered-transport check above; listed here
      // only so the exhaustiveness check below covers every PlumbKnownApi
      // member even if a registration were ever accidentally removed.
      yield {
        type: 'error',
        error: {
          code: 'TRANSPORT_NOT_REGISTERED',
          message: `Provider dialect '${api}' has no registered transport and is not a safe OpenAI-compatible alias. Refusing to send credentials to a generic endpoint.`,
        },
      };
      break;
    default: {
      const _exhaustiveApiCheck: never = api;
      yield {
        type: 'error',
        error: {
          code: 'TRANSPORT_NOT_REGISTERED',
          message: `Unknown provider dialect '${String(_exhaustiveApiCheck)}' has no registered transport and is not a safe OpenAI-compatible alias. Refusing to send credentials to a generic endpoint.`,
        },
      };
      break;
    }
  }
}

// ─── Register built-in transports ──────────────────────────────────────

// OpenAI-compatible (covers most providers)
registerPlumbTransport('openai-completions', openAICompatibleStream);
registerPlumbTransport('openrouter', openAICompatibleStream);
registerPlumbTransport('openai-responses', streamOpenAIResponses);
// Codex/Copilot Responses-family routes must use the native `/responses`
// envelope (input + flat tools + Responses-native tool_choice) — NOT the
// Chat-Completions envelope, which rejects both the flat tool shape and the
// object-form selector as INVALID_REQUEST.
registerPlumbTransport('openai-codex-responses', streamOpenAIResponses);

// Anthropic
registerPlumbTransport('anthropic-messages', anthropicMessagesStream);
registerPlumbTransport('claude-agent-sdk', streamClaudeSubscription);
registerPlumbTransport('watsonx-chat', streamWatsonx);
registerPlumbTransport('oci-openai-responses', streamOciGenaiResponses);
registerPlumbTransport('bedrock-converse-stream', streamBedrockConverse);
registerPlumbTransport('azure-openai-responses', streamAzureResponses);

// Google
registerPlumbTransport('google-generative-ai', googleGenerativeAiStream);

// Local
// Ollama's advertised OpenAI-compatible Chat Completions surface uses the
// same SSE/tool/reasoning/usage contract as the generic parser. Keeping a
// second parser here previously lost fragmented tools, thinking tokens,
// structured-output controls, timeout classification, and mid-stream aborts.
registerPlumbTransport('ollama-chat', openAICompatibleStream);

// Passthrough for specialized APIs (handled by downstream code).
// openai-codex-responses is deliberately NOT here: it is registered above to
// the native Responses transport so the Codex/Copilot route gets the real
// `/responses` envelope instead of the Chat-Completions one.
registerPlumbTransport('cursor-agent', openAICompatibleStream);
registerPlumbTransport('devin-agent', openAICompatibleStream);
registerPlumbTransport('gitlab-duo-agent', openAICompatibleStream);

// ─── OMP stream-normalization delegate ──────────────────────────────────

/** Create a PLUMB-typed event stream backed by the OMP normalization engine. */
export function createNormalizationStream(): EventStream<
  PlumbStreamEvent,
  void
> {
  return new EventStream<PlumbStreamEvent, void>(
    (e) => e.type === 'done' || e.type === 'error',
    () => undefined as void,
  );
}

/**
 * The canonical no-args probe tool PLUMB advertises for structured-tool route
 * diagnostics. Serialized identically by every dialect transport as the
 * native equivalent of `plumb_tool_probe`.
 */
export const CANONICAL_PROBE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'plumb_tool_probe',
    description:
      'Runs a deterministic diagnostic with no filesystem, process, or network side effects.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
};
