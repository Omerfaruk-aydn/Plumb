/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export class NodeIdService {
  constructor(private readonly map: WeakMap<object, string> = new WeakMap()) {}

  get(obj: object): string | undefined {
    return this.map.get(obj);
  }

  set(obj: object, id: string): void {
    this.map.set(obj, id);
  }
}
