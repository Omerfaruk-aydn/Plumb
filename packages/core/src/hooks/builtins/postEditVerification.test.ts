/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createPostEditVerificationHook } from './postEditVerification.js';
import { HookType } from '../types.js';
import type { Config } from '../../config/config.js';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...(actual as object), spawn: vi.fn() };
});

class MockChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

function mockConfig(projectRoot: string): Config {
  return { getProjectRoot: () => projectRoot } as unknown as Config;
}

function afterToolInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    session_id: 's',
    transcript_path: 't',
    cwd: '/repo',
    hook_event_name: 'AfterTool',
    timestamp: '',
    tool_name: 'replace', // EDIT_TOOL_NAME's real value
    tool_input: { file_path: '' },
    tool_response: {},
    ...overrides,
  };
}

describe('createPostEditVerificationHook', () => {
  let tmpDir: string;
  let mockChild: MockChild;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pev-test-'));
    mockChild = new MockChild();
    vi.mocked(spawn).mockReset();
    vi.mocked(spawn).mockReturnValue(
      mockChild as unknown as ReturnType<typeof spawn>,
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('is a runtime hook (no shell command, plain JS action)', () => {
    const hook = createPostEditVerificationHook(mockConfig(tmpDir));
    expect(hook.type).toBe(HookType.Runtime);
    expect(hook.name).toBe('plumb.postEditVerification');
  });

  it('ignores tool calls that are not Edit/WriteFile', async () => {
    const hook = createPostEditVerificationHook(mockConfig(tmpDir));
    const result = await hook.action(
      afterToolInput({ tool_name: 'read_file' }),
      { signal: new AbortController().signal },
    );
    expect(result).toBeNull();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('ignores a tool call that already errored', async () => {
    const hook = createPostEditVerificationHook(mockConfig(tmpDir));
    const result = await hook.action(
      afterToolInput({
        tool_input: { file_path: path.join(tmpDir, 'a.ts') },
        tool_response: { error: { message: 'failed' } },
      }),
      { signal: new AbortController().signal },
    );
    expect(result).toBeNull();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('ignores files with no discoverable ESLint config', async () => {
    const hook = createPostEditVerificationHook(mockConfig(tmpDir));
    const result = await hook.action(
      afterToolInput({
        tool_input: { file_path: path.join(tmpDir, 'a.ts') },
      }),
      { signal: new AbortController().signal },
    );
    expect(result).toBeNull();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('ignores non-lintable file extensions even with a config present', async () => {
    await fs.writeFile(path.join(tmpDir, 'eslint.config.js'), '');
    const hook = createPostEditVerificationHook(mockConfig(tmpDir));
    const result = await hook.action(
      afterToolInput({
        tool_input: { file_path: path.join(tmpDir, 'notes.md') },
      }),
      { signal: new AbortController().signal },
    );
    expect(result).toBeNull();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('returns additionalContext with the trimmed output when eslint finds issues', async () => {
    await fs.writeFile(path.join(tmpDir, 'eslint.config.js'), '');
    const hook = createPostEditVerificationHook(mockConfig(tmpDir));

    const promise = hook.action(
      afterToolInput({
        tool_input: { file_path: path.join(tmpDir, 'a.ts') },
      }),
      { signal: new AbortController().signal },
    );

    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    mockChild.stdout.emit(
      'data',
      Buffer.from('a.ts\n  1:1  error  no-unused-vars'),
    );
    mockChild.emit('close', 1);

    const result = await promise;
    expect(result).not.toBeNull();
    expect(
      (result as { hookSpecificOutput: { additionalContext: string } })
        .hookSpecificOutput.additionalContext,
    ).toContain('no-unused-vars');
  });

  it('returns null (no-op) when eslint exits clean', async () => {
    await fs.writeFile(path.join(tmpDir, 'eslint.config.js'), '');
    const hook = createPostEditVerificationHook(mockConfig(tmpDir));

    const promise = hook.action(
      afterToolInput({
        tool_input: { file_path: path.join(tmpDir, 'a.ts') },
      }),
      { signal: new AbortController().signal },
    );

    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    mockChild.emit('close', 0);

    expect(await promise).toBeNull();
  });

  it('caps the context length rather than dumping unlimited lint output', async () => {
    await fs.writeFile(path.join(tmpDir, 'eslint.config.js'), '');
    const hook = createPostEditVerificationHook(mockConfig(tmpDir));

    const promise = hook.action(
      afterToolInput({
        tool_input: { file_path: path.join(tmpDir, 'a.ts') },
      }),
      { signal: new AbortController().signal },
    );

    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    mockChild.stdout.emit('data', Buffer.from('x'.repeat(5000)));
    mockChild.emit('close', 1);

    const result = (await promise) as {
      hookSpecificOutput: { additionalContext: string };
    };
    expect(result.hookSpecificOutput.additionalContext.length).toBeLessThan(
      2200,
    );
  });
});
