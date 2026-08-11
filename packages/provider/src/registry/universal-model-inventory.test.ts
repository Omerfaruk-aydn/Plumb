import { describe, it, expect, vi } from "vitest";
import { buildUniversalModelInventory } from "./universal-model-inventory.js";

// Mock the provider registry to avoid real credential store access
vi.mock("./provider-registry.js", () => ({
  getPlumbProviderRegistry: () => ({
    initialize: async () => {},
    getActiveProviderStates: () => [],
  }),
}));

// Mock the claude subscription transport to avoid real Agent SDK calls
vi.mock("../transports/claudeSubscription.js", () => ({
  getClaudeSubscriptionModels: async () => ({
    models: [
      {
        id: "opus",
        name: "Claude Opus 4.8",
        contextWindow: 200_000,
        maxTokens: 32_000,
        source: "ACCOUNT_DYNAMIC",
      },
      {
        id: "claude-sonnet-5",
        name: "Claude Sonnet 5",
        contextWindow: 200_000,
        maxTokens: 64_000,
        source: "OFFICIAL_STATIC_METADATA",
      },
    ],
    source: "ACCOUNT_DYNAMIC",
  }),
}));

describe("buildUniversalModelInventory", () => {
  it("includes all registered providers even when none are configured", async () => {
    const inv = await buildUniversalModelInventory({
      build: { gitHead: "a".repeat(40) },
    });
    // At least the bundled catalog providers must appear.
    expect(inv.providers.length).toBeGreaterThan(50);
    // Claude Subscription must be registered.
    const claudeSub = inv.providers.find(
      (p) => p.providerId === "claude-subscription",
    );
    expect(claudeSub).toBeDefined();
    expect(claudeSub!.registered).toBe(true);
    expect(claudeSub!.knownModelCount).toBeGreaterThan(0);
  });

  it("includes models from ALL registered providers (not just configured)", async () => {
    const inv = await buildUniversalModelInventory({
      build: { gitHead: "a".repeat(40) },
    });
    // The model list must be much larger than the configured count.
    expect(inv.models.length).toBeGreaterThan(50);
    // Must include OpenAI models.
    expect(inv.models.some((m) => m.providerId === "openai")).toBe(true);
    // Must include Google models.
    expect(inv.models.some((m) => m.providerId === "google")).toBe(true);
    // Must include Anthropic API models.
    expect(inv.models.some((m) => m.providerId === "anthropic")).toBe(true);
  });

  it("Claude Subscription models come from live probe (ACCOUNT_DYNAMIC) with pinned reference limits", async () => {
    const inv = await buildUniversalModelInventory({
      build: { gitHead: "a".repeat(40) },
    });
    const claudeModels = inv.models.filter(
      (m) => m.providerId === "claude-subscription",
    );
    expect(claudeModels.length).toBe(2);
    // The opus model was reported as ACCOUNT_DYNAMIC by the probe.
    const opus = claudeModels.find((m) => m.modelId === "opus");
    expect(opus).toBeDefined();
    expect(opus!.identitySource).toBe("ACCOUNT_DYNAMIC");
    expect(opus!.contextWindow).toBe(200_000);
    expect(opus!.maxOutputTokens).toBe(32_000);
    // Limit provenance is PINNED_REFERENCE (the pinned table has the
    // numeric value), NOT BUNDLED_CATALOG.
    expect(opus!.contextSource).toBe("PINNED_REFERENCE");
    expect(opus!.maxOutputSource).toBe("PINNED_REFERENCE");
  });

  it("counts are deterministic: same input = same output across two calls", async () => {
    const inv1 = await buildUniversalModelInventory({
      build: { gitHead: "a".repeat(40) },
    });
    const inv2 = await buildUniversalModelInventory({
      build: { gitHead: "a".repeat(40) },
    });
    expect(inv1.counts).toEqual(inv2.counts);
    expect(inv1.providers.length).toBe(inv2.providers.length);
    expect(inv1.models.length).toBe(inv2.models.length);
  });
});

