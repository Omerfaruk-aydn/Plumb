/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

import { debugLogger } from '../utils/debugLogger.js';

let initialized = false;

/**
 * Initialize the PLUMB multi-provider subsystem.
 * Must be called once before any provider operations.
 * Safe to call multiple times (idempotent).
 */
export async function initializePlumbProviders(): Promise<void> {
  if (initialized) return;
  initialized = true;

  try {
    // Dynamic import — the provider package may not be installed.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const mod = await import('@google/gemini-cli-provider');

    // Register all bundled OMP-derived models
     
    mod.initBundledModels();

    // Initialize the provider registry (loads saved credentials)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { getPlumbProviderRegistry } = mod;
     
    await getPlumbProviderRegistry().initialize();

    debugLogger.debug('PLUMB provider subsystem initialized.');
  } catch (err) {
    debugLogger.warn(
      'PLUMB provider subsystem not available:',
      err instanceof Error ? err.message : String(err),
    );
  }
}
