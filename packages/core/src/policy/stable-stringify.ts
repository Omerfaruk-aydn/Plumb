/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export function stableStringify(obj: unknown): string {
  const stringify = (
    currentObj: unknown,
    ancestors: Set<unknown>,
    isTopLevel = false,
  ): string => {
    // Handle primitives and null
    if (currentObj === undefined || typeof currentObj === 'symbol') {
      return 'null'; // undefined and symbols in arrays become null in JSON
    }
    if (currentObj === null) {
      return 'null';
    }
    if (typeof currentObj === 'function') {
      return 'null'; // functions in arrays become null in JSON
    }
    if (typeof currentObj !== 'object') {
      return JSON.stringify(currentObj);
    }

    // Check for circular reference (object is in ancestor chain)
    if (ancestors.has(currentObj)) {
      return '"[Circular]"';
    }

    ancestors.add(currentObj);

    try {
      // Check for toJSON method and use it if present
      const objWithToJSON = currentObj as { toJSON?: () => unknown };
      if (typeof objWithToJSON.toJSON === 'function') {
        try {
          const jsonValue = objWithToJSON.toJSON();
          // The result of toJSON needs to be stringified recursively
          if (jsonValue === null) {
            return 'null';
          }
          // The result of toJSON is effectively a new object graph, but it
          // takes the place of the current node, so we preserve the top-level
          // status of the current node.
          return stringify(jsonValue, ancestors, isTopLevel);
        } catch {
          // If toJSON throws, treat as a regular object
        }
      }

      if (Array.isArray(currentObj)) {
        const items = currentObj.map((item) => {
          // undefined, functions and symbols in arrays become null
          if (
            item === undefined ||
            typeof item === 'function' ||
            typeof item === 'symbol'
          ) {
            return 'null';
          }
          return stringify(item, ancestors, false);
        });
        return '[' + items.join(',') + ']';
      }

      // Handle objects - sort keys and filter out undefined/function values
      const sortedKeys = Object.keys(currentObj).sort();
      const pairs: string[] = [];

      for (const key of sortedKeys) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        const value = (currentObj as Record<string, unknown>)[key];
        // Skip undefined, function and symbol values in objects (per JSON spec)
        if (
          value !== undefined &&
          typeof value !== 'function' &&
          typeof value !== 'symbol'
        ) {
          let pairStr =
            JSON.stringify(key) + ':' + stringify(value, ancestors, false);

          if (isTopLevel) {
            // We use a null byte (\0) to denote structural boundaries.
            // This is safe because any literal \0 in the user's data will
            // be escaped by JSON.stringify into "\u0000" before reaching here.
            pairStr = '\0' + pairStr + '\0';
          }

          pairs.push(pairStr);
        }
      }

      return '{' + pairs.join(',') + '}';
    } finally {
      ancestors.delete(currentObj);
    }
  };

  return stringify(obj, new Set(), true);
}
