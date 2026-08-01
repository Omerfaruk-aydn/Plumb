/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */

import { generatePkce, generateState } from './oauth-pkce.js';
import { startOAuthCallbackServer } from './oauth-callback-server.js';
import type {
  PlumbProviderId,
  PlumbOAuthCredential,
  PlumbApiKeyCredential,
  IPlumbCredentialStore,
} from '@google/gemini-cli-provider';
import { ensurePlumbCredentialStore , getPlumbProviderRegistry } from '@google/gemini-cli-provider';
import { debugLogger } from '../utils/debugLogger.js';

// ─── Types ─────────────────────────────────────────────────────────────

export type OAuthFlowType =
  | 'authorization_code'
  | 'authorization_code_pkce'
  | 'device_code'
  | 'api_key'
  | 'paste_key'
  | 'email_otp';

export interface OAuthFlowConfig {
  providerId: PlumbProviderId;
  flowType: OAuthFlowType;
  authorizeUrl?: string;
  tokenUrl?: string;
  clientId?: string;
  scopes?: string[];
  redirectPort?: number;
  redirectPath?: string;
  deviceCodeUrl?: string;
  extraParams?: Record<string, string>;
}

export interface LoginResult {
  success: boolean;
  credential?: PlumbOAuthCredential | PlumbApiKeyCredential;
  error?: string;
  accountLabel?: string;
}

export interface AuthProviderInfo {
  providerId: PlumbProviderId;
  displayName: string;
  flowType: OAuthFlowType;
  authState:
    | 'unauthenticated'
    | 'authenticating'
    | 'authenticated'
    | 'expired'
    | 'error';
  accountLabel?: string;
  error?: string;
}

// ─── OAuth flow configurations ─────────────────────────────────────────

const OAUTH_CONFIGS: Record<string, OAuthFlowConfig> = {
  anthropic: {
    providerId: 'anthropic',
    flowType: 'authorization_code_pkce',
    authorizeUrl: 'https://claude.ai/oauth/authorize',
    tokenUrl: 'https://api.anthropic.com/v1/oauth/token',
    clientId: Buffer.from(
      'OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl',
      'base64',
    ).toString('utf-8'),
    scopes: [
      'org:create_api_key',
      'user:profile',
      'user:inference',
      'user:sessions:claude_code',
      'user:mcp_servers',
      'user:file_upload',
    ],
    redirectPort: 54545,
  },

  'openai-codex': {
    providerId: 'openai-codex',
    flowType: 'authorization_code_pkce',
    authorizeUrl: 'https://auth.openai.com/oauth/authorize',
    tokenUrl: 'https://auth.openai.com/oauth/token',
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
    scopes: [
      'openid',
      'profile',
      'email',
      'offline_access',
      'api.connectors.read',
      'api.connectors.invoke',
    ],
    redirectPort: 1455,
  },

  'github-copilot': {
    providerId: 'github-copilot',
    flowType: 'device_code',
    deviceCodeUrl: 'https://github.com/login/device/code',
    clientId: 'Ov23li8tweQw6odWQebz',
    scopes: ['read:user'],
  },

  cursor: {
    providerId: 'cursor',
    flowType: 'authorization_code_pkce',
    authorizeUrl: 'https://cursor.com/loginDeepControl',
    redirectPort: 0, // cursor uses polling, not callback
  },

  'xai-oauth': {
    providerId: 'xai-oauth',
    flowType: 'device_code',
    clientId: 'b1a00492-073a-47ea-816f-4c329264a828',
    scopes: [
      'openid',
      'profile',
      'email',
      'offline_access',
      'grok-cli:access',
      'api:access',
    ],
  },

  'kimi-code': {
    providerId: 'kimi-code',
    flowType: 'device_code',
    deviceCodeUrl: 'https://auth.kimi.com/device/code',
    clientId: '17e5f671-d194-4dfb-9706-5516cb48c098',
  },

  'google-gemini-cli': {
    providerId: 'google-gemini-cli',
    flowType: 'authorization_code',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    redirectPort: 8085,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  },

  'google-login': {
    providerId: 'google-login',
    flowType: 'authorization_code',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    redirectPort: 8086,
    scopes: [
      'https://www.googleapis.com/auth/cloud-platform',
      'openid',
      'email',
      'profile',
    ],
  },
};

// ─── Service ───────────────────────────────────────────────────────────

export class PlumbProviderAuthService {
  #credentialStore: IPlumbCredentialStore | null = null;

  async #getStore(): Promise<IPlumbCredentialStore> {
    if (!this.#credentialStore) {
      this.#credentialStore = await ensurePlumbCredentialStore();
    }
    return this.#credentialStore;
  }

  /** List all auth-capable providers with their current state. */
  async listAuthProviders(): Promise<AuthProviderInfo[]> {
    const registry = getPlumbProviderRegistry();
    await registry.initialize();
    const store = await this.#getStore();
    const providers: AuthProviderInfo[] = [];

    for (const [providerId, config] of Object.entries(OAUTH_CONFIGS)) {
      const state = registry.getProviderState(providerId);
      const metadata = await store.getProviderMetadata(providerId);
      const creds = await store.getCredentials(providerId);
      const oauthCred = creds.find((c) => c.credential.type === 'oauth');

      providers.push({
        providerId,
        displayName: this.#getDisplayName(providerId),
        flowType: config.flowType,
        authState: state?.authState ?? 'unauthenticated',
        accountLabel:
          oauthCred?.credential.type === 'oauth'
            ? (oauthCred.credential.email ?? metadata?.accountLabels[0])
            : undefined,
        error: state?.error,
      });
    }

    return providers;
  }

  /** Begin the login flow for a provider. Returns a login result. */
  async beginLogin(
    providerId: PlumbProviderId,
    apiKeyValue?: string,
  ): Promise<LoginResult> {
    const config = OAUTH_CONFIGS[providerId];
    if (!config) {
      // Try API key validation for providers without OAuth configs
      if (apiKeyValue) {
        return this.#validateApiKey(providerId, apiKeyValue);
      }
      return {
        success: false,
        error: `No auth flow configured for provider: ${providerId}`,
      };
    }

    const registry = getPlumbProviderRegistry();
    await registry.initialize();
    registry.setAuthenticating(providerId);

    try {
      switch (config.flowType) {
        case 'authorization_code_pkce':
        case 'authorization_code':
          return await this.#authorizationCodeFlow(providerId, config);
        case 'device_code':
          return await this.#deviceCodeFlow(providerId, config);
        case 'api_key':
        case 'paste_key':
          if (apiKeyValue) {
            return await this.#validateApiKey(providerId, apiKeyValue);
          }
          return {
            success: false,
            error: 'API key required. Please paste your API key.',
          };
        default:
          return {
            success: false,
            error: `Unsupported flow type: ${config.flowType}`,
          };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      registry.setAuthError(providerId, message);
      return { success: false, error: message };
    }
  }

  /** Complete an OAuth redirect (for manual code paste flows). */
  async completeRedirect(
    providerId: PlumbProviderId,
    code: string,
  ): Promise<LoginResult> {
    const config = OAUTH_CONFIGS[providerId];
    if (!config?.tokenUrl) {
      return {
        success: false,
        error: `No token exchange configured for: ${providerId}`,
      };
    }

    try {
      const tokenResponse = await this.#exchangeCode(config, code);
      const credential: PlumbOAuthCredential = {
        type: 'oauth',
        provider: providerId,
        access: tokenResponse.access_token,
        refresh: tokenResponse.refresh_token ?? '',
        expires: Date.now() + (tokenResponse.expires_in ?? 3600) * 1000,
        email: tokenResponse.email,
        accountId: tokenResponse.account_id,
      };

      const store = await this.#getStore();
      await store.storeOAuthCredential(providerId, credential);

      const registry = getPlumbProviderRegistry();
      await registry.setAuthenticated(providerId, credential);

      return {
        success: true,
        credential,
        accountLabel: credential.email ?? credential.accountId,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }

  /** Refresh an expired OAuth credential. */
  async refreshCredential(providerId: PlumbProviderId): Promise<LoginResult> {
    const store = await this.#getStore();
    const creds = await store.getCredentials(providerId);
    const oauthCred = creds.find(
      (c) => c.credential.type === 'oauth' && c.credential.refresh,
    );

    if (!oauthCred || oauthCred.credential.type !== 'oauth') {
      return { success: false, error: 'No refresh token available' };
    }

    const config = OAUTH_CONFIGS[providerId];
    if (!config?.tokenUrl) {
      return { success: false, error: 'No token URL configured' };
    }

    try {
      const response = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: oauthCred.credential.refresh,
          client_id: config.clientId ?? '',
        }),
      });

      if (!response.ok) {
        throw new Error(`Token refresh failed: ${response.status}`);
      }

      const data = (await response.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };

      const refreshed: PlumbOAuthCredential = {
        ...oauthCred.credential,
        access: data.access_token,
        refresh: data.refresh_token ?? oauthCred.credential.refresh,
        expires: Date.now() + (data.expires_in ?? 3600) * 1000,
      };

      await store.storeOAuthCredential(providerId, refreshed);
      const registry = getPlumbProviderRegistry();
      await registry.setAuthenticated(providerId, refreshed);

      return { success: true, credential: refreshed };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }

  /** Logout from a provider. */
  async logout(providerId: PlumbProviderId): Promise<void> {
    const store = await this.#getStore();
    await store.removeCredentials(providerId);
    const registry = getPlumbProviderRegistry();
    await registry.logout(providerId);
  }

  // ─── Private flow implementations ─────────────────────────────────

  async #authorizationCodeFlow(
    providerId: PlumbProviderId,
    config: OAuthFlowConfig,
  ): Promise<LoginResult> {
    const pkce = generatePkce();
    const state = generateState();

    const redirectUri = `http://127.0.0.1:${config.redirectPort}${config.redirectPath ?? '/oauth2callback'}`;

    const authUrl = new URL(config.authorizeUrl!);
    authUrl.searchParams.set('client_id', config.clientId ?? '');
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('state', state);
    if (config.scopes) {
      authUrl.searchParams.set('scope', config.scopes.join(' '));
    }
    if (config.flowType === 'authorization_code_pkce') {
      authUrl.searchParams.set('code_challenge', pkce.codeChallenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
    }

    // Open browser
    const { default: open } = await import('open');
    await open(authUrl.toString());

    debugLogger.log(
      `OAuth browser opened for ${providerId}: ${authUrl.toString()}`,
    );

    // Start callback server
    const { waitForCode } = await startOAuthCallbackServer({
      port: config.redirectPort!,
      path: config.redirectPath ?? '/oauth2callback',
    });

    // Also support paste-code fallback
    const codeResult = await Promise.race([
      waitForCode(),
      this.#waitForPasteCode(providerId),
    ]);

    if (codeResult.state !== state) {
      throw new Error('OAuth state mismatch - possible CSRF attack');
    }

    const tokenResponse = await this.#exchangeCode(
      config,
      codeResult.code,
      pkce.codeVerifier,
      redirectUri,
    );

    const credential: PlumbOAuthCredential = {
      type: 'oauth',
      provider: providerId,
      access: tokenResponse.access_token,
      refresh: tokenResponse.refresh_token ?? '',
      expires: Date.now() + (tokenResponse.expires_in ?? 3600) * 1000,
      email: tokenResponse.email,
      accountId: tokenResponse.account_id,
    };

    const store = await this.#getStore();
    await store.storeOAuthCredential(providerId, credential);
    const registry = getPlumbProviderRegistry();
    await registry.setAuthenticated(providerId, credential);

    return {
      success: true,
      credential,
      accountLabel: credential.email ?? credential.accountId,
    };
  }

  async #deviceCodeFlow(
    providerId: PlumbProviderId,
    config: OAuthFlowConfig,
  ): Promise<LoginResult> {
    // OIDC discovery for xai-oauth
    let deviceCodeUrl = config.deviceCodeUrl;
    if (!deviceCodeUrl && providerId === 'xai-oauth') {
      const discovery = await fetch(
        'https://auth.x.ai/.well-known/openid-configuration',
      ).then(
        (r) => r.json() as Promise<{ device_authorization_endpoint: string }>,
      );
      deviceCodeUrl = discovery.device_authorization_endpoint;
    }

    if (!deviceCodeUrl) {
      throw new Error('No device code URL configured');
    }

    const response = await fetch(deviceCodeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId ?? '',
        scope: config.scopes?.join(' ') ?? '',
      }),
    });

    if (!response.ok) {
      throw new Error(`Device code request failed: ${response.status}`);
    }

    const data = (await response.json()) as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      expires_in: number;
      interval?: number;
    };

    // Return the user code for display - the caller will poll
    return {
      success: false,
      error: `Please visit ${data.verification_uri} and enter code: ${data.user_code}`,
    };
  }

  async #validateApiKey(
    providerId: PlumbProviderId,
    apiKey: string,
  ): Promise<LoginResult> {
    const credential: PlumbApiKeyCredential = {
      type: 'api_key',
      provider: providerId,
      key: apiKey,
    };

    const store = await this.#getStore();
    await store.storeApiKeyCredential(providerId, credential);
    const registry = getPlumbProviderRegistry();
    await registry.setAuthenticated(providerId, credential);

    return { success: true, credential };
  }

  async #exchangeCode(
    config: OAuthFlowConfig,
    code: string,
    codeVerifier?: string,
    redirectUri?: string,
  ): Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    email?: string;
    account_id?: string;
  }> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: config.clientId ?? '',
    });

    if (redirectUri) body.set('redirect_uri', redirectUri);
    if (codeVerifier) body.set('code_verifier', codeVerifier);

    const response = await fetch(config.tokenUrl!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Token exchange failed: ${response.status} ${errText}`);
    }

    return response.json() as Promise<{
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      email?: string;
      account_id?: string;
    }>;
  }

  async #waitForPasteCode(
    _providerId: PlumbProviderId,
  ): Promise<{ code: string; state: string }> {
    // This is a placeholder - in the UI, the user pastes the code
    // and the dialog calls completeRedirect()
    return new Promise(() => {});
  }

  #getDisplayName(providerId: string): string {
    const names: Record<string, string> = {
      anthropic: 'Anthropic (Claude Pro/Max)',
      'openai-codex': 'ChatGPT / Codex',
      'github-copilot': 'GitHub Copilot',
      cursor: 'Cursor',
      'xai-oauth': 'xAI / SuperGrok',
      'kimi-code': 'Kimi Code',
      'google-gemini-cli': 'Google Gemini CLI',
      'google-login': 'Google Login',
    };
    return names[providerId] ?? providerId;
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────

let defaultService: PlumbProviderAuthService | undefined;

export function getPlumbProviderAuthService(): PlumbProviderAuthService {
  if (!defaultService) {
    defaultService = new PlumbProviderAuthService();
  }
  return defaultService;
}
