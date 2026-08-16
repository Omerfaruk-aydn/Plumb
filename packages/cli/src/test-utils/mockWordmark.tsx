/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi } from 'vitest';

/**
 * Freezes the animated wordmark to a static frame suite-wide, the same way
 * `mockShimmerText` freezes the shimmer and `mockInkSpinner` freezes the
 * spinner.
 *
 * The real component runs a 30fps `setInterval` and mounts on AppHeader,
 * which renders on essentially every test that touches the app shell --
 * left live it produces `act(...)` warnings and non-deterministic
 * snapshots across unrelated suites.
 *
 * The mock keeps the component's *shape* contract (screen-reader and
 * narrow fallbacks, ASCII under NO_COLOR, block glyphs otherwise) so
 * assertions about what the header renders stay meaningful; only the
 * animation is removed. `PlumbAnimatedWordmark.test.tsx` calls
 * `vi.unmock` to exercise the real thing.
 */
export function mockAnimatedWordmark() {
  vi.mock('../ui/components/PlumbAnimatedWordmark.js', async () => {
    const { Box, Text } = await import('ink');
    const { renderPlumbBlockWordmark } = await import('@plumb/core');
    const { ThemedGradient } = await import(
      '../ui/components/ThemedGradient.js'
    );

    return {
      DEFAULT_WORDMARK_FPS: 30,
      buildFlowingPalette: () => ['#000000'],
      PlumbAnimatedWordmark: function MockPlumbAnimatedWordmark({
        terminalWidth = 80,
        isNarrow = false,
        noColor = false,
        screenReader = false,
      }: {
        terminalWidth?: number;
        isNarrow?: boolean;
        noColor?: boolean;
        screenReader?: boolean;
      }) {
        if (screenReader) return <Text>PLUMB</Text>;
        if (isNarrow || terminalWidth < 60) return <Text bold>PLUMB</Text>;

        const blockText = renderPlumbBlockWordmark({ useAscii: noColor });
        if (noColor) return <Text>{blockText}</Text>;

        // Matches the real component's `disabled` branch exactly, so a
        // frozen frame in a snapshot is still a faithful picture of the
        // header -- only the hue rotation is gone.
        return (
          <Box flexDirection="column" flexShrink={0}>
            <ThemedGradient>
              <Text>{blockText}</Text>
            </ThemedGradient>
          </Box>
        );
      },
    };
  });
}
