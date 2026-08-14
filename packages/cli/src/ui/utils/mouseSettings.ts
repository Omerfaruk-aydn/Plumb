/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F25 (PLUMB-UI-DEVRIM-PROMPT.md): resolves the initial mouse-capture state
 * from `ui.mouse` -- pulled out of AppContainer.tsx as a pure function so
 * the default (mouse on, matching pre-F25 behavior) is directly testable.
 * The existing TOGGLE_MOUSE_MODE keybinding still works regardless of this
 * setting; it only affects the value mouse mode starts at.
 */

export function resolveInitialMouseMode(
  mouseSetting: boolean | undefined,
  useAlternateBuffer: boolean,
): boolean {
  const mouseSettingEnabled = mouseSetting ?? true;
  return mouseSettingEnabled && useAlternateBuffer;
}
