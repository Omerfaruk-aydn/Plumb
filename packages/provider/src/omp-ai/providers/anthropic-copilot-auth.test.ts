/**
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression test for the "Authorization header is badly formatted" defect:
 * buildAnthropicClientOptions silently fell back to an empty-string
 * credential and built `Authorization: Bearer ` (no token) for GitHub
 * Copilot instead of failing with a clear, classified error.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { installBunGlobal } from '../../omp-shims/bun-runtime.js';
// `anthropic.ts` (transitively, via stream.ts) reads Bun.env at module top
// level, so the shim must be installed before it's imported — a dynamic
// import after installBunGlobal() keeps that ordering, since static imports
// are hoisted ahead of any code in this file.
installBunGlobal();

let buildAnthropicClientOptions: typeof import('./anthropic.js').buildAnthropicClientOptions;
let AIError: typeof import('../error/index.js');
let copilotModel:
  | import('../../omp-catalog/types.js').Model<'anthropic-messages'>
  | undefined;

beforeAll(async () => {
  const [anthropic, errorModule, models] = await Promise.all([
    import('./anthropic.js'),
    import('../error/index.js'),
    import('../../omp-catalog/models.js'),
  ]);
  buildAnthropicClientOptions = anthropic.buildAnthropicClientOptions;
  AIError = errorModule;
  copilotModel = models
    .getBundledModels('github-copilot')
    .find((m) => m.api === 'anthropic-messages') as
    | import('../../omp-catalog/types.js').Model<'anthropic-messages'>
    | undefined;
});

describe('buildAnthropicClientOptions — GitHub Copilot credential guard', () => {
  it('throws a classified MissingApiKeyError instead of building an empty Bearer header when apiKey is empty', () => {
    if (!copilotModel) return;
    expect(() =>
      buildAnthropicClientOptions({
        model: copilotModel!,
        apiKey: '',
      }),
    ).toThrow(AIError.MissingApiKeyError);
  });

  it('builds a real Bearer header from a present credential (no regression to the working path)', () => {
    if (!copilotModel) return;
    const result = buildAnthropicClientOptions({
      model: copilotModel!,
      apiKey: 'gho_real_token',
    });
    expect(result.defaultHeaders['Authorization']).toBe(
      'Bearer gho_real_token',
    );
  });
});
