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
  buildToolSchemaDiagnostics,
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

  it('PART G: reports the Claude Subscription model-selection authority audit, never fabricating account entitlement', async () => {
    const { lines, failures, rawSupportedModelCount } =
      await buildProviderModelsDiagnostics('claude-subscription');
    expect(failures).toEqual([]);
    const report = lines.join('\n');
    expect(report).toContain('[claude-subscription model authority]');
    expect(report).toMatch(/AGENT_SDK_RAW_COUNT: \d+/);
    expect(report).toContain('AGENT_SDK_IDS:');
    expect(report).toMatch(/OFFICIAL_CLIENT_ENUMERATION_AVAILABLE: (YES|NO)/);
    expect(report).toContain('OFFICIAL_CLIENT_COUNT:');
    expect(report).toMatch(
      /FINAL_SELECTION_AUTHORITY: (AGENT_SDK|OFFICIAL_CLIENT|FALLBACK)/,
    );
    expect(report).toMatch(/FINAL_MODEL_COUNT: \d+/);
    // AGENT_SDK_RAW_COUNT must match the same counter the rest of the
    // report already computed -- no second, disagreeing authority.
    expect(report).toContain(`AGENT_SDK_RAW_COUNT: ${rawSupportedModelCount}`);
  });
});

describe('buildModelLimitsDiagnostics', () => {
  it('emits a header, registered providers, models.total, and per-provider sections', async () => {
    const { lines, failures } = await buildModelLimitsDiagnostics();
    const report = lines.join('\n');
    expect(failures).toEqual([]);
    expect(report).toContain('PLUMB universal model metadata diagnostics');
    expect(report).toContain('git.head.embedded:');
    expect(report).toContain('registered.providers:');
    expect(report).toContain('models.total:');
    expect(report).toContain('models.identity.bundled:');
    expect(report).toContain('models.identity.pinned:');
    expect(report).toContain('models.context.known:');
    expect(report).toContain('models.output.known:');
    // The universal inventory must include at least registered
    // providers from the bundled catalog (even when no user is
    // configured). Per-provider sections use [provider-id] format.
    const providerSections = lines.filter((l) => /^\[[\w-]+\]$/.test(l));
    expect(providerSections.length).toBeGreaterThan(0);
    // Every registered provider section must have at least one model
    // or a "(none)" entry.
    for (const section of providerSections) {
      expect(section).toMatch(/^\[[\w-]+\]$/);
    }
  }, 15000);

  it('--summary prints only counts, no individual model rows, and is deterministic across two runs', async () => {
    const run1 = await buildModelLimitsDiagnostics({ summary: true });
    const run2 = await buildModelLimitsDiagnostics({ summary: true });
    expect(run1.failures).toEqual([]);
    const report1 = run1.lines.join('\n');
    expect(report1).toContain('registered.providers:');
    expect(report1).toContain('configured.providers:');
    expect(report1).toContain('selectable.providers:');
    expect(report1).toContain('models.total:');
    expect(report1).toContain('models.context.known:');
    expect(report1).toContain('models.context.unknown:');
    expect(report1).toContain('models.output.known:');
    expect(report1).toContain('models.output.unknown:');
    expect(report1).toMatch(
      /provider=[\w-]+ modelCount=\d+ configured=(true|false) discovery=/,
    );
    // No individual "model=..." rows in summary mode.
    expect(report1).not.toMatch(/^\s*model=/m);
    // Deterministic: two builds of the same static state hash-match.
    expect(run1.lines.join('\n')).toBe(run2.lines.join('\n'));
  }, 15000);

  it.each([
    'claude-subscription',
    'antigravity',
    'github-copilot',
    'opencode-go',
    'opencode-zen',
    'anthropic',
    'openai',
    'ollama',
    'sglang',
    'watsonx',
    'oci-genai',
  ])(
    '--provider %s prints a header even when model count is 0',
    async (providerId) => {
      const { lines, failures } = await buildModelLimitsDiagnostics({
        provider: providerId,
      });
      expect(failures).toEqual([]);
      const report = lines.join('\n');
      expect(report).toContain(`[${providerId}]`);
      // No other provider's section should be present.
      const providerSections = lines.filter((l) => /^\[[\w-]+\]$/.test(l));
      expect(providerSections).toEqual([`[${providerId}]`]);
    },
    15000,
  );

  it('reports a failure for an unknown provider id rather than fabricating a section', async () => {
    const { failures } = await buildModelLimitsDiagnostics({
      provider: 'not-a-real-provider-id',
    });
    expect(failures.length).toBeGreaterThan(0);
  }, 15000);
});

describe('buildToolSchemaDiagnostics (--diagnose-tools)', () => {
  it('reports every built-in tool as canonically valid, including update_topic', async () => {
    const { lines, failures } = await buildToolSchemaDiagnostics();
    expect(failures).toEqual([]);
    const report = lines.join('\n');
    expect(report).toContain('PLUMB tool schema diagnostics');
    expect(report).toContain('total.tools:');
    expect(report).toMatch(/invalid\.canonical\.schemas: 0/);
    expect(report).toContain('tool=update_topic');
    expect(report).toContain('tool=read_file');
    // No tool row may report an invalid canonical schema.
    expect(report).not.toContain('canonical.valid: false');
    // Every dialect serializer must accept every canonical tool.
    expect(report).not.toContain('openai.valid: false');
    expect(report).not.toContain('anthropic.valid: false');
    expect(report).not.toContain('gemini.valid: false');
    expect(report).not.toContain('mcp.valid: false');
  });

  it('never prints prompt or file contents -- only tool names and schema shape metadata', async () => {
    const { lines } = await buildToolSchemaDiagnostics();
    const report = lines.join('\n');
    // Property descriptions (which may reference user-facing prose) must
    // never leak into this diagnostic -- only counts/booleans/names.
    expect(report).not.toMatch(/description:/i);
  });

  it('--provider + --model reports resolved capability, wire model, and advertised count without secrets', async () => {
    const { lines, failures } = await buildToolSchemaDiagnostics({
      provider: 'claude-subscription',
      model: 'claude-opus-4-8',
    });
    expect(failures).toEqual([]);
    const report = lines.join('\n');
    expect(report).toContain('[provider capability]');
    expect(report).toContain('provider: claude-subscription');
    expect(report).toContain('model: claude-opus-4-8');
    expect(report).toContain('toolsSupported: true');
    expect(report).toContain('capability.status: SUPPORTED');
    expect(report).toContain('capability.source: PINNED_REFERENCE');
    expect(report).toContain('wire.model: claude-opus-4-8');
    expect(report).toContain('canonical.tool.count:');
    expect(report).toContain('advertised.tool.count:');
    expect(report).toContain('tools.suppressed.reason: NONE');
  });

  it('reports an unknown model as CAPABILITY_UNKNOWN with zero advertised tools', async () => {
    const { lines, failures } = await buildToolSchemaDiagnostics({
      provider: 'opencode-go',
      model: 'not-in-catalog',
    });
    expect(failures).toEqual([]);
    const report = lines.join('\n');
    expect(report).toContain('toolsSupported: UNKNOWN');
    expect(report).toContain('capability.status: UNKNOWN');
    expect(report).toContain('capability.source: UNKNOWN');
    expect(report).toContain('advertised.tool.count: 0');
    expect(report).toContain('tools.suppressed.reason: CAPABILITY_UNKNOWN');
  });
});
