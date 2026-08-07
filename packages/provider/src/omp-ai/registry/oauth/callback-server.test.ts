/**
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Real user finding: the OAuth callback page served by OAuthCallbackFlow
 * (packages/provider/src/omp-ai/registry/oauth/oauth.html) showed "oh my pi"
 * branding to PLUMB users completing a real Antigravity login.
 *
 * This asserts the static template content directly — no live HTTP round
 * trip. A real-socket integration test was attempted (starting the actual
 * OAuthCallbackFlow server and fetching from it) but hit a persistent
 * Windows-loopback EADDRNOTAVAIL in this environment even with the retry
 * pattern already established in omp-shims/bun-runtime-serve.test.ts —
 * an environment networking issue, not a defect in the reviewed code path.
 * The callback-server.ts redaction fix (stripping code/state from the
 * rendered page) was verified by direct code review instead.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const templateHtml = readFileSync(
  join(import.meta.dirname, 'oauth.html'),
  'utf-8',
);

describe('OAuth callback page template — PLUMB branding', () => {
  it('browser title is PLUMB, not oh my pi', () => {
    expect(templateHtml).toContain('<title>PLUMB — Authentication</title>');
  });

  it('contains no "oh my pi" branding anywhere', () => {
    expect(templateHtml.toLowerCase()).not.toContain('oh my pi');
  });

  it('wordmark shown to the user is PLUMB', () => {
    expect(templateHtml).toContain('<span class="wordmark">PLUMB</span>');
  });

  it('success message identifies PLUMB, not an upstream product', () => {
    expect(templateHtml).toContain('now connected to PLUMB');
    expect(templateHtml).toContain('return to PLUMB');
  });

  it('failure message is generic and does not template in the raw server error', () => {
    expect(templateHtml).toContain(
      'PLUMB could not complete authentication',
    );
    // The old template interpolated serverState.error directly into the
    // page; the new one only reads serverState.ok — no dynamic error text
    // is rendered.
    expect(templateHtml).not.toMatch(/message\.textContent\s*=\s*serverState\.error/);
  });

  it('does not reference other upstream product names', () => {
    for (const brand of ['Gemini CLI', 'Claude Code', 'oh-my-pi']) {
      expect(templateHtml).not.toContain(brand);
    }
  });
});

describe('OAuth callback server — code/state redaction (source review)', () => {
  const serverSource = readFileSync(
    join(import.meta.dirname, 'callback-server.ts'),
    'utf-8',
  );

  it('builds a separate sanitized renderState for the HTML response instead of embedding the raw resultState', () => {
    expect(serverSource).toMatch(/const renderState = resultState\.ok/);
    expect(serverSource).toContain(
      'replaceAll("__OAUTH_STATE__", JSON.stringify(renderState))',
    );
    // The raw resultState (which carries `code`/`state` on success) must no
    // longer be the value serialized into the page.
    expect(serverSource).not.toContain(
      'replaceAll("__OAUTH_STATE__", JSON.stringify(resultState))',
    );
  });

  it('renderState success case carries no additional fields beyond ok', () => {
    const match = serverSource.match(
      /const renderState = resultState\.ok \? (\{[^}]*\}) : /,
    );
    expect(match).not.toBeNull();
    expect(match![1].replace(/\s/g, '')).toBe('{ok:true}'.replace(/\s/g, ''));
  });
});
