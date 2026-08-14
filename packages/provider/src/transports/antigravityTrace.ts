/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import crypto from 'node:crypto';
import type { PlumbModel, PlumbStreamOptions } from '../types.js';
import type { AntigravityRequestDescriptor } from './streaming.js';

export type AntigravityTraceSource = 'NORMAL_CHAT' | 'LIVE_PROBE';

export type AntigravityTracePhase =
  | 'REQUEST_CONSTRUCTION'
  | 'FINAL_HTTP_REQUEST'
  | 'HTTP_RESPONSE'
  | 'ERROR';

export interface ContentGeneratorInstanceTrace {
  instanceId: string;
  providerAtConstruction: string;
  modelAtConstruction: string;
  currentProvider: string;
  currentModel: string;
}

export function antigravityTraceEnabled(): boolean {
  return process.env['PLUMB_ANTIGRAVITY_TRACE_SAFE'] === '1';
}

export function makeAntigravityTraceId(): string {
  return `ag-${Math.random().toString(36).slice(2, 10)}`;
}

export function writeSafeTraceEvent(event: Record<string, unknown>): void {
  if (!antigravityTraceEnabled()) return;

  // Stderr stream write for backward-compatible terminal visibility
  if (process.env['PLUMB_ANTIGRAVITY_TRACE_STDERR'] !== '0') {
    try {
      const summary = `traceId=${String(event['traceId'])} source=${String(event['source'])} phase=${String(event['phase'])}`;
      process.stderr.write(`[antigravity-trace] ${summary}\n`);
    } catch {
      // Ignore stderr write failures
    }
  }

  // Direct filesystem append to trace file sink (bypasses stdio monkey-patching)
  const filePath = process.env['PLUMB_ANTIGRAVITY_TRACE_SAFE_FILE'];
  if (filePath && filePath.trim().length > 0) {
    try {
      const line = JSON.stringify(event) + '\n';
      fs.appendFileSync(filePath, line, 'utf-8');
    } catch {
      // Ignore file append failures
    }
  }
}

export function extractContentsMetadata(
  messages: PlumbStreamOptions['messages'],
): {
  count: number;
  roles: string[];
  partTypeCounts: Record<string, number>;
} {
  const roles: string[] = [];
  const partTypeCounts: Record<string, number> = {
    text: 0,
    image: 0,
    toolCall: 0,
    toolResult: 0,
    thinking: 0,
  };

  for (const msg of messages) {
    roles.push(msg.role);
    if (typeof msg.content === 'string') {
      partTypeCounts['text'] = (partTypeCounts['text'] ?? 0) + 1;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'text') {
          partTypeCounts['text'] = (partTypeCounts['text'] ?? 0) + 1;
        } else if (part.type === 'image') {
          partTypeCounts['image'] = (partTypeCounts['image'] ?? 0) + 1;
        } else if (part.type === 'tool_call') {
          partTypeCounts['toolCall'] = (partTypeCounts['toolCall'] ?? 0) + 1;
        } else if (part.type === 'tool_result') {
          partTypeCounts['toolResult'] =
            (partTypeCounts['toolResult'] ?? 0) + 1;
        } else if (part.type === 'thinking') {
          partTypeCounts['thinking'] = (partTypeCounts['thinking'] ?? 0) + 1;
        } else {
          partTypeCounts['other'] = (partTypeCounts['other'] ?? 0) + 1;
        }
      }
    }
  }

  return {
    count: messages.length,
    roles,
    partTypeCounts,
  };
}

export function extractToolsMetadata(tools: PlumbStreamOptions['tools']): {
  count: number;
  typeNames: string[];
} {
  if (!tools || !Array.isArray(tools)) {
    return { count: 0, typeNames: [] };
  }
  const typeNames = tools.map((t) => t.function?.name ?? t.type ?? 'function');
  return {
    count: tools.length,
    typeNames,
  };
}

export function computeCanonicalStructureHash(obj: unknown): string {
  const canonicalString = JSON.stringify(sortKeysRecursively(obj));
  return crypto.createHash('sha256').update(canonicalString).digest('hex');
}

function sortKeysRecursively(val: unknown): unknown {
  if (val === null || typeof val !== 'object') {
    return val;
  }
  if (Array.isArray(val)) {
    return val.map(sortKeysRecursively);
  }
  const rec = val as Record<string, unknown>;
  const sortedKeys = Object.keys(rec).sort();
  const res: Record<string, unknown> = {};
  for (const k of sortedKeys) {
    res[k] = sortKeysRecursively(rec[k]);
  }
  return res;
}

export function computeRequestStructureHash(
  descriptor: AntigravityRequestDescriptor,
): string {
  let origin = '(unparseable)';
  let pathname = '(unparseable)';
  let queryKeys: string[] = [];
  try {
    const url = new URL(descriptor.url);
    origin = url.origin;
    pathname = url.pathname;
    queryKeys = [...url.searchParams.keys()].sort();
  } catch {}

  const headerNames = Object.keys(descriptor.headers)
    .map((h) => h.toLowerCase())
    .sort();
  const authorizationPresent =
    descriptor.headers['Authorization'] !== undefined;

  const struct = {
    authorizationPresent,
    headerNames,
    method: 'POST',
    origin,
    pathname,
    queryKeys,
  };

  return computeCanonicalStructureHash(struct);
}

export function computeBodyStructureHash(
  descriptor: AntigravityRequestDescriptor,
  contentsMeta: {
    count: number;
    roles: string[];
    partTypeCounts: Record<string, number>;
  },
  toolsMeta: { count: number; typeNames: string[] },
  systemInstructionPresent: boolean,
): string {
  const body = descriptor.body;
  if (!body || typeof body !== 'object') {
    return computeCanonicalStructureHash({ bodyPresent: false });
  }

  const rec = body as Record<string, unknown>;
  const inner =
    rec['request'] && typeof rec['request'] === 'object'
      ? (rec['request'] as Record<string, unknown>)
      : {};

  const bodyModel = typeof rec['model'] === 'string' ? rec['model'] : '';

  const struct = {
    contents: contentsMeta,
    labelsPresent: 'labels' in inner,
    model: bodyModel,
    projectPresent: 'project' in rec,
    requestIdPresent: 'requestId' in rec,
    requestPresent: 'request' in rec,
    requestType: String(rec['requestType'] ?? ''),
    sessionIdPresent: 'sessionId' in inner,
    systemInstructionPresent,
    tools: toolsMeta,
    topLevelKeys: Object.keys(rec).sort(),
    userAgent: String(rec['userAgent'] ?? ''),
  };

  return computeCanonicalStructureHash(struct);
}

export function traceAntigravityRequestConstruction(params: {
  traceId: string;
  source: AntigravityTraceSource;
  model: PlumbModel;
  options: PlumbStreamOptions;
  generatorInstance?: ContentGeneratorInstanceTrace | null;
}): void {
  if (!antigravityTraceEnabled()) return;

  const contentsMeta = extractContentsMetadata(params.options.messages);
  const toolsMeta = extractToolsMetadata(params.options.tools);
  const systemInstructionPresent = !!params.options.systemPrompt;

  const event = {
    traceId: params.traceId,
    timestamp: new Date().toISOString(),
    source: params.source,
    phase: 'REQUEST_CONSTRUCTION' as const,
    provider: {
      plumbId: params.model.provider,
      catalogId: 'google-antigravity',
    },
    model: {
      displayId: params.model.id,
      requestModelId: params.model.requestModelId ?? params.model.id,
      api: params.model.api,
      baseUrl: params.model.baseUrl,
    },
    contents: contentsMeta,
    tools: toolsMeta,
    systemInstruction: {
      present: systemInstructionPresent,
    },
    contentGenerator: params.generatorInstance ?? null,
  };

  writeSafeTraceEvent(event);
}

export function traceAntigravityFinalHttpRequest(params: {
  traceId: string;
  source: AntigravityTraceSource;
  model: PlumbModel;
  descriptor: AntigravityRequestDescriptor;
  options: PlumbStreamOptions;
  resolvedCredential?: {
    classification: string;
    refreshAttempted?: boolean;
    credential?: { scope?: string; projectId?: string; access?: string } | null;
  } | null;
  generatorInstance?: ContentGeneratorInstanceTrace | null;
}): void {
  if (!antigravityTraceEnabled()) return;

  const { descriptor, options, model, traceId, source } = params;

  let origin = '(unparseable)';
  let pathname = '(unparseable)';
  let queryKeys: string[] = [];
  try {
    const url = new URL(descriptor.url);
    origin = url.origin;
    pathname = url.pathname;
    queryKeys = [...url.searchParams.keys()].sort();
  } catch {}

  const headerNames = Object.keys(descriptor.headers)
    .map((h) => h.toLowerCase())
    .sort();
  const authorizationPresent =
    descriptor.headers['Authorization'] !== undefined;

  const bodyRec =
    descriptor.body && typeof descriptor.body === 'object'
      ? (descriptor.body as Record<string, unknown>)
      : {};
  const innerRec =
    bodyRec['request'] && typeof bodyRec['request'] === 'object'
      ? (bodyRec['request'] as Record<string, unknown>)
      : {};

  const contentsMeta = extractContentsMetadata(options.messages);
  const toolsMeta = extractToolsMetadata(options.tools);
  const systemInstructionPresent = !!options.systemPrompt;

  const bodyContents = Array.isArray(innerRec['contents'])
    ? (innerRec['contents'] as Array<{ role?: string }>)
    : [];
  const finalRoles = bodyContents.map((c) => c.role ?? 'unknown');
  const finalContentsMeta = {
    count: bodyContents.length,
    roles: finalRoles,
  };

  const reqStructHash = computeRequestStructureHash(descriptor);
  const bodyStructHash = computeBodyStructureHash(
    descriptor,
    contentsMeta,
    toolsMeta,
    systemInstructionPresent,
  );

  const endpointSelector = model.baseUrl ? 'model.baseUrl' : 'DEFAULT_ENDPOINT';
  const endpointSource = model.baseUrl
    ? 'CUSTOM_BASE_URL'
    : 'GOOGLE_GEMINI_CLI_DEFAULT';

  const event = {
    traceId,
    timestamp: new Date().toISOString(),
    source,
    phase: 'FINAL_HTTP_REQUEST' as const,
    provider: {
      plumbId: model.provider,
      catalogId: 'google-antigravity',
    },
    model: {
      displayId: model.id,
      requestModelId: model.requestModelId ?? model.id,
      api: model.api,
      wireModel: String(bodyRec['model'] ?? model.requestModelId ?? model.id),
    },
    credential: {
      scope: params.resolvedCredential?.credential?.scope ?? 'antigravity',
      classification:
        params.resolvedCredential?.classification ?? 'VALID_CREDENTIAL',
      runtimeUsable:
        params.resolvedCredential?.classification === 'VALID_CREDENTIAL' ||
        true,
      projectIdPresent:
        'project' in bodyRec ||
        !!params.resolvedCredential?.credential?.projectId,
    },
    endpoint: {
      origin,
      pathname,
      selector: endpointSelector,
      source: endpointSource,
    },
    request: {
      origin,
      pathname,
      method: 'POST',
      queryKeys,
      headerNames,
      authorizationPresent,
      structureHash: reqStructHash,
    },
    body: {
      topLevelKeys: Object.keys(bodyRec).sort(),
      projectPresent: 'project' in bodyRec,
      model: String(bodyRec['model'] ?? '(absent)'),
      requestPresent: 'request' in bodyRec,
      requestIdPresent: 'requestId' in bodyRec,
      sessionIdPresent: 'sessionId' in innerRec,
      labelsPresent: 'labels' in innerRec,
      userAgent: String(bodyRec['userAgent'] ?? '(absent)'),
      requestType: String(bodyRec['requestType'] ?? '(absent)'),
      structureHash: bodyStructHash,
    },
    contents: contentsMeta,
    finalContents: finalContentsMeta,
    tools: toolsMeta,
    systemInstruction: {
      present: systemInstructionPresent,
    },
    contentGenerator: params.generatorInstance ?? null,
  };

  writeSafeTraceEvent(event);
}

export function traceAntigravityHttpResponse(params: {
  traceId: string;
  source: AntigravityTraceSource;
  response: Response;
}): void {
  if (!antigravityTraceEnabled()) return;

  const { response, traceId, source } = params;

  const safeHeaders: Record<string, string> = {};
  const safeHeaderKeys = [
    'x-goog-trace-id',
    'x-request-id',
    'server',
    'content-type',
    'date',
  ];
  for (const k of safeHeaderKeys) {
    const val = response.headers.get(k);
    if (val) safeHeaders[k] = val;
  }

  const safeClassification = response.ok
    ? 'HTTP_200'
    : response.status === 404
      ? 'ENDPOINT_NOT_FOUND'
      : `HTTP_${response.status}`;

  const event = {
    traceId,
    timestamp: new Date().toISOString(),
    source,
    phase: 'HTTP_RESPONSE' as const,
    status: response.status,
    statusText: response.statusText,
    contentType: response.headers.get('content-type') ?? '(none)',
    safeHeaders,
    safeClassification,
  };

  writeSafeTraceEvent(event);
}

export function traceAntigravityError(params: {
  traceId: string;
  source: AntigravityTraceSource;
  error: { code: string; message: string };
}): void {
  if (!antigravityTraceEnabled()) return;

  const event = {
    traceId: params.traceId,
    timestamp: new Date().toISOString(),
    source: params.source,
    phase: 'ERROR' as const,
    error: params.error,
  };

  writeSafeTraceEvent(event);
}
