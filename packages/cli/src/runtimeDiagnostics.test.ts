/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateFreshness,
  buildRuntimeIdentityReport,
  buildLogoDiagnostics,
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
