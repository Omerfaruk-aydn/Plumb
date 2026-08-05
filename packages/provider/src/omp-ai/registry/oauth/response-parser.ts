// @ts-nocheck
/**
 * Safe JSON response parser for OAuth / device-code HTTP exchanges.
 *
 * Provider OAuth endpoints frequently answer with HTML interstitials, proxy
 * challenge pages, or stray CLI process-progress lines instead of the JSON a
 * request expected. Calling `response.json()` directly in those cases throws a
 * bare `SyntaxError` (`Unexpected token 'd', "device_cod"...`) that leaks an
 * opaque crash to the user instead of an actionable login error.
 *
 * This parser normalizes every non-JSON or unexpectedly-scalar body into an
 * {@link import("../../error/index.js").OAuthError} carrying the provider and
 * error kind, with a short excerpt — never the full secret-bearing body.
 */

import * as AIError from '../../error/index.js';

export interface SafeJsonParseOptions {
  /** Provider id recorded on the raised OAuthError (github-copilot, kimi, ...). */
  provider: string;
  /** Human label for the HTTP exchange (e.g. "GitHub device authorization"). */
  label: string;
  /** OAuthError kind; defaults to "polling" for device/token exchanges. */
  kind?: import('../../error/index.js').OAuthErrorKind;
  /** HTTP status observed on the response, when known. */
  status?: number;
}

/** Whether a text blob looks like an HTML document or fragment. */
function looksLikeHtml(text: string): boolean {
  return /<(?:\/?[a-zA-Z][^>]*>|!DOCTYPE|!--)/.test(text);
}

/**
 * Try to decode a body that is itself a JSON-encoded string containing JSON
 * (some device-code endpoints return `"{\"...\"}"` — a quoted scalar wrapping
 * the real payload). Returns the inner JSON parse when the outer parse yields a
 * string and re-parsing succeeds; otherwise `undefined`.
 */
function unwrapJsonString(body: string): unknown | undefined {
  const trimmed = body.trim();
  if (!trimmed.startsWith('"')) return undefined;
  try {
    const maybeString = JSON.parse(trimmed);
    if (typeof maybeString !== 'string') return undefined;
    return JSON.parse(maybeString);
  } catch {
    return undefined;
  }
}

/**
 * Parse a UTF-8 auth endpoint body as JSON, converting any failure into a
 * descriptive {@link AIError.OAuthError}.
 *
 * @throws {AIError.OAuthError} when the body is not valid JSON, is HTML, or is
 *   otherwise unexpected. Never throws a bare `SyntaxError`.
 */
export function parseAuthJsonResponse(
  body: string,
  options: SafeJsonParseOptions,
): unknown {
  const text = body.replace(/^\uFEFF/, '').trim();

  try {
    const direct = JSON.parse(text);
    if (typeof direct === 'string') {
      const unwrapped = unwrapJsonString(text);
      if (unwrapped !== undefined) {
        return unwrapped;
      }
    }
    return direct;
  } catch (parseError) {
    // Fall through to a normalized OAuthError.
    void parseError;
  }

  if (looksLikeHtml(text)) {
    throw new AIError.OAuthError(
      `${options.label} returned an HTML page instead of JSON (HTTP ${options.status ?? '?'}). ` +
        'This is usually a login interstitial, proxy/captcha challenge, or a client that needs a ' +
        'registered redirect. Re-run after completing any challenge, or verify the provider.',
      {
        kind: options.kind ?? 'polling',
        provider: options.provider,
        status: options.status,
      },
    );
  }

  const excerpt = text.length > 80 ? `${text.slice(0, 80)}...` : text;
  throw new AIError.OAuthError(
    `${options.label} returned an unexpected (non-JSON) response (HTTP ${options.status ?? '?'}): ${excerpt}`,
    {
      kind: options.kind ?? 'polling',
      provider: options.provider,
      status: options.status,
    },
  );
}
