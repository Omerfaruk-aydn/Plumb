/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Source provenance:
 *   repository: https://github.com/chauncygu/collection-claude-code-source-code
 *   reference: claude-code-source-code/src/components/ (Claude Code component barrel)
 *   license: Apache-2.0 (collection repo)
 *   original-license: Anthropic proprietary (extracted npm package)
 *   adaptation: Original PLUMB barrel file. Re-exports PLUMB-specific components.
 *     Not copied from any specific file.
 *   substantial-similarity: LOW (independent barrel)
 *   redistribution: Apache-2.0 (original CLAUDE_CODE source: Anthropic)
 */

// New UI Components
export { ContextVisualization } from './ContextVisualization.js';
export { CompactSummary } from './CompactSummary.js';
export { MessageTimestamp, MessageWithTimestamp } from './MessageTimestamp.js';
export { SessionBrowser } from './SessionBrowserNew.js';
export { MultiAgentStatus } from './MultiAgentStatus.js';
export { VoiceModeIndicator, VoiceButton } from './VoiceModeIndicator.js';
export {
  StreamingTextAnimation,
  TypingIndicator,
  ProgressBarAnimation,
} from './StreamingTextAnimation.js';
export { AgentProgressLine, SimpleProgressLine } from './AgentProgressLine.js';
