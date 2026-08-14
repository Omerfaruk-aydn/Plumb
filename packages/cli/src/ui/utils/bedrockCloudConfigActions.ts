/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BEDROCK_CONFIG_SCHEMA,
  validateBedrockConfig,
  buildBedrockSaveOperation,
} from '@plumb/provider';
import { createCloudConfigActions } from './genericCloudConfigActions.js';

export const bedrockCloudConfigActions = createCloudConfigActions({
  providerId: 'amazon-bedrock',
  schema: BEDROCK_CONFIG_SCHEMA,
  validate: validateBedrockConfig,
  buildSaveOperation: buildBedrockSaveOperation,
});
