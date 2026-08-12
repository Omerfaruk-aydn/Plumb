import { describe, it, expect, vi } from 'vitest';
import { buildUniversalModelInventory } from './universal-model-inventory.js';
import { getPlumbModelRegistry } from './model-registry.js';

// Mock the provider registry to avoid real credential store access
vi.mock('./provider-registry.js', () => ({
  getPlumbProviderRegistry: () => ({
    initialize: async () => {},
    getActiveProviderStates: () => [],
  }),
}));

// Mock the claude subscription transport to avoid real Agent SDK calls
vi.mock('../transports/claudeSubscription.js', () => ({
  getClaudeSubscriptionModels: async () => ({
    models: [
      // "opus" is a generic alias with no exact match in the pinned
      // reference table (which keys on "claude-opus-4-8") — this
      // mirrors the real transport's GENERIC_FLOOR fallback.
      {
        id: 'opus',
        name: 'Claude Opus 4.8',
        contextWindow: 200_000,
        maxTokens: 32_000,
        source: 'ACCOUNT_DYNAMIC',
        limitsSource: 'GENERIC_FLOOR',
      },
      {
        id: 'claude-sonnet-5',
        name: 'Claude Sonnet 5',
        contextWindow: 200_000,
        maxTokens: 64_000,
        source: 'OFFICIAL_STATIC_METADATA',
        limitsSource: 'PINNED_REFERENCE',
      },
    ],
    source: 'ACCOUNT_DYNAMIC',
  }),
}));

describe('buildUniversalModelInventory', () => {
  it('includes all registered providers even when none are configured', async () => {
    const inv = await buildUniversalModelInventory({
      build: { gitHead: 'a'.repeat(40) },
    });
    // At least the bundled catalog providers must appear.
    expect(inv.providers.length).toBeGreaterThan(50);
    // Claude Subscription must be registered.
    const claudeSub = inv.providers.find(
      (p) => p.providerId === 'claude-subscription',
    );
    expect(claudeSub).toBeDefined();
    expect(claudeSub!.registered).toBe(true);
    expect(claudeSub!.knownModelCount).toBeGreaterThan(0);
  });

  it('includes models from ALL registered providers (not just configured)', async () => {
    const inv = await buildUniversalModelInventory({
      build: { gitHead: 'a'.repeat(40) },
    });
    // The model list must be much larger than the configured count.
    expect(inv.models.length).toBeGreaterThan(50);
    // Must include OpenAI models.
    expect(inv.models.some((m) => m.providerId === 'openai')).toBe(true);
    // Must include Google models.
    expect(inv.models.some((m) => m.providerId === 'google')).toBe(true);
    // Must include Anthropic API models.
    expect(inv.models.some((m) => m.providerId === 'anthropic')).toBe(true);
  });

  it('Claude Subscription models with a real pinned-table match report PINNED_REFERENCE limits', async () => {
    const inv = await buildUniversalModelInventory({
      build: { gitHead: 'a'.repeat(40) },
    });
    const claudeModels = inv.models.filter(
      (m) => m.providerId === 'claude-subscription',
    );
    expect(claudeModels.length).toBe(2);
    const sonnet = claudeModels.find((m) => m.modelId === 'claude-sonnet-5');
    expect(sonnet).toBeDefined();
    // The mock fixture reports sonnet's identity as OFFICIAL_STATIC_METADATA
    // (no live probe match for this id) -> PINNED_REFERENCE identity.
    expect(sonnet!.identitySource).toBe('PINNED_REFERENCE');
    expect(sonnet!.contextWindow).toBe(200_000);
    expect(sonnet!.maxOutputTokens).toBe(64_000);
    expect(sonnet!.contextSource).toBe('PINNED_REFERENCE');
    expect(sonnet!.maxOutputSource).toBe('PINNED_REFERENCE');
  });

  it('Claude Subscription models report toolsSupported=true/PINNED_REFERENCE -- the Agent SDK MCP bridge is a verified, product-specific pin, not vendor-family inference. Phase-2 UNIVERSAL_TOOL_CAPABILITY regression: resolveClaudeSubscriptionModel used to silently drop this known capability.', async () => {
    const inv = await buildUniversalModelInventory({
      build: { gitHead: 'a'.repeat(40) },
    });
    const claudeModels = inv.models.filter(
      (m) => m.providerId === 'claude-subscription',
    );
    expect(claudeModels.length).toBe(2);
    for (const m of claudeModels) {
      expect(m.toolsSupported).toBe(true);
      expect(m.toolsCapabilitySource).toBe('PINNED_REFERENCE');
    }
  });

  it('Claude Subscription models with NO pinned-table match (GENERIC_FLOOR) report UNKNOWN limits, never the floor as truth', async () => {
    const inv = await buildUniversalModelInventory({
      build: { gitHead: 'a'.repeat(40) },
    });
    const claudeModels = inv.models.filter(
      (m) => m.providerId === 'claude-subscription',
    );
    const opus = claudeModels.find((m) => m.modelId === 'opus');
    expect(opus).toBeDefined();
    expect(opus!.identitySource).toBe('ACCOUNT_DYNAMIC');
    // The generic floor must never be reported as the model's true limit.
    expect(opus!.contextWindow).toBeUndefined();
    expect(opus!.maxOutputTokens).toBeUndefined();
    expect(opus!.contextSource).toBe('UNKNOWN');
    expect(opus!.maxOutputSource).toBe('UNKNOWN');
    // The floor value is still surfaced, but only as an explicitly
    // labeled transport safety budget.
    expect(opus!.requestSafetyMaxOutput).toBe(32_000);
  });

  it('counts are deterministic: same input = same output across two calls', async () => {
    const inv1 = await buildUniversalModelInventory({
      build: { gitHead: 'a'.repeat(40) },
    });
    const inv2 = await buildUniversalModelInventory({
      build: { gitHead: 'a'.repeat(40) },
    });
    expect(inv1.counts).toEqual(inv2.counts);
    expect(inv1.providers.length).toBe(inv2.providers.length);
    expect(inv1.models.length).toBe(inv2.models.length);
  });

  // ─── Antigravity: canonical/presentation alias regression ────────────
  //
  // antigravity's OMP/catalog backing id is "google-antigravity"
  // (PLUMB_TO_OMP_ID in catalog/providers.ts). Before this fix, per-model
  // rows were tagged with the raw catalog record's own `provider` field
  // instead of the requesting PLUMB provider id, which silently orphaned
  // every antigravity model (attributed to a "google-antigravity" id that
  // has no inventory provider entry) and made the provider look like it
  // had zero models.
  it('groups every antigravity model under the PLUMB presentation id, never the OMP backing id', async () => {
    const inv = await buildUniversalModelInventory({
      build: { gitHead: 'a'.repeat(40) },
    });
    const antigravityModels = inv.models.filter(
      (m) => m.providerId === 'antigravity',
    );
    expect(antigravityModels.length).toBeGreaterThan(0);
    // No model may be silently attributed to the raw OMP backing id.
    expect(
      inv.models.some((m) => m.providerId === ('google-antigravity' as never)),
    ).toBe(false);
    // No duplication: the OMP id must not appear as a second provider entry.
    expect(
      inv.providers.some(
        (p) => p.providerId === ('google-antigravity' as never),
      ),
    ).toBe(false);
    // Known display/wire pairs must be preserved verbatim, with no
    // hardcoded transformation applied by the inventory layer.
    const flash36 = antigravityModels.find(
      (m) => m.modelId === 'gemini-3.6-flash',
    );
    if (flash36) {
      expect(flash36.wireModelId).toBe('gemini-3.6-flash-low');
    }
    const gptOss = antigravityModels.find((m) => m.modelId === 'gpt-oss-120b');
    if (gptOss) {
      expect(gptOss.wireModelId).toBe('gpt-oss-120b-medium');
    }
  });

  // ─── Canonical authority parity ───────────────────────────────────────
  //
  // The universal inventory must never maintain a diagnostic-only
  // aggregation path: for every registered provider, the model ids it
  // reports must be sourced from (and therefore match) the exact same
  // canonical authority the /model dialog reads,
  // PlumbModelRegistry.getModelsForProvider.
  it.each([
    'antigravity',
    'github-copilot',
    'claude-subscription',
    'opencode-go',
    'opencode-zen',
    'anthropic',
    'openai',
    'google-vertex',
    'watsonx',
    'oci-genai',
    'ollama',
    'sglang',
  ])(
    'model ids for %s match PlumbModelRegistry.getModelsForProvider (the /model authority)',
    async (providerId) => {
      const inv = await buildUniversalModelInventory({
        build: { gitHead: 'a'.repeat(40) },
      });
      const inventoryIds = new Set(
        inv.models
          .filter((m) => m.providerId === providerId)
          .map((m) => m.modelId),
      );
      if (providerId === 'claude-subscription') {
        // claude-subscription is resolved from the live/pinned Agent SDK
        // probe, not PlumbModelRegistry -- covered by the dedicated
        // Claude Subscription tests above instead of registry parity.
        expect(inventoryIds.size).toBeGreaterThan(0);
        return;
      }
      const registryIds = new Set(
        getPlumbModelRegistry()
          .getModelsForProvider(providerId as never)
          .map((m) => m.id),
      );
      expect(inventoryIds).toEqual(registryIds);
    },
  );
});
