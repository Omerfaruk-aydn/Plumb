/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '../../config/config.js';
import { debugLogger } from '../../utils/debugLogger.js';

/**
 * Default model for the visual agent (Computer Use capable).
 */
export const VISUAL_AGENT_MODEL = 'gemini-2.5-computer-use-preview-10-2025';

/**
 * Pattern matching the gemini computer-use model family.
 * These models require a computerUse tool declaration in every request.
 */
const COMPUTER_USE_MODEL_PATTERN = /^gemini-.*-computer-use-/;

/**
 * Returns true if the model name belongs to the computer-use family
 * (matches gemini-*-computer-use-*).
 */
export function isComputerUseModel(model: string): boolean {
  return COMPUTER_USE_MODEL_PATTERN.test(model);
}

/**
 * Gets the visual agent model from config, falling back to default.
 *
 * @param config Runtime configuration
 * @returns The model to use for visual agent
 */
export function getVisualAgentModel(config: Config): string {
  const browserConfig = config.getBrowserAgentConfig();
  const model = browserConfig.customConfig.visualModel ?? VISUAL_AGENT_MODEL;

  debugLogger.log(`Visual agent model: ${model}`);
  return model;
}
