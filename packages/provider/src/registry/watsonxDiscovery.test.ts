/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * WatsonxDiscovery capability metadata: `toolsSupported` must derive from
 * IBM's real foundation-model `tasks[].id` metadata (genuine
 * PROVIDER_DYNAMIC discovery), never from guessing based on the model
 * name, and must stay `undefined` (unknown) rather than `false` when IBM
 * reports no task metadata for a model.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const mockListFoundationModelSpecs = vi.fn();
const mockNewInstance = vi.fn((_options: unknown) => ({
  listFoundationModelSpecs: mockListFoundationModelSpecs,
}));
const mockIamAuthenticatorCtor = vi.fn();

vi.mock('@ibm-cloud/watsonx-ai', () => ({
  WatsonXAI: { newInstance: (options: unknown) => mockNewInstance(options) },
}));

vi.mock('ibm-cloud-sdk-core', () => ({
  IamAuthenticator: class {
    constructor(options: unknown) {
      mockIamAuthenticatorCtor(options);
    }
  },
}));

async function importFresh() {
  vi.resetModules();
  return import('./model-discovery.js');
}

describe('WatsonxDiscovery', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('returns [] without an API key -- never calls the SDK', async () => {
    const { discoverProviderModels } = await importFresh();
    const result = await discoverProviderModels('watsonx', {
      providerId: 'watsonx',
    });
    expect(result).toEqual([]);
    expect(mockListFoundationModelSpecs).not.toHaveBeenCalled();
  });

  it('marks a model with a function_calling task as toolsSupported: true', async () => {
    mockListFoundationModelSpecs.mockResolvedValue({
      result: {
        resources: [
          {
            model_id: 'ibm/granite-3-3-8b-instruct',
            label: 'Granite 3.3 8B Instruct',
            tasks: [{ id: 'question_answering' }, { id: 'function_calling' }],
          },
        ],
      },
    });
    const { discoverProviderModels } = await importFresh();
    const result = await discoverProviderModels('watsonx', {
      providerId: 'watsonx',
      apiKey: 'ibm-key',
    });
    expect(result).toEqual([
      {
        id: 'ibm/granite-3-3-8b-instruct',
        name: 'Granite 3.3 8B Instruct',
        api: 'watsonx-chat',
        toolsSupported: true,
        toolsCapabilitySource: 'PROVIDER_DYNAMIC',
      },
    ]);
  });

  it('marks a model with tasks but no function_calling task as toolsSupported: false', async () => {
    mockListFoundationModelSpecs.mockResolvedValue({
      result: {
        resources: [
          {
            model_id: 'ibm/text-only-model',
            label: 'Text Only Model',
            tasks: [{ id: 'summarization' }],
          },
        ],
      },
    });
    const { discoverProviderModels } = await importFresh();
    const result = await discoverProviderModels('watsonx', {
      providerId: 'watsonx',
      apiKey: 'ibm-key',
    });
    expect(result).toEqual([
      {
        id: 'ibm/text-only-model',
        name: 'Text Only Model',
        api: 'watsonx-chat',
        toolsSupported: false,
        toolsCapabilitySource: 'PROVIDER_DYNAMIC',
      },
    ]);
  });

  it('leaves toolsSupported undefined (unknown) when IBM reports no tasks metadata at all', async () => {
    mockListFoundationModelSpecs.mockResolvedValue({
      result: {
        resources: [
          { model_id: 'ibm/no-metadata-model', label: 'No Metadata Model' },
        ],
      },
    });
    const { discoverProviderModels } = await importFresh();
    const result = await discoverProviderModels('watsonx', {
      providerId: 'watsonx',
      apiKey: 'ibm-key',
    });
    expect(result[0]?.toolsSupported).toBeUndefined();
    expect('toolsSupported' in (result[0] as object)).toBe(true);
  });
});
