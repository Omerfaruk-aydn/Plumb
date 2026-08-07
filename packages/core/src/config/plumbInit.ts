/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

import { debugLogger } from '../utils/debugLogger.js';
import { getPlumbCredentialStore as getCoreCredentialStore } from '../auth/plumbSecureCredentialStore.js';
import { getPlumbProviderAuthService } from '../auth/plumbProviderAuthService.js';
// Type-only import: erased at compile time, so this does not create a
// runtime load-order cycle with the dynamic `import()` below — it only
// gives the dynamically-imported module a real static shape to check
// against, instead of the `any` it silently had before.
import type * as GeminiCliProviderModule from '@google/gemini-cli-provider';

let initialized = false;

export async function initializePlumbProviders(): Promise<void> {
  if (initialized) return;
  initialized = true;

  try {
    const mod: typeof GeminiCliProviderModule = await import(
      '@google/gemini-cli-provider'
    );

    // Return type is pinned to the canonical interface here, at the
    // production wiring boundary — if the concrete store class ever stops
    // satisfying IPlumbCredentialStore, this line fails typecheck instead
    // of surfacing as a runtime "is not a function" error post-auth.
    mod.registerPlumbCredentialStoreFactory(
      (): Promise<GeminiCliProviderModule.IPlumbCredentialStore> =>
        Promise.resolve(getCoreCredentialStore()),
    );

    // Register the real, pinned-OMP-backed silent token refresher so
    // resolveUsablePlumbCredential (shared by production transports and
    // diagnostics) can recover an expired-but-refreshable credential
    // without a new OAuth/login flow.
    mod.registerPlumbCredentialRefresher(async (providerId: string) => {
      const result =
        await getPlumbProviderAuthService().refreshCredential(providerId);
      if (
        !result.success ||
        !result.credential ||
        result.credential.type !== 'oauth'
      ) {
        return {
          success: false,
          error: result.error ?? 'refresh returned no credential',
        };
      }
      return { success: true, credential: result.credential };
    });

    // Register all bundled OMP-derived models
    mod.initBundledModels();

    // Initialize the provider registry
    const { getPlumbProviderRegistry } = mod;
    await getPlumbProviderRegistry().initialize();
  } catch (err) {
    debugLogger.warn(
      'PLUMB provider subsystem not available:',
      err instanceof Error ? err.message : String(err),
    );
  }
}
