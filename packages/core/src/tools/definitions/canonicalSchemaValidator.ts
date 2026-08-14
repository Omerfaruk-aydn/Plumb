/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
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

function findInvalidSchemaType(
  schema: unknown,
  seen = new Set<object>(),
): string | undefined {
  if (!isPlainObject(schema)) return undefined;
  if (seen.has(schema)) return undefined;
  seen.add(schema);

  if ('type' in schema) {
    const type = schema['type'];
    if (type === null || type === undefined || type === 'null') {
      return 'SCHEMA_TYPE_NULL_OR_UNDEFINED';
    }
    if (Array.isArray(type) && type.some((entry) => entry === 'null')) {
      return 'SCHEMA_TYPE_NULL_OR_UNDEFINED';
    }
  }

  for (const value of Object.values(schema)) {
    if (isPlainObject(value)) {
      const failure = findInvalidSchemaType(value, seen);
      if (failure) return failure;
    } else if (Array.isArray(value)) {
      for (const item of value) {
        const failure = findInvalidSchemaType(item, seen);
        if (failure) return failure;
      }
    }
  }
  return undefined;
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

  if (!isPlainObject(schema['properties'])) {
    return {
      valid: false,
      toolName,
      rootType,
      propertyCount: 0,
      requiredCount: 0,
      reason: 'PROPERTIES_NOT_OBJECT',
    };
  }
  const properties = schema['properties'];
  const propertyKeys = new Set(Object.keys(properties));
  if (schema['required'] !== undefined && !Array.isArray(schema['required'])) {
    return {
      valid: false,
      toolName,
      rootType,
      propertyCount: propertyKeys.size,
      requiredCount: 0,
      reason: 'REQUIRED_NOT_ARRAY',
    };
  }
  const required = (schema['required'] ?? []) as unknown[];

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

  const invalidType = findInvalidSchemaType(schema);
  if (invalidType) {
    return {
      valid: false,
      toolName,
      rootType,
      propertyCount: propertyKeys.size,
      requiredCount: required.length,
      reason: invalidType,
    };
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
