/**
 * PLUMB-side runtime adaptation: installs a minimal `Bun` global for the
 * imported OMP modules when running on Node. The ambient `bun-types.d.ts`
 * already supplies the compile-time declarations; this module provides the
 * corresponding runtime values.
 *
 * OMP SHA: 4df68d60438423b384b2b47fb3d6835641624757
 *
 * Surface implemented (from the actual usage scan of omp-ai/omp-catalog):
 * - `Bun.hash(s)` / `Bun.hash.crc32` / `Bun.hash.xxhash32` / `Bun.hash.xxhash64`
 * - `Bun.deepEquals(a, b)` (structural equality)
 * - `Bun.env` (process env)
 * - `Bun.sleep(ms)`, `Bun.write(path, data)`, `Bun.file(path)`
 * - `Bun.CryptoHasher(algorithm)`, `Bun.sha(data, encoding)`
 * - `Bun.spawn(argv, opts)` (web-stream + `exited` promise surface)
 * - `Bun.zstdCompressSync` — throws a clear error (no zstd in Node)
 *
 * Not implemented (load-safe; hit only at runtime in platform-specific paths):
 * `Bun.Image` (image resize, anthropic) and `Bun.serve` (auth-broker, removed).
 * `installBunGlobal()` must run before any OMP module executes Bun-flavored
 * code; it is a no-op when a real Bun global already exists.
 */
import { createHash } from 'node:crypto';
import { spawn as nodeSpawn } from 'node:child_process';
import { writeFile as fsWriteFile, readFile } from 'node:fs/promises';
import { setTimeout as sleepTimer } from 'node:timers/promises';
import { Readable } from 'node:stream';

// ─────────────────────────────────────────────────────────────────────────────
// Hash primitives (pure JS, standard algorithms)
// ─────────────────────────────────────────────────────────────────────────────

const U32 = (value: number): number => value >>> 0;
const U64 = (value: bigint): bigint => value & 0xffffffffffffffffn;

function toBytes(input: string | Uint8Array | ArrayBuffer): Uint8Array {
  if (typeof input === 'string') return new TextEncoder().encode(input);
  if (input instanceof Uint8Array) return input;
  return new Uint8Array(input);
}

/** Standard xxHash32. */
function xxhash32(input: string | Uint8Array | ArrayBuffer, seed = 0): number {
  const data = toBytes(input);
  const P1 = 2654435761;
  const P2 = 2246822519;
  const P3 = 3266489917;
  const P4 = 668265263;
  const P5 = 374761393;
  let h: number;
  const len = data.length;
  const idx = (len / 4) | 0;
  const bodyStart = 16;

  let i = 0;
  if (len >= 16) {
    let v1 = U32(seed + P1 + P2);
    let v2 = U32(seed + P2);
    let v3 = U32(seed);
    let v4 = U32(seed - P1);
    while (i < idx * 4) {
      const lane1 = U32(
        (data[i] |
          (data[i + 1] << 8) |
          (data[i + 2] << 16) |
          (data[i + 3] << 24)) *
          P2,
      );
      const lane2 = U32(
        (data[i + 4] |
          (data[i + 5] << 8) |
          (data[i + 6] << 16) |
          (data[i + 7] << 24)) *
          P2,
      );
      const lane3 = U32(
        (data[i + 8] |
          (data[i + 9] << 8) |
          (data[i + 10] << 16) |
          (data[i + 11] << 24)) *
          P2,
      );
      const lane4 = U32(
        (data[i + 12] |
          (data[i + 13] << 8) |
          (data[i + 14] << 16) |
          (data[i + 15] << 24)) *
          P2,
      );
      v1 = U32(U32(v1 + lane1) * P1);
      v2 = U32(U32(v2 + lane2) * P1);
      v3 = U32(U32(v3 + lane3) * P1);
      v4 = U32(U32(v4 + lane4) * P1);
      i += 16;
    }
    h = U32(
      U32(U32(v1 << 1) + U32(v2 >>> 7)) + U32(U32(v3 >>> 12) + U32(v4 >>> 18)),
    );
  } else {
    h = U32(seed + P5);
  }
  h = U32(h + len);
  while (i + 4 <= len) {
    h = U32(
      U32(
        h +
          U32(
            (data[i] |
              (data[i + 1] << 8) |
              (data[i + 2] << 16) |
              (data[i + 3] << 24)) *
              P3,
          ),
      ) * P4,
    );
    i += 4;
  }
  while (i < len) {
    h = U32(U32(h + data[i] * P5) * P1);
    i += 1;
  }
  h ^= h >>> 15;
  h = U32(h * P2);
  h ^= h >>> 13;
  h = U32(h * P3);
  h ^= h >>> 16;
  return U32(h);
}

/** Standard xxHash64. */
function xxhash64(input: string | Uint8Array | ArrayBuffer, seed = 0n): bigint {
  const data = toBytes(input);
  const P1 = 11400714785074694791n;
  const P2 = 14029467366897019727n;
  const P3 = 1609587929392839161n;
  const P4 = 9650029242287828579n;
  const P5 = 2870177450012600261n;
  const len = BigInt(data.length);
  const idx = (data.length / 32) | 0;
  let v1 = U64(seed + P1 + P2);
  let v2 = U64(seed + P2);
  let v3 = U64(seed);
  let v4 = U64(seed - P1);
  let i = 0;

  const round = (acc: bigint, lane: bigint): bigint => {
    acc = U64(acc + lane * P2);
    acc = U64(((acc << 31n) | (acc >> 33n)) * P1);
    return acc;
  };
  const mergeRound = (acc: bigint, val: bigint): bigint => {
    val = round(0n, val);
    acc = U64(acc ^ val);
    acc = U64(acc * P1 + P4);
    return acc;
  };
  const read64 = (offset: number): bigint => {
    return (
      BigInt(data[offset]) |
      (BigInt(data[offset + 1]) << 8n) |
      (BigInt(data[offset + 2]) << 16n) |
      (BigInt(data[offset + 3]) << 24n) |
      (BigInt(data[offset + 4]) << 32n) |
      (BigInt(data[offset + 5]) << 40n) |
      (BigInt(data[offset + 6]) << 48n) |
      (BigInt(data[offset + 7]) << 56n)
    );
  };

  let h: bigint;
  if (data.length >= 32) {
    while (i < idx * 32) {
      v1 = round(v1, read64(i));
      v2 = round(v2, read64(i + 8));
      v3 = round(v3, read64(i + 16));
      v4 = round(v4, read64(i + 24));
      i += 32;
    }
    h = U64(
      ((v1 << 1n) | (v1 >> 63n)) +
        ((v2 << 7n) | (v2 >> 57n)) +
        ((v3 << 12n) | (v3 >> 52n)) +
        ((v4 << 18n) | (v4 >> 46n)),
    );
    h = U64(
      mergeRound(h, v1) +
        mergeRound(h, v2) +
        mergeRound(h, v3) +
        mergeRound(h, v4),
    );
  } else {
    h = U64(seed + P5);
  }
  h = U64(h + len);
  while (i + 8 <= data.length) {
    h = U64(round(h, read64(i)));
    i += 8;
  }
  while (i + 4 <= data.length) {
    const lane = U64(
      BigInt(data[i]) |
        (BigInt(data[i + 1]) << 8n) |
        (BigInt(data[i + 2]) << 16n) |
        (BigInt(data[i + 3]) << 24n),
    );
    h = U64(h ^ (lane * P1));
    h = U64(((h << 23n) | (h >> 41n)) * P2 + P3);
    i += 4;
  }
  while (i < data.length) {
    h = U64(h ^ (BigInt(data[i]) * P5));
    h = U64((h << 11n) | (h >> 53n)) * P1;
    i += 1;
  }
  h ^= h >> 33n;
  h = U64(h * P2);
  h ^= h >> 29n;
  h = U64(h * P3);
  h ^= h >> 32n;
  return U64(h);
}

/** Standard CRC-32 (IEEE 802.3). */
function crc32(input: string | Uint8Array | ArrayBuffer, seed = 0): number {
  const data = toBytes(input);
  let crc = U32(seed ^ 0xffffffff);
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return U32(crc ^ 0xffffffff);
}

/** Structural deep equality (own enumerable keys, no prototype order). */
function deepEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEquals(a[i], b[i])) return false;
    }
    return true;
  }
  if (
    a !== null &&
    b !== null &&
    typeof a === 'object' &&
    typeof b === 'object'
  ) {
    const aKeys = Object.keys(a as Record<string, unknown>);
    const bKeys = Object.keys(b as Record<string, unknown>);
    if (aKeys.length !== bKeys.length) return false;
    const bObj = b as Record<string, unknown>;
    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(bObj, key)) return false;
      if (!deepEquals((a as Record<string, unknown>)[key], bObj[key]))
        return false;
    }
    return true;
  }
  return false;
}

function nodeStreamToWeb(
  stream: NodeJS.ReadableStream | null,
): ReadableStream<Uint8Array> {
  return Readable.toWeb(
    stream as import('node:stream').Readable,
  ) as ReadableStream<Uint8Array>;
}

function installBunGlobal(): void {
  if (globalThis.Bun !== undefined) {
    return;
  }
  const hash = Object.assign(
    (input: string | Uint8Array | ArrayBuffer, seed?: number): number =>
      xxhash32(input, seed ?? 0),
    {
      crc32,
      xxhash32,
      xxhash64,
      xxHash64: xxhash64, // imported anthropic.ts calls the capital-H spelling
    },
  );
  globalThis.Bun = {
    hash,
    deepEquals,
    env: process.env as Record<string, string | undefined>,
    sleep: (ms: number | Promise<number>): Promise<void> =>
      sleepTimer(typeof ms === 'number' ? ms : 0),
    write: (path: string, data: string | Uint8Array): Promise<void> =>
      fsWriteFile(path, data),
    file: (
      path: string,
    ): {
      exists: () => Promise<boolean>;
      text: () => Promise<string>;
      json: () => Promise<unknown>;
    } => ({
      exists: async (): Promise<boolean> => {
        try {
          await readFile(path);
          return true;
        } catch {
          return false;
        }
      },
      text: (): Promise<string> => readFile(path, 'utf8'),
      json: async (): Promise<unknown> =>
        JSON.parse(await readFile(path, 'utf8')),
    }),
    CryptoHasher: class {
      #hash: ReturnType<typeof createHash>;
      constructor(algorithm: string) {
        this.#hash = createHash(algorithm);
      }
      update(data: string | Uint8Array): this {
        this.#hash.update(data);
        return this;
      }
      digest(encoding: 'hex' | 'base64' | 'base64url' = 'hex'): string {
        return this.#hash.digest(encoding);
      }
    },
    sha: (
      input: string | Uint8Array,
      encoding: 'hex' | 'base64' = 'hex',
    ): string => createHash('sha256').update(input).digest(encoding),
    spawn: (
      argv: string[],
      options?: {
        stdin?: 'ignore' | 'pipe';
        stdout?: 'pipe';
        stderr?: 'pipe';
        windowsHide?: boolean;
        signal?: AbortSignal;
      },
    ): {
      pid: number | undefined;
      exited: Promise<number>;
      stdout: ReadableStream<Uint8Array>;
      stderr: ReadableStream<Uint8Array>;
      kill: () => boolean;
    } => {
      const child = nodeSpawn(argv[0], argv.slice(1), {
        stdio: [
          options?.stdin === 'ignore' ? 'ignore' : 'pipe',
          'pipe',
          'pipe',
        ] as const,
        windowsHide: options?.windowsHide,
        signal: options?.signal,
      });
      const exited = new Promise<number>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code) => resolve(code ?? -1));
      });
      return {
        pid: child.pid,
        exited,
        stdout: nodeStreamToWeb(child.stdout),
        stderr: nodeStreamToWeb(child.stderr),
        kill: (): boolean => child.kill(),
      };
    },
    zstdCompressSync: (): never => {
      throw new Error(
        'Bun.zstdCompressSync is unavailable in the Node runtime (OMP codex WebSocket compression)',
      );
    },
    Image: class {
      constructor() {
        throw new Error(
          'Bun.Image is unavailable in the Node runtime (anthropic many-image auto-resize); image blocks pass through unmodified',
        );
      }
    },
  } as unknown as typeof Bun;
}

export { installBunGlobal };
