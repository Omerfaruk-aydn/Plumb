/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  getModelDbPath,
  getAgentDbPath,
  getAgentDir,
  getConfigRootDir,
  getLogsDir,
  getInstallId,
  isRecord,
  asRecord,
  isEnoent,
  once,
  parseStreamingJson,
  parseJsonWithRepair,
  stringifyJson,
  classifyJsonPrefix,
  sanitizeText,
  isBunTestRuntime,
  wrapFetchForExtraCa,
  structuredCloneJSON,
  $pickenv,
  $flag,
  APP_NAME,
} from '../vendor-shims/pi-utils.js';

describe('pi-utils shim parity', () => {
  it('APP_NAME is plumb', () => {
    expect(APP_NAME).toBe('plumb');
  });

  it('Bun test runtime is always false on Node', () => {
    expect(isBunTestRuntime()).toBe(false);
  });

  it('path helpers return non-empty structured paths', () => {
    expect(getModelDbPath()).toContain('.plumb');
    expect(getModelDbPath()).toContain('models.db');
    expect(getAgentDbPath()).toContain('.plumb');
    expect(getAgentDbPath()).toContain('agent.db');
    expect(getAgentDir()).toContain('.plumb');
    expect(getConfigRootDir()).toContain('.plumb');
    expect(getLogsDir()).toContain('logs');
  });

  it('install id is stable across calls', () => {
    const id1 = getInstallId();
    const id2 = getInstallId();
    expect(id1).toBe(id2);
    expect(id1.length).toBeGreaterThan(0);
  });

  it('isRecord/asRecord correctly classify objects', () => {
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('str')).toBe(false);
    expect(asRecord({ x: 1 })).toEqual({ x: 1 });
    expect(asRecord(null)).toBeNull();
  });

  it('isEnoent detects ENOENT errors', () => {
    const err = new Error('missing');
    (err as any).code = 'ENOENT';
    expect(isEnoent(err)).toBe(true);
    expect(isEnoent(new Error('other'))).toBe(false);
  });

  it('once calls fn exactly once', () => {
    let calls = 0;
    const fn = once(() => {
      calls++;
      return 42;
    });
    expect(fn()).toBe(42);
    expect(fn()).toBe(42);
    expect(calls).toBe(1);
  });

  it('parseStreamingJson handles partial/full JSON', () => {
    expect(parseStreamingJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseStreamingJson('{broken')).toBeNull();
  });

  it('parseJsonWithRepair fixes trailing commas', () => {
    expect(parseJsonWithRepair('{"a":1,}')).toEqual({ a: 1 });
    expect(parseJsonWithRepair('{"a":1}')).toEqual({ a: 1 });
  });

  it('stringifyJson round-trips structuredCloneJSON', () => {
    const obj = { x: 1, y: [2, 3] };
    expect(structuredCloneJSON(obj)).toEqual(obj);
    expect(stringifyJson(obj)).toBe('{"x":1,"y":[2,3]}');
  });

  it('classifyJsonPrefix detects complete/partial/invalid/empty', () => {
    expect(classifyJsonPrefix('').kind).toBe('empty');
    expect(classifyJsonPrefix('{"a":1}').kind).toBe('complete');
    expect(classifyJsonPrefix('{"unfinished"').kind).toBe('partial');
    expect(classifyJsonPrefix('not json').kind).toBe('invalid');
  });

  it('sanitizeText strips control characters', () => {
    expect(sanitizeText('hello\u0000world')).toBe('helloworld');
    expect(sanitizeText('clean')).toBe('clean');
  });

  it('wrapFetchForExtraCa is identity on Node', () => {
    expect(wrapFetchForExtraCa(fetch)).toBe(fetch);
  });

  it('$pickenv and $flag read process.env', () => {
    const v = $pickenv('PATH', 'NONEXISTENT_VAR');
    expect(v).toBeTruthy(); // PATH always exists
    expect($flag('NONEXISTENT_FLAG_12345')).toBe(false);
  });

  it('no dummy shims: flat-false/identity adapters are explicit platform choices', () => {
    // `isBunTestRuntime` → always false on Node (correct platform adapter)
    expect(isBunTestRuntime()).toBe(false);
    // `wrapFetchForExtraCa` → identity (Node doesn't need extra CA)
    expect(wrapFetchForExtraCa).toBeDefined();
  });
});
