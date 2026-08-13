/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

import {
  buildEffectiveToolRouteContract,
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
  resolveLiveModelAuthority,
  type ClassifiedBatchResult,
  type PlumbContentPart,
  type PlumbEffectiveToolRouteContract,
  type PlumbModel,
  type PlumbStreamEvent,
  type PlumbToolChoice,
} from '@google/gemini-cli-provider';
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
} from '@google/gemini-cli-core';

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

/** Structured probe outcome consumed by the honest batch classification. */
export interface ToolRouteProbeOutcome {
  readonly provider: string;
  readonly exitCode: number;
  readonly code: string;
  readonly structuredToolCalls: boolean;
}

interface ResolvedToolRoute {
  model: PlumbModel;
  apiKey: string;
}

async function resolveToolRoute(
  providerId: string,
  requestedModel: string | undefined,
  refreshModels: boolean,
): Promise<ResolvedToolRoute | undefined> {
  if (!getPlumbProvider(providerId)) return undefined;

  const providerRegistry = getPlumbProviderRegistry();
  await providerRegistry.initialize();
  const credential = providerRegistry.getProviderState(providerId)?.credentials;
  const apiKey = refreshModels
    ? ((await providerRegistry.getApiKey(providerId)) ??
      (credential?.type === 'oauth' ? credential.access : ''))
    : '';
  const modelRegistry = getPlumbModelRegistry();
  let model = requestedModel
    ? modelRegistry.findModel(providerId, requestedModel)
    : modelRegistry.resolveDefaultModel(providerId);
  if (!model && refreshModels) {
    const refreshed = await modelRegistry.refreshProvider(
      providerId,
      apiKey || undefined,
    );
    model = requestedModel
      ? modelRegistry.findModel(providerId, requestedModel)
      : refreshed[0];
  }
  return model ? { model, apiKey } : undefined;
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

  let resolved: ResolvedToolRoute | undefined;
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

  const contract = buildEffectiveToolRouteContract({
    providerId,
    model: resolved.model,
  });
  printToolRouteContract(contract);

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
  let resolved: ResolvedToolRoute | undefined;
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
    geminiClient: config.getGeminiClient(),
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
  enableToolRouteDiag();
  try {
    for await (const event of plumbModelStream({
      model,
      messages: [{ role: 'user', content: 'Run the diagnostic tool.' }],
      tools: [tool],
      toolChoice: effective.value,
      apiKey,
      maxTokens: 64,
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
  const firstResponseDiag = getLastToolRouteDiag();
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
  line(
    'probe.forced',
    requestedChoice?.mode === 'required' || requestedChoice?.mode === 'named',
  );
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
  /** User-supplied `--model`; when present the LIVE_MODEL_UNRESOLVED rule is
   * bypassed (explicit selection remains allowed). */
  readonly explicitModel?: string;
}

/**
 * Run the forced live probe sequentially for every configured provider with
 * honest classification. Two universal rules are wired here (the cde
 * toolRouteContract helpers are the single authority for both):
 *
 *  1. LIVE_MODEL_UNRESOLVED — a provider with zero live-discovered models and
 *     bundled-only fallbacks is NEVER probed unless the user explicitly passed
 *     `--model` (zero network, classified, reported).
 *  2. Mutually-exclusive classification — every outcome is classified into
 *     exactly one of PASS / REQUEST_FAILED / AUTH_BLOCKED / MODEL_UNAVAILABLE /
 *     SERVER_UNAVAILABLE / ROUTE_UNRESOLVED / PROTOCOL_UNSUPPORTED /
 *     LIVE_MODEL_UNRESOLVED / UNKNOWN, and BATCH_SUM must equal the configured
 *     count.
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
    const stats = modelRegistry.getModelAuthorityStats(providerId);
    const authority = resolveLiveModelAuthority({
      liveDiscoveryCount: stats.liveDiscoveryCount,
      bundledFallbackCount: stats.bundledFallbackCount,
      explicitModelRequested: explicitModel !== undefined,
      fallbackUsed:
        stats.liveDiscoveryCount === 0 && stats.bundledFallbackCount > 0,
    });
    line('batch.provider.liveModelAuthority', authority);
    line('batch.provider.liveDiscoveredModels', stats.liveDiscoveryCount);
    line('batch.provider.bundledFallbackModels', stats.bundledFallbackCount);
    if (authority === 'LIVE_MODEL_UNRESOLVED') {
      // Universal honesty rule: never trust bundled fallbacks as live
      // authority. No request is made for this provider.
      const classified = classifyBatchResult({
        provider: providerId,
        code: 'LIVE_MODEL_UNRESOLVED',
        structuredToolCalls: false,
      });
      results.push(classified);
      line(
        'batch.provider.result',
        'LIVE_MODEL_UNRESOLVED_SKIPPED_LIVE_REQUEST',
      );
      line('batch.provider.class', classified.className);
      continue;
    }
    try {
      const outcome = await probe(providerId, explicitModel);
      const classified = classifyBatchResult({
        provider: providerId,
        code: outcome.code,
        structuredToolCalls: outcome.structuredToolCalls,
      });
      results.push(classified);
      line('batch.provider.result', outcome.code);
      line('batch.provider.class', classified.className);
    } catch {
      const classified = classifyBatchResult({
        provider: providerId,
        code: 'PROBE_FAILED',
        structuredToolCalls: false,
      });
      results.push(classified);
      line('batch.provider.result', 'PROBE_FAILED');
      line('batch.provider.class', classified.className);
    }
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
  line('batch.unknown.count', breakdown.unknown);
  line('BATCH_SUM', breakdown.sum);
  line('BATCH_SUM_MATCHES_CONFIGURED', breakdown.sumMatchesConfigured);
  const allPassed = results.every((result) => result.className === 'PASS');
  line(
    'result',
    providerIds.length === 0
      ? 'NO_CONFIGURED_PROVIDERS'
      : allPassed
        ? 'ALL_CONFIGURED_ROUTES_PASSED'
        : 'CONFIGURED_ROUTE_FAILURES',
  );
  return providerIds.length > 0 && allPassed ? 0 : 1;
}
