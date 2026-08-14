/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PlumbModel, PlumbStreamEvent } from '../types.js';
import {
  resolveProviderConfigValue,
  resolveProviderSafeConfig,
} from '../config/providerConfigResolver.js';
import { getVertexAccessToken } from '../vendor-ai/providers/plumbGoogleAuth.js';
import { resolveVertexEndpointHost } from '../vendor-catalog/hosts.js';

const VERTEX_PROVIDER_ID = 'google-vertex';
const API_VERSION = 'v1';

export interface VertexProjectAuthorityInfo {
  readonly project?: string;
  readonly source: 'CONFIGURED_PROVIDER_STATE' | 'ENVIRONMENT' | 'NONE';
  readonly present: boolean;
}

export function resolveVertexProjectAuthority(): VertexProjectAuthorityInfo {
  const safeConfig = resolveProviderSafeConfig(VERTEX_PROVIDER_ID);
  const fromConfig = safeConfig['project']?.trim();
  if (fromConfig) {
    return {
      project: fromConfig,
      source: 'CONFIGURED_PROVIDER_STATE',
      present: true,
    };
  }
  const fromEnv =
    process.env['GOOGLE_CLOUD_PROJECT']?.trim() ??
    process.env['GCLOUD_PROJECT']?.trim();
  if (fromEnv) {
    return {
      project: fromEnv,
      source: 'ENVIRONMENT',
      present: true,
    };
  }
  return {
    project: undefined,
    source: 'NONE',
    present: false,
  };
}

export function resolveVertexProject(): string | undefined {
  return (
    resolveProviderConfigValue(
      VERTEX_PROVIDER_ID,
      'project',
      'GOOGLE_CLOUD_PROJECT',
    ) ?? process.env['GCLOUD_PROJECT']?.trim()
  );
}

export function resolveVertexLocation(): string {
  return (
    resolveProviderConfigValue(
      VERTEX_PROVIDER_ID,
      'location',
      'GOOGLE_CLOUD_LOCATION',
    ) ?? 'global'
  );
}

/** Substitutes the real project/location into a Vertex catalog template. */
function substitutePlaceholders(
  template: string,
  project: string,
  location: string,
): string {
  return template
    .replaceAll('{project}', project)
    .replaceAll('{location}', location);
}

export interface VertexRequestPrep {
  model: PlumbModel;
  error?: PlumbStreamEvent;
  /** Last COMPLETED preflight stage (monotonic, safe, no values). */
  stage?: VertexPreflightStage;
  /** The stage that FAILED (FIRST_BROKEN_BOUNDARY when set). */
  failedStage?: VertexPreflightStage;
  /** Safe missing-field classification — never a credential value. */
  validationError?: VertexValidationError;
}

/** Monotonic safe preflight stages for a Vertex-routed request. */
export type VertexPreflightStage =
  | 'ROUTE_RESOLVED'
  | 'PROJECT_RESOLVED'
  | 'CREDENTIAL_RESOLVED'
  | 'LOCATION_RESOLVED'
  | 'MODEL_RESOLVED'
  | 'REQUEST_CONSTRUCTED';

/** Safe missing-field classification for a Vertex preflight failure. */
export type VertexValidationError =
  | 'missing.project'
  | 'missing.credential'
  | 'invalid.model'
  | 'invalid.endpoint'
  | 'request.validation.error';

/**
 * Prepares a Vertex-routed model for dispatch: resolves the real project ID
 * and a fresh OAuth access token, resolves the real per-dialect request
 * URL, and returns a new model descriptor carrying the real
 * `Authorization: Bearer` header. Never mutates the input model. Returns a
 * safe `error` PlumbStreamEvent (never throws) when project/token
 * resolution fails, and reports the exact failed preflight stage so the
 * probe can distinguish a pre-network boundary break from a serializer
 * rejection.
 */
export async function prepareVertexModel(
  model: PlumbModel,
  signal?: AbortSignal,
): Promise<VertexRequestPrep> {
  if (model.provider !== VERTEX_PROVIDER_ID) return { model };

  let stage: VertexPreflightStage = 'ROUTE_RESOLVED';
  const project = resolveVertexProject();
  if (!project) {
    return {
      model,
      stage,
      failedStage: 'PROJECT_RESOLVED',
      validationError: 'missing.project',
      error: {
        type: 'error',
        error: {
          code: 'CONFIGURATION_REQUIRED',
          message:
            'Vertex AI requires a project ID. Set GOOGLE_CLOUD_PROJECT or configure it via PLUMB provider setup.',
        },
      },
    };
  }
  stage = 'PROJECT_RESOLVED';
  const location = resolveVertexLocation();

  let accessToken: string;
  try {
    accessToken = await getVertexAccessToken({ signal });
  } catch (err) {
    return {
      model,
      stage,
      failedStage: 'CREDENTIAL_RESOLVED',
      validationError: 'missing.credential',
      error: {
        type: 'error',
        error: {
          code: 'AUTH_REQUIRED',
          message:
            err instanceof Error
              ? err.message
              : 'Unable to resolve a Google Vertex AI access token.',
        },
      },
    };
  }
  stage = 'CREDENTIAL_RESOLVED';
  stage = 'LOCATION_RESOLVED';

  const wireModelId = model.requestModelId ?? model.id;
  if (!wireModelId) {
    return {
      model,
      stage,
      failedStage: 'MODEL_RESOLVED',
      validationError: 'invalid.model',
      error: {
        type: 'error',
        error: {
          code: 'INVALID_REQUEST',
          message: 'Vertex route resolved without a model id.',
        },
      },
    };
  }

  let baseUrl: string;
  if (model.api === 'google-vertex') {
    // Native Gemini-on-Vertex: catalog baseUrl is host-only. Build the
    // real base path here; googleGenerativeAiStream appends
    // `/models/{id}:streamGenerateContent` to it.
    const host = resolveVertexEndpointHost(location);
    baseUrl = `https://${host}/${API_VERSION}/projects/${project}/locations/${location}/publishers/google`;
  } else if (model.baseUrl) {
    // anthropic-messages (Claude-on-Vertex, already a complete URL) and
    // openai-completions (MaaS, already the correct base) -- just
    // substitute the placeholders.
    baseUrl = substitutePlaceholders(model.baseUrl, project, location);
  } else {
    baseUrl = model.baseUrl ?? '';
  }
  if (!baseUrl) {
    return {
      model,
      stage,
      failedStage: 'MODEL_RESOLVED',
      validationError: 'invalid.endpoint',
      error: {
        type: 'error',
        error: {
          code: 'INVALID_REQUEST',
          message: 'Vertex route resolved without an endpoint URL.',
        },
      },
    };
  }
  stage = 'MODEL_RESOLVED';

  return {
    model: {
      ...model,
      baseUrl,
      headers: {
        ...(model.headers ?? {}),
        Authorization: `Bearer ${accessToken}`,
      },
    },
    stage: 'REQUEST_CONSTRUCTED',
  };
}
