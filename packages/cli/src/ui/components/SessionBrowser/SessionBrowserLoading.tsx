/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../../colors.js';

/**
 * Loading state component displayed while sessions are being loaded.
 */
export const SessionBrowserLoading = (): React.JSX.Element => (
  <Box flexDirection="column" paddingX={1}>
    <Text color={Colors.Gray}>Loading sessions…</Text>
  </Box>
);
