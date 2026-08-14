/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ConfigFileAuthenticationDetailsProvider,
  SessionAuthDetailProvider,
  InstancePrincipalsAuthenticationDetailsProviderBuilder,
  ResourcePrincipalAuthenticationDetailsProvider,
  DefaultRequestSigner,
  type AuthenticationDetailsProvider,
  type HttpRequest,
  type Method,
} from 'oci-common';
import { resolveProviderConfigValue } from '../config/providerConfigResolver.js';

export type OciIamAuthMode =
  | 'config_profile'
  | 'session'
  | 'instance_principal'
  | 'resource_principal';

const VALID_MODES: ReadonlySet<string> = new Set([
  'config_profile',
  'session',
  'instance_principal',
  'resource_principal',
]);

/**
 * Reads `OCI_IAM_AUTH_MODE` -- presence of this env var (rather than
 * `OCI_GENAI_API_KEY`) is what selects the OCI_IAM credential authority
 * over the simpler OCI_GENAI_API_KEY bearer path. Returns undefined for an
 * unset/invalid value rather than guessing a default -- an invalid mode
 * must surface as a clear configuration error, never silently fall back to
 * a different auth mode than the one the user configured.
 */
const OCI_GENAI_PROVIDER_ID = 'oci-genai';

export function resolveOciIamAuthMode(): OciIamAuthMode | undefined {
  const raw = resolveProviderConfigValue(
    OCI_GENAI_PROVIDER_ID,
    'iamAuthMode',
    'OCI_IAM_AUTH_MODE',
  );
  if (!raw) return undefined;
  return VALID_MODES.has(raw) ? (raw as OciIamAuthMode) : undefined;
}

interface CachedProvider {
  mode: OciIamAuthMode;
  configPath: string | undefined;
  profile: string | undefined;
  provider: AuthenticationDetailsProvider;
}

let cachedProvider: CachedProvider | null = null;

/**
 * Resolves (and caches) the real `oci-common` `AuthenticationDetailsProvider`
 * for the given mode. CONFIG_PROFILE/SESSION read `OCI_IAM_CONFIG_PATH`
 * (optional -- defaults to `oci-common`'s own default `~/.oci/config`
 * resolution when unset) and `OCI_IAM_CONFIG_PROFILE` (optional -- defaults
 * to oci-common's own "DEFAULT" profile). INSTANCE_PRINCIPAL/
 * RESOURCE_PRINCIPAL take no PLUMB-supplied config at all -- their identity
 * comes entirely from the OCI compute/function runtime.
 */
export async function getOciIamAuthProvider(
  mode: OciIamAuthMode,
): Promise<AuthenticationDetailsProvider> {
  const configPath = resolveProviderConfigValue(
    OCI_GENAI_PROVIDER_ID,
    'iamConfigPath',
    'OCI_IAM_CONFIG_PATH',
  );
  const profile = resolveProviderConfigValue(
    OCI_GENAI_PROVIDER_ID,
    'iamConfigProfile',
    'OCI_IAM_CONFIG_PROFILE',
  );

  if (
    cachedProvider &&
    cachedProvider.mode === mode &&
    cachedProvider.configPath === configPath &&
    cachedProvider.profile === profile
  ) {
    return cachedProvider.provider;
  }

  let provider: AuthenticationDetailsProvider;
  switch (mode) {
    case 'config_profile':
      provider = new ConfigFileAuthenticationDetailsProvider(
        configPath,
        profile,
      );
      break;
    case 'session':
      provider = new SessionAuthDetailProvider(configPath, profile);
      break;
    case 'instance_principal':
      provider =
        await new InstancePrincipalsAuthenticationDetailsProviderBuilder().build();
      break;
    case 'resource_principal':
      provider = ResourcePrincipalAuthenticationDetailsProvider.builder();
      break;
  }

  cachedProvider = { mode, configPath, profile, provider };
  return provider;
}

/** Reset the cached provider -- test-only. */
export function __resetOciIamProviderCacheForTests(): void {
  cachedProvider = null;
}

/**
 * Signs a fully-built outbound request in place via `oci-common`'s
 * `DefaultRequestSigner`. Must be called only after every other header
 * (Content-Type, opc-compartment-id, OpenAI-Project, etc.) has already been
 * added to `request.headers` -- signature inputs cover method/URL/headers/
 * body, so signing must be the LAST mutation before fetch, never followed
 * by further header changes.
 */
export async function signOciGenaiRequest(
  provider: AuthenticationDetailsProvider,
  request: { method: Method; url: string; headers: Headers; body?: string },
): Promise<void> {
  const httpRequest: HttpRequest = {
    method: request.method,
    uri: request.url,
    headers: request.headers,
    body: request.body,
  };
  const signer = new DefaultRequestSigner(provider);
  await signer.signHttpRequest(httpRequest);
}
