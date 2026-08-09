/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  BEDROCK_CONFIG_SCHEMA,
  validateBedrockConfig,
  buildBedrockSaveOperation,
} from '@google/gemini-cli-provider';
import { createCloudConfigActions } from './genericCloudConfigActions.js';

export const bedrockCloudConfigActions = createCloudConfigActions({
  providerId: 'amazon-bedrock',
  schema: BEDROCK_CONFIG_SCHEMA,
  validate: validateBedrockConfig,
  buildSaveOperation: buildBedrockSaveOperation,
});
