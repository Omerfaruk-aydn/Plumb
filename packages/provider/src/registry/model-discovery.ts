/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provider-specific model discovery adapters.
 * Each adapter knows how to discover models from a specific provider's API.
 */

import type { PlumbModel, PlumbProviderId } from '../types.js';

export interface DiscoveryContext {
  providerId: PlumbProviderId;
  apiKey?: string;
  baseUrl?: string;
  oauthToken?: string;
}

export interface DiscoveredModel {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
}

export interface ProviderModelDiscovery {
  providerId: string;
  discover(context: DiscoveryContext): Promise<DiscoveredModel[]>;
}

// ─── OpenAI-compatible /v1/models discovery ────────────────────────────

class OpenAICompatDiscovery implements ProviderModelDiscovery {
  constructor(
    readonly providerId: string,
    private readonly defaultBaseUrl: string,
  ) {}

  async discover(context: DiscoveryContext): Promise<DiscoveredModel[]> {
    const baseUrl = context.baseUrl ?? this.defaultBaseUrl;
    const token = context.oauthToken ?? context.apiKey;
    if (!token) return [];

    try {
      const response = await fetch(`${baseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) return [];

      const data = (await response.json()) as {
        data?: Array<{ id: string; name?: string }>;
      };

      return (data.data ?? []).map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
      }));
    } catch {
      return [];
    }
  }
}

// ─── Ollama discovery ──────────────────────────────────────────────────

class OllamaDiscovery implements ProviderModelDiscovery {
  readonly providerId = 'ollama';

  async discover(context: DiscoveryContext): Promise<DiscoveredModel[]> {
    const baseUrl = context.baseUrl ?? 'http://127.0.0.1:11434';

    try {
      const response = await fetch(`${baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5_000),
      });

      if (!response.ok) return [];

      const data = (await response.json()) as {
        models?: Array<{ name: string; details?: { parameter_size?: string } }>;
      };

      return (data.models ?? []).map((m) => ({
        id: m.name,
        name: m.name,
        contextWindow: 131072,
        maxTokens: 16384,
      }));
    } catch {
      return [];
    }
  }
}

// ─── LM Studio / llama.cpp / vLLM discovery ───────────────────────────

class OpenAICompatLocalDiscovery implements ProviderModelDiscovery {
  constructor(
    readonly providerId: string,
    private readonly defaultBaseUrl: string,
  ) {}

  async discover(context: DiscoveryContext): Promise<DiscoveredModel[]> {
    const baseUrl = context.baseUrl ?? this.defaultBaseUrl;

    try {
      const response = await fetch(`${baseUrl}/v1/models`, {
        signal: AbortSignal.timeout(5_000),
      });

      if (!response.ok) return [];

      const data = (await response.json()) as {
        data?: Array<{ id: string }>;
      };

      return (data.data ?? []).map((m) => ({
        id: m.id,
        name: m.id,
        contextWindow: 131072,
        maxTokens: 32768,
      }));
    } catch {
      return [];
    }
  }
}

// ─── Discovery registry ────────────────────────────────────────────────

const DISCOVERIES = new Map<string, ProviderModelDiscovery>();

function register(discovery: ProviderModelDiscovery): void {
  DISCOVERIES.set(discovery.providerId, discovery);
}

// Register all known discovery adapters
register(new OllamaDiscovery());
register(new OpenAICompatLocalDiscovery('lm-studio', 'http://127.0.0.1:1234'));
register(new OpenAICompatLocalDiscovery('llama-cpp', 'http://127.0.0.1:8080'));
register(new OpenAICompatLocalDiscovery('vllm', 'http://127.0.0.1:8000'));
register(new OpenAICompatDiscovery('openai', 'https://api.openai.com'));
register(new OpenAICompatDiscovery('openrouter', 'https://openrouter.ai'));
register(new OpenAICompatDiscovery('groq', 'https://api.groq.com'));
register(new OpenAICompatDiscovery('mistral', 'https://api.mistral.ai'));
register(new OpenAICompatDiscovery('together', 'https://api.together.xyz'));
register(new OpenAICompatDiscovery('fireworks', 'https://api.fireworks.ai'));
register(new OpenAICompatDiscovery('deepseek', 'https://api.deepseek.com'));
register(new OpenAICompatDiscovery('moonshot', 'https://api.moonshot.cn'));
register(new OpenAICompatDiscovery('cerebras', 'https://api.cerebras.ai'));
register(
  new OpenAICompatDiscovery('nvidia', 'https://integrate.api.nvidia.com'),
);
register(new OpenAICompatDiscovery('novita', 'https://api.novita.ai'));
register(new OpenAICompatDiscovery('venice', 'https://api.venice.ai'));
register(new OpenAICompatDiscovery('perplexity', 'https://api.perplexity.ai'));

/** Get the discovery adapter for a provider. */
export function getDiscovery(
  providerId: string,
): ProviderModelDiscovery | undefined {
  return DISCOVERIES.get(providerId);
}

/** Discover models from a provider using its adapter. */
export async function discoverProviderModels(
  providerId: string,
  context: DiscoveryContext,
): Promise<DiscoveredModel[]> {
  const discovery = DISCOVERIES.get(providerId);
  if (!discovery) return [];
  return discovery.discover(context);
}

/** Get all registered discovery provider IDs. */
export function getDiscoveryProviderIds(): string[] {
  return [...DISCOVERIES.keys()];
}
