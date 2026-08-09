/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  WATSONX_CONFIG_SCHEMA,
  validateWatsonxConfig,
  buildWatsonxSaveOperation,
} from '@google/gemini-cli-provider';
import { createCloudConfigActions } from './genericCloudConfigActions.js';

export const watsonxCloudConfigActions = createCloudConfigActions({
  providerId: 'watsonx',
  schema: WATSONX_CONFIG_SCHEMA,
  validate: validateWatsonxConfig,
  buildSaveOperation: buildWatsonxSaveOperation,
});
