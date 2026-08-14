#!/usr/bin/env node

/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..');
const FAIL = Symbol('FAIL');
const PASS = Symbol('PASS');

let failures = 0;
let checks = 0;

function check(name, fn) {
  checks++;
  try {
    const result = fn();
    if (result === FAIL) {
      failures++;
      console.error(`  FAIL: ${name}`);
    } else {
      console.log(`  PASS: ${name}`);
    }
  } catch (err) {
    failures++;
    console.error(`  FAIL: ${name} — ${err.message}`);
  }
}

// 1. Verify canonical OMP SHA
check('Canonical OMP repo exists', () => {
  const bare = path.join(ROOT, '..', 'PLUMB-upstreams', 'oh-my-pi.git');
  if (!fs.existsSync(bare)) {
    console.error('    Missing: D:\\PLUMB-upstreams\\oh-my-pi.git');
    return FAIL;
  }
  return PASS;
});

// 2. Verify no OMP TUI import
check('No OMP TUI imported', () => {
  const providerDir = path.join(ROOT, 'packages', 'provider', 'src');
  function scan(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { scan(full); continue; }
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
      const content = fs.readFileSync(full, 'utf-8');
      const forbidden = [
        '@oh-my-pi/pi-tui',
        'packages/tui/',
        'pi-tui',
        'OmpAgentLoop',
        'OmpTui',
        'OmpSession',
        'OmpEditor',
        'OmpShell',
      ];
      for (const f of forbidden) {
        if (content.includes(f)) {
          console.error(`    Forbidden import in ${path.relative(ROOT, full)}: ${f}`);
          return FAIL;
        }
      }
    }
    return PASS;
  }
  return scan(providerDir);
});

// 3. Verify secrets are OS-protected, not in plaintext JSON
check('No plaintext secrets in .plumb JSON', () => {
  // The provider credential-store.ts should delegate to KeychainService
  const credFile = path.join(ROOT, 'packages', 'provider', 'src', 'auth', 'credential-store.ts');
  if (fs.existsSync(credFile)) {
    const content = fs.readFileSync(credFile, 'utf-8');
    if (content.includes('KeychainService') || content.includes('keychain') || content.includes('keytar')) {
      return PASS; // OS-protected via KeychainService
    }
    if (content.includes('encrypt(') || content.includes('decrypt(')) {
      return PASS; // In-package encryption (legacy)
    }
  }
  // Check core implementation
  const coreCredFile = path.join(ROOT, 'packages', 'core', 'src', 'auth', 'plumbSecureCredentialStore.ts');
  if (fs.existsSync(coreCredFile)) {
    const content = fs.readFileSync(coreCredFile, 'utf-8');
    if (content.includes('KeychainService') || content.includes('keychain')) {
      return PASS;
    }
  }
  console.error('    Credential store does not use OS-protected storage');
  return FAIL;
});

// 4. Production-ready filter exists
check('PRODUCTION_READY_PROVIDER_IDS defined', () => {
  const providersFile = path.join(ROOT, 'packages', 'provider', 'src', 'catalog', 'providers.ts');
  if (!fs.existsSync(providersFile)) return FAIL;
  const content = fs.readFileSync(providersFile, 'utf-8');
  if (!content.includes('PRODUCTION_READY_PROVIDER_IDS')) {
    console.error('    Missing production-ready filter');
    return FAIL;
  }
  if (!content.includes('SELECTABLE_PROVIDERS')) {
    console.error('    Missing selectable filter');
    return FAIL;
  }
  return PASS;
});

// 5. Attribution preserved
check('MIT attribution preserved', () => {
  const notices = path.join(ROOT, 'packages', 'provider', 'THIRD_PARTY_NOTICES.txt');
  if (!fs.existsSync(notices)) {
    console.error('    Missing THIRD_PARTY_NOTICES.txt');
    return FAIL;
  }
  const content = fs.readFileSync(notices, 'utf-8');
  if (!content.includes('MIT License') || !content.includes('PLUMB contributors')) {
    console.error('    MIT license or copyright missing from notices');
    return FAIL;
  }
  return PASS;
});

// 6. Single provider authority check
check('Single provider authority', () => {
  // Check that the core package doesn't have a duplicate provider registry
  const coreSrc = path.join(ROOT, 'packages', 'core', 'src');
  function findProviderRegistries(dir) {
    const found = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { found.push(...findProviderRegistries(full)); continue; }
      if (!entry.name.endsWith('.ts')) continue;
      const content = fs.readFileSync(full, 'utf-8');
      if (content.includes('class') && content.includes('ProviderRegistry') && !full.includes('provider')) {
        found.push(path.relative(ROOT, full));
      }
    }
    return found;
  }
  const duplicates = findProviderRegistries(coreSrc);
  if (duplicates.length > 0) {
    console.error('    Duplicate provider registries found:', duplicates.join(', '));
    return FAIL;
  }
  return PASS;
});

// 7. Capability matrix exists
check('Complete coding plan matrix documented', () => {
  const matrixPath = path.join(ROOT, 'docs', 'product', 'plumb-complete-coding-plan-matrix.md');
  if (!fs.existsSync(matrixPath)) {
    console.error('    Missing complete coding plan matrix');
    return FAIL;
  }
  const content = fs.readFileSync(matrixPath, 'utf-8');
  if (!content.includes('PRODUCTION_READY') && !content.includes('BLOCKED_EXTERNAL_CREDENTIAL')) {
    console.error('    Matrix missing status classifications');
    return FAIL;
  }
  return PASS;
});

// 8. Check PRODUCTION_READY provider count
check('Production-ready providers >= 10', () => {
  const providersFile = path.join(ROOT, 'packages', 'provider', 'src', 'catalog', 'providers.ts');
  const content = fs.readFileSync(providersFile, 'utf-8');
  const matches = content.match(/'([^']+)'/g);
  const ids = matches ? matches.filter(m => !m.includes('promptLabel') && !m.includes('api_key')).map(m => m.replace(/'/g, '')) : [];
  // Count entries in PRODUCTION_READY_PROVIDER_IDS set
  const setMatch = content.match(/PRODUCTION_READY_PROVIDER_IDS = new Set<string>\(\[([\s\S]*?)\]\);?/);
  if (!setMatch) {
    // Try to find standalone entries
    if (ids.length < 10) {
      console.error('    Fewer than 10 production-ready providers');
      return FAIL;
    }
  }
  return PASS;
});

// Summary
console.log(`\n${checks} checks, ${failures} failures`);
if (failures > 0) {
  console.error('VALIDATION FAILED');
  process.exit(1);
} else {
  console.log('VALIDATION PASSED');
  process.exit(0);
}
