/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F26 (PLUMB-UI-DEVRIM-PROMPT.md): `/bench` runs the 5 edit fixtures
 * against the currently selected model and opens the live-progress
 * BenchmarkRunner screen (Esc cancels, result is written to
 * ~/.plumb/benchmarks.json on completion).
 */
import React from 'react';
import {
  CommandKind,
  type CommandContext,
  type SlashCommand,
} from './types.js';
import { BenchmarkRunner } from '../components/BenchmarkRunner.js';

export const benchCommand: SlashCommand = {
  name: 'bench',
  description:
    'Measure real edit-accuracy for the current model (5 fixtures) and save the result',
  kind: CommandKind.BUILT_IN,
  action: (context: CommandContext) => {
    const config = context.services.agentContext?.config;
    if (!config) {
      return {
        type: 'message' as const,
        messageType: 'error' as const,
        content: 'Config not found',
      };
    }

    const provider = config.getPlumbProvider();
    const modelId = config.getModel();
    if (!provider || !modelId) {
      return {
        type: 'message' as const,
        messageType: 'error' as const,
        content: 'No active provider/model to benchmark.',
      };
    }

    return {
      type: 'custom_dialog' as const,
      component: React.createElement(BenchmarkRunner, {
        config,
        provider,
        modelId,
        onClose: () => context.ui.removeComponent(),
      }),
    };
  },
};
