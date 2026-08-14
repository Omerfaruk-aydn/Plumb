/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { parseRateLimitReason } from '../vendor-ai/error/rate-limit.js';

/**
 * Minimal shape of the safe-Google-error extraction result this module
 * needs (the real type is `SafeGoogleErrorDetails` in streaming.ts — kept
 * structural here rather than imported to avoid a circular dependency;
 * streaming.ts imports classifyGoogleHttpError, not the other way around).
 */
export interface GoogleErrorEvidence {
  status?: string;
  safeMessage?: string;
}

/**
 * Canonical error codes a streaming transport may report on its initial
 * HTTP response. Not every dialect can produce every code — see each
 * dialect's classifyXError wrapper for which subset applies.
 */
export type PlumbCanonicalErrorCode =
  | 'INVALID_REQUEST' // 400 and unclassified 4xx
  | 'AUTH_REQUIRED' // 401
  | 'ACCOUNT_RESTRICTED' // 403
  | 'MODEL_NOT_AVAILABLE' // 404
  | 'TIMEOUT' // 408
  | 'CONFLICT' // 409
  | 'RATE_LIMITED' // 429 (no stronger evidence of quota exhaustion)
  | 'QUOTA_EXHAUSTED' // 429 + rate-limit-reason evidence
  | 'UPSTREAM_ERROR' // 5xx
  | 'NETWORK_ERROR'; // fetch() rejected (not AbortError)

export interface ClassifiedHttpError {
  code: PlumbCanonicalErrorCode;
  /** Sanitized, bounded message safe to surface in UI/logs. */
  message: string;
}

const MAX_MESSAGE_LEN = 500;
const HTML_MARKER_PATTERN = /<!doctype html|<html[\s>]|<body[\s>]/i;

/**
 * Extract a safe, bounded message from a raw error response body. Prefers a
 * provider-reported `.error.message` / `.message` JSON field (the common
 * shape across OpenAI-, Anthropic-, and Google-compatible APIs) over the raw
 * body text — this is what keeps an upstream HTML error page (a CDN/gateway
 * 5xx, a WAF block page) or an oversized JSON error blob from being dumped
 * verbatim into a user-facing message.
 */
export function sanitizeErrorBodyMessage(
  bodyText: string,
  fallback: string,
): string {
  const trimmed = bodyText.trim();
  if (!trimmed) return fallback;

  if (HTML_MARKER_PATTERN.test(trimmed)) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object') {
      const rec = parsed as Record<string, unknown>;
      const nested = rec['error'];
      const nestedMessage =
        nested && typeof nested === 'object'
          ? (nested as Record<string, unknown>)['message']
          : undefined;
      const message =
        (typeof nestedMessage === 'string' && nestedMessage) ||
        (typeof rec['message'] === 'string'
          ? (rec['message'] as string)
          : undefined);
      if (message) {
        return message.slice(0, MAX_MESSAGE_LEN);
      }
    }
  } catch {
    // Not JSON — fall through to the raw-text path below.
  }

  return trimmed.slice(0, MAX_MESSAGE_LEN) || fallback;
}

/** Redact credential/token patterns from an upstream error message. */
function redactSensitiveText(text: string): string {
  return (
    text
      .replace(/ya29\.[A-Za-z0-9_-]+/g, '[REDACTED_TOKEN]')
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, '[REDACTED_BEARER]')
      .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[REDACTED_KEY]')
      .replace(/gho_[A-Za-z0-9_-]+/g, '[REDACTED_KEY]')
      .replace(/projects\/[A-Za-z0-9._-]+/g, 'projects/[REDACTED]')
      .replace(/api[_-]?key[=:]\s*[A-Za-z0-9._-]+/gi, 'api_key=[REDACTED]')
      // Strip echoed prompt/input content (e.g. `prompt "..."`, `input: {...}`).
      .replace(
        /\b(prompt|input)\s*[:=]?\s*"[^"]*"/gi,
        '$1 "[REDACTED_CONTENT]"',
      )
      .replace(
        /\b(prompt|input)\s*[:=]?\s*\{[^}]*\}/gi,
        '$1 [REDACTED_CONTENT]',
      )
  );
}

export interface SafeResponsesErrorDetails {
  errorType?: string;
  errorParam?: string;
  errorMessageSafe?: string;
}

const MAX_SAFE_ERROR_DETAIL = 300;

/**
 * Extract ONLY the safe structural details of an OpenAI-Responses-family
 * upstream error (`error.type`, `error.param`, sanitized `error.message`).
 * The message is redacted (tokens/keys/bearers stripped), bounded to 300
 * chars, and never includes the raw body or echoed request content.
 */
export function extractSafeResponsesErrorDetails(
  bodyText: string,
): SafeResponsesErrorDetails {
  const result: SafeResponsesErrorDetails = {};
  if (!bodyText || bodyText.trim().length === 0) return result;
  try {
    const parsed = JSON.parse(bodyText.trim()) as unknown;
    if (!parsed || typeof parsed !== 'object') return result;
    const error = (parsed as Record<string, unknown>)['error'];
    if (!error || typeof error !== 'object') return result;
    const rec = error as Record<string, unknown>;
    if (typeof rec['type'] === 'string') {
      result.errorType = redactSensitiveText(rec['type']).slice(
        0,
        MAX_SAFE_ERROR_DETAIL,
      );
    }
    if (typeof rec['param'] === 'string' && rec['param'].length < 250) {
      result.errorParam = redactSensitiveText(rec['param']).slice(
        0,
        MAX_SAFE_ERROR_DETAIL,
      );
    }
    if (typeof rec['message'] === 'string' && rec['message'].trim()) {
      result.errorMessageSafe = redactSensitiveText(rec['message']).slice(
        0,
        MAX_SAFE_ERROR_DETAIL,
      );
    }
  } catch {
    // Not JSON — no safe structured details to expose.
  }
  return result;
}

/** Structural shape of an upstream error response body — never the values,
 * only the shape. `UNKNOWN` is returned rather than invented whenever the
 * body doesn't match a recognized envelope. */
export type SafeErrorBodyFormat =
  | 'JSON_OBJECT'
  | 'JSON_ARRAY'
  | 'TEXT'
  | 'HTML'
  | 'EMPTY'
  | 'UNKNOWN';

/** Safe, provider-neutral structural facts about an upstream error body —
 * key names and field paths only, never values, never the raw body. */
export interface SafeErrorEnvelope {
  readonly bodyPresent: boolean;
  readonly contentType: string;
  readonly format: SafeErrorBodyFormat;
  readonly byteLength: number;
  readonly topLevelKeys: readonly string[];
  readonly nestedErrorPresent: boolean;
  readonly nestedErrorKeys: readonly string[];
  /** Field PATHS only (e.g. "error.message", "errors[0].message") — never
   * the message text itself. */
  readonly messageCandidatePaths: readonly string[];
  readonly errorType?: string;
  readonly errorCode?: string;
  readonly errorParam?: string;
  readonly errorMessageSafe?: string;
  /** Sanitized, truncated fallback text — only set for TEXT/HTML bodies
   * (or bodies with no recognized message field), never for a body that
   * already yielded a structured `errorMessageSafe`. */
  readonly textSafe?: string;
}

const MAX_ENVELOPE_KEYS = 20;

function stripHtmlTags(text: string): string {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeHtml(text: string): boolean {
  const head = text.trim().slice(0, 200);
  return (
    /^<(!doctype\s+html|html)/i.test(head) || /<\/?[a-z][^>]*>/i.test(head)
  );
}

function safeFallbackText(
  bodyText: string,
  format: SafeErrorBodyFormat,
): string | undefined {
  const source = format === 'HTML' ? stripHtmlTags(bodyText) : bodyText.trim();
  if (!source) return undefined;
  return redactSensitiveText(source).slice(0, MAX_SAFE_ERROR_DETAIL);
}

function safeMessageFrom(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return redactSensitiveText(value).slice(0, MAX_SAFE_ERROR_DETAIL);
}

/**
 * Provider-neutral SAFE error-envelope extractor. Recognizes ONLY
 * evidence-backed shapes:
 *   { error: { type, code, param, message } }  (Anthropic/OpenAI-family)
 *   { error: "..." }
 *   { message: "..." }
 *   { detail: "..." }
 *   { errors: [{ message: "..." }, ...] }
 * plus plain-text and HTML bodies. An unrecognized JSON object still
 * reports its top-level key NAMES (shape only) so a human can see what
 * envelope it actually is, but never invents `errorType`/`errorParam`/
 * `errorMessageSafe` for a shape it doesn't recognize — those stay
 * `undefined`, never guessed. This is deliberately separate from (and does
 * not replace) `extractSafeResponsesErrorDetails`, which stays narrowly
 * scoped to the OpenAI-Responses-family shape `classifyResponsesHttpError`
 * depends on.
 */
export function extractSafeErrorEnvelope(
  bodyText: string,
  contentType?: string,
): SafeErrorEnvelope {
  const source = bodyText ?? '';
  const byteLength = new TextEncoder().encode(source).length;
  const trimmed = source.trim();
  const bodyPresent = trimmed.length > 0;
  const base = { bodyPresent, contentType: contentType ?? 'none', byteLength };

  if (!bodyPresent) {
    return {
      ...base,
      format: 'EMPTY',
      topLevelKeys: [],
      nestedErrorPresent: false,
      nestedErrorKeys: [],
      messageCandidatePaths: [],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const format: SafeErrorBodyFormat = looksLikeHtml(trimmed)
      ? 'HTML'
      : 'TEXT';
    return {
      ...base,
      format,
      topLevelKeys: [],
      nestedErrorPresent: false,
      nestedErrorKeys: [],
      messageCandidatePaths: [],
      textSafe: safeFallbackText(trimmed, format),
    };
  }

  if (Array.isArray(parsed)) {
    const first = parsed[0] as Record<string, unknown> | undefined;
    const messageCandidatePaths: string[] = [];
    let errorMessageSafe: string | undefined;
    if (first && typeof first === 'object') {
      const msg = safeMessageFrom(first['message']);
      if (msg) {
        messageCandidatePaths.push('[0].message');
        errorMessageSafe = msg;
      }
    }
    return {
      ...base,
      format: 'JSON_ARRAY',
      topLevelKeys: [],
      nestedErrorPresent: false,
      nestedErrorKeys: [],
      messageCandidatePaths,
      errorMessageSafe,
    };
  }

  if (parsed === null || typeof parsed !== 'object') {
    // A bare JSON primitive (string/number/bool) — not a recognized
    // error envelope. Report the shape honestly, invent nothing.
    return {
      ...base,
      format: 'UNKNOWN',
      topLevelKeys: [],
      nestedErrorPresent: false,
      nestedErrorKeys: [],
      messageCandidatePaths: [],
    };
  }

  const rec = parsed as Record<string, unknown>;
  const topLevelKeys = Object.keys(rec).slice(0, MAX_ENVELOPE_KEYS);
  const nested = rec['error'];
  const nestedRec: Record<string, unknown> | undefined =
    nested && typeof nested === 'object' && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)
      : undefined;
  const nestedErrorPresent = nestedRec !== undefined;
  const nestedErrorKeys = nestedRec
    ? Object.keys(nestedRec).slice(0, MAX_ENVELOPE_KEYS)
    : [];

  const messageCandidatePaths: string[] = [];
  let errorType: string | undefined;
  let errorCode: string | undefined;
  let errorParam: string | undefined;
  let errorMessageSafe: string | undefined;

  if (nestedRec) {
    errorType = safeMessageFrom(nestedRec['type']);
    errorCode = safeMessageFrom(nestedRec['code']);
    if (
      typeof nestedRec['param'] === 'string' &&
      nestedRec['param'].length < 250
    ) {
      errorParam = safeMessageFrom(nestedRec['param']);
    }
    const nestedMessage = safeMessageFrom(nestedRec['message']);
    if (nestedMessage) {
      messageCandidatePaths.push('error.message');
      errorMessageSafe = nestedMessage;
    }
  } else {
    const errorAsString = safeMessageFrom(rec['error']);
    if (errorAsString) {
      messageCandidatePaths.push('error');
      errorMessageSafe = errorAsString;
    }
  }

  const topMessage = safeMessageFrom(rec['message']);
  if (topMessage) {
    messageCandidatePaths.push('message');
    errorMessageSafe = errorMessageSafe ?? topMessage;
  }
  const detail = safeMessageFrom(rec['detail']);
  if (detail) {
    messageCandidatePaths.push('detail');
    errorMessageSafe = errorMessageSafe ?? detail;
  }
  if (Array.isArray(rec['errors']) && rec['errors'].length > 0) {
    const first = (rec['errors'] as unknown[])[0] as
      | Record<string, unknown>
      | undefined;
    const arrMessage = first ? safeMessageFrom(first['message']) : undefined;
    if (arrMessage) {
      messageCandidatePaths.push('errors[0].message');
      errorMessageSafe = errorMessageSafe ?? arrMessage;
    }
  }

  return {
    ...base,
    format: 'JSON_OBJECT',
    topLevelKeys,
    nestedErrorPresent,
    nestedErrorKeys,
    messageCandidatePaths,
    errorType,
    errorCode,
    errorParam,
    errorMessageSafe,
  };
}

/**
 * Classify an OpenAI-Responses-family HTTP error, refined by the same safe
 * structured evidence `extractSafeResponsesErrorDetails` already extracts
 * for diagnostics. A 4xx whose body names `error.param: "model"` is
 * evidence-backed proof the *model identifier itself* was rejected, not a
 * generic malformed request — this is exactly the shape GitHub Copilot's
 * `/responses` proxy returns for a model present in discovery but not
 * enabled/available for the account ("The requested model is not
 * supported."). Reclassifying this to `MODEL_NOT_AVAILABLE` is honest and
 * evidence-driven (never inferred from provider identity alone); anything
 * without that specific evidence keeps the ordinary status-code
 * classification.
 */
export function classifyResponsesHttpError(
  status: number,
  bodyText: string,
): ClassifiedHttpError {
  const generic = classifyGenericHttpError(status, bodyText);
  if (generic.code !== 'INVALID_REQUEST') return generic;
  const safe = extractSafeResponsesErrorDetails(bodyText);
  if (safe.errorParam === 'model') {
    return { code: 'MODEL_NOT_AVAILABLE', message: generic.message };
  }
  return generic;
}

/**
 * Classify a generic (OpenAI-/Anthropic-/Ollama-compatible) HTTP error
 * response using only the HTTP status code and OMP's vetted rate-limit-
 * reason text heuristics. No provider-specific structured-error parsing —
 * dialects with a richer error schema (Google) use classifyGoogleHttpError
 * instead.
 */
export function classifyGenericHttpError(
  status: number,
  bodyText: string,
): ClassifiedHttpError {
  const fallback = `HTTP ${status}`;
  const message = sanitizeErrorBodyMessage(bodyText, fallback);

  if (status === 401) return { code: 'AUTH_REQUIRED', message };
  if (status === 403) return { code: 'ACCOUNT_RESTRICTED', message };
  if (status === 404) return { code: 'MODEL_NOT_AVAILABLE', message };
  if (status === 408) return { code: 'TIMEOUT', message };
  if (status === 409) return { code: 'CONFLICT', message };
  if (status === 429) {
    const reason = parseRateLimitReason(message);
    if (reason === 'QUOTA_EXHAUSTED') {
      return { code: 'QUOTA_EXHAUSTED', message };
    }
    return { code: 'RATE_LIMITED', message };
  }
  if (status >= 500) return { code: 'UPSTREAM_ERROR', message };
  // Any other 4xx (400, 422, ...): the request itself was rejected.
  return { code: 'INVALID_REQUEST', message };
}

/**
 * Classify an HTTP error response from a Google-family dialect (Gemini
 * Developer API, Vertex AI, Cloud Code Assist) given the already-extracted
 * safe error evidence (`extractSafeGoogleErrorDetails` in streaming.ts) —
 * Google's `status` field is a documented canonical gRPC-style code
 * (PERMISSION_DENIED/RESOURCE_EXHAUSTED/INVALID_ARGUMENT/...), a stronger
 * signal than the bare HTTP status alone.
 */
export function classifyGoogleHttpError(
  status: number,
  bodyText: string,
  details: GoogleErrorEvidence,
): ClassifiedHttpError {
  const fallback = `HTTP ${status}`;
  const message = details.safeMessage ?? fallback;

  switch (details.status) {
    case 'PERMISSION_DENIED':
      return { code: 'ACCOUNT_RESTRICTED', message };
    case 'UNAUTHENTICATED':
      return { code: 'AUTH_REQUIRED', message };
    case 'INVALID_ARGUMENT':
    case 'FAILED_PRECONDITION':
      return { code: 'INVALID_REQUEST', message };
    case 'NOT_FOUND':
      return { code: 'MODEL_NOT_AVAILABLE', message };
    case 'RESOURCE_EXHAUSTED': {
      const reason = parseRateLimitReason(message);
      return reason === 'QUOTA_EXHAUSTED'
        ? { code: 'QUOTA_EXHAUSTED', message }
        : { code: 'RATE_LIMITED', message };
    }
    case 'DEADLINE_EXCEEDED':
      return { code: 'TIMEOUT', message };
    default:
      break;
  }

  // No (or unrecognized) structured Google status: fall back to the same
  // HTTP-status-only classification every other dialect uses.
  return classifyGenericHttpError(status, bodyText);
}

/** Anthropic Messages API documented SSE/HTTP error `type` values. */
const ANTHROPIC_ERROR_TYPE_MAP: Readonly<
  Record<string, PlumbCanonicalErrorCode>
> = {
  invalid_request_error: 'INVALID_REQUEST',
  authentication_error: 'AUTH_REQUIRED',
  permission_error: 'ACCOUNT_RESTRICTED',
  not_found_error: 'MODEL_NOT_AVAILABLE',
  request_too_large: 'INVALID_REQUEST',
  rate_limit_error: 'RATE_LIMITED',
  api_error: 'UPSTREAM_ERROR',
  overloaded_error: 'UPSTREAM_ERROR',
};

/**
 * Classify an Anthropic Messages API HTTP error response. Prefers the
 * documented `error.type` field (a stronger signal than HTTP status alone);
 * falls back to generic HTTP-status classification when the body doesn't
 * carry that field (a proxy/gateway 4xx/5xx that never reached Anthropic).
 */
export function classifyAnthropicHttpError(
  status: number,
  bodyText: string,
): ClassifiedHttpError {
  const fallback = `HTTP ${status}`;
  try {
    const parsed = JSON.parse(bodyText.trim()) as {
      error?: { type?: string; message?: string };
    };
    const type = parsed.error?.type;
    if (type && type in ANTHROPIC_ERROR_TYPE_MAP) {
      const message = (parsed.error?.message ?? fallback).slice(
        0,
        MAX_MESSAGE_LEN,
      );
      if (type === 'rate_limit_error') {
        const reason = parseRateLimitReason(message);
        return reason === 'QUOTA_EXHAUSTED'
          ? { code: 'QUOTA_EXHAUSTED', message }
          : { code: 'RATE_LIMITED', message };
      }
      return { code: ANTHROPIC_ERROR_TYPE_MAP[type], message };
    }
  } catch {
    // Not the documented Anthropic error shape — fall through.
  }
  return classifyGenericHttpError(status, bodyText);
}

/**
 * Map the same documented Anthropic `error.type` vocabulary onto a
 * canonical code, for the streamed `event: error` SSE case (mid-stream,
 * same schema as the HTTP-level error body).
 */
export function classifyAnthropicSseErrorType(
  type: string | undefined,
  message: string,
): PlumbCanonicalErrorCode | undefined {
  if (!type) return undefined;
  if (type === 'rate_limit_error') {
    const reason = parseRateLimitReason(message);
    return reason === 'QUOTA_EXHAUSTED' ? 'QUOTA_EXHAUSTED' : 'RATE_LIMITED';
  }
  return ANTHROPIC_ERROR_TYPE_MAP[type];
}
