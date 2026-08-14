/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F21 (PLUMB-UI-DEVRIM-PROMPT.md): live "broadcasting" indicator shown near
 * the footer while `/collab` is running -- mirrors the spec's
 * `viewers:2` footer requirement. Renders nothing when collab is off.
 */
import type React from 'react';
import { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import {
  getCollabServer,
  type CollabStatus,
} from '../../collab/collabServer.js';

export const CollabStatusBar: React.FC = () => {
  const [status, setStatus] = useState<CollabStatus>(() =>
    getCollabServer().getStatus(),
  );

  useEffect(() => {
    const server = getCollabServer();
    setStatus(server.getStatus());

    const onChange = () => setStatus(server.getStatus());
    server.on('started', onChange);
    server.on('stopped', onChange);
    server.on('viewerChange', onChange);
    return () => {
      server.off('started', onChange);
      server.off('stopped', onChange);
      server.off('viewerChange', onChange);
    };
  }, []);

  if (!status.running) return null;

  return (
    <Box>
      <Text color={theme.status.success}>
        ● Broadcasting: localhost:{status.port} · viewers:{status.viewerCount} ·
        /collab stop
      </Text>
    </Box>
  );
};
