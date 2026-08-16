/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export * from './types.js';
export * from './base-token-storage.js';
export * from './hybrid-token-storage.js';
export * from './keychain-token-storage.js';

export * from './migrating-token-storage.js';

export const DEFAULT_SERVICE_NAME = 'plumb-cli-oauth';

/**
 * The service name used before the rebrand. Credentials saved by an older
 * install are still filed under this key, so reads fall back to it and copy
 * forward rather than silently losing every stored login.
 */
export const LEGACY_DEFAULT_SERVICE_NAME = 'gemini-cli-oauth';
export const FORCE_ENCRYPTED_FILE_ENV_VAR =
  'GEMINI_FORCE_ENCRYPTED_FILE_STORAGE';
