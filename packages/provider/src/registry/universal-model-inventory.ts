/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * PLUMB Universal Model Inventory — the single canonical aggregation
 * layer that every surface (UI token meter, model picker, compaction,
 * transport, diagnostics) consumes. Replaces the previous
 * architecture that conflated "models the user can pick right now"
 * (i.e. active authenticated/configured providers) with "models
 * PLUMB knows about in total", which made the diagnostics silently
 * omit bundled catalog entries, providers not yet authenticated in
 * this process, and everything reachable through the OMP catalog —
 * exactly the failure the real-user diagnostic output exposed
 * ("active.model.count: 45 but only opencode-go + google-vertex show
 * up; claude-subscription, antigravity, github-copilot, openai, etc.
 * are completely absent").
 *
 * Contract:
 *  1. ONE canonical inventory, no parallel registries.
 *  2. Deterministic snapshot — async work first, render later.
 *  3. Per-field source provenance (identity / context / input /
 *     output / pricing). Identity provenance and limit provenance
 *     are NEVER conflated.
 *  4. Unknown means unknown. No silent fallbacks.
 *  5. No fake limits. The Claude "32k for unknown models" floor
 *     only applies inside the Claude Subscription transport's
 *     outbound `max_tokens` field; it is NEVER reported as a
 *     model's true `maxOutputTokens` in this inventory.
 */

import {
  type PlumbModel,
  type PlumbModelPricing,
  type PlumbProvider,
  type PlumbProviderId,
  type PlumbKnownApi,
} from '../types.js';
import {
  SELECTABLE_PROVIDERS,
  getPlumbProvider,
} from '../catalog/providers.js';
import {
  listCustomPlumbProviders,
  listCustomProviderDefinitions,
  customDefinitionToModels,
} from '../config/customProviderDefinitions.js';
import { getCatalogModels } from '../catalog/model-catalog.js';
import { getBundledProviders } from '../omp-catalog/models.js';

// Identity provenance enum
export type ModelIdentitySource =
  | 'BUNDLED_CATALOG'
  | 'PINNED_REFERENCE'
  | 'PROVIDER_DYNAMIC'
  | 'ACCOUNT_DYNAMIC'
  | 'USER_CONFIGURED'
  | 'USER_CONFIGURED_DEPLOYMENT'
  | 'UNKNOWN';

export type ModelLimitSource =
  | 'BUNDLED_CATALOG'
  | 'PINNED_REFERENCE'
  | 'REGISTRY_DISCOVERY'
  | 'OMP_CATALOG'
  | 'BUILTIN_GEMINI'
  | 'TOKEN_LIMIT_DEFAULT'
  | 'PROVIDER_DEFAULT'
  | 'UNKNOWN';

// ResolvedModelMetadata
export interface ResolvedModelMetadata {
  providerId: PlumbProviderId;
  providerName: string;
  modelId: string;
  wireModelId?: string;
  api?: PlumbKnownApi;
  identitySource: ModelIdentitySource;
  contextSource: ModelLimitSource;
  inputSource: ModelLimitSource;
  maxOutputSource: ModelLimitSource;
  pricingSource: ModelLimitSource;
  contextWindow?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  pricing?: PlumbModelPricing;
  reasoning?: boolean;
  toolsSupported?: boolean;
  toolsCapabilitySource?:
    | 'ACCOUNT_DYNAMIC'
    | 'PROVIDER_DYNAMIC'
    | 'SERVER_DYNAMIC'
    | 'BUNDLED_CATALOG'
    | 'PINNED_REFERENCE'
    | 'USER_CONFIGURED'
    | 'UNKNOWN';
  registered: boolean;
  configured: boolean;
  discoveryAttempted: boolean;
  fetchedAt?: number;
  /**
   * Transport-side outbound safety budget for `maxOutputTokens` when the
   * real value is UNKNOWN (e.g. Claude Subscription's generic
   * Claude-4.x-generation floor for a live-discovered model id with no
   * pinned reference entry). NEVER the model's true max output — only
   * ever set alongside `maxOutputSource: 'UNKNOWN'`.
   */
  requestSafetyMaxOutput?: number;
}

export interface UniversalProviderEntry {
  providerId: PlumbProviderId;
  providerName: string;
  category: string;
  group?: string;
  selectable: boolean;
  configured: boolean;
  authState?: string;
  hasCredential: boolean;
  bundledModelCount: number;
  knownModelCount: number;
  /** Whether this provider appears in SELECTABLE_PROVIDERS or custom list. */
  registered: boolean;
}

export interface UniversalModelInventory {
  build: {
    gitHeadEmbedded: string;
    capturedAt: number;
  };
  providers: UniversalProviderEntry[];
  models: ResolvedModelMetadata[];
  counts: {
    registeredProviders: number;
    selectableProviders: number;
    configuredProviders: number;
    totalModels: number;
    identityBundledCatalog: number;
    identityPinnedReference: number;
    identityProviderDynamic: number;
    identityAccountDynamic: number;
    identityUserConfigured: number;
    identityUserConfiguredDeployment: number;
    identityUnknown: number;
    contextKnown: number;
    contextUnknown: number;
    inputKnown: number;
    inputUnknown: number;
    outputKnown: number;
    outputUnknown: number;
    /** toolsSupported === true, across every model in this inventory snapshot. */
    toolsSupported: number;
    /** toolsSupported === false, across every model in this inventory snapshot. */
    toolsUnsupported: number;
    /** toolsSupported === undefined (no trustworthy capability metadata) — never guessed. */
    toolsUnknown: number;
  };
}

// Helper: registered provider enumeration
function enumerateAllRegisteredProviders(): PlumbProvider[] {
  const seen = new Set<string>();
  const out: PlumbProvider[] = [];
  const push = (p: PlumbProvider | undefined): void => {
    if (!p || seen.has(p.id)) return;
    seen.add(p.id);
    out.push(p);
  };
  for (const p of SELECTABLE_PROVIDERS) push(p);
  for (const id of getBundledProviders()) {
    push(getPlumbProvider(id));
  }
  for (const id of [
    'claude-subscription',
    'watsonx',
    'oci-genai',
    'custom-openai-compat',
  ]) {
    push(getPlumbProvider(id));
  }
  for (const p of listCustomPlumbProviders()) push(p);
  return out;
}

function isSelectableProvider(p: PlumbProvider): boolean {
  return SELECTABLE_PROVIDERS.some((q) => q.id === p.id);
}

// Build a per-model resolved metadata from a bundled-catalog PlumbModel
// entry. The catalog is the source of truth for contextWindow + maxTokens
// + pricing. Provenance is recorded per-field, NOT derived from the
// catalog-level source field.
//
// `providerId` is the canonical PLUMB presentation id the caller is
// grouping under (e.g. "antigravity", "anthropic-api") -- NEVER `m.provider`
// directly. The bundled/OMP catalog record's own `provider` field may carry
// a different underlying OMP registry id (e.g. antigravity's OMP backing is
// "google-antigravity", anthropic-api's is "anthropic") and using it here
// would silently orphan the model under a provider section that either
// doesn't exist in the inventory or belongs to a different PLUMB provider
// entirely -- exactly the "model count shows 0 / models missing" bug this
// resolver must not reproduce.
function resolveFromBundledCatalog(
  m: PlumbModel,
  providerId: string,
  providerName: string,
  registered: boolean,
  configured: boolean,
  discoveryAttempted: boolean,
  identitySource: ModelIdentitySource = 'BUNDLED_CATALOG',
): ResolvedModelMetadata {
  return {
    providerId: providerId as PlumbProviderId,
    providerName,
    modelId: m.id,
    wireModelId: m.requestModelId,
    api: m.api,
    identitySource,
    contextSource:
      typeof m.contextWindow === 'number' && m.contextWindow > 0
        ? identitySource === 'PROVIDER_DYNAMIC'
          ? 'REGISTRY_DISCOVERY'
          : 'BUNDLED_CATALOG'
        : 'UNKNOWN',
    inputSource: 'UNKNOWN',
    maxOutputSource:
      typeof m.maxTokens === 'number' && m.maxTokens > 0
        ? identitySource === 'PROVIDER_DYNAMIC'
          ? 'REGISTRY_DISCOVERY'
          : 'BUNDLED_CATALOG'
        : 'UNKNOWN',
    pricingSource: m.pricing
      ? identitySource === 'PROVIDER_DYNAMIC'
        ? 'REGISTRY_DISCOVERY'
        : 'BUNDLED_CATALOG'
      : 'UNKNOWN',
    contextWindow:
      typeof m.contextWindow === 'number' && m.contextWindow > 0
        ? m.contextWindow
        : undefined,
    maxOutputTokens:
      typeof m.maxTokens === 'number' && m.maxTokens > 0
        ? m.maxTokens
        : undefined,
    pricing: m.pricing,
    reasoning: m.reasoning,
    toolsSupported: m.toolsSupported,
    toolsCapabilitySource: m.toolsCapabilitySource,
    registered,
    configured,
    discoveryAttempted,
  };
}

// Claude Subscription resolver. The Agent SDK's Query.supportedModels()
// may return (a) only model ids with no numeric metadata, or (b) model
// ids with the SDK's own contextWindow/maxTokens report. We must never
// guess or borrow a limit from a different model, and we must never
// inherit the identity provenance onto the limit fields.
//
// We resolve by:
//   1. identity: ACCOUNT_DYNAMIC if the id came from a live SDK
//      supportedModels() call; PINNED_REFERENCE if it came from
//      CLAUDE_SUBSCRIPTION_MODELS only (no live probe available).
//   2. context: PINNED_REFERENCE if the id matches a known entry in
//      CLAUDE_SUBSCRIPTION_MODELS; UNKNOWN otherwise.
//   3. maxOutput: PINNED_REFERENCE if known; UNKNOWN otherwise.
//      The 32,000 floor (CLAUDE_UNKNOWN_MODEL_MAX_TOKENS_FLOOR) is
//      NEVER reported as a model's true max output here -- it is
//      only used by the Claude Subscription transport as an outbound
//      request safety budget when the model has no documented value.
export interface ClaudeSubscriptionModelIdentity {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  source: 'ACCOUNT_DYNAMIC' | 'OFFICIAL_STATIC_METADATA';
  /**
   * Whether contextWindow/maxTokens are a real per-model pinned reference
   * or the generic Claude-4.x-generation floor used only as a transport
   * safety budget. Missing/undefined is treated as NOT pinned (safest
   * default) — only an explicit 'PINNED_REFERENCE' unlocks reporting the
   * numeric value as the model's true contextWindow/maxOutputTokens.
   */
  limitsSource?: 'PINNED_REFERENCE' | 'GENERIC_FLOOR';
}

function resolveClaudeSubscriptionModel(
  entry: ClaudeSubscriptionModelIdentity,
  registered: boolean,
  configured: boolean,
  discoveryAttempted: boolean,
): ResolvedModelMetadata {
  const isPinned = entry.limitsSource === 'PINNED_REFERENCE';
  const hasContext =
    isPinned &&
    typeof entry.contextWindow === 'number' &&
    entry.contextWindow > 0;
  const hasMaxOutput =
    isPinned && typeof entry.maxTokens === 'number' && entry.maxTokens > 0;
  return {
    providerId: 'claude-subscription',
    providerName: 'Claude Subscription (Agent SDK)',
    modelId: entry.id,
    wireModelId: entry.id,
    identitySource:
      entry.source === 'ACCOUNT_DYNAMIC'
        ? 'ACCOUNT_DYNAMIC'
        : 'PINNED_REFERENCE',
    contextSource: hasContext ? 'PINNED_REFERENCE' : 'UNKNOWN',
    inputSource: 'UNKNOWN',
    maxOutputSource: hasMaxOutput ? 'PINNED_REFERENCE' : 'UNKNOWN',
    pricingSource: 'UNKNOWN',
    contextWindow: hasContext ? entry.contextWindow : undefined,
    maxOutputTokens: hasMaxOutput ? entry.maxTokens : undefined,
    requestSafetyMaxOutput:
      !hasMaxOutput &&
      typeof entry.maxTokens === 'number' &&
      entry.maxTokens > 0
        ? entry.maxTokens
        : undefined,
    registered,
    configured,
    discoveryAttempted,
  };
}

// Build the universal snapshot. This is the ONE place the
// diagnostic, the StatusRow, the transport, and the model picker
// should source from. The function takes a uild descriptor
// (gitHead) so it does not import a generated module at module top.
export interface BuildDescriptor {
  gitHead: string;
}

export interface InventoryBuildContext {
  build: BuildDescriptor;
  // Override-able injectors. Production callers leave these
  // undefined and get the real registry/catalog; tests inject
  // deterministic fixtures.
  overrideActiveProviderStates?: () => ReadonlyArray<{
    provider: PlumbProvider;
    authState?: string;
    hasCredential: boolean;
  }>;
  overrideCatalogModels?: (providerId: string) => PlumbModel[];
  overrideClaudeSubscriptionModels?: () => ReadonlyArray<ClaudeSubscriptionModelIdentity>;
  overrideAllModels?: () => PlumbModel[];
  // Timestamp injection (default Date.now()).
  now?: () => number;
}

// Build the universal snapshot. ONE place every consumer sources from.
export async function buildUniversalModelInventory(
  context: InventoryBuildContext,
): Promise<UniversalModelInventory> {
  const registered = enumerateAllRegisteredProviders();
  const registeredById = new Map(registered.map((p) => [p.id, p]));

  let activeStates: ReadonlyArray<{
    provider: PlumbProvider;
    authState?: string;
    hasCredential: boolean;
  }>;
  if (context.overrideActiveProviderStates) {
    activeStates = context.overrideActiveProviderStates();
  } else {
    try {
      const providerRegistry = (
        await import('./provider-registry.js')
      ).getPlumbProviderRegistry();
      try {
        await providerRegistry.initialize();
      } catch {
        // Non-fatal: initialize() needs a credential store backend
        // which may not be available in some test environments.
      }
      activeStates = providerRegistry.getActiveProviderStates().map((s) => ({
        provider: s.provider,
        authState: s.authState,
        hasCredential: s.credentials !== null,
      }));
    } catch {
      activeStates = [];
    }
  }
  const configuredById = new Map(activeStates.map((s) => [s.provider.id, s]));

  // main 3

  // main 4: build per-provider model maps.
  //
  // `bundledByProvider` is the PURE static bundled-catalog list (used only
  // for the `bundledModelCount` stat). `canonicalByProvider` is the SAME
  // canonical authority the /model dialog itself reads
  // (`PlumbModelRegistry.getModelsForProvider` -- bundled + any
  // already-discovered/cached models + custom models). Diagnostics MUST NOT
  // maintain a second, narrower aggregation: sourcing model rows from the
  // bundled catalog alone is what silently reported 0 models for
  // dynamic-discovery-only providers (e.g. antigravity) whose catalog has
  // no static entries at all. `loadCache` is disk-only (no network, no
  // credentials) so calling it here stays within this diagnostic's
  // credential-free contract while still surfacing any discovery a prior,
  // authenticated interactive session already cached to disk.
  const bundledByProvider = new Map<string, PlumbModel[]>();
  const canonicalByProvider = new Map<string, PlumbModel[]>();
  let modelRegistryForInventory:
    | import('./model-registry.js').PlumbModelRegistry
    | undefined;
  if (!context.overrideCatalogModels) {
    try {
      modelRegistryForInventory = (
        await import('./model-registry.js')
      ).getPlumbModelRegistry();
    } catch {
      modelRegistryForInventory = undefined;
    }
  }
  for (const p of registered) {
    let bundledList: PlumbModel[];
    try {
      bundledList = context.overrideCatalogModels
        ? context.overrideCatalogModels(p.id)
        : getCatalogModels(p.id);
    } catch {
      bundledList = [];
    }
    bundledByProvider.set(p.id, bundledList);

    if (context.overrideCatalogModels) {
      canonicalByProvider.set(p.id, bundledList);
      continue;
    }
    if (!modelRegistryForInventory) {
      canonicalByProvider.set(p.id, bundledList);
      continue;
    }
    try {
      modelRegistryForInventory.loadCache(p.id as PlumbProviderId);
    } catch {
      // Non-fatal: no cache file, or provider isn't cache-eligible.
    }
    try {
      canonicalByProvider.set(
        p.id,
        modelRegistryForInventory.getModelsForProvider(p.id as PlumbProviderId),
      );
    } catch {
      canonicalByProvider.set(p.id, bundledList);
    }
  }

  // main 5: claude-subscription live models
  let claudeSubscriptionLive: ReadonlyArray<ClaudeSubscriptionModelIdentity> =
    [];
  if (context.overrideClaudeSubscriptionModels) {
    claudeSubscriptionLive = context.overrideClaudeSubscriptionModels();
  } else {
    try {
      const m = await import('../transports/claudeSubscription.js');
      const result = await m.getClaudeSubscriptionModels();
      claudeSubscriptionLive = (result.models as ReadonlyArray<any>).map(
        (mm) => ({
          id: mm.id,
          name: mm.name,
          contextWindow: mm.contextWindow,
          maxTokens: mm.maxTokens,
          source:
            mm.source === 'ACCOUNT_DYNAMIC'
              ? ('ACCOUNT_DYNAMIC' as const)
              : ('OFFICIAL_STATIC_METADATA' as const),
          limitsSource: mm.limitsSource,
        }),
      );
    } catch {
      claudeSubscriptionLive = [];
    }
  }

  // main 6: assemble provider entries
  const providers: UniversalProviderEntry[] = registered.map((p) => {
    const active = configuredById.get(p.id);
    const bundledCount = bundledByProvider.get(p.id)?.length ?? 0;
    // knownModelCount reflects the SAME canonical authority the model list
    // below is built from (bundled + discovered/cached + custom), not the
    // narrower bundled-only floor -- otherwise this count and the printed
    // model rows for the same provider section would silently disagree.
    let knownCount = canonicalByProvider.get(p.id)?.length ?? bundledCount;
    if (p.id === 'claude-subscription') {
      knownCount = claudeSubscriptionLive.length || knownCount;
    }
    return {
      providerId: p.id,
      providerName: p.name,
      category: String(p.category ?? 'unknown'),
      group: p.group ?? undefined,
      selectable: isSelectableProvider(p),
      configured: active !== undefined,
      authState: active?.authState,
      hasCredential: active?.hasCredential ?? false,
      bundledModelCount: bundledCount,
      knownModelCount: knownCount,
      registered: true,
    };
  });

  // main 7: assemble models. For claude-subscription, the live probe
  // result is authoritative (identity + limits from pinned reference).
  // For all other providers, the bundled catalog is the source of
  // truth, optionally overlaid with whatever the in-memory registry
  // has for the configured subset.
  const models: ResolvedModelMetadata[] = [];
  const capturedAt = context.now ? context.now() : Date.now();

  // Claude-subscription: live probe + pinned reference
  for (const entry of claudeSubscriptionLive) {
    const p = registeredById.get('claude-subscription');
    models.push(
      resolveClaudeSubscriptionModel(
        entry,
        p !== undefined,
        configuredById.has('claude-subscription'),
        true,
      ),
    );
  }
  // All other providers: canonical model-registry list (bundled + any
  // already-discovered/cached models + custom), grouped under the PLUMB
  // provider id `p.id` -- never the raw catalog record's own `provider`
  // field, which may carry a different underlying OMP registry id (e.g.
  // antigravity's OMP backing is "google-antigravity"). Deduplicated by
  // id+provider.
  const seenModelIds = new Set<string>();
  for (const entry of claudeSubscriptionLive) {
    seenModelIds.add('claude-subscription:' + entry.id);
  }
  for (const p of registered) {
    if (p.id === 'claude-subscription') continue;
    const bundledIds = new Set(
      (bundledByProvider.get(p.id) ?? []).map((m) => m.id),
    );
    const list = canonicalByProvider.get(p.id) ?? [];
    for (const m of list) {
      const key = p.id + ':' + m.id;
      if (seenModelIds.has(key)) continue;
      seenModelIds.add(key);
      models.push(
        resolveFromBundledCatalog(
          m,
          p.id,
          p.name,
          true,
          configuredById.has(p.id),
          false,
          bundledIds.has(m.id) ? 'BUNDLED_CATALOG' : 'PROVIDER_DYNAMIC',
        ),
      );
    }
  }

  // User-configured (custom provider) models: source = USER_CONFIGURED
  try {
    const customModels = listCustomProviderDefinitions().flatMap(
      (definition) => {
        try {
          return customDefinitionToModels(definition);
        } catch {
          return [];
        }
      },
    );
    for (const m of customModels as PlumbModel[]) {
      const key = m.provider + ':' + m.id;
      if (seenModelIds.has(key)) continue;
      seenModelIds.add(key);
      models.push({
        providerId: m.provider,
        providerName: registeredById.get(m.provider)?.name ?? m.provider,
        modelId: m.id,
        wireModelId: m.requestModelId,
        identitySource: 'USER_CONFIGURED',
        contextSource:
          typeof m.contextWindow === 'number' && m.contextWindow > 0
            ? 'BUNDLED_CATALOG'
            : 'UNKNOWN',
        inputSource: 'UNKNOWN',
        maxOutputSource:
          typeof m.maxTokens === 'number' && m.maxTokens > 0
            ? 'BUNDLED_CATALOG'
            : 'UNKNOWN',
        pricingSource: m.pricing ? 'BUNDLED_CATALOG' : 'UNKNOWN',
        contextWindow:
          typeof m.contextWindow === 'number' && m.contextWindow > 0
            ? m.contextWindow
            : undefined,
        maxOutputTokens:
          typeof m.maxTokens === 'number' && m.maxTokens > 0
            ? m.maxTokens
            : undefined,
        pricing: m.pricing,
        reasoning: m.reasoning,
        toolsSupported: m.toolsSupported,
        toolsCapabilitySource: m.toolsCapabilitySource,
        registered: true,
        configured: configuredById.has(m.provider),
        discoveryAttempted: false,
      });
    }
  } catch {
    // Non-fatal: custom provider model surface is best-effort.
  }

  // main 8: count summary
  const counts = {
    registeredProviders: registered.length,
    selectableProviders: providers.filter((p) => p.selectable).length,
    configuredProviders: providers.filter((p) => p.configured).length,
    totalModels: models.length,
    identityBundledCatalog: 0,
    identityPinnedReference: 0,
    identityProviderDynamic: 0,
    identityAccountDynamic: 0,
    identityUserConfigured: 0,
    identityUserConfiguredDeployment: 0,
    identityUnknown: 0,
    contextKnown: 0,
    contextUnknown: 0,
    inputKnown: 0,
    inputUnknown: 0,
    outputKnown: 0,
    outputUnknown: 0,
    toolsSupported: 0,
    toolsUnsupported: 0,
    toolsUnknown: 0,
  };
  for (const m of models) {
    if (m.identitySource === 'BUNDLED_CATALOG') counts.identityBundledCatalog++;
    else if (m.identitySource === 'PINNED_REFERENCE')
      counts.identityPinnedReference++;
    else if (m.identitySource === 'PROVIDER_DYNAMIC')
      counts.identityProviderDynamic++;
    else if (m.identitySource === 'ACCOUNT_DYNAMIC')
      counts.identityAccountDynamic++;
    else if (m.identitySource === 'USER_CONFIGURED')
      counts.identityUserConfigured++;
    else if (m.identitySource === 'USER_CONFIGURED_DEPLOYMENT')
      counts.identityUserConfiguredDeployment++;
    else counts.identityUnknown++;
    if (typeof m.contextWindow === 'number') counts.contextKnown++;
    else counts.contextUnknown++;
    if (typeof m.maxInputTokens === 'number') counts.inputKnown++;
    else counts.inputUnknown++;
    if (typeof m.maxOutputTokens === 'number') counts.outputKnown++;
    else counts.outputUnknown++;
    if (m.toolsSupported === true) counts.toolsSupported++;
    else if (m.toolsSupported === false) counts.toolsUnsupported++;
    else counts.toolsUnknown++;
  }

  return {
    build: {
      gitHeadEmbedded: context.build.gitHead,
      capturedAt,
    },
    providers,
    models,
    counts,
  };
}
