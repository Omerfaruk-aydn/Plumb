/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  classifyGenericHttpError,
  classifyGoogleHttpError,
  classifyAnthropicHttpError,
  classifyAnthropicSseErrorType,
  classifyResponsesHttpError,
  extractSafeResponsesErrorDetails,
  extractSafeErrorEnvelope,
  sanitizeErrorBodyMessage,
} from './errorClassification.js';

describe('classifyGenericHttpError (OpenAI-/Ollama-compatible status codes)', () => {
  it('400 -> INVALID_REQUEST', () => {
    expect(
      classifyGenericHttpError(
        400,
        JSON.stringify({ error: { message: 'bad request' } }),
      ).code,
    ).toBe('INVALID_REQUEST');
  });

  it('401 -> AUTH_REQUIRED', () => {
    expect(
      classifyGenericHttpError(
        401,
        JSON.stringify({ error: { message: 'invalid api key' } }),
      ).code,
    ).toBe('AUTH_REQUIRED');
  });

  it('403 -> ACCOUNT_RESTRICTED', () => {
    expect(
      classifyGenericHttpError(
        403,
        JSON.stringify({ error: { message: 'forbidden' } }),
      ).code,
    ).toBe('ACCOUNT_RESTRICTED');
  });

  it('404 -> MODEL_NOT_AVAILABLE', () => {
    expect(
      classifyGenericHttpError(
        404,
        JSON.stringify({ error: { message: 'model not found' } }),
      ).code,
    ).toBe('MODEL_NOT_AVAILABLE');
  });

  it('408 -> TIMEOUT', () => {
    expect(classifyGenericHttpError(408, '').code).toBe('TIMEOUT');
  });

  it('409 -> CONFLICT', () => {
    expect(classifyGenericHttpError(409, '').code).toBe('CONFLICT');
  });

  it('429 with no quota evidence -> RATE_LIMITED', () => {
    const result = classifyGenericHttpError(
      429,
      JSON.stringify({
        error: { message: 'Too many requests, please slow down.' },
      }),
    );
    expect(result.code).toBe('RATE_LIMITED');
  });

  it('429 with quota-exhaustion evidence -> QUOTA_EXHAUSTED', () => {
    const result = classifyGenericHttpError(
      429,
      JSON.stringify({
        error: { message: 'You have exceeded your monthly quota.' },
      }),
    );
    expect(result.code).toBe('QUOTA_EXHAUSTED');
  });

  it('500/502/503 -> UPSTREAM_ERROR', () => {
    expect(classifyGenericHttpError(500, '').code).toBe('UPSTREAM_ERROR');
    expect(classifyGenericHttpError(502, '').code).toBe('UPSTREAM_ERROR');
    expect(classifyGenericHttpError(503, '').code).toBe('UPSTREAM_ERROR');
  });

  it('an unmapped 4xx (422) falls back to INVALID_REQUEST rather than guessing', () => {
    expect(classifyGenericHttpError(422, '').code).toBe('INVALID_REQUEST');
  });

  it('extracts the nested error.message field from a JSON body', () => {
    const result = classifyGenericHttpError(
      400,
      JSON.stringify({ error: { message: 'Specific reason from provider' } }),
    );
    expect(result.message).toBe('Specific reason from provider');
  });

  it('falls back to a bounded raw-text message for a non-JSON body', () => {
    const result = classifyGenericHttpError(500, 'plain text upstream failure');
    expect(result.message).toBe('plain text upstream failure');
  });

  it('never surfaces a raw HTML error page as the message', () => {
    const html =
      '<!DOCTYPE html><html><body><h1>502 Bad Gateway</h1><p>nginx</p></body></html>';
    const result = classifyGenericHttpError(502, html);
    expect(result.message).not.toContain('<html');
    expect(result.message).not.toContain('<body');
    expect(result.code).toBe('UPSTREAM_ERROR');
  });

  it('bounds an oversized JSON error message to a safe length', () => {
    const huge = 'x'.repeat(10_000);
    const result = classifyGenericHttpError(
      400,
      JSON.stringify({ error: { message: huge } }),
    );
    expect(result.message.length).toBeLessThanOrEqual(500);
  });
});

describe('classifyGoogleHttpError (Gemini/Vertex/Cloud Code Assist)', () => {
  it('PERMISSION_DENIED -> ACCOUNT_RESTRICTED', () => {
    const result = classifyGoogleHttpError(403, '', {
      status: 'PERMISSION_DENIED',
      safeMessage: 'Caller does not have permission',
    });
    expect(result.code).toBe('ACCOUNT_RESTRICTED');
  });

  it('UNAUTHENTICATED -> AUTH_REQUIRED', () => {
    const result = classifyGoogleHttpError(401, '', {
      status: 'UNAUTHENTICATED',
      safeMessage: 'Request had invalid authentication credentials',
    });
    expect(result.code).toBe('AUTH_REQUIRED');
  });

  it('INVALID_ARGUMENT -> INVALID_REQUEST', () => {
    const result = classifyGoogleHttpError(400, '', {
      status: 'INVALID_ARGUMENT',
      safeMessage: 'Invalid value for field',
    });
    expect(result.code).toBe('INVALID_REQUEST');
  });

  it('NOT_FOUND -> MODEL_NOT_AVAILABLE', () => {
    const result = classifyGoogleHttpError(404, '', {
      status: 'NOT_FOUND',
      safeMessage: 'Model not found',
    });
    expect(result.code).toBe('MODEL_NOT_AVAILABLE');
  });

  it('a bare resource_exhausted status (transient model capacity, no quota wording) -> RATE_LIMITED', () => {
    // OMP's parseRateLimitReason treats the bare gRPC status name
    // ("resource_exhausted") as transient MODEL_CAPACITY_EXHAUSTED, distinct
    // from explicit quota/balance wording — see rate-limit.ts's
    // RESOURCE_EXHAUSTED_PATTERN stripping. classifyGenericHttpError maps
    // anything short of QUOTA_EXHAUSTED evidence to the safe RATE_LIMITED
    // default rather than guessing QUOTA_EXHAUSTED.
    const result = classifyGoogleHttpError(429, '', {
      status: 'RESOURCE_EXHAUSTED',
      safeMessage: 'resource_exhausted',
    });
    expect(result.code).toBe('RATE_LIMITED');
  });

  it('RESOURCE_EXHAUSTED with quota-exhaustion evidence -> QUOTA_EXHAUSTED', () => {
    const result = classifyGoogleHttpError(429, '', {
      status: 'RESOURCE_EXHAUSTED',
      safeMessage:
        'You have exhausted your capacity on this model. Your quota will reset after 24h.',
    });
    expect(result.code).toBe('QUOTA_EXHAUSTED');
  });

  it('DEADLINE_EXCEEDED -> TIMEOUT', () => {
    const result = classifyGoogleHttpError(504, '', {
      status: 'DEADLINE_EXCEEDED',
      safeMessage: 'Deadline exceeded',
    });
    expect(result.code).toBe('TIMEOUT');
  });

  it('falls back to generic HTTP-status classification with no structured status', () => {
    const result = classifyGoogleHttpError(500, '', {});
    expect(result.code).toBe('UPSTREAM_ERROR');
  });

  it('falls back to generic HTTP-status classification for an unrecognized status value', () => {
    const result = classifyGoogleHttpError(400, '', {
      status: 'SOME_FUTURE_GOOGLE_STATUS',
    });
    expect(result.code).toBe('INVALID_REQUEST');
  });
});

describe('classifyAnthropicHttpError', () => {
  it('authentication_error -> AUTH_REQUIRED', () => {
    const result = classifyAnthropicHttpError(
      401,
      JSON.stringify({
        error: { type: 'authentication_error', message: 'invalid x-api-key' },
      }),
    );
    expect(result.code).toBe('AUTH_REQUIRED');
    expect(result.message).toBe('invalid x-api-key');
  });

  it('permission_error -> ACCOUNT_RESTRICTED', () => {
    const result = classifyAnthropicHttpError(
      403,
      JSON.stringify({
        error: { type: 'permission_error', message: 'no access to this model' },
      }),
    );
    expect(result.code).toBe('ACCOUNT_RESTRICTED');
  });

  it('not_found_error -> MODEL_NOT_AVAILABLE', () => {
    const result = classifyAnthropicHttpError(
      404,
      JSON.stringify({
        error: { type: 'not_found_error', message: 'model not found' },
      }),
    );
    expect(result.code).toBe('MODEL_NOT_AVAILABLE');
  });

  it('invalid_request_error -> INVALID_REQUEST', () => {
    const result = classifyAnthropicHttpError(
      400,
      JSON.stringify({
        error: {
          type: 'invalid_request_error',
          message: 'messages: at least one message is required',
        },
      }),
    );
    expect(result.code).toBe('INVALID_REQUEST');
  });

  it('rate_limit_error without quota evidence -> RATE_LIMITED', () => {
    const result = classifyAnthropicHttpError(
      429,
      JSON.stringify({
        error: {
          type: 'rate_limit_error',
          message: 'Number of requests has exceeded your per-minute rate limit',
        },
      }),
    );
    expect(result.code).toBe('RATE_LIMITED');
  });

  it('overloaded_error -> UPSTREAM_ERROR', () => {
    const result = classifyAnthropicHttpError(
      529,
      JSON.stringify({
        error: { type: 'overloaded_error', message: 'Overloaded' },
      }),
    );
    expect(result.code).toBe('UPSTREAM_ERROR');
  });

  it('falls back to generic HTTP-status classification for a non-Anthropic-shaped body (e.g. a proxy 502)', () => {
    const result = classifyAnthropicHttpError(
      502,
      '<html><body>Bad Gateway</body></html>',
    );
    expect(result.code).toBe('UPSTREAM_ERROR');
    expect(result.message).not.toContain('<html');
  });
});

describe('classifyAnthropicSseErrorType', () => {
  it('maps documented SSE error types to canonical codes', () => {
    expect(classifyAnthropicSseErrorType('authentication_error', '')).toBe(
      'AUTH_REQUIRED',
    );
    expect(classifyAnthropicSseErrorType('overloaded_error', '')).toBe(
      'UPSTREAM_ERROR',
    );
  });

  it('returns undefined for an unrecognized type (caller keeps its own fallback)', () => {
    expect(
      classifyAnthropicSseErrorType('some_future_error_type', ''),
    ).toBeUndefined();
  });

  it('returns undefined for a missing type', () => {
    expect(classifyAnthropicSseErrorType(undefined, '')).toBeUndefined();
  });
});

describe('sanitizeErrorBodyMessage', () => {
  it('returns the fallback for an empty body', () => {
    expect(sanitizeErrorBodyMessage('', 'HTTP 500')).toBe('HTTP 500');
  });

  it('returns the fallback for an HTML body', () => {
    expect(
      sanitizeErrorBodyMessage('<html><body>oops</body></html>', 'HTTP 502'),
    ).toBe('HTTP 502');
  });

  it('prefers error.message over top-level message when both are present', () => {
    expect(
      sanitizeErrorBodyMessage(
        JSON.stringify({ message: 'outer', error: { message: 'inner' } }),
        'fallback',
      ),
    ).toBe('inner');
  });
});

describe('classifyResponsesHttpError (regression G: evidence-driven model_not_supported classification)', () => {
  it('G. a 400 with error.param="model" reclassifies from generic INVALID_REQUEST to MODEL_NOT_AVAILABLE — the exact GitHub Copilot /responses gpt-5.5 shape', () => {
    const body = JSON.stringify({
      error: {
        type: 'invalid_request_error',
        param: 'model',
        message: 'The requested model is not supported.',
      },
    });
    const result = classifyResponsesHttpError(400, body);
    expect(result.code).toBe('MODEL_NOT_AVAILABLE');
  });

  it('a 400 with no error.param="model" evidence keeps the ordinary generic classification (never fabricated)', () => {
    const body = JSON.stringify({
      error: { type: 'invalid_request_error', message: 'bad request shape' },
    });
    const result = classifyResponsesHttpError(400, body);
    expect(result.code).toBe('INVALID_REQUEST');
  });

  it('a non-INVALID_REQUEST status (e.g. 401) is never reclassified by param evidence', () => {
    const body = JSON.stringify({
      error: { type: 'authentication_error', param: 'model', message: 'x' },
    });
    const result = classifyResponsesHttpError(401, body);
    expect(result.code).toBe('AUTH_REQUIRED');
  });

  it('an unparsable body falls through to the ordinary status-code classification', () => {
    const result = classifyResponsesHttpError(400, 'not json');
    expect(result.code).toBe('INVALID_REQUEST');
  });
});

describe('extractSafeResponsesErrorDetails on an Anthropic-shaped body (regression A: Anthropic Copilot 400 body safe parsing)', () => {
  it('A. parses the documented Anthropic error shape ({error:{type,message}}, no param) safely', () => {
    const body = JSON.stringify({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: 'thinking.budget_tokens: Field required',
      },
    });
    const details = extractSafeResponsesErrorDetails(body);
    expect(details.errorType).toBe('invalid_request_error');
    expect(details.errorParam).toBeUndefined();
    expect(details.errorMessageSafe).toBe(
      'thinking.budget_tokens: Field required',
    );
  });

  it('bounds the message to 300 chars and redacts credential-looking substrings', () => {
    const longMessage = `Bearer sk-abcdefgh12345678 ${'x'.repeat(400)}`;
    const body = JSON.stringify({
      error: { type: 'invalid_request_error', message: longMessage },
    });
    const details = extractSafeResponsesErrorDetails(body);
    expect(details.errorMessageSafe).not.toContain('sk-abcdefgh12345678');
    expect(details.errorMessageSafe!.length).toBeLessThanOrEqual(300);
  });
});

describe('extractSafeErrorEnvelope (provider-neutral SAFE response-shape forensics)', () => {
  it('canonical Anthropic error JSON: {error:{type,message}}, no param', () => {
    const body = JSON.stringify({
      type: 'error',
      error: { type: 'invalid_request_error', message: 'bad field' },
    });
    const env = extractSafeErrorEnvelope(body, 'application/json');
    expect(env.bodyPresent).toBe(true);
    expect(env.format).toBe('JSON_OBJECT');
    expect([...env.topLevelKeys].sort()).toEqual(['error', 'type']);
    expect(env.nestedErrorPresent).toBe(true);
    expect([...env.nestedErrorKeys].sort()).toEqual(['message', 'type']);
    expect(env.messageCandidatePaths).toEqual(['error.message']);
    expect(env.errorType).toBe('invalid_request_error');
    expect(env.errorParam).toBeUndefined();
    expect(env.errorMessageSafe).toBe('bad field');
  });

  it('OpenAI-style error JSON: {error:{type,param,code,message}}', () => {
    const body = JSON.stringify({
      error: {
        type: 'invalid_request_error',
        code: 'model_not_found',
        param: 'model',
        message: 'The requested model is not supported.',
      },
    });
    const env = extractSafeErrorEnvelope(body);
    expect(env.format).toBe('JSON_OBJECT');
    expect(env.errorType).toBe('invalid_request_error');
    expect(env.errorCode).toBe('model_not_found');
    expect(env.errorParam).toBe('model');
    expect(env.errorMessageSafe).toBe('The requested model is not supported.');
    expect(env.messageCandidatePaths).toEqual(['error.message']);
  });

  it('GitHub-style message JSON: {message:"..."}', () => {
    const body = JSON.stringify({ message: 'Bad credentials' });
    const env = extractSafeErrorEnvelope(body);
    expect(env.format).toBe('JSON_OBJECT');
    expect(env.topLevelKeys).toEqual(['message']);
    expect(env.nestedErrorPresent).toBe(false);
    expect(env.messageCandidatePaths).toEqual(['message']);
    expect(env.errorMessageSafe).toBe('Bad credentials');
    expect(env.errorType).toBeUndefined();
  });

  it('error-as-string JSON: {error:"..."}', () => {
    const body = JSON.stringify({ error: 'unauthorized' });
    const env = extractSafeErrorEnvelope(body);
    expect(env.format).toBe('JSON_OBJECT');
    expect(env.nestedErrorPresent).toBe(false);
    expect(env.messageCandidatePaths).toEqual(['error']);
    expect(env.errorMessageSafe).toBe('unauthorized');
  });

  it('{detail:"..."} shape', () => {
    const body = JSON.stringify({ detail: 'Not found' });
    const env = extractSafeErrorEnvelope(body);
    expect(env.messageCandidatePaths).toEqual(['detail']);
    expect(env.errorMessageSafe).toBe('Not found');
  });

  it('errors-array JSON: {errors:[{message:"..."}]}', () => {
    const body = JSON.stringify({ errors: [{ message: 'field x invalid' }] });
    const env = extractSafeErrorEnvelope(body);
    expect(env.format).toBe('JSON_OBJECT');
    expect(env.messageCandidatePaths).toEqual(['errors[0].message']);
    expect(env.errorMessageSafe).toBe('field x invalid');
  });

  it('a bare top-level JSON array reports [0].message when present', () => {
    const body = JSON.stringify([{ message: 'top-level array error' }]);
    const env = extractSafeErrorEnvelope(body);
    expect(env.format).toBe('JSON_ARRAY');
    expect(env.messageCandidatePaths).toEqual(['[0].message']);
    expect(env.errorMessageSafe).toBe('top-level array error');
  });

  it('plain-text error body', () => {
    const env = extractSafeErrorEnvelope(
      'upstream refused the connection',
      'text/plain',
    );
    expect(env.format).toBe('TEXT');
    expect(env.bodyPresent).toBe(true);
    expect(env.topLevelKeys).toEqual([]);
    expect(env.textSafe).toBe('upstream refused the connection');
    expect(env.errorMessageSafe).toBeUndefined();
  });

  it('HTML error body strips markup and never leaks it in textSafe', () => {
    const env = extractSafeErrorEnvelope(
      '<html><body><h1>502 Bad Gateway</h1></body></html>',
      'text/html',
    );
    expect(env.format).toBe('HTML');
    expect(env.textSafe).not.toContain('<');
    expect(env.textSafe).toContain('502 Bad Gateway');
  });

  it('empty body', () => {
    const env = extractSafeErrorEnvelope('', undefined);
    expect(env.format).toBe('EMPTY');
    expect(env.bodyPresent).toBe(false);
    expect(env.byteLength).toBe(0);
    expect(env.textSafe).toBeUndefined();
  });

  it('malformed JSON falls back to TEXT, never throws', () => {
    const env = extractSafeErrorEnvelope('{ "error": "unterminated');
    expect(env.format).toBe('TEXT');
    expect(env.errorMessageSafe).toBeUndefined();
  });

  it('a recognized-but-unmapped JSON object still reports its shape (top-level keys) without inventing a message', () => {
    const body = JSON.stringify({ status: 503, retryAfterSeconds: 30 });
    const env = extractSafeErrorEnvelope(body);
    expect(env.format).toBe('JSON_OBJECT');
    expect([...env.topLevelKeys].sort()).toEqual([
      'retryAfterSeconds',
      'status',
    ]);
    expect(env.messageCandidatePaths).toEqual([]);
    expect(env.errorMessageSafe).toBeUndefined();
  });

  it('a bare JSON primitive (not an object/array) reports UNKNOWN, never invents structure', () => {
    const env = extractSafeErrorEnvelope('"just a string"');
    expect(env.format).toBe('UNKNOWN');
    expect(env.topLevelKeys).toEqual([]);
  });

  it('secret redaction: bearer tokens and API keys never appear in errorMessageSafe or textSafe', () => {
    const jsonBody = JSON.stringify({
      error: {
        type: 'authentication_error',
        message: 'Bearer sk-abcdefgh12345678 rejected; token=ya29.abc123XYZ',
      },
    });
    const envJson = extractSafeErrorEnvelope(jsonBody);
    expect(envJson.errorMessageSafe).not.toContain('sk-abcdefgh12345678');
    expect(envJson.errorMessageSafe).not.toContain('ya29.abc123XYZ');

    const textBody = 'auth failed: Bearer sk-abcdefgh12345678';
    const envText = extractSafeErrorEnvelope(textBody, 'text/plain');
    expect(envText.textSafe).not.toContain('sk-abcdefgh12345678');
  });

  it('300-char truncation applies to both errorMessageSafe and textSafe', () => {
    const longJson = JSON.stringify({ message: 'x'.repeat(1000) });
    const envJson = extractSafeErrorEnvelope(longJson);
    expect(envJson.errorMessageSafe!.length).toBeLessThanOrEqual(300);

    const longText = 'y'.repeat(1000);
    const envText = extractSafeErrorEnvelope(longText, 'text/plain');
    expect(envText.textSafe!.length).toBeLessThanOrEqual(300);
  });

  it('byte length reflects the actual body, and content-type defaults to "none" when absent', () => {
    const env = extractSafeErrorEnvelope('{"message":"hi"}');
    expect(env.contentType).toBe('none');
    expect(env.byteLength).toBe(
      new TextEncoder().encode('{"message":"hi"}').length,
    );
  });

  it('caps reported key counts to a reasonable maximum rather than dumping an unbounded list', () => {
    const manyKeys: Record<string, string> = {};
    for (let i = 0; i < 50; i++) manyKeys[`k${i}`] = 'v';
    const env = extractSafeErrorEnvelope(JSON.stringify(manyKeys));
    expect(env.topLevelKeys.length).toBeLessThanOrEqual(20);
  });
});
