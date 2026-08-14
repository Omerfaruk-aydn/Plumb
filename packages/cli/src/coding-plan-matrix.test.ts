/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  ALL_CODING_PLAN_IDS,
  buildPlanDiagnostics,
  buildCodingPlanLiveStatus,
} from './runtimeDiagnostics.js';

describe('coding-plan governance matrix', () => {
  for (const planId of ALL_CODING_PLAN_IDS) {
    it(`${planId}: auth route exists, registration valid, models present, transport present`, async () => {
      const { lines, failures } = await buildPlanDiagnostics(planId);
      const report = lines.join('\n');

      // 1. No structural failures from the diagnostics builder.
      expect(
        failures,
        `${planId} diagnostics build should have no failures`,
      ).toEqual([]);

      // 2. The plan must have an auth mechanism (not NONE).
      expect(report, `${planId} must have a mechanism`).not.toContain(
        'mechanism: NONE',
      );

      // 3. The plan must have an OMP login or an API-key auth method.
      const hasLogin = report.includes('omp.login: present');
      const hasAuthMethod =
        report.includes('auth.methods: api_key') ||
        report.includes('auth.methods: device_code') ||
        report.includes('auth.methods: oauth');
      expect(
        hasLogin || hasAuthMethod,
        `${planId} must have an OMP login or an auth method`,
      ).toBe(true);

      // 4. Registration classification must be one of the valid labels.
      const validRegistrations = [
        'UPSTREAM_PRODUCT_OWNED_REGISTRATION',
        'OFFICIAL_CLI_DELEGATION',
        'NO_OAUTH_CLIENT_REGISTRATION',
        'MISSING_REGISTRATION',
      ];
      const regLine = lines.find((l) => l.startsWith('registration:'));
      expect(regLine, `${planId} must have a registration line`).toBeDefined();
      const regValue = regLine!.split(': ')[1];
      expect(
        validRegistrations,
        `${planId} registration "${regValue}" must be a valid label`,
      ).toContain(regValue);

      // 5. Bundled model count must be > 0 for selectable plans.
      const modelCountLine = lines.find((l) =>
        l.startsWith('bundled.model.count:'),
      );
      expect(
        modelCountLine,
        `${planId} must have a model count line`,
      ).toBeDefined();
      const modelCount = parseInt(modelCountLine!.split(': ')[1], 10);
      expect(modelCount, `${planId} must have bundled models`).toBeGreaterThan(
        0,
      );

      // 6. Transport (authMethods) must be non-empty.
      const authMethodsLine = lines.find((l) => l.startsWith('auth.methods:'));
      expect(authMethodsLine, `${planId} must have auth methods`).toBeDefined();
      const authMethods = authMethodsLine!.split(': ')[1];
      expect(
        authMethods,
        `${planId} must have non-empty auth methods`,
      ).not.toBe('none');

      // 7. Final classification must NOT be PRODUCTION_READY.
      const finalLine = lines.find((l) =>
        l.startsWith('final.classification:'),
      );
      expect(
        finalLine,
        `${planId} must have a final classification`,
      ).toBeDefined();
      expect(
        finalLine!.includes('PRODUCTION_READY'),
        `${planId} must not claim PRODUCTION_READY without live verification`,
      ).toBe(false);

      // 8. Final classification must be one of the valid static labels.
      const validFinals = [
        'IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED',
        'IMPLEMENTATION_INCOMPLETE_NOT_SELECTABLE',
        'BLOCKED_CLIENT_REGISTRATION',
      ];
      const finalValue = finalLine!.split(': ')[1];
      expect(
        validFinals,
        `${planId} final classification "${finalValue}" must be a valid static label`,
      ).toContain(finalValue);

      // 9. Selectable plans must have IMPLEMENTATION_COMPLETE (not BLOCKED or INCOMPLETE).
      const selectableLine = lines.find((l) => l.startsWith('selectable:'));
      expect(
        selectableLine,
        `${planId} must have a selectable line`,
      ).toBeDefined();
      if (selectableLine!.includes('selectable: true')) {
        expect(
          finalValue,
          `${planId} selectable=true but final classification is not IMPLEMENTATION_COMPLETE`,
        ).toBe('IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED');
      }

      // 10. API-key plans must not have a generic browser prompt.
      //     (API-key plans use onPrompt, not onAuth → no browser-open instruction.)
      if (authMethods.includes('api_key')) {
        expect(
          report,
          `${planId} api_key plan must not contain browser-open instruction`,
        ).not.toContain('Open the sign-in page in your browser');
      }

      // 11. Plans with pasteCodeFlow must have a callback port.
      if (report.includes('omp.pasteCodeFlow: true')) {
        expect(
          report,
          `${planId} pasteCodeFlow=true must have a callback port`,
        ).not.toContain('omp.callbackPort: none');
      }

      // 12. The live.status line must be present and must NOT equal LIVE_VERIFIED.
      const liveStatusLine = lines.find((l) => l.startsWith('live.status:'));
      expect(
        liveStatusLine,
        `${planId} must have a live.status line`,
      ).toBeDefined();
      expect(
        liveStatusLine,
        `${planId} must not claim LIVE_VERIFIED without live test`,
      ).not.toBe('live.status: LIVE_VERIFIED');
    });
  }
});

describe('coding-plan live-verification gate', () => {
  it('reports zero live-verified plans and the correct checkpoint', () => {
    const lines = buildCodingPlanLiveStatus();
    const report = lines.join('\n');

    expect(report).toContain('LIVE_VERIFIED_CODING_PLANS: 0');
    expect(report).toContain(
      'PLUMB_CODING_PLAN_AUTH_STATIC_REPAIR_READY_FOR_LIVE_USER_TEST',
    );
    expect(report).toContain('GITHUB_COPILOT: PENDING_REAL_DEVICE_LOGIN');
    expect(report).toContain('KIMI_CODE: PENDING_REAL_DEVICE_LOGIN');
    expect(report).toContain(
      'OPENCODE_GO: OFFICIAL_DELEGATION_VERIFIED_OR_BLOCKED',
    );
    expect(report).toContain('ANTIGRAVITY: PENDING_REAL_OAUTH_OR_BLOCKED');

    // Must never claim PRODUCTION_READY in the gate report.
    expect(report).not.toContain('PRODUCTION_READY');
  });

  it('exports ALL_CODING_PLAN_IDS with exactly 23 entries', () => {
    expect(ALL_CODING_PLAN_IDS.length).toBe(23);
    // Spot-check the four previously-broken plans are present.
    expect(ALL_CODING_PLAN_IDS).toContain('github-copilot');
    expect(ALL_CODING_PLAN_IDS).toContain('kimi-code');
    expect(ALL_CODING_PLAN_IDS).toContain('opencode-go');
    expect(ALL_CODING_PLAN_IDS).toContain('antigravity');
  });
});
