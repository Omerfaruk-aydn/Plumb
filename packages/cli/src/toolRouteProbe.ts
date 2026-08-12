/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

import {
  getLastToolRouteDiag,
  getPlumbModelRegistry,
  getPlumbProvider,
  getPlumbProviderRegistry,
  plumbModelStream,
  enableToolRouteDiag,
  resolveEffectiveToolChoice,
  resolveRouteToolPolicy,
  type PlumbContentPart,
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

export async function runToolRouteProbe(
  providerId: string,
  requestedModel?: string,
): Promise<number> {
  const provider = getPlumbProvider(providerId);
  const providerRegistry = getPlumbProviderRegistry();
  await providerRegistry.initialize();
  const credential = providerRegistry.getProviderState(providerId)?.credentials;
  const apiKey =
    (await providerRegistry.getApiKey(providerId)) ??
    (credential?.type === 'oauth' ? credential.access : '');
  const modelRegistry = getPlumbModelRegistry();
  let model = requestedModel
    ? modelRegistry.findModel(providerId, requestedModel)
    : modelRegistry.resolveDefaultModel(providerId);
  if (!model) {
    const refreshed = await modelRegistry.refreshProvider(
      providerId,
      apiKey || undefined,
    );
    model = requestedModel
      ? modelRegistry.findModel(providerId, requestedModel)
      : refreshed[0];
  }
  if (!provider || !model) {
    line('provider', providerId);
    line('result', 'ROUTE_NOT_FOUND');
    return 1;
  }

  const policy = resolveRouteToolPolicy(model);
  const requestedChoice: PlumbToolChoice | undefined =
    policy.forcedToolChoiceSupported && policy.namedToolChoiceSupported
      ? { mode: 'named', name: PLUMB_TOOL_PROBE_NAME }
      : policy.forcedToolChoiceSupported
        ? { mode: 'required' }
        : undefined;
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
  const firstResponseDiag = getLastToolRouteDiag();

  const requests: ToolCallRequestInfo[] = calls.map((call) => ({
    callId: call.id,
    name: call.name,
    args: safeParseArgs(call.arguments),
    isClientInitiated: false,
    prompt_id: 'plumb-tool-route-probe',
  }));
  const completed = requests.length
    ? await scheduler.schedule(requests, new AbortController().signal)
    : [];
  let resultReinjected = false;
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
      if (event.type === 'text' || event.type === 'done')
        resultReinjected = true;
      if (event.type === 'error')
        safeError = event.error?.code ?? 'PROVIDER_ERROR';
    }
  }
  scheduler.dispose();

  line('provider', providerId);
  line('model', model.id);
  line('dialect', model.api);
  line('toolChoicePolicy', policy.emission);
  line('toolChoiceSent', effective.sent);
  line('request.tools.count', 1);
  line(
    'response.structuredToolCalls',
    firstResponseDiag?.['responseToolCallDeltaCount'] ?? calls.length,
  );
  line('normalizedToolCalls', calls.length);
  line('scheduler.executions', completed.length);
  line('result.reinjected', resultReinjected);
  line(
    'STRUCTURED_TOOL_PROTOCOL_WORKS',
    calls.length > 0 && completed.length > 0,
  );
  line('AUTO_TOOL_SELECTION_WORKS', 'NOT_TESTED_BY_FORCED_PROBE');
  line('safeError', safeError);
  return calls.length > 0 &&
    completed.length === calls.length &&
    resultReinjected
    ? 0
    : 1;
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
