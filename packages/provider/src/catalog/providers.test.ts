/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provider catalog projection contract: every selectable provider must be
 * backed by an imported OMP descriptor (registry definition or catalog
 * entry), and the provider inventory must be OMP-derived (no hard-coded
 * independent array in the facade).
 */

import { describe, it, expect } from 'vitest';
import {
  SELECTABLE_PROVIDERS,
  PLUMB_PROVIDERS,
  PRODUCTION_READY_PROVIDER_IDS,
} from './providers.js';
import { getProviderDefinition } from '../omp-ai/registry/registry.js';
import { getCatalogProviderEntry } from '../omp-catalog/provider-models/descriptors.js';

// PLUMB ids that legitimately have no OMP descriptor (PLUMB-only surfaces).
const PLUMB_ONLY_IDS = new Set([
  'custom-openai-compat',
  'google-login',
  'claude-subscription',
  'watsonx',
]);

// PLUMB presentation id → OMP registry id (mirrors the facade alias map).
const PLUMB_TO_OMP: Record<string, string> = {
  antigravity: 'google-antigravity',
  'llama-cpp': 'llama.cpp',
  'anthropic-api': 'anthropic',
};

/** Resolve the OMP id backing a PLUMB id (or undefined for PLUMB-only). */
function resolveOmpId(plumbId: string): string | undefined {
  return PLUMB_TO_OMP[plumbId] ?? plumbId;
}

describe('provider catalog projection', () => {
  it('projects a unique, OMP-backed provider inventory (no independent array)', () => {
    // The catalog is a projection: ids are unique and every non-PLUMB-only
    // id resolves to an OMP registry or catalog descriptor. OMP registry-only
    // search/tool providers (exa, kagi, parallel, tavily, gitlab-duo-workflow,
    // openai-codex-device) are intentionally not UI chat providers.
    const ids = PLUMB_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const provider of PLUMB_PROVIDERS) {
      if (PLUMB_ONLY_IDS.has(provider.id)) continue;
      const ompId = resolveOmpId(provider.id);
      expect(
        ompId !== undefined &&
          (getProviderDefinition(ompId) !== undefined ||
            getCatalogProviderEntry(ompId) !== undefined),
        `provider ${provider.id} has no OMP descriptor`,
      ).toBe(true);
    }
  });

  it('every selectable provider has an imported OMP descriptor', () => {
    for (const provider of SELECTABLE_PROVIDERS) {
      if (PLUMB_ONLY_IDS.has(provider.id)) {
        // PLUMB-only providers must NOT be selectable (no OMP backing).
        expect(
          provider.available,
          `${provider.id} is PLUMB-only and must not be selectable`,
        ).toBe(false);
        continue;
      }
      const ompId = resolveOmpId(provider.id);
      const ompDef = ompId ? getProviderDefinition(ompId) : undefined;
      const catalogEntry = ompId ? getCatalogProviderEntry(ompId) : undefined;
      expect(
        ompDef !== undefined || catalogEntry !== undefined,
        `selectable provider ${provider.id} has no imported OMP descriptor`,
      ).toBe(true);
    }
  });

  it('every selectable provider is OMP-backed and has valid registration', () => {
    // The invariant: every selectable provider must have OMP backing
    // AND must not be in the blocked client-registration set.
    const blockedClientReg = new Set(['openai-codex']);
    for (const id of PRODUCTION_READY_PROVIDER_IDS) {
      const provider = PLUMB_PROVIDERS.find((p) => p.id === id);
      expect(provider?.available).toBe(true);
      expect(blockedClientReg.has(id)).toBe(false);
    }
  });

  it('openai-codex is non-selectable (blocked client registration)', () => {
    const codex = PLUMB_PROVIDERS.find((p) => p.id === 'openai-codex');
    expect(codex).toBeDefined();
    expect(codex!.available).toBe(false);
    expect(PRODUCTION_READY_PROVIDER_IDS.has('openai-codex')).toBe(false);
    // openai API key provider remains separately selectable.
    expect(PRODUCTION_READY_PROVIDER_IDS.has('openai')).toBe(true);
  });

  it('anthropic (raw Claude Code OAuth) is non-selectable (blocked upstream policy)', () => {
    const anthropic = PLUMB_PROVIDERS.find((p) => p.id === 'anthropic');
    expect(anthropic).toBeDefined();
    expect(anthropic!.available).toBe(false);
    expect(anthropic!.availabilityReason).toBe('BLOCKED_UPSTREAM_POLICY');
    expect(PRODUCTION_READY_PROVIDER_IDS.has('anthropic')).toBe(false);
    // Direct Anthropic API key access is unaffected.
    expect(PRODUCTION_READY_PROVIDER_IDS.has('anthropic-api')).toBe(true);
  });

  it('amazon-bedrock declares its real ambient AWS credential env vars, not authMethods: [{type: "none"}]', () => {
    // Regression: authMethods: [{type:'none'}] with allowUnauthenticated
    // undefined/false is indistinguishable, in the setup dialog, from a
    // provider with no working way to authenticate at all -- the
    // AuthStep component renders an empty box and Enter does nothing (the
    // same dead-end class of bug fixed for claude-subscription). Bedrock's
    // real credential is the standard AWS credential chain
    // (AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, or AWS_PROFILE, or
    // AWS_BEARER_TOKEN_BEDROCK -- see omp-ai/providers/aws-credentials.ts),
    // which must be surfaced as a real 'env' auth method.
    const bedrock = PLUMB_PROVIDERS.find((p) => p.id === 'amazon-bedrock');
    expect(bedrock).toBeDefined();
    expect(bedrock!.authMethods.some((m) => m.type === 'env')).toBe(true);
    expect(bedrock!.authMethods.every((m) => m.type !== 'none')).toBe(true);
    const envMethod = bedrock!.authMethods.find((m) => m.type === 'env') as {
      type: 'env';
      envVars: string[];
    };
    expect(envMethod.envVars).toContain('AWS_ACCESS_KEY_ID');
    expect(envMethod.envVars).toContain('AWS_SECRET_ACCESS_KEY');
  });

  it('llama-cpp and vllm are correctly marked allowUnauthenticated (real local keyless servers, not a dead-end auth step)', () => {
    // Regression: llama-cpp has no OMP catalog descriptor at all
    // (allowUnauthenticated would resolve to undefined/falsy), and vllm's
    // descriptor sets allowUnauthenticated:true nested inside
    // catalogDiscovery rather than at the top level this projection reads
    // (also resolves to false). Both are real local, keyless servers --
    // without the presentation-layer override, both would route to the
    // 'authenticate' step with authMethods: [{type:'none'}], which matches
    // none of AuthStep's branches (a dead end, same class of bug fixed for
    // claude-subscription and amazon-bedrock).
    for (const id of ['llama-cpp', 'vllm']) {
      const provider = PLUMB_PROVIDERS.find((p) => p.id === id);
      expect(provider, `${id} not found`).toBeDefined();
      expect(provider!.allowUnauthenticated, `${id}.allowUnauthenticated`).toBe(
        true,
      );
    }
  });

  it('claude-subscription is a PLUMB-only synthetic (no OMP backing, not in the OMP-derived selectable set)', () => {
    const sub = PLUMB_PROVIDERS.find((p) => p.id === 'claude-subscription');
    expect(sub).toBeDefined();
    expect(sub!.available).toBe(false);
    expect(sub!.availabilityReason).toBe('PLUMB_ONLY_SYNTHETIC');
    expect(PRODUCTION_READY_PROVIDER_IDS.has('claude-subscription')).toBe(
      false,
    );
  });

  describe('auth dead-end regression invariant', () => {
    // This session found the exact same real bug -- a provider whose
    // authMethods/allowUnauthenticated shape matches none of
    // PlumbProviderSetupDialog's branches, so selecting it in /login is a
    // silent dead end -- five separate times (claude-subscription,
    // amazon-bedrock, azure, llama-cpp, vllm). This test locks the
    // invariant down permanently: every provider PLUMB actually intends
    // users to reach through setup (every SELECTABLE_PROVIDERS entry, plus
    // the PLUMB-only synthetics the setup dialog bespoke-injects --
    // 'claude-subscription' and 'watsonx', see
    // packages/cli/src/ui/hooks/useProviderSetupData.ts) must resolve to
    // at least one valid, reachable setup branch. A future provider
    // addition that reintroduces this bug class fails this test.
    //
    // Valid setup branches, matching PlumbProviderSetupDialog.tsx exactly:
    //   - allowUnauthenticated: true (routes straight to model-select)
    //   - authMethods includes oauth/api_key/device_code (a real submit
    //     path exists in AuthStep + the authenticate-step Enter handler)
    //   - authMethods is env-only, non-empty (the dedicated
    //     "press Enter once the env vars are set" branch)
    //   - id === 'claude-subscription' (the one legitimate bespoke
    //     exception: no PLUMB-initiated auth at all -- a real connection
    //     probe drives its own dedicated routing, see
    //     probeClaudeSubscription in PlumbProviderSetupDialog.tsx)
    const BESPOKE_PROBE_EXCEPTIONS = new Set(['claude-subscription']);

    function hasValidSetupBranch(provider: {
      id: string;
      allowUnauthenticated?: boolean;
      authMethods: Array<{ type: string }>;
    }): boolean {
      if (provider.allowUnauthenticated === true) return true;
      if (BESPOKE_PROBE_EXCEPTIONS.has(provider.id)) return true;
      if (
        provider.authMethods.some(
          (m) =>
            m.type === 'oauth' ||
            m.type === 'api_key' ||
            m.type === 'device_code',
        )
      ) {
        return true;
      }
      if (
        provider.authMethods.length > 0 &&
        provider.authMethods.every((m) => m.type === 'env')
      ) {
        return true;
      }
      return false;
    }

    it('every selectable provider resolves to a valid setup branch', () => {
      const failures: string[] = [];
      for (const provider of SELECTABLE_PROVIDERS) {
        if (!hasValidSetupBranch(provider)) failures.push(provider.id);
      }
      expect(
        failures,
        `providers with no valid setup branch: ${failures.join(', ')}`,
      ).toEqual([]);
    });

    it('every bespoke-injected PLUMB-only synthetic (claude-subscription, watsonx) also resolves to a valid setup branch', () => {
      const failures: string[] = [];
      for (const id of ['claude-subscription', 'watsonx']) {
        const provider = PLUMB_PROVIDERS.find((p) => p.id === id);
        if (!provider || !hasValidSetupBranch(provider)) failures.push(id);
      }
      expect(
        failures,
        `synthetic providers with no valid setup branch: ${failures.join(', ')}`,
      ).toEqual([]);
    });
  });
});
