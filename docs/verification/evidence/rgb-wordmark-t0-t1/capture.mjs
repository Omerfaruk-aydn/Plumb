#!/usr/bin/env node

/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..', '..');
const EVIDENCE_DIR = path.join(
  ROOT,
  'docs',
  'verification',
  'evidence',
  'rgb-wordmark-t0-t1',
);
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

process.env['FORCE_COLOR'] = '3';
process.env['NODE_ENV'] = 'development';
delete process.env['NO_COLOR'];

const inkModule = await import(
  pathToFileURL(
    path.join(ROOT, 'node_modules', 'ink', 'build', 'index.js'),
  ).href
);
const React = (await import(
  pathToFileURL(path.join(ROOT, 'node_modules', 'react', 'index.js')).href
)).default;
const { render } = inkModule;

const cliDist = path.join(ROOT, 'packages', 'cli', 'dist', 'src', 'ui', 'components');
const PlumbAnimatedWordmark = (
  await import(pathToFileURL(path.join(cliDist, 'PlumbAnimatedWordmark.js')).href)
).PlumbAnimatedWordmark;
const PlumbProviderSetupDialog = (
  await import(pathToFileURL(path.join(cliDist, 'PlumbProviderSetupDialog.js')).href)
).PlumbProviderSetupDialog;

function makeStdout() {
  const chunks = [];
  const stdout = {
    write: (chunk) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      return true;
    },
    columns: 80,
    rows: 24,
    on: () => () => {},
    off: () => {},
    onData: () => () => {},
  };
  return {
    stdout,
    chunks,
    take() {
      return Buffer.concat(
        chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(String(c)))),
      ).toString('utf-8');
    },
  };
}

function makeErrout() {
  return {
    write: () => true,
    on: () => () => {},
    off: () => {},
  };
}

async function snapshot(component, props, delayMs = 350) {
  const { stdout, take } = makeStdout();
  const instance = render(React.createElement(component, props), {
    stdout,
    stderr: makeErrout(),
    debug: false,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  await new Promise((r) => setTimeout(r, delayMs));
  instance.unmount();
  await new Promise((r) => setTimeout(r, 50));
  return take();
}

const t0 = await snapshot(
  PlumbAnimatedWordmark,
  { phase: 0, terminalWidth: 80 },
);
fs.writeFileSync(path.join(EVIDENCE_DIR, 'frame-T0-first-paint.log'), t0);

const t1 = await snapshot(
  PlumbAnimatedWordmark,
  { phase: 60, terminalWidth: 80 },
);
fs.writeFileSync(path.join(EVIDENCE_DIR, 'frame-T1-after-phase-tick.log'), t1);

const t2 = await snapshot(
  PlumbAnimatedWordmark,
  { phase: 120, terminalWidth: 80 },
);
fs.writeFileSync(path.join(EVIDENCE_DIR, 'frame-T2-after-second-tick.log'), t2);

const providerFirst = await snapshot(
  PlumbProviderSetupDialog,
  {
    providers: [],
    categoryGroups: new Map(),
    models: [],
    onComplete: () => undefined,
    onCancel: () => undefined,
  },
  120,
);
fs.writeFileSync(
  path.join(EVIDENCE_DIR, 'frame-provider-first-empty-state.log'),
  providerFirst,
);

const rgbRegex = /\x1b\[38;2;\d{1,3};\d{1,3};\d{1,3}m/g;
const palettes = {
  t0: (t0.match(rgbRegex) ?? []).slice(0, 8),
  t1: (t1.match(rgbRegex) ?? []).slice(0, 8),
  t2: (t2.match(rgbRegex) ?? []).slice(0, 8),
};

const summary = {
  capturedAt: new Date().toISOString(),
  platform: process.platform,
  productionEmbeddedHead:
    '41f95108dced34d8fec000328ea55c6ee3470885',
  renderingRoute:
    'AppHeader.tsx → PlumbAnimatedWordmark → @jrichman/ink-gradient (the same stack Windows Terminal hosts)',
  wordmark: {
    t0Length: t0.length,
    t1Length: t1.length,
    t2Length: t2.length,
    rgbVisibleT0: (t0.match(rgbRegex) ?? []).length,
    rgbVisibleT1: (t1.match(rgbRegex) ?? []).length,
    rgbVisibleT2: (t2.match(rgbRegex) ?? []).length,
    blockWordmarkPresent:
      t0.includes('█') && t1.includes('█') && t2.includes('█'),
    paletteSampleT0: palettes.t0,
    paletteSampleT1: palettes.t1,
    paletteSampleT2: palettes.t2,
    paletteRotatesT0T1:
      JSON.stringify(palettes.t0) !== JSON.stringify(palettes.t1),
    paletteRotatesT1T2:
      JSON.stringify(palettes.t1) !== JSON.stringify(palettes.t2),
    geometryStable: [
      t0,
      t1,
      t2,
    ]
      .map((f) => f.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ''))
      .every(
        (stripped, _, arr) => stripped === arr[0],
      ),
  },
  providerFirst: {
    length: providerFirst.length,
    showsPlumbProviderSetupTitle: providerFirst.includes('PLUMB Provider Setup'),
    asksForConnectionType: providerFirst.includes('Choose connection type'),
    noGoogleFirst: !/(Sign in with Google|Gemini API Key|Vertex AI)/i.test(
      providerFirst,
    ),
  },
};
fs.writeFileSync(
  path.join(EVIDENCE_DIR, 'summary.json'),
  JSON.stringify(summary, null, 2),
);
console.log(JSON.stringify(summary, null, 2));
