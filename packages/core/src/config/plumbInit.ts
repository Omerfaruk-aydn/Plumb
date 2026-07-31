/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * PLUMB provider subsystem initialization.
 * Called once at startup to load bundled models and initialize the provider registry.
 */

import { debugLogger } from '../utils/debugLogger.js';
import { getPlumbCredentialStore as getCoreCredentialStore } from '../auth/plumbSecureCredentialStore.js';

let initialized = false;

export async function initializePlumbProviders(): Promise<void> {
  if (initialized) return;
  initialized = true;

  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const mod = await import('@google/gemini-cli-provider');

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    mod.registerPlumbCredentialStoreFactory(() => Promise.resolve(getCoreCredentialStore()));

    // Register all bundled OMP-derived models
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    mod.initBundledModels();

    // Initialize the provider registry
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const { getPlumbProviderRegistry } = mod;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await getPlumbProviderRegistry().initialize();

    debugLogger.debug('PLUMB provider subsystem initialized.');
  } catch (err) {
    debugLogger.warn(
      'PLUMB provider subsystem not available:',
      err instanceof Error ? err.message : String(err),
    );
  }
}
