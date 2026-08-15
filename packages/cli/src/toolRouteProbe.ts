/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  buildEffectiveToolRouteContract,
  initToolRouteDiag,
  getLastToolRouteDiag,
  getPlumbModelRegistry,
  getPlumbProviderProtocolMatrix,
  getPlumbProvider,
  getPlumbProviderRegistry,
  plumbModelStream,
  enableToolRouteDiag,
  resolveEffectiveToolChoice,
  resolveRouteToolPolicy,
  deriveDialectToolChoiceCapability,
  deriveRouteToolChoiceCapability,
  resolveHonestProbeToolChoice,
  describeToolChoiceValue,
  classifyBatchResult,
  computeBatchBreakdown,
  isLocalProvider,
  resolveProbeAuthorityDecision,
  resolveModelAuthorityDimensions,
  type ClassifiedBatchResult,
  type PlumbContentPart,
  type PlumbEffectiveToolRouteContract,
  type PlumbModel,
  type PlumbStreamEvent,
  type PlumbToolChoice,
  type ResolvedModelSelection,
} from '@plumb/provider';
import {
  Config,
  CANONICAL_NO_ARGS_SCHEMA,
  MessageBus,
  PlumbToolProbe,
  PLUMB_TOOL_PROBE_NAME,
  PLUMB_TOOL_PROBE_RESULT,
  PolicyDecision,
  Scheduler,
  ToolRegistry,
  type AgentLoopContext,
  type ToolCallRequestInfo,
  writeToStdout,
} from '@plumb/core';

function line(key: string, value: unknown): void {
  writeToStdout(`${key}: ${String(value)}\n`);
}

/**
 * Honest provenance of the tool-choice selector actually emitted by a probe.
 * `HONEST_AUTO_FALLBACK_UNVERIFIED_ROUTE` is the critical case: the route has
 * no VERIFIED forced/named proof, so the probe deliberately degrades to auto
 * and must never pretend the FORCED probe actually forced anything.
 */
export function toolChoiceSentSource(
  requested: PlumbToolChoice | undefined,
  effective: {
    readonly value?: PlumbToolChoice;
    readonly sent: boolean;
    readonly downgraded: boolean;
  },
  routeVerified: boolean,
): string {
  if (!effective.sent) return 'ABSENT';
  if (effective.downgraded) return 'DOWNGRADED';
  switch (effective.value?.mode) {
    case 'named':
      return routeVerified ? 'VERIFIED_ROUTE_NAMED' : 'UNVERIFIED_ROUTE_NAMED';
    case 'required':
      return routeVerified
        ? 'VERIFIED_ROUTE_REQUIRED'
        : 'UNVERIFIED_ROUTE_REQUIRED';
    case 'auto':
      if (requested?.mode === 'auto') {
        return routeVerified
          ? 'VERIFIED_ROUTE_AUTO'
          : 'HONEST_AUTO_FALLBACK_UNVERIFIED_ROUTE';
      }
      return 'POLICY_AUTO_FALLBACK';
    case 'none':
      return 'REQUESTED_NONE';
    default:
      return 'UNKNOWN';
  }
}

/**
 * Requested vs. effective force. A route/dialect downgrade (e.g. an
 * unverified route falling back to `auto`) must never be reported as if the
 * originally requested forced/named selector actually went out on the wire.
 */
export function computeProbeForce(
  requestedChoice: PlumbToolChoice | undefined,
  effective: {
    readonly value?: PlumbToolChoice;
    readonly sent: boolean;
    readonly downgraded: boolean;
  },
): { forceRequested: boolean; forceEffective: boolean } {
  const forceRequested =
    requestedChoice?.mode === 'required' || requestedChoice?.mode === 'named';
  const forceEffective =
    !effective.downgraded &&
    (effective.value?.mode === 'required' || effective.value?.mode === 'named');
  return { forceRequested, forceEffective };
}

/** Structured probe outcome consumed by the honest batch classification. */
export interface ToolRouteProbeOutcome {
  readonly provider: string;
  readonly exitCode: number;
  readonly code: string;
  readonly structuredToolCalls: boolean;
  /** Full structural protocol proof — optional so legacy/test callers that
   * only supply the boolean above keep working. When present, batch
   * classification requires the whole chain before reporting PASS. */
  readonly normalizedToolCalls?: number;
  readonly schedulerExecutions?: number;
  readonly toolResults?: number;
  readonly resultReinjected?: boolean;
  readonly continuationCompleted?: boolean;
  /** What tool-choice selector the probe intended to send vs. what was
   * actually sent after route/dialect downgrade. */
  readonly forceRequested?: boolean;
  readonly forceEffective?: boolean;
}

interface ResolvedToolRoute {
  model: PlumbModel;
  apiKey: string;
  selection: ResolvedModelSelection;
}

/** Honest, non-generic failure to resolve a route — never flattened to a
 * single opaque code. Carries the exact canonical classification. */
interface UnresolvedToolRoute {
  failureCode: string;
}

/**
 * Canonical route resolution pipeline. This is the ONE place that runs
 * discovery and applies `resolveProbeAuthorityDecision` before ever calling
 * `resolveModelSelection` — the single-provider probe (`--test-tool-route`)
 * and the batch probe (`--test-tool-routes`) both funnel through it so they
 * can never diverge on model authority or classification.
 */
async function resolveToolRoute(
  providerId: string,
  requestedModel: string | undefined,
  refreshModels: boolean,
): Promise<ResolvedToolRoute | UnresolvedToolRoute | undefined> {
  if (!getPlumbProvider(providerId)) return undefined;

  const providerRegistry = getPlumbProviderRegistry();
  await providerRegistry.initialize();
  const local = isLocalProvider(providerId);
  const credential = providerRegistry.getProviderState(providerId)?.credentials;
  let apiKey = '';
  if (refreshModels) {
    try {
      apiKey =
        (await providerRegistry.getApiKey(providerId)) ??
        (credential?.type === 'oauth' ? credential.access : '');
    } catch {
      apiKey = credential?.type === 'oauth' ? credential.access : '';
    }
  }
  const modelRegistry = getPlumbModelRegistry();

  // Hydrate the canonical discovered-model registry from any on-disk cache
  // BEFORE anything else. This is a synchronous, no-network read — it must
  // run for explicit and modeless requests alike, so a model already
  // cached from a prior discovery is never invisible to
  // resolveModelSelection merely because this call path skips (or has not
  // yet reached) a live discovery attempt. Network discovery and cache
  // hydration converge into the same discovered-model map either way.
  if (modelRegistry.hasDiscoveryCapability(providerId)) {
    modelRegistry.loadCache(providerId);
  }

  // Same canonical sequence the batch probe runs: attempt authoritative
  // discovery (when capable) BEFORE reading any authority state, then gate
  // on resolveProbeAuthorityDecision. Explicit --model skips this — an
  // explicit request is always allowed to attempt the probe.
  if (refreshModels && !requestedModel) {
    if (modelRegistry.hasDiscoveryCapability(providerId)) {
      try {
        await modelRegistry.attemptAuthoritativeDiscovery(
          providerId,
          apiKey || undefined,
        );
      } catch {
        // Discovery failure leaves stats in an honest non-empty or empty state.
      }
    }
    const stats = modelRegistry.getModelAuthorityStats(providerId);
    const decision = resolveProbeAuthorityDecision({
      discoveryState: stats.discoveryState,
      explicitModelRequested: false,
      isLocalProvider: local,
      bundledFallbackCount: stats.bundledFallbackCount,
      liveDiscoveryCount: stats.liveDiscoveryCount,
    });
    if (!decision.probeAllowed) {
      return { failureCode: decision.classificationCode };
    }
  }

  const selection = modelRegistry.resolveModelSelection({
    providerId,
    requestedModel,
    configuredModel: modelRegistry.getDefaultModel() ?? undefined,
    probeTools: true,
  });

  if (!selection.model) {
    return {
      failureCode:
        selection.fallbackReason === 'discovery_empty_live_model_unresolved'
          ? 'LIVE_MODEL_UNRESOLVED'
          : 'ROUTE_NOT_FOUND',
    };
  }
  return { model: selection.model, apiKey, selection };
}

function capabilityLines(
  prefix: string,
  capability: { status: string; source: string },
): void {
  line(`${prefix}.status`, capability.status);
  line(`${prefix}.source`, capability.source);
}

/**
 * Print the static effective route contract. This performs no provider request
 * and deliberately reports endpoint presence rather than an endpoint value.
 */
export async function diagnoseToolRoute(
  providerId: string | undefined,
  requestedModel?: string,
): Promise<number> {
  line('diagnostic.mode', 'AUTO_ROUTE_CONTRACT');
  if (!providerId) {
    line('result', 'PROVIDER_REQUIRED');
    return 1;
  }

  let resolved: ResolvedToolRoute | UnresolvedToolRoute | undefined;
  try {
    // Diagnostics must not turn into a discovery request. They inspect only
    // the already configured/catalogued route.
    resolved = await resolveToolRoute(providerId, requestedModel, false);
  } catch {
    line('provider', providerId);
    line('result', 'ROUTE_RESOLUTION_FAILED');
    return 1;
  }
  if (!resolved) {
    line('provider', providerId);
    if (requestedModel) line('model', requestedModel);
    line('result', 'ROUTE_NOT_FOUND');
    return 1;
  }
  if ('failureCode' in resolved) {
    line('provider', providerId);
    if (requestedModel) line('model', requestedModel);
    line('result', resolved.failureCode);
    return 1;
  }

  const contract = buildEffectiveToolRouteContract({
    providerId,
    model: resolved.model,
  });
  printToolRouteContract(contract);
  line('model.selection.source', resolved.selection.source);
  line(
    'model.selection.displayId',
    resolved.selection.displayId ?? resolved.model.id,
  );
  line(
    'model.selection.wireId',
    resolved.selection.wireId ?? contract.scope.wireModelId,
  );
  line(
    'model.selection.providerAuthorityMatch',
    resolved.selection.providerAuthorityMatch,
  );
  line(
    'model.selection.liveAuthorityMatch',
    resolved.selection.liveAuthorityMatch,
  );
  line('model.selection.routeAuthority', resolved.selection.routeAuthority);
  line(
    'model.selection.routeAuthoritySource',
    resolved.selection.routeAuthoritySource,
  );
  line(
    'model.selection.routeMismatchReason',
    resolved.selection.routeMismatchReason ?? 'NONE',
  );
  line('model.selection.fallbackReason', resolved.selection.fallbackReason);

  const matrix = getPlumbProviderProtocolMatrix();
  const matrixRow = matrix.providers.find(
    (row) => row.providerId === providerId,
  );
  line('matrix.registeredProviders', matrix.counts.registeredProviders);
  line('matrix.selectableProviders', matrix.counts.selectableProviders);
  line('matrix.providerRows', matrix.counts.providerRows);
  line('matrix.modelRoutes', matrix.counts.modelRoutes);
  line('matrix.provider.present', matrixRow !== undefined);
  if (matrixRow) {
    line('matrix.provider.selectable', matrixRow.selectable);
    line('matrix.provider.modelRoutes', matrixRow.modelRouteCount);
    line(
      'matrix.provider.baseModelTools.supported',
      matrixRow.baseModelTools.supported,
    );
    line(
      'matrix.provider.baseModelTools.unsupported',
      matrixRow.baseModelTools.unsupported,
    );
    line(
      'matrix.provider.baseModelTools.unknown',
      matrixRow.baseModelTools.unknown,
    );
  }
  line('AUTO_TOOL_SELECTION_WORKS', 'UNKNOWN_NOT_LIVE_TESTED');
  line('FORCED_STRUCTURED_TOOL_PROTOCOL_WORKS', 'NOT_TESTED_BY_DIAGNOSIS');
  line('result', 'ROUTE_CONTRACT_RESOLVED');
  return 0;
}

function printToolRouteContract(
  contract: PlumbEffectiveToolRouteContract,
): void {
  line('provider', contract.scope.providerId);
  line('model', contract.scope.modelId);
  line('wireModel', contract.scope.wireModelId);
  line('dialect', contract.scope.dialect);
  line('endpoint.family', contract.scope.endpoint.family);
  line('endpoint.path', contract.scope.endpoint.path);
  line('endpoint.source', contract.scope.endpoint.source);
  line('endpoint.baseUrl.present', Boolean(contract.scope.endpoint.baseUrl));
  capabilityLines('baseModelTools', contract.baseModelTools);
  line('structuredProtocol.kind', contract.structuredProtocol.kind);
  capabilityLines('structuredProtocol', contract.structuredProtocol.capability);
  line('toolChoice.emission', contract.toolChoice.emission);
  capabilityLines('toolChoice.auto', contract.toolChoice.auto);
  capabilityLines('toolChoice.required', contract.toolChoice.required);
  capabilityLines('toolChoice.named', contract.toolChoice.named);
  capabilityLines('strictToolSchema', contract.strictToolSchema);
  capabilityLines('parallelToolCalls', contract.parallelToolCalls);
  capabilityLines('reasoningWithTools', contract.reasoningWithTools);
  capabilityLines('parser', contract.parser.capability);
  capabilityLines('parser.fragmentAssembly', contract.parser.fragmentAssembly);
  capabilityLines(
    'parser.callIdPreservation',
    contract.parser.callIdPreservation,
  );
  capabilityLines('replay', contract.replay.capability);
  capabilityLines(
    'replay.assistantToolCalls',
    contract.replay.assistantToolCalls,
  );
  capabilityLines('replay.toolResults', contract.replay.toolResults);
}

export async function runToolRouteProbeResult(
  providerId: string,
  requestedModel?: string,
): Promise<ToolRouteProbeOutcome> {
  let resolved: ResolvedToolRoute | UnresolvedToolRoute | undefined;
  try {
    resolved = await resolveToolRoute(providerId, requestedModel, true);
  } catch {
    line('diagnostic.mode', 'FORCED_STRUCTURED_TOOL_PROBE');
    line('provider', providerId);
    line('result', 'ROUTE_RESOLUTION_FAILED');
    return {
      provider: providerId,
      exitCode: 1,
      code: 'ROUTE_RESOLUTION_FAILED',
      structuredToolCalls: false,
      normalizedToolCalls: 0,
      schedulerExecutions: 0,
      toolResults: 0,
      resultReinjected: false,
      continuationCompleted: false,
      forceRequested: false,
      forceEffective: false,
    };
  }
  if (!resolved) {
    line('diagnostic.mode', 'FORCED_STRUCTURED_TOOL_PROBE');
    line('provider', providerId);
    line('result', 'ROUTE_NOT_FOUND');
    return {
      provider: providerId,
      exitCode: 1,
      code: 'ROUTE_NOT_FOUND',
      structuredToolCalls: false,
      normalizedToolCalls: 0,
      schedulerExecutions: 0,
      toolResults: 0,
      resultReinjected: false,
      continuationCompleted: false,
      forceRequested: false,
      forceEffective: false,
    };
  }
  if ('failureCode' in resolved) {
    line('diagnostic.mode', 'FORCED_STRUCTURED_TOOL_PROBE');
    line('provider', providerId);
    line('result', resolved.failureCode);
    return {
      provider: providerId,
      exitCode: 1,
      code: resolved.failureCode,
      structuredToolCalls: false,
      normalizedToolCalls: 0,
      schedulerExecutions: 0,
      toolResults: 0,
      resultReinjected: false,
      continuationCompleted: false,
      forceRequested: false,
      forceEffective: false,
    };
  }
  const { model, apiKey } = resolved;
  const routeContract = buildEffectiveToolRouteContract({ providerId, model });
  const policy = resolveRouteToolPolicy(model);
  // DIALECT vs ROUTE separation: the dialect serializer may REPORT
  // SUPPORTED for forced/named selectors, but that does not prove the
  // provider route accepts them. Without VERIFIED route proof we must NOT
  // fabricate named/required support — an honest probe falls back to `auto`
  // (or omits the selector) and reports the route cannot be deterministically
  // forced.
  const dialect = deriveDialectToolChoiceCapability(policy);
  const route = deriveRouteToolChoiceCapability(model.provider, dialect);
  const requestedChoice: PlumbToolChoice | undefined =
    resolveHonestProbeToolChoice(
      route,
      policy.forcedToolChoiceSupported,
      policy.namedToolChoiceSupported,
    );
  line('toolChoice.dialect.required', dialect.required);
  line('toolChoice.dialect.named', dialect.named);
  line('toolChoice.route.required', route.required);
  line('toolChoice.route.named', route.named);
  line('toolChoice.route.proof', route.providerProof);
  line('toolChoice.route.verifiable', route.routeVerified);
  const effective = resolveEffectiveToolChoice(policy, requestedChoice, 1);
  const config = new Config({
    sessionId: 'plumb-tool-route-probe',
    targetDir: process.cwd(),
    cwd: process.cwd(),
    debugMode: false,
    model: model.id,
    interactive: false,
    enableHooks: false,
    policyEngineConfig: { defaultDecision: PolicyDecision.ALLOW },
    telemetry: { enabled: false },
  });
  const messageBus = new MessageBus(config.getPolicyEngine());
  const registry = new ToolRegistry(config, messageBus);
  const probe = new PlumbToolProbe(messageBus);
  registry.registerTool(probe);
  const context = {
    config,
    promptId: 'plumb-tool-route-probe',
    toolRegistry: registry,
    messageBus,
    promptRegistry: config.getPromptRegistry(),
    resourceRegistry: config.getResourceRegistry(),
    geminiClient: config.getPlumbClient(),
    sandboxManager: config.sandboxManager,
  } satisfies AgentLoopContext;
  const scheduler = new Scheduler({
    context,
    messageBus,
    getPreferredEditor: () => undefined,
    schedulerId: 'plumb-tool-route-probe',
  });
  // Single lifecycle-aborted controller. The tool executor must never create a
  // dangling, never-closed AbortController per schedule — that leaves an async
  // handle open across process shutdown (the Windows libuv `UV_HANDLE_CLOSING`
  // assert source) when the request errors, prints, and exits.
  const probeAbort = new AbortController();
  const tool = {
    type: 'function' as const,
    function: {
      name: PLUMB_TOOL_PROBE_NAME,
      description: probe.description,
      parameters: CANONICAL_NO_ARGS_SCHEMA,
    },
  };
  const calls: Array<{ id: string; name: string; arguments: string }> = [];
  let safeError = 'none';
  const probeId = `probe-${providerId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  enableToolRouteDiag();
  initToolRouteDiag(probeId);
  try {
    for await (const event of plumbModelStream({
      model,
      messages: [{ role: 'user', content: 'Run the diagnostic tool.' }],
      tools: [tool],
      toolChoice: effective.value,
      apiKey,
      maxTokens: 64,
      probeId,
    })) {
      if (event.type === 'tool_call' && event.toolCall)
        calls.push(event.toolCall);
      if (event.type === 'error')
        safeError = event.error?.code ?? 'PROVIDER_ERROR';
    }
  } catch (err) {
    safeError =
      err instanceof Error && err.name === 'AbortError'
        ? 'CANCELLED'
        : 'PROBE_ERROR';
  }
  // Capture the first request before the continuation request resets the
  // transport diagnostic snapshot. This contains structural counters only.
  const firstResponseDiag = getLastToolRouteDiag(probeId);
  const requests: ToolCallRequestInfo[] = calls.map((call) => ({
    callId: call.id,
    name: call.name,
    args: safeParseArgs(call.arguments),
    isClientInitiated: false,
    prompt_id: 'plumb-tool-route-probe',
  }));
  let completed: Awaited<ReturnType<Scheduler['schedule']>> = [];
  try {
    completed = requests.length
      ? await scheduler.schedule(requests, probeAbort.signal)
      : [];
  } catch (err) {
    if (safeError === 'none')
      safeError =
        err instanceof Error && err.name === 'AbortError'
          ? 'CANCELLED'
          : 'SCHEDULER_ERROR';
  }
  let resultReinjected = false;
  let continuationCompleted = false;
  if (completed.length) {
    const assistantParts: PlumbContentPart[] = calls.map((call, index) => ({
      type: 'tool_call',
      id: requests[index].callId,
      name: call.name,
      arguments: call.arguments,
    }));
    const toolMessages = completed.map((item) => ({
      role: 'tool' as const,
      content: PLUMB_TOOL_PROBE_RESULT,
      name: item.request.name,
      toolCallId: item.request.callId,
    }));
    // The second provider request below is constructed with the structured
    // assistant calls plus their matching tool-result messages. Reaching this
    // boundary proves PLUMB reinjection; continuation remains a separate
    // observation and requires non-empty assistant text.
    resultReinjected = true;
    try {
      for await (const event of plumbModelStream({
        model,
        messages: [
          { role: 'user', content: 'Run the diagnostic tool.' },
          { role: 'assistant', content: assistantParts },
          ...toolMessages,
        ],
        tools: [tool],
        apiKey,
        maxTokens: 64,
        probeId,
      })) {
        if (isCompletedToolContinuationEvent(event))
          continuationCompleted = true;
        if (event.type === 'error')
          safeError = event.error?.code ?? 'PROVIDER_ERROR';
      }
    } catch (err) {
      // A failed continuation must not retract the reinjection observation:
      // the second request was still constructed and issued with the tool
      // result. Only the error classification may be updated here.
      if (safeError === 'none')
        safeError =
          err instanceof Error && err.name === 'AbortError'
            ? 'CANCELLED'
            : 'REINJECT_ERROR';
    }
  }
  // Dispose exactly once, always, and abort the shared controller so no async
  // handle survives into process shutdown.
  probeAbort.abort();
  scheduler.dispose();

  line('diagnostic.mode', 'FORCED_STRUCTURED_TOOL_PROBE');
  line('provider', providerId);
  line('model', model.id);
  line('wireModel', routeContract.scope.wireModelId);
  line('model.selection.source', resolved.selection.source);
  line('model.selection.displayId', resolved.selection.displayId ?? model.id);
  line(
    'model.selection.wireId',
    resolved.selection.wireId ?? routeContract.scope.wireModelId,
  );
  line(
    'model.selection.providerAuthorityMatch',
    resolved.selection.providerAuthorityMatch,
  );
  line(
    'model.selection.liveAuthorityMatch',
    resolved.selection.liveAuthorityMatch,
  );
  line('model.selection.routeAuthority', resolved.selection.routeAuthority);
  line(
    'model.selection.routeAuthoritySource',
    resolved.selection.routeAuthoritySource,
  );
  line(
    'model.selection.routeMismatchReason',
    resolved.selection.routeMismatchReason ?? 'NONE',
  );
  line('model.selection.fallbackReason', resolved.selection.fallbackReason);
  line('dialect', model.api);
  line('endpoint.family', routeContract.scope.endpoint.family);
  line('structuredToolProtocol.policy', routeContract.structuredProtocol.kind);
  line(
    'structuredToolProtocol.status',
    routeContract.structuredProtocol.capability.status,
  );
  line('toolChoicePolicy', policy.emission);
  line(
    'toolChoiceSent',
    firstResponseDiag?.['toolChoiceSent'] ?? effective.sent,
  );
  // Honest selector provenance: what category was actually serialized and
  // where the decision came from. Never prompt/credential content.
  line(
    'toolChoice.sent.category',
    firstResponseDiag?.['toolChoiceValueCategory'] ??
      describeToolChoiceValue(effective.value),
  );
  line(
    'toolChoice.sent.source',
    toolChoiceSentSource(requestedChoice, effective, route.routeVerified),
  );
  const { forceRequested, forceEffective } = computeProbeForce(
    requestedChoice,
    effective,
  );
  line('probe.forceRequested', forceRequested);
  line('probe.forceEffective', forceEffective);
  line('request.tools.count', firstResponseDiag?.['requestToolsCount'] ?? 0);
  // Safe wire-proof structural facts recorded by the transport immediately
  // before network. Counts/paths/shapes only — no prompt, credential, or
  // arguments.
  line(
    'wire.requestFamily',
    firstResponseDiag?.['requestFamily'] ?? 'not_recorded',
  );
  line(
    'wire.endpointPath',
    firstResponseDiag?.['endpointPath'] ?? 'not_recorded',
  );
  line(
    'wire.toolSerializationShape',
    firstResponseDiag?.['toolSerializationShape'] ?? 'not_recorded',
  );
  line('wire.httpStatus', firstResponseDiag?.['httpStatus'] ?? 0);
  line(
    'wire.upstreamErrorCode',
    firstResponseDiag?.['upstreamErrorCode'] ?? 'none',
  );
  line(
    'wire.upstreamFieldViolations',
    JSON.stringify(firstResponseDiag?.['upstreamErrorFieldViolations'] ?? []),
  );
  line(
    'vertex.functionDeclarationCount',
    firstResponseDiag?.['functionDeclarationCount'] ?? 0,
  );
  line(
    'vertex.functionDeclarationNames',
    JSON.stringify(firstResponseDiag?.['functionDeclarationNames'] ?? []),
  );
  line(
    'vertex.functionCallingMode',
    firstResponseDiag?.['functionCallingMode'] ?? 'absent',
  );
  line(
    'vertex.allowedFunctionNamesCount',
    firstResponseDiag?.['allowedFunctionNamesCount'] ?? 0,
  );
  line(
    'vertex.allowedFunctionNames',
    JSON.stringify(firstResponseDiag?.['allowedFunctionNames'] ?? []),
  );
  line(
    'vertex.toolConfigPresent',
    firstResponseDiag?.['toolConfigPresent'] ?? false,
  );
  line('vertex.toolsPresent', firstResponseDiag?.['toolsPresent'] ?? false);
  // Vertex preflight progression: the exact stage reached and the exact
  // failed boundary (safe stage names / field classifications only).
  line('vertex.stage', firstResponseDiag?.['vertexStage'] ?? 'not_recorded');
  line(
    'vertex.failedStage',
    firstResponseDiag?.['vertexFailedStage'] ?? 'none',
  );
  line(
    'vertex.validationError',
    firstResponseDiag?.['vertexValidationError'] ?? 'none',
  );
  line(
    'vertex.requestConstructed',
    firstResponseDiag?.['vertexStage'] === 'REQUEST_CONSTRUCTED' ||
      firstResponseDiag?.['vertexStage'] === 'NETWORK_STARTED' ||
      Boolean(firstResponseDiag?.['networkStarted']),
  );
  line('vertex.networkStarted', Boolean(firstResponseDiag?.['networkStarted']));
  line('wire.networkStarted', firstResponseDiag?.['networkStarted'] ?? false);
  // Responses-family structural request facts (names/counts only).
  line('wire.hasInput', firstResponseDiag?.['hasInput'] ?? false);
  line('wire.inputItemCount', firstResponseDiag?.['inputItemCount'] ?? 0);
  line(
    'wire.parallelToolCallsPresent',
    firstResponseDiag?.['parallelToolCallsPresent'] ?? false,
  );
  line(
    'wire.maxOutputTokensFieldName',
    firstResponseDiag?.['maxOutputTokensFieldName'] ?? 'absent',
  );
  line(
    'wire.reasoningFieldPresent',
    firstResponseDiag?.['reasoningFieldPresent'] ?? false,
  );
  // Canonical reasoning-effort resolution facts (see
  // `resolveReasoningEffortRequest` in packages/provider/src/transports/
  // streaming.ts) — requested vs. effective vs. capability/provenance,
  // never the raw thinking payload.
  line(
    'reasoning.requested',
    firstResponseDiag?.['reasoningRequested'] ?? 'none',
  );
  line(
    'reasoning.effective',
    firstResponseDiag?.['reasoningEffective'] ?? 'none',
  );
  line(
    'reasoning.capability',
    firstResponseDiag?.['reasoningCapability'] ?? 'not_applicable',
  );
  line(
    'reasoning.capabilitySource',
    firstResponseDiag?.['reasoningCapabilitySource'] ?? 'not_applicable',
  );
  line(
    'reasoning.serializationField',
    firstResponseDiag?.['reasoningSerializationField'] ?? 'none',
  );
  line('reasoning.sent', firstResponseDiag?.['reasoningSent'] ?? false);
  // Anthropic Messages structural request facts (booleans/counts only — no
  // thinking/system/tool-argument content). Printed for every dialect the
  // same way vertex.*/wire.* fields are — 'false'/0 on a non-Anthropic
  // route is itself an honest, informative value.
  line(
    'anthropic.thinkingPresent',
    firstResponseDiag?.['anthropicThinkingPresent'] ?? false,
  );
  line(
    'anthropic.outputConfigPresent',
    firstResponseDiag?.['anthropicOutputConfigPresent'] ?? false,
  );
  line(
    'anthropic.effortPresent',
    firstResponseDiag?.['anthropicEffortPresent'] ?? false,
  );
  line(
    'anthropic.temperaturePresent',
    firstResponseDiag?.['anthropicTemperaturePresent'] ?? false,
  );
  line(
    'anthropic.serviceTierPresent',
    firstResponseDiag?.['anthropicServiceTierPresent'] ?? false,
  );
  line(
    'anthropic.systemPresent',
    firstResponseDiag?.['anthropicSystemPresent'] ?? false,
  );
  line('anthropic.toolCount', firstResponseDiag?.['requestToolsCount'] ?? 0);
  line(
    'anthropic.toolChoiceCategory',
    firstResponseDiag?.['toolChoiceValueCategory'] ?? 'absent',
  );
  line('anthropic.maxTokens', firstResponseDiag?.['anthropicMaxTokens'] ?? 0);
  line(
    'anthropic.endpointPath',
    routeContract.scope.dialect === 'anthropic-messages'
      ? (firstResponseDiag?.['endpointPath'] ?? 'not_recorded')
      : 'not_applicable',
  );
  // Anthropic thinking/max_tokens invariant — describes the ACTUAL final
  // wire request (never prompt/credential content).
  line(
    'anthropic.requestedMaxTokens',
    firstResponseDiag?.['anthropicRequestedMaxTokens'] ?? 'unspecified',
  );
  line(
    'anthropic.effectiveMaxTokens',
    firstResponseDiag?.['anthropicMaxTokens'] ?? 0,
  );
  line(
    'anthropic.thinkingRequested',
    firstResponseDiag?.['anthropicThinkingPresent'] ?? false,
  );
  line(
    'anthropic.thinkingBudgetRequested',
    firstResponseDiag?.['anthropicThinkingBudgetRequested'] ?? 'not_applicable',
  );
  line(
    'anthropic.thinkingBudgetEffective',
    firstResponseDiag?.['anthropicThinkingBudgetEffective'] ?? 'not_applicable',
  );
  line(
    'anthropic.thinkingBudgetSource',
    firstResponseDiag?.['anthropicThinkingBudgetSource'] ?? 'NOT_APPLICABLE',
  );
  line(
    'anthropic.thinkingBudgetAdjusted',
    firstResponseDiag?.['anthropicThinkingBudgetAdjusted'] ?? false,
  );
  line(
    'anthropic.thinkingBudgetAdjustmentReason',
    firstResponseDiag?.['anthropicThinkingBudgetAdjustmentReason'] ?? 'NONE',
  );
  line(
    'anthropic.thinkingTokenInvariant',
    firstResponseDiag?.['anthropicThinkingTokenInvariant'] ?? 'PASS',
  );
  line(
    'wire.upstreamErrorType',
    firstResponseDiag?.['upstreamErrorType'] ?? 'none',
  );
  line(
    'wire.upstreamErrorParam',
    firstResponseDiag?.['upstreamErrorParam'] ?? 'none',
  );
  line(
    'wire.upstreamErrorMessageSafe',
    firstResponseDiag?.['upstreamErrorMessageSafe'] ?? 'none',
  );
  // Safe, provider-neutral forensic structure of the raw error body — key
  // NAMES and field PATHS only, never values, never the raw body.
  line(
    'wire.errorBodyPresent',
    firstResponseDiag?.['errorBodyPresent'] ?? false,
  );
  line(
    'wire.errorBodyContentType',
    firstResponseDiag?.['errorBodyContentType'] ?? 'none',
  );
  line(
    'wire.errorBodyFormat',
    firstResponseDiag?.['errorBodyFormat'] ?? 'not_recorded',
  );
  line(
    'wire.errorBodyByteLength',
    firstResponseDiag?.['errorBodyByteLength'] ?? 0,
  );
  line(
    'wire.errorTopLevelKeys',
    JSON.stringify(firstResponseDiag?.['errorTopLevelKeys'] ?? []),
  );
  line(
    'wire.errorNestedErrorPresent',
    firstResponseDiag?.['errorNestedErrorPresent'] ?? false,
  );
  line(
    'wire.errorNestedErrorKeys',
    JSON.stringify(firstResponseDiag?.['errorNestedErrorKeys'] ?? []),
  );
  line(
    'wire.errorMessageCandidatePaths',
    JSON.stringify(firstResponseDiag?.['errorMessageCandidatePaths'] ?? []),
  );
  line(
    'wire.upstreamErrorTextSafe',
    firstResponseDiag?.['upstreamErrorTextSafe'] ?? 'none',
  );
  // plumbModelStream emits one normalized event per native structured call;
  // delta fragments are intentionally not counted here.
  line('response.structuredToolCalls', calls.length);
  line('normalizedToolCalls', calls.length);
  line('turn.functionCalls', 'NOT_OBSERVED_BY_TRANSPORT_PROBE');
  line('turn.functionCalls.fixtureProof', 'CROSS_DIALECT_CORE_MATRIX');
  line('scheduler.executions', completed.length);
  line('toolResults', completed.length);
  line('result.reinjected', resultReinjected);
  line('continuation.completed', continuationCompleted);
  line(
    'STRUCTURED_TOOL_PROTOCOL_WORKS',
    calls.length > 0 &&
      completed.length === calls.length &&
      resultReinjected &&
      continuationCompleted,
  );
  line('AUTO_TOOL_SELECTION_WORKS', 'NOT_TESTED_BY_FORCED_PROBE');
  line('safeError', safeError);
  // Account usability is a THIRD, independent dimension from discovery
  // membership and route compatibility: a model can be a live-discovered,
  // route-compatible member of the catalog while this specific account is
  // not entitled/enabled to actually use it (GitHub Copilot's per-model
  // seat gating). Never infer VERIFIED_AVAILABLE from discovery membership
  // alone — only an observed live request outcome may set it.
  const authorityDimensions = resolveModelAuthorityDimensions({
    discovered: resolved.selection.liveAuthorityMatch,
    liveRequestOutcome:
      safeError === 'none'
        ? 'SUCCEEDED'
        : safeError === 'MODEL_NOT_AVAILABLE'
          ? 'MODEL_NOT_AVAILABLE'
          : 'OTHER_FAILURE',
  });
  line('model.discoveryStatus', authorityDimensions.discoveryStatus);
  line('model.accountUsability', authorityDimensions.accountUsability);
  if (safeError === 'MODEL_NOT_AVAILABLE') {
    // Diagnostic-only, safe, static recommendation — never an automatic
    // account/config change.
    line(
      'model.accountUsability.recommendation',
      'Upstream reported the model identifier itself is not supported for this account. If this is unexpected, check whether the model needs to be enabled in the official provider model selector for this account.',
    );
  }
  const succeeded =
    calls.length > 0 &&
    completed.length === calls.length &&
    resultReinjected &&
    continuationCompleted;
  return {
    provider: providerId,
    exitCode: succeeded ? 0 : 1,
    code: safeError !== 'none' ? safeError : 'OK',
    structuredToolCalls: calls.length > 0,
    normalizedToolCalls: calls.length,
    schedulerExecutions: completed.length,
    toolResults: completed.length,
    resultReinjected,
    continuationCompleted,
    forceRequested,
    forceEffective,
  };
}

/** Single-provider CLI entry point (`--test-tool-route`). */
export async function runToolRouteProbe(
  providerId: string,
  requestedModel?: string,
): Promise<number> {
  const outcome = await runToolRouteProbeResult(providerId, requestedModel);
  return outcome.exitCode;
}

export function isCompletedToolContinuationEvent(
  event: Pick<PlumbStreamEvent, 'type' | 'text'>,
): boolean {
  return event.type === 'text' && Boolean(event.text?.trim());
}

function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
      ? Object.fromEntries(Object.entries(parsed))
      : {};
  } catch {
    return {};
  }
}

export interface ConfiguredToolRouteProbeOptions {
  /** User-supplied `--model`; when present the probe runs explicitly for
   * every configured provider (USER_EXPLICIT authority, no discovery). */
  readonly explicitModel?: string;
}

/**
 * Run the forced live probe sequentially for every configured provider with
 * honest, discovery-state-driven authority:
 *
 *   1. configured provider → determine discovery capability
 *   2. attempt authoritative discovery when the provider supports it
 *   3. record the discovery outcome as a canonical state
 *   4. resolve probe authority from THAT state (never from a bare zero count)
 *   5. only then decide whether the live probe may run
 *
 * NOT_ATTEMPTED is never classified LIVE_MODEL_UNRESOLVED. AUTH_BLOCKED,
 * SERVER_UNAVAILABLE and NETWORK_FAILED are environment blockers. Only
 * SUCCEEDED_EMPTY justifies LIVE_MODEL_UNRESOLVED. Providers with an
 * official static (bundled) catalog remain probe candidates under
 * STATIC_AUTHORITATIVE authority — bundled metadata is valid selection
 * authority; it is simply never claimed to be live-discovered.
 */
export async function runConfiguredToolRouteProbes(
  probe: (
    providerId: string,
    requestedModel?: string,
  ) => Promise<ToolRouteProbeOutcome> = runToolRouteProbeResult,
  options: ConfiguredToolRouteProbeOptions = {},
): Promise<number> {
  const providerRegistry = getPlumbProviderRegistry();
  try {
    await providerRegistry.initialize();
  } catch {
    line('batch.mode', 'CONFIGURED_PROVIDERS_FORCED_PROBE');
    line('batch.configured.count', 0);
    line('BATCH_SUM', 0);
    line('result', 'PROVIDER_REGISTRY_UNAVAILABLE');
    return 1;
  }
  const providerIds = providerRegistry
    .getActiveProviderStates()
    .map((state) => state.provider.id)
    .sort();
  line('batch.mode', 'CONFIGURED_PROVIDERS_FORCED_PROBE');
  line('batch.configured.count', providerIds.length);

  const modelRegistry = getPlumbModelRegistry();
  const explicitModel = options.explicitModel?.trim() || undefined;
  const results: ClassifiedBatchResult[] = [];
  for (const providerId of providerIds) {
    line('batch.provider', providerId);
    const local = isLocalProvider(providerId);

    if (explicitModel !== undefined) {
      line('batch.provider.discoveryState', 'NOT_ATTEMPTED');
      line('batch.provider.modelAuthority', 'USER_EXPLICIT');
      results.push(await runClassifiedProbe(probe, providerId, explicitModel));
      continue;
    }

    // Determine discovery capability, then attempt an authoritative
    // discovery/refresh BEFORE reading any authority state.
    if (modelRegistry.hasDiscoveryCapability(providerId)) {
      let apiKey: string | undefined;
      if (!local) {
        try {
          apiKey = (await providerRegistry.getApiKey(providerId)) ?? undefined;
        } catch {
          // The discovery adapter will classify the credential failure
          // itself (AUTH_BLOCKED); never fail the batch here.
        }
      }
      try {
        await modelRegistry.attemptAuthoritativeDiscovery(providerId, apiKey);
      } catch {
        // Attempt threw outside the adapter — the NOT_ATTEMPTED state then
        // drives the static/route fallback below.
      }
    }

    const stats = modelRegistry.getModelAuthorityStats(providerId);
    const decision = resolveProbeAuthorityDecision({
      discoveryState: stats.discoveryState,
      explicitModelRequested: false,
      isLocalProvider: local,
      bundledFallbackCount: stats.bundledFallbackCount,
      liveDiscoveryCount: stats.liveDiscoveryCount,
    });
    line('batch.provider.discoveryState', stats.discoveryState);
    line('batch.provider.modelAuthority', decision.authority);
    line('batch.provider.liveDiscoveredModels', stats.liveDiscoveryCount);
    line('batch.provider.bundledFallbackModels', stats.bundledFallbackCount);

    if (!decision.probeAllowed) {
      const classified = classifyBatchResult({
        provider: providerId,
        code: decision.classificationCode,
        structuredToolCalls: false,
      });
      results.push(classified);
      line('batch.provider.result', decision.classificationCode);
      line('batch.provider.class', classified.className);
      continue;
    }

    results.push(await runClassifiedProbe(probe, providerId, undefined));
  }

  const breakdown = computeBatchBreakdown(results, providerIds.length);
  line('batch.pass.count', breakdown.pass);
  line('batch.requestFailed.count', breakdown.requestFailure);
  line('batch.authBlocked.count', breakdown.authBlocked);
  line('batch.modelUnavailable.count', breakdown.modelUnavailable);
  line('batch.serverUnavailable.count', breakdown.serverUnavailable);
  line('batch.routeUnresolved.count', breakdown.routeUnresolved);
  line('batch.protocolUnsupported.count', breakdown.protocolUnsupported);
  line('batch.liveModelUnresolved.count', breakdown.liveModelUnresolved);
  line('batch.inconclusive.count', breakdown.inconclusive);
  line('batch.unknown.count', breakdown.unknown);
  line('BATCH_SUM', breakdown.sum);
  line('BATCH_SUM_MATCHES_CONFIGURED', breakdown.sumMatchesConfigured);

  const allPassed = results.every((result) => result.className === 'PASS');
  const conclusiveFailures =
    breakdown.requestFailure + breakdown.protocolUnsupported;
  line(
    'result',
    providerIds.length === 0
      ? 'NO_CONFIGURED_PROVIDERS'
      : allPassed
        ? 'CONFIGURED_ROUTE_PROBES_PASS'
        : conclusiveFailures > 0
          ? 'CONFIGURED_ROUTE_REQUEST_FAILURES'
          : breakdown.pass > 0 || breakdown.inconclusive > 0
            ? 'CONFIGURED_ROUTE_PROBES_INCONCLUSIVE'
            : 'CONFIGURED_ROUTE_ENVIRONMENT_BLOCKED',
  );
  return providerIds.length > 0 && allPassed ? 0 : 1;
}

/** Run one probe and classify its outcome (never throws). */
async function runClassifiedProbe(
  probe: (
    providerId: string,
    requestedModel?: string,
  ) => Promise<ToolRouteProbeOutcome>,
  providerId: string,
  requestedModel: string | undefined,
): Promise<ClassifiedBatchResult> {
  try {
    const outcome = await probe(providerId, requestedModel);
    const classified = classifyBatchResult({
      provider: providerId,
      code: outcome.code,
      structuredToolCalls: outcome.structuredToolCalls,
      normalizedToolCalls: outcome.normalizedToolCalls,
      schedulerExecutions: outcome.schedulerExecutions,
      toolResults: outcome.toolResults,
      resultReinjected: outcome.resultReinjected,
      continuationCompleted: outcome.continuationCompleted,
    });
    line('batch.provider.result', outcome.code);
    line('batch.provider.class', classified.className);
    return classified;
  } catch {
    const classified = classifyBatchResult({
      provider: providerId,
      code: 'PROBE_FAILED',
      structuredToolCalls: false,
    });
    line('batch.provider.result', 'PROBE_FAILED');
    line('batch.provider.class', classified.className);
    return classified;
  }
}
