/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression: `claude-subscription` (a PLUMB-only synthetic with no OMP
 * catalog descriptor) must have a static model floor so a cold process
 * restart with a persisted claude-subscription/model selection resolves the
 * correct wire dialect (`claude-agent-sdk`) on the very first chat turn,
 * without depending on a live discovery call having already run.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { getCatalogModels, getCatalogModel } from './model-catalog.js';
import { CLAUDE_SUBSCRIPTION_MODELS } from '../transports/claudeSubscription.js';
import { setProviderConfigResolver } from '../config/providerConfigResolver.js';

describe('claude-subscription static catalog floor', () => {
  it('getCatalogModels returns real Anthropic models tagged with the claude-agent-sdk dialect and provider', () => {
    const models = getCatalogModels('claude-subscription');

    expect(models.length).toBeGreaterThan(0);
    for (const model of models) {
      expect(model.provider).toBe('claude-subscription');
      expect(model.api).toBe('claude-agent-sdk');
      // Real bundled Anthropic model ids, not synthetic/placeholder ids.
      expect(model.id).toMatch(/^claude-/);
    }
  });

  it('getCatalogModel resolves a specific model by id with the same overrides', () => {
    const [first] = getCatalogModels('claude-subscription');
    expect(first).toBeDefined();

    const resolved = getCatalogModel('claude-subscription', first!.id);

    expect(resolved).toBeDefined();
    expect(resolved!.provider).toBe('claude-subscription');
    expect(resolved!.api).toBe('claude-agent-sdk');
    expect(resolved!.id).toBe(first!.id);
  });

  it('does not misroute claude-subscription models to the raw anthropic-api provider id', () => {
    // The regression this guards against: before the fix, claude-subscription
    // had no models.json entry, so getCatalogModels returned []. A naive fix
    // of aliasing it to the 'anthropic' bundled catalog (without overriding
    // provider/api) would have made these models carry provider: 'anthropic'
    // and api: 'anthropic-messages' — silently routing Agent-SDK-intended
    // requests through the disabled raw OAuth / direct API-key path instead.
    const models = getCatalogModels('claude-subscription');
    for (const model of models) {
      expect(model.provider).not.toBe('anthropic');
      expect(model.api).not.toBe('anthropic-messages');
    }
  });

  it('exposes exactly the pinned Agent SDK model aliases — not the full Anthropic API catalog', () => {
    // The Agent SDK's query() only accepts a small, pinned set of model
    // aliases (CLAUDE_SUBSCRIPTION_MODELS), not arbitrary Anthropic
    // Developer Platform model ids. Regression: an earlier version of this
    // fix reused getBundledModels('anthropic') directly (the full API
    // catalog — dozens of model ids), which would let a user pick a model
    // id the SDK does not accept and misrepresented the source's real
    // provenance (a fixed static list, not a proper catalog).
    const models = getCatalogModels('claude-subscription');
    expect(models.length).toBe(CLAUDE_SUBSCRIPTION_MODELS.length);
    const expectedIds = new Set(CLAUDE_SUBSCRIPTION_MODELS.map((m) => m.id));
    for (const model of models) {
      expect(expectedIds.has(model.id)).toBe(true);
    }
  });

  it('omits per-token pricing (subscription usage is not metered the way API billing is)', () => {
    const models = getCatalogModels('claude-subscription');
    for (const model of models) {
      expect(model.pricing).toBeUndefined();
    }
  });

  it('other providers are unaffected by the claude-subscription special case', () => {
    const anthropicModels = getCatalogModels('anthropic-api');
    expect(anthropicModels.length).toBeGreaterThan(0);
    for (const model of anthropicModels) {
      expect(model.api).toBe('anthropic-messages');
    }
  });
});

describe('oci-genai static catalog floor', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("returns real OCI model ids tagged with the oci-openai-responses dialect (Responses API, Oracle's documented primary interface)", () => {
    const models = getCatalogModels('oci-genai');
    expect(models.length).toBeGreaterThan(0);
    for (const model of models) {
      expect(model.provider).toBe('oci-genai');
      expect(model.api).toBe('oci-openai-responses');
      expect(model.id).toMatch(/^openai\.gpt-oss-/);
    }
  });

  it('leaves toolsSupported undefined (unknown) -- no live per-model capability discovery adapter exists yet for oci-genai', () => {
    const models = getCatalogModels('oci-genai');
    for (const model of models) {
      expect(model.toolsSupported).toBeUndefined();
    }
  });

  it('builds the region-specific baseUrl from OCI_REGION (defaults to us-chicago-1)', () => {
    delete process.env['OCI_REGION'];
    const [defaultModel] = getCatalogModels('oci-genai');
    expect(defaultModel!.baseUrl).toBe(
      'https://inference.generativeai.us-chicago-1.oci.oraclecloud.com/openai/v1',
    );

    process.env['OCI_REGION'] = 'eu-frankfurt-1';
    const [euModel] = getCatalogModels('oci-genai');
    expect(euModel!.baseUrl).toBe(
      'https://inference.generativeai.eu-frankfurt-1.oci.oraclecloud.com/openai/v1',
    );
  });

  it('carries the required opc-compartment-id header from OCI_COMPARTMENT_ID, and omits it when unset', () => {
    process.env['OCI_COMPARTMENT_ID'] = 'ocid1.compartment.oc1..real';
    const [withCompartment] = getCatalogModels('oci-genai');
    expect(withCompartment!.headers).toEqual({
      'opc-compartment-id': 'ocid1.compartment.oc1..real',
    });

    delete process.env['OCI_COMPARTMENT_ID'];
    const [withoutCompartment] = getCatalogModels('oci-genai');
    expect(withoutCompartment!.headers).toBeUndefined();
  });

  it('getCatalogModel resolves a specific OCI model with the same baseUrl/header wiring', () => {
    process.env['OCI_COMPARTMENT_ID'] = 'ocid1.compartment.oc1..real';
    const resolved = getCatalogModel('oci-genai', 'openai.gpt-oss-120b');
    expect(resolved).toBeDefined();
    expect(resolved!.provider).toBe('oci-genai');
    expect(resolved!.headers).toEqual({
      'opc-compartment-id': 'ocid1.compartment.oc1..real',
    });
  });

  it('carries the required OpenAI-Project header from OCI_GENAI_PROJECT_ID -- Oracle docs: "OCI OpenAI-compatible API calls require a project"', () => {
    process.env['OCI_GENAI_PROJECT_ID'] =
      'ocid1.generativeaiproject.oc1.us-chicago-1.real';
    const [withProject] = getCatalogModels('oci-genai');
    expect(withProject!.headers).toEqual({
      'OpenAI-Project': 'ocid1.generativeaiproject.oc1.us-chicago-1.real',
    });

    delete process.env['OCI_GENAI_PROJECT_ID'];
    const [withoutProject] = getCatalogModels('oci-genai');
    expect(withoutProject!.headers).toBeUndefined();
  });

  it('carries both opc-compartment-id and OpenAI-Project headers together when both are configured', () => {
    process.env['OCI_COMPARTMENT_ID'] = 'ocid1.compartment.oc1..real';
    process.env['OCI_GENAI_PROJECT_ID'] =
      'ocid1.generativeaiproject.oc1.us-chicago-1.real';
    const [model] = getCatalogModels('oci-genai');
    expect(model!.headers).toEqual({
      'opc-compartment-id': 'ocid1.compartment.oc1..real',
      'OpenAI-Project': 'ocid1.generativeaiproject.oc1.us-chicago-1.real',
    });
  });
});

describe('Cloudflare AI Gateway configured endpoint', () => {
  afterEach(() => setProviderConfigResolver(undefined));

  it('replaces every placeholder catalog URL before first-request routing', () => {
    const configured =
      'https://gateway.ai.cloudflare.com/v1/0123456789abcdef0123456789abcdef/prod/anthropic';
    setProviderConfigResolver(
      (providerId): Readonly<Record<string, string>> =>
        providerId === 'cloudflare-ai-gateway' ? { baseUrl: configured } : {},
    );

    const models = getCatalogModels('cloudflare-ai-gateway');
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((model) => model.baseUrl === configured)).toBe(true);
    expect(JSON.stringify(models)).not.toContain('<account>');
    expect(JSON.stringify(models)).not.toContain('<gateway>');
  });
});
