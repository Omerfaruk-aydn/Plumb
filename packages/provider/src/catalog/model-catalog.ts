/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Complete model catalog loader (THIN PLUMB UI FACADE over the OMP authority).
 *
 * The bundled model data, provider set, and per-provider lookups are the
 * responsibility of the imported OMP runtime (`omp-catalog/models.ts`); this
 * module only projects the OMP `Model` records onto the PLUMB `PlumbModel`
 * shape the UI consumes.
 *
 * OMP source: packages/catalog/src/models.ts
 * OMP SHA: 4df68d60438423b384b2b47fb3d6835641624757
 */

import type { Model, Api, KnownProvider } from '../omp-catalog/types.js';
import type { GeneratedProvider } from '../omp-catalog/models.js';
import {
  getBundledModels,
  getBundledModel,
  getBundledProviders,
} from '../omp-catalog/models.js';
import type {
  PlumbModel,
  PlumbProviderId,
  PlumbKnownApi,
  PlumbModelPricing,
} from '../types.js';
import { resolveProviderAlias } from './providers.js';
import { CLAUDE_SUBSCRIPTION_MODELS } from '../transports/claudeSubscription.js';
import { resolveProviderConfigValue } from '../config/providerConfigResolver.js';

// ─── OMP → PLUMB projection ────────────────────────────────────────────

const GENERATED_PROVIDERS = new Set<string>(getBundledProviders());

/**
 * Provider ids that share a catalog entry under a different id.
 * e.g. zai-coding-plan's models are under "zai" in the bundled catalog.
 */
const CATALOG_PROVIDER_FALLBACK: Readonly<Record<string, string>> = {
  'zai-coding-plan': 'zai',
};

/** True when an OMP provider id is a key of the bundled models.json. */
function isGeneratedProvider(id: string): id is GeneratedProvider {
  return GENERATED_PROVIDERS.has(id);
}

/** Resolve the catalog provider id for a PLUMB provider id. */
function resolveCatalogProviderId(providerId: string): string {
  return (
    CATALOG_PROVIDER_FALLBACK[providerId] ??
    resolveProviderAlias(providerId) ??
    providerId
  );
}

/** Map an OMP `Model` onto the PLUMB `PlumbModel` shape. */
export function ompModelToPlumbModel(model: Model<Api>): PlumbModel {
  const pricing: PlumbModelPricing | undefined = model.cost
    ? {
        input: model.cost.input,
        output: model.cost.output,
        cacheRead: model.cost.cacheRead,
        cacheWrite: model.cost.cacheWrite,
      }
    : undefined;

  const input: PlumbModel['input'] = model.input.includes('image')
    ? 'text+image'
    : 'text';

  const baseUrl =
    model.provider === 'cloudflare-ai-gateway'
      ? resolveProviderConfigValue(
          'cloudflare-ai-gateway',
          'baseUrl',
          'CLOUDFLARE_AI_GATEWAY_BASE_URL',
          model.baseUrl,
        )
      : model.baseUrl;

  return {
    id: model.id,
    provider: model.provider as PlumbProviderId,
    name: model.name,
    api: model.api as PlumbKnownApi,
    requestModelId: model.requestModelId,
    contextWindow: model.contextWindow ?? 0,
    maxTokens: model.maxTokens ?? 0,
    reasoning: model.reasoning,
    input,
    pricing,
    baseUrl,
    isOAuth: model.isOAuth,
  };
}

// ─── Generated catalog accessors (delegated to OMP) ────────────────────

/** Get all providers present in the bundled model catalog. */
export function getCatalogProviders(): string[] {
  return getBundledProviders() as string[];
}

/**
 * `claude-subscription` is a PLUMB-only synthetic (transports/claudeSubscription.ts,
 * Agent SDK-backed) with no OMP catalog descriptor, so it is never a
 * `GeneratedProvider` key and `getBundledModels`/`isGeneratedProvider` never
 * cover it. Without a static floor here, `getModelsForProvider` returns
 * nothing until a live discovery call has run at least once in the current
 * process — on a cold restart with a persisted `claude-subscription`
 * selection, the very first chat turn would find no registry model and
 * silently fall back to the wrong wire dialect (`openai-completions`
 * instead of `claude-agent-sdk`), misrouting the request.
 *
 * IMPORTANT — model source honesty: this deliberately does NOT reuse the
 * full bundled Anthropic Developer Platform catalog (`getBundledModels
 * ('anthropic')`). That catalog lists every Anthropic API model id;
 * `options.model` for the Agent SDK's `query()` only accepts the small,
 * pinned set of model aliases in `CLAUDE_SUBSCRIPTION_MODELS`
 * (transports/claudeSubscription.ts) — Anthropic exposes no live
 * model-list endpoint for Claude subscription sessions the way the
 * Developer Platform API does. Offering the full API catalog here would
 * both misrepresent the model source's real provenance
 * (OFFICIAL_STATIC_METADATA, not a proper catalog) and let a user pick a
 * model id the Agent SDK may reject. Pricing is intentionally omitted —
 * subscription usage is not metered per-token the way direct API billing
 * is, so carrying over the API catalog's per-token cost figures here would
 * misrepresent how usage is actually billed.
 */
const CLAUDE_SUBSCRIPTION_PROVIDER_ID = 'claude-subscription';

function claudeSubscriptionCatalogModels(): PlumbModel[] {
  return CLAUDE_SUBSCRIPTION_MODELS.map((m) => ({
    id: m.id,
    name: m.name,
    provider: CLAUDE_SUBSCRIPTION_PROVIDER_ID as PlumbProviderId,
    api: 'claude-agent-sdk' as PlumbKnownApi,
    contextWindow: m.contextWindow,
    maxTokens: m.maxTokens,
    reasoning: m.reasoning,
    // The Agent SDK's supportedModels() result is the pinned authority for
    // this intentionally two-model Subscription surface, and its MCP bridge
    // is the documented client-tool mechanism for these aliases. Do not
    // extrapolate this fact to other Anthropic API models.
    toolsSupported: true,
    toolsCapabilitySource: 'PINNED_REFERENCE',
    input: 'text' as const,
  }));
}

/**
 * `watsonx` is a PLUMB-only synthetic (transports/watsonx.ts, official
 * `@ibm-cloud/watsonx-ai` SDK) with no OMP catalog descriptor. Same
 * cold-start reasoning as claude-subscription above: without a static
 * floor, a fresh process with a persisted `watsonx` selection would find
 * no registry model on the first chat turn and fall back to the wrong
 * wire dialect. Real, minimal, confirmed IBM foundation model ids
 * (see transports/watsonx.ts module doc for sourcing) -- live discovery
 * via the SDK's `listFoundationModelSpecs()` (registry/model-discovery.ts's
 * WatsonxDiscovery) supersedes this floor once a discovery call has run.
 */
const WATSONX_PROVIDER_ID = 'watsonx';

interface WatsonxStaticModel {
  id: string;
  name: string;
}

const WATSONX_STATIC_MODELS: readonly WatsonxStaticModel[] = [
  { id: 'ibm/granite-3-3-8b-instruct', name: 'Granite 3.3 8B Instruct' },
  { id: 'ibm/granite-4-h-small', name: 'Granite 4.0-h Small' },
  { id: 'meta-llama/llama-3-3-70b-instruct', name: 'Llama 3.3 70B Instruct' },
];

function watsonxCatalogModels(): PlumbModel[] {
  return WATSONX_STATIC_MODELS.map((m) => ({
    id: m.id,
    name: m.name,
    provider: WATSONX_PROVIDER_ID as PlumbProviderId,
    api: 'watsonx-chat' as PlumbKnownApi,
    contextWindow: 131072,
    maxTokens: 8192,
    reasoning: false,
    input: 'text' as const,
  }));
}

/**
 * `oci-genai` is a PLUMB-only synthetic (no OMP catalog descriptor) whose
 * base URL (https://inference.generativeai.{region}.oci.oraclecloud.com/openai/v1)
 * hosts both an OpenAI-Chat-Completions-wire-identical `/chat/completions`
 * endpoint and the Responses API at `/responses`. Oracle documents the
 * Responses API as the primary OpenAI-compatible interface for new/agentic
 * workloads, so `api: 'oci-openai-responses'` (transports/ociGenaiResponses.ts)
 * is the default dialect here -- a distinct, explicit dialect rather than
 * folding it into the generic `openai-completions` transport, since OCI's
 * Responses calls carry OCI-specific auth (OCI_GENAI_API_KEY bearer OR
 * OCI_IAM signing -- see transports/ociGenaiIamAuth.ts) and capability
 * surface. Real, minimal, confirmed OCI model ids (openai.gpt-oss-* -- see
 * transports registration in registry/model-discovery.ts / catalog
 * providers.ts for sourcing). baseUrl and the required opc-compartment-id/
 * OpenAI-Project headers are resolved fresh from ambient env config
 * (OCI_REGION, OCI_COMPARTMENT_ID, OCI_GENAI_PROJECT_ID) on every call
 * rather than cached, so a region/compartment/project change takes effect
 * on the very next model lookup.
 *
 * PROJECT vs COMPARTMENT: Oracle's own docs state plainly "OCI
 * OpenAI-compatible API calls require a project" -- a distinct
 * `ocid1.generativeaiproject.oc1.{region}.{id}` resource for organizing
 * Generative AI agents/requests, separate from the general-purpose OCI
 * compartment used for IAM policy scoping. Every officially documented
 * client example passes it via the OpenAI SDK's own `project` constructor
 * parameter (never a bespoke OCI-specific kwarg) -- Oracle's OpenAI-compat
 * endpoint is deliberately built to accept the vanilla `openai` client
 * unmodified, and that parameter's one documented wire mechanism across
 * every OpenAI SDK is the `OpenAI-Project` request header, so that is what
 * PLUMB sends here. (Oracle's docs do not publish a raw curl/header
 * reference for this specific header name; this is the one mechanism
 * consistent with "unmodified OpenAI SDK compatibility", not a guess from
 * the model name or an invented header.)
 *
 * TOOLS CAPABILITY: no live OCI model/region discovery adapter exists yet
 * (tracked as separate follow-up work -- see registry/model-discovery.ts),
 * so this static floor cannot report real per-model `toolsSupported`
 * metadata the way WatsonxDiscovery does; it stays `undefined` (unknown),
 * never guessed `true`, consistent with the "undefined means unknown"
 * contract on `PlumbModel.toolsSupported`.
 */
const OCI_GENAI_PROVIDER_ID = 'oci-genai';
const OCI_DEFAULT_REGION = 'us-chicago-1';

interface OciGenaiStaticModel {
  id: string;
  name: string;
}

const OCI_GENAI_STATIC_MODELS: readonly OciGenaiStaticModel[] = [
  { id: 'openai.gpt-oss-120b', name: 'GPT-OSS 120B (OCI)' },
  { id: 'openai.gpt-oss-20b', name: 'GPT-OSS 20B (OCI)' },
];

function ociGenaiCatalogModels(): PlumbModel[] {
  const region =
    resolveProviderConfigValue(
      OCI_GENAI_PROVIDER_ID,
      'region',
      'OCI_REGION',
      OCI_DEFAULT_REGION,
    ) ?? OCI_DEFAULT_REGION;
  const baseUrl = `https://inference.generativeai.${region}.oci.oraclecloud.com/openai/v1`;
  const compartmentId = resolveProviderConfigValue(
    OCI_GENAI_PROVIDER_ID,
    'compartmentId',
    'OCI_COMPARTMENT_ID',
  );
  const projectId = resolveProviderConfigValue(
    OCI_GENAI_PROVIDER_ID,
    'projectId',
    'OCI_GENAI_PROJECT_ID',
  );
  const headers: Record<string, string> = {};
  if (compartmentId) headers['opc-compartment-id'] = compartmentId;
  if (projectId) headers['OpenAI-Project'] = projectId;
  return OCI_GENAI_STATIC_MODELS.map((m) => ({
    id: m.id,
    name: m.name,
    provider: OCI_GENAI_PROVIDER_ID as PlumbProviderId,
    api: 'oci-openai-responses' as PlumbKnownApi,
    baseUrl,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    contextWindow: 131072,
    maxTokens: 8192,
    reasoning: false,
    input: 'text' as const,
  }));
}

/** Get all models for a provider from the bundled OMP catalog. */
export function getCatalogModels(providerId: PlumbProviderId): PlumbModel[] {
  if (providerId === OCI_GENAI_PROVIDER_ID) {
    return ociGenaiCatalogModels();
  }
  if (providerId === WATSONX_PROVIDER_ID) {
    return watsonxCatalogModels();
  }
  if (providerId === CLAUDE_SUBSCRIPTION_PROVIDER_ID) {
    return claudeSubscriptionCatalogModels();
  }
  const resolvedId = resolveCatalogProviderId(providerId);
  if (!isGeneratedProvider(resolvedId)) return [];
  return getBundledModels(resolvedId).map(ompModelToPlumbModel);
}

/** Get a specific model from the catalog. */
export function getCatalogModel(
  providerId: PlumbProviderId,
  modelId: string,
): PlumbModel | undefined {
  if (providerId === WATSONX_PROVIDER_ID) {
    return watsonxCatalogModels().find((m) => m.id === modelId);
  }
  if (providerId === OCI_GENAI_PROVIDER_ID) {
    return ociGenaiCatalogModels().find((m) => m.id === modelId);
  }
  if (providerId === CLAUDE_SUBSCRIPTION_PROVIDER_ID) {
    return claudeSubscriptionCatalogModels().find((m) => m.id === modelId);
  }
  const resolvedId = resolveCatalogProviderId(providerId);
  if (!isGeneratedProvider(resolvedId)) return undefined;
  const model = getBundledModel<Api>(resolvedId, modelId);
  if (!model) return undefined;
  return ompModelToPlumbModel(model);
}

/** Get the total model count in the catalog. */
export function getCatalogModelCount(): number {
  let count = 0;
  for (const providerId of getBundledProviders()) {
    if (isGeneratedProvider(providerId)) {
      count += getBundledModels(providerId).length;
    }
  }
  return count;
}

/** Get all models across all providers. */
export function getAllCatalogModels(): PlumbModel[] {
  const models: PlumbModel[] = [];
  for (const providerId of getBundledProviders()) {
    if (!isGeneratedProvider(providerId)) continue;
    for (const model of getBundledModels(providerId)) {
      models.push(ompModelToPlumbModel(model));
    }
  }
  return models;
}
