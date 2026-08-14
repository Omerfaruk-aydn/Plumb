/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BrowserManager } from './browserManager.js';
import { debugLogger } from '../../utils/debugLogger.js';

const OVERLAY_ELEMENT_ID = '__gemini_automation_overlay';

/**
 * Builds the JavaScript function string that injects the automation overlay.
 *
 * Returns a plain arrow-function expression (no trailing invocation) because
 * chrome-devtools-mcp's evaluate_script tool invokes it internally.
 *
 * Avoids nested template literals by using string concatenation for cssText.
 */
function buildInjectionScript(): string {
  return `() => {
    const id = '${OVERLAY_ELEMENT_ID}';
    const existing = document.getElementById(id);
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = id;
    overlay.setAttribute('aria-hidden', 'true');
    overlay.setAttribute('role', 'presentation');

    Object.assign(overlay.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      bottom: '0',
      zIndex: '2147483647',
      pointerEvents: 'none',
      border: '6px solid rgba(66, 133, 244, 1.0)',
    });

    document.documentElement.appendChild(overlay);

    try {
      overlay.animate([
        { borderColor: 'rgba(66,133,244,0.3)', boxShadow: 'inset 0 0 8px rgba(66,133,244,0.15)' },
        { borderColor: 'rgba(66,133,244,1.0)', boxShadow: 'inset 0 0 16px rgba(66,133,244,0.5)' },
        { borderColor: 'rgba(66,133,244,0.3)', boxShadow: 'inset 0 0 8px rgba(66,133,244,0.15)' }
      ], { duration: 2000, iterations: Infinity, easing: 'ease-in-out' });
    } catch (e) {
      // Silently ignore animation errors, as they can happen on sites with strict CSP.
      // The border itself is the most important visual indicator.
    }

    return 'overlay-injected';
  }`;
}

/**
 * Builds the JavaScript function string that removes the automation overlay.
 */
function buildRemovalScript(): string {
  return `() => {
    const el = document.getElementById('${OVERLAY_ELEMENT_ID}');
    if (el) el.remove();
    return 'overlay-removed';
  }`;
}

/**
 * Injects the automation overlay into the current page.
 */
export async function injectAutomationOverlay(
  browserManager: BrowserManager,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const result = await browserManager.callTool(
      'evaluate_script',
      { function: buildInjectionScript() },
      signal,
      true,
    );

    if (result.isError) {
      debugLogger.warn('Failed to inject automation overlay:', result);
    }
  } catch (error) {
    debugLogger.warn('Error injecting automation overlay:', error);
  }
}

/**
 * Removes the automation overlay from the current page.
 */
export async function removeAutomationOverlay(
  browserManager: BrowserManager,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const result = await browserManager.callTool(
      'evaluate_script',
      { function: buildRemovalScript() },
      signal,
      true,
    );

    if (result.isError) {
      debugLogger.warn('Failed to remove automation overlay:', result);
    }
  } catch (error) {
    debugLogger.warn('Error removing automation overlay:', error);
  }
}
