/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * ONE canonical structural validator for PLUMB tool input schemas. Every
 * provider-facing tool serializer (OpenAI, Anthropic, Gemini, MCP, Claude
 * Agent SDK, ...) must consume a schema that has already passed this check
 * -- this module does not itself know about any wire dialect. Per-dialect
 * normalization (strict-mode enforcement, Google keyword stripping, CCA
 * fallback, ...) lives in packages/provider/src/omp-ai/utils/schema and is
 * unaffected by this module; this is the shared, dialect-agnostic gate that
 * runs BEFORE any of that, so a structurally broken canonical schema never
 * reaches a network call in the first place.
 */

export interface CanonicalSchemaValidationResult {
  valid: boolean;
  toolName: string;
  /** The schema's root `type` value, or `null` when absent/non-string. */
  rootType: string | null;
  propertyCount: number;
  requiredCount: number;
  /**
   * Machine-readable failure reason, e.g. `ROOT_SCHEMA_MISSING`,
   * `ROOT_TYPE_NOT_OBJECT`, `REQUIRED_PROPERTY_MISSING:<name>`. Undefined
   * when `valid` is true.
   */
  reason?: string;
}

/**
 * The normalized canonical schema for a tool with no parameters. Every
 * no-argument tool must serialize to exactly this shape -- never a bare
 * `{}` (which has no `type` and fails validation below) and never `null`.
 */
export const CANONICAL_NO_ARGS_SCHEMA = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates a tool's root input schema against the invariant every PLUMB
 * client tool must satisfy:
 *   1. The root is a JSON Schema object (not null/undefined/non-object).
 *   2. The root's `type` is exactly `"object"` (never `null`, an array, or
 *      absent).
 *   3. `required` (when present) is a subset of `Object.keys(properties)`.
 *
 * Never throws -- always returns a result. Callers that need fail-closed
 * behavior (never send a malformed schema to a provider) check `.valid`
 * and refuse to build the outbound request when false.
 */
export function validateCanonicalToolSchema(
  schema: unknown,
  toolName: string,
): CanonicalSchemaValidationResult {
  if (!isPlainObject(schema)) {
    return {
      valid: false,
      toolName,
      rootType: null,
      propertyCount: 0,
      requiredCount: 0,
      reason:
        schema === null || schema === undefined
          ? 'ROOT_SCHEMA_MISSING'
          : 'ROOT_NOT_OBJECT_LITERAL',
    };
  }

  const rawType = schema['type'];
  const rootType = typeof rawType === 'string' ? rawType : null;

  if (rootType !== 'object') {
    return {
      valid: false,
      toolName,
      rootType,
      propertyCount: 0,
      requiredCount: 0,
      reason:
        rawType === undefined ? 'ROOT_TYPE_MISSING' : 'ROOT_TYPE_NOT_OBJECT',
    };
  }

  const properties = isPlainObject(schema['properties'])
    ? schema['properties']
    : {};
  const propertyKeys = new Set(Object.keys(properties));
  const required = Array.isArray(schema['required'])
    ? (schema['required'] as unknown[])
    : [];

  for (const entry of required) {
    if (typeof entry !== 'string' || !propertyKeys.has(entry)) {
      return {
        valid: false,
        toolName,
        rootType,
        propertyCount: propertyKeys.size,
        requiredCount: required.length,
        reason: `REQUIRED_PROPERTY_MISSING:${String(entry)}`,
      };
    }
  }

  return {
    valid: true,
    toolName,
    rootType,
    propertyCount: propertyKeys.size,
    requiredCount: required.length,
  };
}

/** Thrown by callers that fail closed on an invalid canonical tool schema. */
export class InvalidToolSchemaError extends Error {
  readonly toolName: string;
  readonly reason: string;

  constructor(result: CanonicalSchemaValidationResult) {
    super(
      `INVALID_TOOL_SCHEMA tool=${result.toolName} reason=${result.reason ?? 'UNKNOWN'}`,
    );
    this.name = 'InvalidToolSchemaError';
    this.toolName = result.toolName;
    this.reason = result.reason ?? 'UNKNOWN';
  }
}
