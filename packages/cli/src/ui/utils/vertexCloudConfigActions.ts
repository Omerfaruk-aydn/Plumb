/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  VERTEX_CONFIG_SCHEMA,
  validateVertexConfig,
  buildVertexSaveOperation,
} from '@plumb/provider';
import { createCloudConfigActions } from './genericCloudConfigActions.js';

export const vertexCloudConfigActions = createCloudConfigActions({
  providerId: 'google-vertex',
  schema: VERTEX_CONFIG_SCHEMA,
  validate: validateVertexConfig,
  buildSaveOperation: buildVertexSaveOperation,
});
