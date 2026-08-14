/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export interface AzureDeployment {
  readonly modelId: string;
  readonly deploymentName: string;
}

export interface AzureConfigFormValues {
  /** Either a full base URL (https://...) or a bare resource name -- auto-detected on save. */
  endpoint?: string;
  credential?: string;
  hasExistingCredential?: boolean;
  deployments: readonly AzureDeployment[];
}

export type AzureConfigValidationErrors = Partial<
  Record<'endpoint' | 'credential' | 'deployments', string>
>;

function isEndpointUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

export function validateAzureConfig(
  values: AzureConfigFormValues,
): AzureConfigValidationErrors {
  const errors: AzureConfigValidationErrors = {};
  if (!values.endpoint?.trim()) {
    errors.endpoint = 'Endpoint or resource name is required.';
  }
  const hasNewCredential = !!values.credential?.trim();
  if (!hasNewCredential && !values.hasExistingCredential) {
    errors.credential = 'API key is required.';
  }
  const seen = new Set<string>();
  for (const d of values.deployments) {
    if (!d.modelId.trim() || !d.deploymentName.trim()) {
      errors.deployments =
        'Every deployment needs both a model ID and a deployment name.';
      break;
    }
    if (seen.has(d.modelId.trim())) {
      errors.deployments = `Duplicate deployment mapping for model "${d.modelId.trim()}".`;
      break;
    }
    seen.add(d.modelId.trim());
  }
  return errors;
}

/** The same "model=deployment,..." shape parseAzureDeploymentNameMap already parses -- see the module doc. */
export function encodeAzureDeploymentMap(
  deployments: readonly AzureDeployment[],
): string {
  return deployments
    .filter((d) => d.modelId.trim() && d.deploymentName.trim())
    .map((d) => `${d.modelId.trim()}=${d.deploymentName.trim()}`)
    .join(',');
}

export function decodeAzureDeploymentMap(
  raw: string | undefined,
): AzureDeployment[] {
  if (!raw) return [];
  const deployments: AzureDeployment[] = [];
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const [modelId, deploymentName] = trimmed.split('=', 2);
    if (!modelId || !deploymentName) continue;
    deployments.push({
      modelId: modelId.trim(),
      deploymentName: deploymentName.trim(),
    });
  }
  return deployments;
}

export function buildAzureSaveOperation(values: AzureConfigFormValues): {
  safeConfig: Record<string, string>;
  credential?: string;
} {
  const endpoint = values.endpoint?.trim() ?? '';
  const safeConfig: Record<string, string> = {};
  if (endpoint) {
    if (isEndpointUrl(endpoint)) {
      safeConfig['baseUrl'] = endpoint;
    } else {
      safeConfig['resourceName'] = endpoint;
    }
  }
  const deploymentMap = encodeAzureDeploymentMap(values.deployments);
  if (deploymentMap) safeConfig['deploymentMap'] = deploymentMap;

  const hasNewCredential = !!values.credential?.trim();
  return {
    safeConfig,
    ...(hasNewCredential ? { credential: values.credential!.trim() } : {}),
  };
}

/** Reconstructs the single displayed 'endpoint' string from whichever of baseUrl/resourceName is persisted. */
export function decodeAzureEndpoint(
  safeConfig: Record<string, string>,
): string {
  return safeConfig['baseUrl'] || safeConfig['resourceName'] || '';
}
