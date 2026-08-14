/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { completionsCommand } from './completions.js';

vi.mock('./completionMetadata.js', () => ({
  collectCompletionMetadata: vi.fn().mockResolvedValue({
    slashCommands: ['/help'],
    flags: ['--model'],
    models: ['gemini-pro'],
    sessions: [],
  }),
}));

function spyOnWrite(stream: NodeJS.WriteStream) {
  return vi.spyOn(stream, 'write').mockImplementation(() => true);
}

describe('completionsCommand', () => {
  let stdoutSpy: ReturnType<typeof spyOnWrite>;
  let stderrSpy: ReturnType<typeof spyOnWrite>;

  beforeEach(() => {
    stdoutSpy = spyOnWrite(process.stdout);
    stderrSpy = spyOnWrite(process.stderr);
    process.exitCode = undefined;
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    process.exitCode = undefined;
  });

  it('writes a bash completion script to stdout for a valid shell', async () => {
    await completionsCommand.handler({ shell: 'bash', _: [], $0: 'plumb' });

    expect(stdoutSpy).toHaveBeenCalled();
    const written = stdoutSpy.mock.calls[0][0] as string;
    expect(written).toContain('_plumb_completions');
    expect(process.exitCode).toBeUndefined();
  });

  it('errors to stderr and sets a non-zero exit code for an unknown shell', async () => {
    await completionsCommand.handler({
      shell: 'powerbash',
      _: [],
      $0: 'plumb',
    });

    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unknown shell "powerbash"'),
    );
    expect(process.exitCode).toBe(1);
  });
});
