/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi } from 'vitest';

/**
 * Freezes ShimmerText to its inactive (flat) rendering suite-wide, the
 * same way `mockInkSpinner` freezes the spinner to frame 0.
 *
 * The real component runs a 30fps `setInterval` and mounts on
 * LoadingIndicator, which renders on essentially every test that touches
 * the app shell -- left live it produces `act(...)` warnings and
 * non-deterministic snapshots across unrelated suites.
 */
export function mockShimmerText() {
  vi.mock('../ui/components/ShimmerText.js', async () => {
    const { Text } = await import('ink');
    const { theme } = await import('../ui/semantic-colors.js');

    return {
      ShimmerText: function MockShimmerText({
        text,
        italic,
      }: {
        text: string;
        active: boolean;
        italic?: boolean;
      }) {
        return (
          <Text color={theme.text.accent} italic={italic} wrap="truncate-end">
            {text}
          </Text>
        );
      },
    };
  });
}
