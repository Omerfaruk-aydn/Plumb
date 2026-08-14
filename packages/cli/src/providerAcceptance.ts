/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { homedir } from '@plumb/core';

const PLUMB_DIR = '.plumb';
const ACCEPTANCE_FILE = 'provider-acceptance.json';

export interface ProviderAcceptanceRecord {
  providerId: string;
  modelId?: string;
  testDate: string;
  productHead: string;
  ompSha: string;
  safeResult:
    | 'LIVE_VERIFIED'
    | 'IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED'
    | 'BLOCKED_CLIENT_REGISTRATION'
    | 'BLOCKED_PROVIDER_POLICY'
    | 'BLOCKED_ACCOUNT_ENTITLEMENT'
    | 'IMPLEMENTATION_INCOMPLETE_NOT_SELECTABLE'
    | 'SERVER_UNAVAILABLE'
    | 'LIVE_TEST_FAILED'
    | 'LIVE_TEST_CANCELLED';
  streamVerified: boolean;
  restartVerified: boolean;
  logoutVerified: boolean;
  safeError?: string;
}

export interface AcceptanceStore {
  version: number;
  records: Record<string, ProviderAcceptanceRecord>;
}

function getAcceptancePath(): string {
  return path.join(homedir(), PLUMB_DIR, ACCEPTANCE_FILE);
}

export async function readAcceptanceStore(): Promise<AcceptanceStore> {
  const filePath = getAcceptancePath();
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as AcceptanceStore;
    if (parsed.version === 1 && parsed.records) {
      return parsed;
    }
  } catch {
    // File doesn't exist or is malformed
  }
  return { version: 1, records: {} };
}

export async function writeAcceptanceStore(
  store: AcceptanceStore,
): Promise<void> {
  const filePath = getAcceptancePath();
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = filePath + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(store, null, 2) + '\n', 'utf-8');
  await fs.rename(tmp, filePath);
}

export async function recordAcceptance(
  record: ProviderAcceptanceRecord,
): Promise<void> {
  const store = await readAcceptanceStore();
  store.records[record.providerId] = record;
  await writeAcceptanceStore(store);
}

export async function getAcceptance(
  providerId: string,
): Promise<ProviderAcceptanceRecord | undefined> {
  const store = await readAcceptanceStore();
  return store.records[providerId];
}

export async function getAllAcceptances(): Promise<
  Record<string, ProviderAcceptanceRecord>
> {
  const store = await readAcceptanceStore();
  return store.records;
}
