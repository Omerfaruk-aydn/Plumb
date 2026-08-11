/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  validateCanonicalToolSchema,
  CANONICAL_NO_ARGS_SCHEMA,
  InvalidToolSchemaError,
} from './canonicalSchemaValidator.js';
import { getToolSet } from './coreTools.js';
import { getUpdateTopicDeclaration } from './dynamic-declaration-helpers.js';
import type { FunctionDeclaration } from '@google/genai';

describe('validateCanonicalToolSchema', () => {
  it('accepts a well-formed object schema', () => {
    const result = validateCanonicalToolSchema(
      {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      'read_file',
    );
    expect(result.valid).toBe(true);
    expect(result.rootType).toBe('object');
    expect(result.propertyCount).toBe(1);
    expect(result.requiredCount).toBe(1);
  });

  it('accepts the canonical no-args schema', () => {
    expect(
      validateCanonicalToolSchema(CANONICAL_NO_ARGS_SCHEMA, 'complete_task')
        .valid,
    ).toBe(true);
  });

  it('rejects null', () => {
    const result = validateCanonicalToolSchema(null, 'update_topic');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('ROOT_SCHEMA_MISSING');
  });

  it('rejects undefined', () => {
    const result = validateCanonicalToolSchema(undefined, 'update_topic');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('ROOT_SCHEMA_MISSING');
  });

  it('rejects { type: null } (the exact real-user-reported shape)', () => {
    const result = validateCanonicalToolSchema({ type: null }, 'update_topic');
    expect(result.valid).toBe(false);
    expect(result.rootType).toBe(null);
    expect(result.reason).toBe('ROOT_TYPE_NOT_OBJECT');
  });

  it('rejects a bare {} (no type at all -- the fabricated fallback this bug produced)', () => {
    const result = validateCanonicalToolSchema({}, 'update_topic');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('ROOT_TYPE_MISSING');
  });

  it('rejects a non-object schema value', () => {
    expect(validateCanonicalToolSchema('not a schema', 'x').valid).toBe(false);
    expect(validateCanonicalToolSchema(42, 'x').valid).toBe(false);
    expect(validateCanonicalToolSchema([], 'x').valid).toBe(false);
  });

  it('rejects type: "array" at the root (tools must be object-rooted)', () => {
    const result = validateCanonicalToolSchema({ type: 'array' }, 'x');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('ROOT_TYPE_NOT_OBJECT');
  });

  it('rejects required referencing a property that does not exist', () => {
    const result = validateCanonicalToolSchema(
      {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path', 'ghost'],
      },
      'x',
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('REQUIRED_PROPERTY_MISSING:ghost');
  });

  it('rejects a schema with no properties', () => {
    const result = validateCanonicalToolSchema({ type: 'object' }, 'x');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('PROPERTIES_NOT_OBJECT');
  });

  it('rejects non-object properties and non-array required', () => {
    expect(
      validateCanonicalToolSchema(
        { type: 'object', properties: [], required: [] },
        'bad-properties',
      ).reason,
    ).toBe('PROPERTIES_NOT_OBJECT');
    expect(
      validateCanonicalToolSchema(
        { type: 'object', properties: {}, required: 'value' },
        'bad-required',
      ).reason,
    ).toBe('REQUIRED_NOT_ARRAY');
  });

  it('rejects null JSON Schema types below the root', () => {
    expect(
      validateCanonicalToolSchema(
        {
          type: 'object',
          properties: { value: { type: null } },
        },
        'null-nested-type',
      ).reason,
    ).toBe('SCHEMA_TYPE_NULL_OR_UNDEFINED');
  });
});

describe('InvalidToolSchemaError', () => {
  it('carries a safe, structural message (no prompt/file contents)', () => {
    const result = validateCanonicalToolSchema({ type: null }, 'update_topic');
    const err = new InvalidToolSchemaError(result);
    expect(err.message).toBe(
      'INVALID_TOOL_SCHEMA tool=update_topic reason=ROOT_TYPE_NOT_OBJECT',
    );
    expect(err.toolName).toBe('update_topic');
    expect(err.reason).toBe('ROOT_TYPE_NOT_OBJECT');
  });
});

// ─── PART J: all-registered-(built-in)-tool canonical audit ───────────
//
// Enumerates every FunctionDeclaration in both tool families
// (default-legacy, gemini-3) and asserts each one's root input schema
// satisfies the canonical invariant. MCP/extension tools are registered
// at runtime (not statically enumerable here); this audit covers
// PLUMB's own built-in tool surface, which is what update_topic and the
// rest of PART A/PART J are about.
function resolveAllDeclarations(
  modelId: string | undefined,
): FunctionDeclaration[] {
  const set = getToolSet(modelId);
  const decls: FunctionDeclaration[] = [
    set.read_file,
    set.write_file,
    set.grep_search,
    set.grep_search_ripgrep,
    set.glob,
    set.list_directory,
    set.run_shell_command(true, true, true),
    set.replace,
    set.google_web_search,
    set.web_fetch,
    set.read_many_files,
    set.write_todos,
    set.get_internal_docs,
    set.ask_user,
    set.enter_plan_mode,
    set.exit_plan_mode(),
    set.activate_skill(['example-skill']),
    set.read_mcp_resource,
    set.list_mcp_resources,
  ];
  if (set.update_topic) decls.push(set.update_topic);
  return decls;
}

describe('update_topic (real-user-reported failing tool)', () => {
  it('the real, always-live declaration (topicTool.ts calls this directly, NOT gated by tool family) is canonically valid', () => {
    const decl = getUpdateTopicDeclaration();
    const result = validateCanonicalToolSchema(
      decl.parametersJsonSchema,
      decl.name ?? 'update_topic',
    );
    expect(result.valid).toBe(true);
    expect(result.rootType).toBe('object');
  });
});

describe('PART J: all registered built-in tools have a valid canonical schema', () => {
  it.each([
    ['default-legacy', undefined],
    ['gemini-3', 'gemini-3-pro'],
  ])(
    'every %s-family tool declaration is canonically valid',
    (_label, modelId) => {
      const decls = resolveAllDeclarations(modelId);
      expect(decls.length).toBeGreaterThan(10);

      const invalid: Array<{ name: string; reason?: string }> = [];
      for (const decl of decls) {
        const schema = decl.parametersJsonSchema ?? decl.parameters;
        const result = validateCanonicalToolSchema(
          schema,
          decl.name ?? 'unknown',
        );
        if (!result.valid) {
          invalid.push({ name: decl.name ?? 'unknown', reason: result.reason });
        }
      }

      expect(invalid).toEqual([]);
    },
  );
});
