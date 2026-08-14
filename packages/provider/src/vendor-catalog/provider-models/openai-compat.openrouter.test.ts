import { describe, expect, it, vi } from 'vitest';
import { openrouterModelManagerOptions } from './openai-compat.js';

describe('openrouterModelManagerOptions', () => {
  it('queries the official /api/v1/models endpoint with its own credential', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        data: [
          {
            id: 'test-vendor/dynamic-tool-model',
            name: 'Dynamic Tool Model',
            context_length: 200000,
            supported_parameters: ['tools', 'tool_choice'],
          },
        ],
      }),
    );
    const options = openrouterModelManagerOptions({
      apiKey: 'openrouter-key',
      fetch: fetchImpl,
    });

    const models = await options.fetchDynamicModels?.();

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer openrouter-key',
        }),
      }),
    );
    expect(models).toContainEqual(
      expect.objectContaining({
        id: 'test-vendor/dynamic-tool-model',
        api: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        contextWindow: 200000,
      }),
    );
  });
});
