/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  generateCompletion,
  COMPLETION_SHELLS,
  type CompletionMetadataInput,
} from './completionGenerators.js';

const BASE_METADATA: CompletionMetadataInput = {
  slashCommands: ['/help', '/model', '/stats session'],
  flags: ['--model', '--resume', '--yolo'],
  models: ['gemini-pro', 'gemini-flash'],
  sessions: ['session-abc123'],
};

describe('generateCompletion', () => {
  it.each(COMPLETION_SHELLS)(
    'emits a stable script for %s (snapshot)',
    (shell) => {
      expect(generateCompletion(shell, BASE_METADATA)).toMatchSnapshot();
    },
  );

  it('injects the live model list into --model completion for every shell', () => {
    for (const shell of COMPLETION_SHELLS) {
      const script = generateCompletion(shell, BASE_METADATA);
      expect(script).toContain('gemini-pro');
      expect(script).toContain('gemini-flash');
    }
  });

  it('injects the live session list into --resume completion for every shell', () => {
    for (const shell of COMPLETION_SHELLS) {
      const script = generateCompletion(shell, BASE_METADATA);
      expect(script).toContain('session-abc123');
    }
  });

  it('throws with the full list of supported shells for an unknown shell', () => {
    expect(() =>
      // @ts-expect-error -- deliberately passing an invalid shell
      generateCompletion('powerbash', BASE_METADATA),
    ).toThrow(/Unsupported shell/);
  });

  it('escapes single quotes in session names so they stay one candidate per shell', () => {
    const metadata: CompletionMetadataInput = {
      ...BASE_METADATA,
      sessions: [`session with 'quotes' and spaces`],
    };

    const bash = generateCompletion('bash', metadata);
    expect(bash).toContain(`'session with '\\''quotes'\\'' and spaces'`);

    const fish = generateCompletion('fish', metadata);
    expect(fish).toContain(`session with \\'quotes\\' and spaces`);

    const powershell = generateCompletion('powershell', metadata);
    expect(powershell).toContain(`'session with ''quotes'' and spaces'`);

    const zsh = generateCompletion('zsh', metadata);
    expect(zsh).toContain(`'session with '\\''quotes'\\'' and spaces'`);
  });

  it('changes output when metadata changes (never a stale, cached script)', () => {
    const before = generateCompletion('bash', BASE_METADATA);
    const after = generateCompletion('bash', {
      ...BASE_METADATA,
      models: [...BASE_METADATA.models, 'brand-new-model'],
      sessions: [...BASE_METADATA.sessions, 'brand-new-session'],
    });

    expect(before).not.toContain('brand-new-model');
    expect(after).toContain('brand-new-model');
    expect(after).toContain('brand-new-session');
    expect(before).not.toEqual(after);
  });

  it('includes slash commands alongside flags in the top-level candidate list', () => {
    for (const shell of COMPLETION_SHELLS) {
      const script = generateCompletion(shell, BASE_METADATA);
      expect(script).toContain('/model');
      expect(script).toContain('/stats session');
    }
  });
});
