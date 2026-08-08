/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * OCI IAM-based authentication for OCI Generative AI, distinct from the
 * simpler `OCI_GENAI_API_KEY` bearer-token credential (transports/watsonx.ts's
 * sibling module for the API-key path lives in catalog/model-catalog.ts and
 * this file's own Responses/chat transports). Oracle's own docs: "Use API
 * keys for testing and early development. Use IAM-based authentication for
 * production workloads and OCI-managed environments."
 *
 * OFFICIAL SDK, NOT HAND-ROLLED SIGNING: there is no dedicated
 * GenAI-specific TypeScript/JavaScript auth helper published by Oracle
 * (unlike the Python `oci-genai-auth` / Java `oci-genai-auth-java`
 * packages -- confirmed absent from the npm registry as of this writing;
 * only `oci-common` (the general OCI TypeScript/JavaScript SDK's auth +
 * request-signing package) and `oci-generativeai` (the native gRPC-style
 * GenerativeAI service client, NOT the OpenAI-compatible endpoint this
 * transport calls) exist). Per Oracle's own documented pattern for
 * authenticated custom/raw OCI requests, this uses `oci-common`'s
 * `DefaultRequestSigner` bound to one of its real
 * `AuthenticationDetailsProvider` implementations -- never a hand-rolled
 * RSA signing / canonical-signing-string / key-fingerprint implementation.
 *
 * SUPPORT MATRIX (verified against the installed `oci-common` package's own
 * .d.ts sources, not assumed):
 *   CONFIG_PROFILE      -- SUPPORTED (ConfigFileAuthenticationDetailsProvider)
 *   SESSION              -- SUPPORTED (SessionAuthDetailProvider)
 *   INSTANCE_PRINCIPAL   -- SUPPORTED (InstancePrincipalsAuthenticationDetailsProviderBuilder)
 *   RESOURCE_PRINCIPAL   -- SUPPORTED (ResourcePrincipalAuthenticationDetailsProvider)
 * (Oracle's TS SDK also exposes OKE workload identity -- out of the
 * requested scope here, not wired.)
 *
 * CREDENTIAL OWNERSHIP: PLUMB never copies private key PEM material,
 * session token contents, or signed Authorization values into ordinary
 * PLUMB settings. CONFIG_PROFILE/SESSION modes read the identity straight
 * from the user's own `~/.oci/config` (or an explicit override path) --
 * PLUMB stores only the safe profile name / config path reference.
 * INSTANCE_PRINCIPAL/RESOURCE_PRINCIPAL read no local secret at all (OCI
 * compute/function metadata service owns that identity). All four modes
 * are classified as EXTERNAL_OFFICIAL_CREDENTIAL_AUTHORITY.
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
export function resolveOciIamAuthMode(): OciIamAuthMode | undefined {
  const raw = process.env['OCI_IAM_AUTH_MODE']?.trim();
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
  const configPath = process.env['OCI_IAM_CONFIG_PATH']?.trim() || undefined;
  const profile = process.env['OCI_IAM_CONFIG_PROFILE']?.trim() || undefined;

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
