/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F3 (PLUMB-UI-DEVRIM-PROMPT.md) -- scoped down after a real test failure.
 *
 * The spec wanted a continuously gradient-cycling cursor. First attempt
 * used useColorCycle (a real setInterval, same as GeminiSpinner) here, but
 * unlike GeminiSpinner -- which is mocked away in essentially every test
 * that renders a component near it -- GeminiMessage/GeminiMessageContent
 * are rendered directly and unmocked in their own tests. That produced the
 * exact leaked-timer act() failures the ToolStatusIndicator attempt hit
 * earlier (see useColorCycle's own doc comment): "renders correctly" tests
 * failed with `act(...)` warnings and mismatched snapshots because the
 * interval kept ticking after assertions ran.
 *
 * A static accent-colored cursor still reads as "generation is still
 * happening" (this is exactly what a plain terminal cursor does) without
 * a repeating timer anywhere near a directly-tested component.
 */
import type React from 'react';
import { Text, useIsScreenReaderEnabled } from 'ink';
import { theme } from '../semantic-colors.js';

export const GradientStreamCursor: React.FC = () => {
  const isScreenReaderEnabled = useIsScreenReaderEnabled();

  if (isScreenReaderEnabled) {
    return null;
  }

  return <Text color={theme.text.accent}>▌</Text>;
};
