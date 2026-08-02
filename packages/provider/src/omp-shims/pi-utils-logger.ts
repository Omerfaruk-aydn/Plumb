/**
 * Minimal shim for @oh-my-pi/pi-utils/logger
 */

export function log(...args: unknown[]): void {
  console.log('[PLUMB]', ...args);
}

export function warn(...args: unknown[]): void {
  console.warn('[PLUMB]', ...args);
}

export function error(...args: unknown[]): void {
  console.error('[PLUMB]', ...args);
}

export function debug(...args: unknown[]): void {
  if (process.env['DEBUG']) {
    console.debug('[PLUMB]', ...args);
  }
}
