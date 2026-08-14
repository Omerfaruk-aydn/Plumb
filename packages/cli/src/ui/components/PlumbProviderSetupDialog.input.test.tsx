/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { renderWithProviders } from '../../test-utils/render.js';
import { PlumbProviderSetupDialog } from './PlumbProviderSetupDialog.js';
import { PlumbProviderCategory } from '@plumb/provider';
import type { PlumbProvider } from '@plumb/provider';
import { useKeypress } from '../hooks/useKeypress.js';
import { Command } from '../key/keyMatchers.js';
import { useKeyMatchers } from '../hooks/useKeyMatchers.js';

enum TerminalKeys {
  ENTER = '\u000D',
  UP_ARROW = '\u001B[A',
  DOWN_ARROW = '\u001B[B',
  ESCAPE = '\u001B',
  BACKSPACE = '\u007F',
}

const nvidiaProvider: PlumbProvider = {
  id: 'nvidia',
  name: 'NVIDIA',
  category: PlumbProviderCategory.API_KEY,
  description: 'NVIDIA NIM',
  authMethods: [{ type: 'api_key', envVar: 'NVIDIA_API_KEY' }],
  allowUnauthenticated: false,
  available: true,
  envVars: ['NVIDIA_API_KEY'],
};

const providers = [nvidiaProvider];
const categoryGroups = new Map<string, PlumbProvider[]>();
categoryGroups.set('api-key', [nvidiaProvider]);
const models = [
  {
    id: 'nvidia/llama-3.1-nemotron-70b-instruct',
    name: 'Nemotron',
    provider: 'nvidia',
  },
];

async function pressKey(stdin: { write: (data: string) => void }, key: string) {
  await act(async () => {
    vi.advanceTimersByTime(100);
    stdin.write(key);
  });
}

/**
 * A component that simulates InputPrompt's keypress subscription at High
 * priority. It registers a handler that matches Command.RETURN (Enter) and
 * tracks whether it consumed the keypress. This reproduces the scenario where
 * Composer/InputPrompt could steal Enter from the dialog.
 */
function CompetingHighPriorityHandler({
  onEnterConsumed,
  activeRef,
}: {
  onEnterConsumed: () => void;
  activeRef?: { current: boolean };
}) {
  const keyMatchers = useKeyMatchers();

  useKeypress(
    (key) => {
      if (activeRef && !activeRef.current) {
        return false;
      }
      if (keyMatchers[Command.RETURN](key)) {
        onEnterConsumed();
        return true; // Consume the key — this is the bug
      }
      return false;
    },
    { isActive: true, priority: true }, // Same priority as dialog
  );

  return null;
}

describe(
  'PlumbProviderSetupDialog — Input Competition Tests',
  { timeout: 30000 },
  () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it('dialog Enter at confirm step is consumed ONLY by the dialog, not by a competing High-priority handler subscribed BEFORE the dialog', async () => {
      const onComplete = vi.fn();
      const competingEnterCount = { value: 0 };
      const onCompetingEnter = vi.fn(() => {
        competingEnterCount.value++;
      });

      const activeRef = { current: false };

      const { stdin, lastFrame, waitUntilReady } = await renderWithProviders(
        <>
          <CompetingHighPriorityHandler
            onEnterConsumed={onCompetingEnter}
            activeRef={activeRef}
          />
          <PlumbProviderSetupDialog
            onComplete={onComplete}
            onCancel={vi.fn()}
            providers={providers}
            categoryGroups={categoryGroups}
            models={models}
          />
        </>,
      );

      await waitUntilReady();

      // Navigate: API Key Provider category (index 2)
      await pressKey(stdin, TerminalKeys.DOWN_ARROW);
      await waitUntilReady();
      await pressKey(stdin, TerminalKeys.DOWN_ARROW);
      await waitUntilReady();
      await pressKey(stdin, TerminalKeys.ENTER);
      await waitUntilReady();

      // Select NVIDIA
      await pressKey(stdin, TerminalKeys.DOWN_ARROW);
      await waitUntilReady();
      await pressKey(stdin, TerminalKeys.ENTER);
      await waitUntilReady();

      // Type API key and submit
      for (const ch of 'nvapi-test-key') {
        await pressKey(stdin, ch);
      }
      await pressKey(stdin, TerminalKeys.ENTER);
      await waitUntilReady();

      // Select model
      await pressKey(stdin, TerminalKeys.ENTER);
      await waitUntilReady();

      // Should be on confirm step
      expect(lastFrame()).toContain('Confirm setup');
      expect(lastFrame()).toContain('Step 5');

      // Activate competing handler at confirm step
      activeRef.current = true;

      // Press Enter to confirm
      await pressKey(stdin, TerminalKeys.ENTER);
      await waitUntilReady();

      // The dialog should have received the Enter (onComplete called)
      // The competing handler should NOT have consumed it
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(competingEnterCount.value).toBe(0);
    });

    it('dialog Enter at confirm step is consumed ONLY by the dialog, not by a competing High-priority handler subscribed AFTER the dialog', async () => {
      const onComplete = vi.fn();
      const competingEnterCount = { value: 0 };
      const onCompetingEnter = vi.fn(() => {
        competingEnterCount.value++;
      });

      const activeRef = { current: false };

      const { stdin, lastFrame, waitUntilReady } = await renderWithProviders(
        <>
          <PlumbProviderSetupDialog
            onComplete={onComplete}
            onCancel={vi.fn()}
            providers={providers}
            categoryGroups={categoryGroups}
            models={models}
          />
          <CompetingHighPriorityHandler
            onEnterConsumed={onCompetingEnter}
            activeRef={activeRef}
          />
        </>,
      );

      await waitUntilReady();

      // Navigate: API Key Provider category (index 2)
      await pressKey(stdin, TerminalKeys.DOWN_ARROW);
      await waitUntilReady();
      await pressKey(stdin, TerminalKeys.DOWN_ARROW);
      await waitUntilReady();
      await pressKey(stdin, TerminalKeys.ENTER);
      await waitUntilReady();

      // Select NVIDIA
      await pressKey(stdin, TerminalKeys.DOWN_ARROW);
      await waitUntilReady();
      await pressKey(stdin, TerminalKeys.ENTER);
      await waitUntilReady();

      // Type API key and submit
      for (const ch of 'nvapi-test-key') {
        await pressKey(stdin, ch);
      }
      await pressKey(stdin, TerminalKeys.ENTER);
      await waitUntilReady();

      // Select model
      await pressKey(stdin, TerminalKeys.ENTER);
      await waitUntilReady();

      // Should be on confirm step
      expect(lastFrame()).toContain('Confirm setup');
      expect(lastFrame()).toContain('Step 5');

      // Activate competing handler at confirm step
      activeRef.current = true;

      // Press Enter to confirm
      await pressKey(stdin, TerminalKeys.ENTER);
      await waitUntilReady();

      // CRITICAL: Even though the competing handler subscribes AFTER the dialog
      // (and thus runs FIRST within the same priority level), the dialog should
      // still receive the Enter because InputPrompt must be inactive when a
      // modal dialog is open.
      //
      // With the current code (no input ownership), the competing handler
      // WOULD steal Enter because it runs first. After the fix, InputPrompt
      // should not be active when a modal dialog is open.
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(competingEnterCount.value).toBe(0);
    });

    it('repeated Enter at confirm step only triggers onComplete once', async () => {
      const onComplete = vi.fn();

      const { stdin, lastFrame, waitUntilReady } = await renderWithProviders(
        <PlumbProviderSetupDialog
          onComplete={onComplete}
          onCancel={vi.fn()}
          providers={providers}
          categoryGroups={categoryGroups}
          models={models}
        />,
      );

      await waitUntilReady();

      // Navigate to confirm
      await pressKey(stdin, TerminalKeys.DOWN_ARROW);
      await pressKey(stdin, TerminalKeys.DOWN_ARROW);
      await pressKey(stdin, TerminalKeys.ENTER);
      await waitUntilReady();

      await pressKey(stdin, TerminalKeys.DOWN_ARROW);
      await pressKey(stdin, TerminalKeys.ENTER);
      await waitUntilReady();

      for (const ch of 'nvapi-test-key') {
        await pressKey(stdin, ch);
      }
      await pressKey(stdin, TerminalKeys.ENTER);
      await waitUntilReady();

      await pressKey(stdin, TerminalKeys.ENTER);
      await waitUntilReady();

      expect(lastFrame()).toContain('Confirm setup');

      // Press Enter 5 times rapidly
      await pressKey(stdin, TerminalKeys.ENTER);
      await pressKey(stdin, TerminalKeys.ENTER);
      await pressKey(stdin, TerminalKeys.ENTER);
      await pressKey(stdin, TerminalKeys.ENTER);
      await pressKey(stdin, TerminalKeys.ENTER);
      await waitUntilReady();

      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('Backspace at confirm returns to model selection', async () => {
      const onComplete = vi.fn();

      const { stdin, lastFrame, waitUntilReady } = await renderWithProviders(
        <PlumbProviderSetupDialog
          onComplete={onComplete}
          onCancel={vi.fn()}
          providers={providers}
          categoryGroups={categoryGroups}
          models={models}
        />,
      );

      await waitUntilReady();

      // Navigate to confirm
      await pressKey(stdin, TerminalKeys.DOWN_ARROW);
      await pressKey(stdin, TerminalKeys.DOWN_ARROW);
      await pressKey(stdin, TerminalKeys.ENTER);
      await waitUntilReady();

      await pressKey(stdin, TerminalKeys.DOWN_ARROW);
      await pressKey(stdin, TerminalKeys.ENTER);
      await waitUntilReady();

      for (const ch of 'nvapi-test-key') {
        await pressKey(stdin, ch);
      }
      await pressKey(stdin, TerminalKeys.ENTER);
      await waitUntilReady();

      await pressKey(stdin, TerminalKeys.ENTER);
      await waitUntilReady();

      expect(lastFrame()).toContain('Confirm setup');

      // Backspace returns to model selection
      await pressKey(stdin, TerminalKeys.BACKSPACE);
      await waitUntilReady();

      expect(lastFrame()).toContain('Step 4');
      expect(lastFrame()).not.toContain('Confirm setup');
      expect(onComplete).not.toHaveBeenCalled();
    });

    it('Escape at confirm cancels setup', async () => {
      const onComplete = vi.fn();
      const onCancel = vi.fn();

      const { stdin, lastFrame, waitUntilReady } = await renderWithProviders(
        <PlumbProviderSetupDialog
          onComplete={onComplete}
          onCancel={onCancel}
          providers={providers}
          categoryGroups={categoryGroups}
          models={models}
        />,
      );

      await waitUntilReady();

      // Navigate to confirm
      await pressKey(stdin, TerminalKeys.DOWN_ARROW);
      await waitUntilReady();
      await pressKey(stdin, TerminalKeys.DOWN_ARROW);
      await waitUntilReady();
      await pressKey(stdin, TerminalKeys.ENTER);
      await waitUntilReady();

      await pressKey(stdin, TerminalKeys.DOWN_ARROW);
      await waitUntilReady();
      await pressKey(stdin, TerminalKeys.ENTER);
      await waitUntilReady();

      for (const ch of 'nvapi-test-key') {
        await pressKey(stdin, ch);
      }
      await pressKey(stdin, TerminalKeys.ENTER);
      await waitUntilReady();

      await pressKey(stdin, TerminalKeys.ENTER);
      await waitUntilReady();

      expect(lastFrame()).toContain('Confirm setup');

      // Escape returns to model selection
      await pressKey(stdin, TerminalKeys.ESCAPE);

      expect(onComplete).not.toHaveBeenCalled();
    });

    it('no legacy Gemini auth text appears at any step', async () => {
      const { stdin, lastFrame, waitUntilReady } = await renderWithProviders(
        <PlumbProviderSetupDialog
          onComplete={vi.fn()}
          onCancel={vi.fn()}
          providers={providers}
          categoryGroups={categoryGroups}
          models={models}
        />,
      );

      await waitUntilReady();

      // Check all steps for legacy auth text
      const frame1 = lastFrame();
      expect(frame1).not.toContain('Sign in with Google');
      expect(frame1).not.toContain('geminicli.com');
      expect(frame1).not.toContain('Get started');

      // Navigate through all steps
      await pressKey(stdin, TerminalKeys.DOWN_ARROW);
      await pressKey(stdin, TerminalKeys.DOWN_ARROW);
      await pressKey(stdin, TerminalKeys.ENTER);
      await waitUntilReady();

      const frame2 = lastFrame();
      expect(frame2).not.toContain('Sign in with Google');
      expect(frame2).not.toContain('geminicli.com');

      await pressKey(stdin, TerminalKeys.DOWN_ARROW);
      await pressKey(stdin, TerminalKeys.ENTER);
      await waitUntilReady();

      for (const ch of 'nvapi-test-key') {
        await pressKey(stdin, ch);
      }
      await pressKey(stdin, TerminalKeys.ENTER);
      await waitUntilReady();

      const frame3 = lastFrame();
      expect(frame3).not.toContain('Sign in with Google');
      expect(frame3).not.toContain('geminicli.com');
      expect(frame3).not.toContain('Waiting for authorization');

      await pressKey(stdin, TerminalKeys.ENTER);
      await waitUntilReady();

      const frame4 = lastFrame();
      expect(frame4).not.toContain('Sign in with Google');
      expect(frame4).not.toContain('geminicli.com');
      expect(frame4).toContain('Confirm setup');
    });
  },
);
