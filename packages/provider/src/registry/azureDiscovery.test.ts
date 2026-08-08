/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * AzureDeploymentDiscovery: Azure's live resource-level deployment-listing
 * data-plane API is officially retired, and the only remaining live
 * ARM-based path needs a heavier Azure AD credential authority PLUMB does
 * not implement yet -- so this formalizes the existing manual
 * AZURE_OPENAI_DEPLOYMENT_NAME_MAP mechanism into the standard discovery
 * pipeline, honestly labeled as a user-typed mapping, never a verified
 * account-dynamic result.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { discoverProviderModels } from './model-discovery.js';

describe('AzureDeploymentDiscovery', () => {
  afterEach(() => {
    delete process.env['AZURE_OPENAI_DEPLOYMENT_NAME_MAP'];
  });

  it('returns [] when no deployment map is configured -- never fabricates a discovered model', async () => {
    const result = await discoverProviderModels('azure', {
      providerId: 'azure',
    });
    expect(result).toEqual([]);
  });

  it('parses the real AZURE_OPENAI_DEPLOYMENT_NAME_MAP format into DiscoveredModel entries', async () => {
    process.env['AZURE_OPENAI_DEPLOYMENT_NAME_MAP'] =
      'gpt-4o=my-gpt4o-deployment,gpt-4o-mini=my-mini-deployment';
    const result = await discoverProviderModels('azure', {
      providerId: 'azure',
    });
    expect(result).toEqual([
      {
        id: 'gpt-4o',
        name: 'gpt-4o -> my-gpt4o-deployment',
        api: 'azure-openai-responses',
      },
      {
        id: 'gpt-4o-mini',
        name: 'gpt-4o-mini -> my-mini-deployment',
        api: 'azure-openai-responses',
      },
    ]);
  });

  it('the entry id is the canonical model id (the key resolveDeploymentName looks up), not the deployment name', async () => {
    // omp-ai/providers/azure-openai-responses.ts's resolveDeploymentName
    // looks up `model.id` in the parsed map and substitutes the mapped
    // deployment name at request time -- so DiscoveredModel.id must be the
    // map's KEY side, or the real request would resolve the wrong (or a
    // nonexistent) deployment.
    process.env['AZURE_OPENAI_DEPLOYMENT_NAME_MAP'] = 'gpt-4o=prod-gpt4o';
    const result = await discoverProviderModels('azure', {
      providerId: 'azure',
    });
    expect(result[0]?.id).toBe('gpt-4o');
    expect(result[0]?.id).not.toBe('prod-gpt4o');
  });
});
