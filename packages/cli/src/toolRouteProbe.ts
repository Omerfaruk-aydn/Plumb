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

export async function runToolRouteProbe(
  providerId: string,
  requestedModel?: string,
): Promise<number> {
  let resolved: ResolvedToolRoute | undefined;
  try {
    resolved = await resolveToolRoute(providerId, requestedModel, true);
  } catch {
    line('diagnostic.mode', 'FORCED_STRUCTURED_TOOL_PROBE');
    line('provider', providerId);
    line('result', 'ROUTE_RESOLUTION_FAILED');
    return 1;
  }
  if (!resolved) {
    line('diagnostic.mode', 'FORCED_STRUCTURED_TOOL_PROBE');
    line('provider', providerId);
    line('result', 'ROUTE_NOT_FOUND');
    return 1;
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
  line('request.tools.count', firstResponseDiag?.['requestToolsCount'] ?? 0);
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
  return calls.length > 0 &&
    completed.length === calls.length &&
    resultReinjected &&
    continuationCompleted
    ? 0
    : 1;
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

/** Run the forced live probe sequentially for every configured provider. */
export async function runConfiguredToolRouteProbes(
  probe: (providerId: string) => Promise<number> = runToolRouteProbe,
): Promise<number> {
  const providerRegistry = getPlumbProviderRegistry();
  try {
    await providerRegistry.initialize();
  } catch {
    line('batch.mode', 'CONFIGURED_PROVIDERS_FORCED_PROBE');
    line('batch.configured.count', 0);
    line('batch.passed.count', 0);
    line('batch.failed.count', 0);
    line('result', 'PROVIDER_REGISTRY_UNAVAILABLE');
    return 1;
  }
  const providerIds = providerRegistry
    .getActiveProviderStates()
    .map((state) => state.provider.id)
    .sort();
  line('batch.mode', 'CONFIGURED_PROVIDERS_FORCED_PROBE');
  line('batch.configured.count', providerIds.length);

  let passed = 0;
  let failed = 0;
  for (const providerId of providerIds) {
    line('batch.provider', providerId);
    try {
      const result = await probe(providerId);
      if (result === 0) passed++;
      else failed++;
    } catch {
      failed++;
      line('batch.provider.result', 'PROBE_FAILED');
    }
  }
  line('batch.passed.count', passed);
  line('batch.failed.count', failed);
  line(
    'result',
    providerIds.length === 0
      ? 'NO_CONFIGURED_PROVIDERS'
      : failed === 0
        ? 'ALL_CONFIGURED_ROUTES_PASSED'
        : 'CONFIGURED_ROUTE_FAILURES',
  );
  return providerIds.length > 0 && failed === 0 ? 0 : 1;
}
