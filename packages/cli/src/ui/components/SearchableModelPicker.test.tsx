/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderWithProviders } from '../../test-utils/render.js';
import { act } from 'react';
import { SearchableModelPicker } from './SearchableModelPicker.js';
import type { PlumbModel } from '@google/gemini-cli-provider';

enum TerminalKeys {
  ENTER = '\u000D',
  UP_ARROW = '\u001B[A',
  DOWN_ARROW = '\u001B[B',
  ESCAPE = '\u001B',
  BACKSPACE = '\u007F',
}

function makeModel(
  id: string,
  provider = 'openai',
  overrides: Partial<PlumbModel> = {},
): PlumbModel {
  return {
    id,
    name: id,
    provider,
    api: 'openai-completions',
    contextWindow: 131072,
    maxTokens: 32768,
    reasoning: false,
    input: 'text',
    ...overrides,
  };
}

function makeModels(count: number, provider = 'openai'): PlumbModel[] {
  return Array.from({ length: count }, (_, i) =>
    makeModel(`model-${i}`, provider),
  );
}

async function pressKey(stdin: { write: (data: string) => void }, key: string) {
  await act(async () => {
    vi.advanceTimersByTime(100);
    stdin.write(key);
  });
}

describe('SearchableModelPicker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('1. renders model list', async () => {
    const models = [makeModel('gpt-4'), makeModel('claude-opus')];
    const { lastFrame } = await renderWithProviders(
      <SearchableModelPicker
        models={models}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain('gpt-4');
    expect(frame).toContain('claude-opus');
  });

  it('2. renders 1000+ models without crashing', async () => {
    const models = makeModels(1500);
    const { lastFrame } = await renderWithProviders(
      <SearchableModelPicker
        models={models}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain('1500');
    // Should show bounded rows, not all 1500
    expect(frame).toContain('more');
  });

  it('3. fuzzy search filters models', async () => {
    const models = [
      makeModel('gpt-4'),
      makeModel('gpt-3.5-turbo'),
      makeModel('claude-opus'),
    ];
    const { stdin, lastFrame, waitUntilReady } = await renderWithProviders(
      <SearchableModelPicker
        models={models}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await waitUntilReady();
    await pressKey(stdin, 'g');
    await waitUntilReady();

    const frame = lastFrame();
    expect(frame).toContain('gpt-4');
    expect(frame).toContain('gpt-3.5-turbo');
    expect(frame).not.toContain('claude-opus');
  });

  it('4. Enter selects highlighted model', async () => {
    const onSelect = vi.fn();
    const models = [makeModel('gpt-4'), makeModel('claude-opus')];
    const { stdin, waitUntilReady } = await renderWithProviders(
      <SearchableModelPicker
        models={models}
        onSelect={onSelect}
        onCancel={vi.fn()}
      />,
    );

    await waitUntilReady();
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'gpt-4' }),
    );
  });

  it('5. Down arrow changes selection', async () => {
    const onSelect = vi.fn();
    const models = [makeModel('gpt-4'), makeModel('claude-opus')];
    const { stdin, waitUntilReady } = await renderWithProviders(
      <SearchableModelPicker
        models={models}
        onSelect={onSelect}
        onCancel={vi.fn()}
      />,
    );

    await waitUntilReady();
    await pressKey(stdin, TerminalKeys.DOWN_ARROW);
    await pressKey(stdin, TerminalKeys.ENTER);
    await waitUntilReady();

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'claude-opus' }),
    );
  });

  it('6. Escape with empty query calls onCancel', async () => {
    const onCancel = vi.fn();
    const models = [makeModel('gpt-4')];
    const { stdin, waitUntilReady } = await renderWithProviders(
      <SearchableModelPicker
        models={models}
        onSelect={vi.fn()}
        onCancel={onCancel}
      />,
    );

    await waitUntilReady();
    await pressKey(stdin, TerminalKeys.ESCAPE);
    await waitUntilReady();

    expect(onCancel).toHaveBeenCalled();
  });

  it('7. shows search input when typing', async () => {
    const models = [makeModel('gpt-4'), makeModel('claude')];
    const { stdin, lastFrame, waitUntilReady } = await renderWithProviders(
      <SearchableModelPicker
        models={models}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await waitUntilReady();
    await pressKey(stdin, 'g');
    await waitUntilReady();

    const frame = lastFrame();
    expect(frame).toContain('gpt-4');
    expect(frame).not.toContain('claude');
  });

  it('8. shows provider name for each model', async () => {
    const models = [
      makeModel('gpt-4', 'openai'),
      makeModel('claude', 'anthropic'),
    ];
    const { lastFrame } = await renderWithProviders(
      <SearchableModelPicker
        models={models}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain('openai');
    expect(frame).toContain('anthropic');
  });

  it('9. shows no-match message when search finds nothing', async () => {
    const models = [makeModel('gpt-4')];
    const { stdin, lastFrame, waitUntilReady } = await renderWithProviders(
      <SearchableModelPicker
        models={models}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await waitUntilReady();
    await pressKey(stdin, 'z');
    await pressKey(stdin, 'z');
    await pressKey(stdin, 'z');
    await waitUntilReady();

    const frame = lastFrame();
    expect(frame).toContain('No models match');
  });

  it('10. shows model count', async () => {
    const models = makeModels(50);
    const { lastFrame } = await renderWithProviders(
      <SearchableModelPicker
        models={models}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(lastFrame()).toContain('50');
  });

  it('11. shows navigation hints', async () => {
    const models = [makeModel('gpt-4')];
    const { lastFrame } = await renderWithProviders(
      <SearchableModelPicker
        models={models}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain('search');
    expect(frame).toContain('Enter');
    expect(frame).toContain('ESC');
  });

  // Bug 3/5 regression: OpenCode Zen's real, currently-free models (e.g.
  // deepseek-v4-flash-free) must show a truthful FREE badge, driven only by
  // a real all-zero pricing record -- never inferred from the model id/name
  // string, and never shown for a model with no pricing data at all.
  it('12. shows a FREE badge only for a model with an explicit all-zero pricing record', async () => {
    const models = [
      makeModel('deepseek-v4-flash-free', 'opencode-zen', {
        pricing: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      }),
      makeModel('grok-4.5', 'opencode-go', {
        // No pricing data at all -- must NOT be labeled free.
      }),
      makeModel('gpt-5.6-luna', 'opencode-go', {
        pricing: { input: 3, output: 15 },
      }),
    ];
    const { lastFrame } = await renderWithProviders(
      <SearchableModelPicker
        models={models}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? '';
    const lines = frame.split('\n');
    const freeLine = lines.find((l) => l.includes('deepseek-v4-flash-free'));
    const goLine = lines.find((l) => l.includes('grok-4.5'));
    const paidLine = lines.find((l) => l.includes('gpt-5.6-luna'));
    expect(freeLine).toContain('FREE');
    expect(goLine).not.toContain('FREE');
    expect(paidLine).not.toContain('FREE');
  });

  it("13. shows each model's own max-output figure, never a sibling's or a global constant", async () => {
    const models = [
      makeModel('claude-opus-4-8', 'claude-subscription', {
        contextWindow: 200_000,
        maxTokens: 32_000,
      }),
      makeModel('claude-sonnet-5', 'claude-subscription', {
        contextWindow: 200_000,
        maxTokens: 64_000,
      }),
    ];
    const { lastFrame } = await renderWithProviders(
      <SearchableModelPicker
        models={models}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? '';
    const lines = frame.split('\n');
    const opusLine = lines.find((l) => l.includes('claude-opus-4-8'));
    const sonnetLine = lines.find((l) => l.includes('claude-sonnet-5'));
    expect(opusLine).toContain('32K max output');
    expect(sonnetLine).toContain('64K max output');
  });

  it('14. shows an honest, compact tool-calling capability label per model: "tools" / "no tools" / "tools ?" -- reading model.toolsSupported directly, never guessed', async () => {
    const models = [
      makeModel('supported-model', 'opencode-zen', { toolsSupported: true }),
      makeModel('unsupported-model', 'opencode-zen', {
        toolsSupported: false,
      }),
      makeModel('unknown-model', 'opencode-zen', {
        toolsSupported: undefined,
      }),
    ];
    const { lastFrame } = await renderWithProviders(
      <SearchableModelPicker
        models={models}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? '';
    const lines = frame.split('\n');
    const supportedLine = lines.find((l) => l.includes('supported-model'));
    const unsupportedLine = lines.find((l) => l.includes('unsupported-model'));
    const unknownLine = lines.find((l) => l.includes('unknown-model'));

    expect(supportedLine).toContain('tools');
    expect(supportedLine).not.toContain('no tools');
    expect(supportedLine).not.toContain('tools ?');

    expect(unsupportedLine).toContain('no tools');

    expect(unknownLine).toContain('tools ?');
    expect(unknownLine).not.toContain('no tools');
  });
});
