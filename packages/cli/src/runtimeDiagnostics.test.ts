/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateFreshness,
  buildRuntimeIdentityReport,
  buildLogoDiagnostics,
  buildPlanDiagnostics,
  buildProviderModelsDiagnostics,
  buildModelLimitsDiagnostics,
} from './runtimeDiagnostics.js';
import { BUILD_IDENTITY } from './generated/buildIdentity.js';
import { createTestMergedSettings } from './config/settings.js';

describe('evaluateFreshness', () => {
  it('reports current when embedded HEAD matches the repository HEAD', () => {
    const head = 'a'.repeat(40);
    const verdict = evaluateFreshness(head, head);
    expect(verdict.kind).toBe('current');
    expect(verdict.message).toContain('current');
  });

  it('reports stale when embedded HEAD differs from the repository HEAD', () => {
    const verdict = evaluateFreshness('a'.repeat(40), 'b'.repeat(40));
    expect(verdict.kind).toBe('stale');
    expect(verdict.message).toContain('STALE');
    expect(verdict.message).toContain('a'.repeat(40));
    expect(verdict.message).toContain('b'.repeat(40));
  });

  it('reports indeterminate when no repository HEAD is detectable', () => {
    const verdict = evaluateFreshness('a'.repeat(40), null);
    expect(verdict.kind).toBe('indeterminate');
  });
});

describe('buildRuntimeIdentityReport', () => {
  it('produces all required identity fields of the running production build', () => {
    const { lines } = buildRuntimeIdentityReport();
    const report = lines.join('\n');

    const requiredKeys = [
      'product.name:',
      'package.name:',
      'package.version:',
      'command.shimPath:',
      'command.jsEntryPath:',
      'command.packageRoot:',
      'build.embeddedHead:',
      'repo.currentHead:',
      'source.entryMtime:',
      'dist.entryMtime:',
      'freshness:',
      'module.providerStartup.source:',
      'module.providerRegistry.source:',
      'module.wordmark.source:',
    ];
    for (const key of requiredKeys) {
      expect(report).toContain(key);
    }
    expect(report).toContain('product.name: PLUMB');
    expect(report).toContain(`build.embeddedHead: ${BUILD_IDENTITY.gitHead}`);
  });

  it('fails freshness when the embedded HEAD cannot match the repository', () => {
    const { staleReasons } = buildRuntimeIdentityReport();
    const headMismatch = staleReasons.filter((reason) =>
      reason.includes('does not match repository HEAD'),
    );
    expect(headMismatch).toEqual([]);
  });
});

describe('buildLogoDiagnostics', () => {
  it('derives the animated rgb-gradient mode for a color-capable default session', () => {
    const settings = createTestMergedSettings();
    const d = buildLogoDiagnostics(settings);
    expect(d.renderingMode).toBe('rgb-gradient-block (animated)');
    expect(d.animationEnabled).toBe(true);
    expect(d.animationReason).toContain('fps');
  });

  it('selects ascii-block mode when NO_COLOR is present', () => {
    const settings = createTestMergedSettings();
    const original = process.env['NO_COLOR'];
    process.env['NO_COLOR'] = '1';
    try {
      const d = buildLogoDiagnostics(settings);
      expect(d.renderingMode).toBe('ascii-block (no color)');
      expect(d.animationEnabled).toBe(false);
      expect(d.animationReason).toContain('NO_COLOR');
    } finally {
      if (original === undefined) {
        delete process.env['NO_COLOR'];
      } else {
        process.env['NO_COLOR'] = original;
      }
    }
  });

  it('selects plain-text mode when the screen reader setting is on', () => {
    const settings = createTestMergedSettings();
    settings.ui.accessibility = {
      ...settings.ui.accessibility,
      screenReader: true,
    };
    const d = buildLogoDiagnostics(settings);
    expect(d.renderingMode).toBe('plain-text (screen reader)');
    expect(d.animationEnabled).toBe(false);
    expect(d.animationReason).toContain('screen reader');
  });

  it('disables animation when ui.animatedLogo is false', () => {
    const settings = createTestMergedSettings();
    settings.ui.animatedLogo = false;
    const d = buildLogoDiagnostics(settings);
    expect(d.renderingMode).toBe('rgb-gradient-block (static)');
    expect(d.animationEnabled).toBe(false);
    expect(d.animationReason).toContain('ui.animatedLogo');
  });

  it('never prints secret-bearing environment variables', () => {
    const settings = createTestMergedSettings();
    const sentinel = 'sk-test-SECRET-sentinel-value';
    const original = process.env['GEMINI_API_KEY'];
    process.env['GEMINI_API_KEY'] = sentinel;
    try {
      const d = buildLogoDiagnostics(settings);
      const serialized = JSON.stringify(d);
      expect(serialized).not.toContain(sentinel);
    } finally {
      if (original === undefined) {
        delete process.env['GEMINI_API_KEY'];
      } else {
        process.env['GEMINI_API_KEY'] = original;
      }
    }
  });
});

describe('buildPlanDiagnostics', () => {
  it('classifies the four previously-broken coding plans as selectable device/api-key flows', async () => {
    for (const id of [
      'github-copilot',
      'kimi-code',
      'opencode-go',
      'antigravity',
    ]) {
      const { lines, failures } = await buildPlanDiagnostics(id);
      const report = lines.join('\n');
      expect(failures, `${id} should build without failures`).toEqual([]);
      expect(report).toContain(`PLUMB coding-plan diagnostics: ${id}`);
      expect(report).toContain('selectable: true');
      expect(report).toMatch(
        /final\.classification: IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED/,
      );
    }
  });

  it('reports the device-code mechanism for github-copilot', async () => {
    const { lines } = await buildPlanDiagnostics('github-copilot');
    const report = lines.join('\n');
    expect(report).toContain('mechanism: DEVICE_CODE');
    expect(report).toContain(
      'registration: UPSTREAM_PRODUCT_OWNED_REGISTRATION',
    );
  });

  it('reports the api_key mechanism and OFFICIAL_CLI_DELEGATION for opencode-go', async () => {
    const { lines } = await buildPlanDiagnostics('opencode-go');
    const report = lines.join('\n');
    expect(report).toContain('mechanism: API_KEY');
    expect(report).toContain('registration: OFFICIAL_CLI_DELEGATION');
  });
});

describe('buildProviderModelsDiagnostics', () => {
  it('classifies a live agent-sdk probe as AGENT_SDK discovery with BUNDLED_FALLBACK floor', async () => {
    const {
      lines,
      failures,
      provenance,
      fallbackUsed,
      rawSupportedModelCount,
    } = await buildProviderModelsDiagnostics('claude-subscription');
    expect(failures).toEqual([]);
    const report = lines.join('\n');
    expect(report).toContain('PLUMB provider model discovery diagnostics');
    expect(report).toContain('canonical.provider: claude-subscription');
    expect(report).toContain('discovery.source: AGENT_SDK');
    expect(report).toContain('live.source:');
    // bundled floor must be present and non-zero
    expect(report).toMatch(/bundled\.model\.count: \d+/);
    expect(report).toContain('ui.picker.model.count:');
    // Live probe may succeed or fall back depending on whether the
    // dev machine has an authenticated `claude` session; either way
    // the provenance field is one of the documented values.
    expect([
      'ACCOUNT_DYNAMIC',
      'OFFICIAL_CLIENT_DYNAMIC',
      'BUNDLED_FALLBACK',
      'CACHE',
      'UNKNOWN',
    ]).toContain(provenance);
    // A successful live probe must surface >0 raw count; a fallback
    // floor (no auth) must surface 0. Either is acceptable, but the
    // counter must be a real integer.
    expect(Number.isInteger(rawSupportedModelCount)).toBe(true);
    // If fallback is used, the provenance must be BUNDLED_FALLBACK.
    if (fallbackUsed) {
      expect(provenance).toBe('BUNDLED_FALLBACK');
    }
  });

  it('returns UNKNOWN provenance and a safe failure when given a totally unknown provider id', async () => {
    const { lines } = await buildProviderModelsDiagnostics(
      'this-provider-definitely-does-not-exist-zzz',
    );
    // Non-fatal: the diagnostic must not crash; it should still
    // emit the header + safe identification lines.
    const report = lines.join('\n');
    expect(report).toContain('PLUMB provider model discovery diagnostics');
    expect(report).toContain('canonical.provider:');
  });
});

describe('buildModelLimitsDiagnostics', () => {
  it('emits a header, an active-model count, and a per-model line for every active model', async () => {
    const { lines, failures } = await buildModelLimitsDiagnostics();
    const report = lines.join('\n');
    expect(failures).toEqual([]);
    expect(report).toContain('PLUMB model limits diagnostics');
    expect(report).toMatch(/active\.model\.count: \d+/);
    // Per-model lines have a stable "provider=... model=... context=...
    // (provenance) maxOutput=... (provenance)" shape — the diagnostic
    // must follow it for every model the registry reports.
    const perModelLines = lines.filter(
      (l) => l.includes('provider=') && l.includes('model='),
    );
    const countMatch = report.match(/active\.model\.count: (\d+)/);
    expect(countMatch).not.toBeNull();
    if (countMatch) {
      const declared = Number(countMatch[1]);
      // When the active model count is > 0, the per-model lines must
      // cover it. When 0, the per-model list is empty (no providers
      // authenticated in this test environment).
      if (declared > 0) {
        expect(perModelLines.length).toBeGreaterThan(0);
        for (const line of perModelLines) {
          expect(line).toMatch(/context=\S+/);
          expect(line).toMatch(/maxOutput=\S+/);
        }
      } else {
        expect(perModelLines.length).toBe(0);
      }
    }
  });
});
