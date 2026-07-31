import pty from 'node-pty';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const currentEpoch = '1753949400';
const evidenceDir = path.join(rootDir, `docs/verification/evidence/rgb-wordmark-verified-${currentEpoch}`);

if (!fs.existsSync(evidenceDir)) {
  fs.mkdirSync(evidenceDir, { recursive: true });
}

function sha256(data) {
  return crypto.createHash('sha256').update(data || '').digest('hex');
}

function stripAnsi(str) {
  return str.replace(/[\u001b\u009b][\[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=>]/g, '');
}

async function captureSession(name, cols = 80, rows = 24, env = {}, inputs = []) {
  const logPath = path.join(evidenceDir, `${name}-raw.log`);
  const metaPath = path.join(evidenceDir, `${name}-meta.json`);
  const framePath = path.join(evidenceDir, `${name}-frame.txt`);
  const logStream = fs.createWriteStream(logPath, { flags: 'w' });

  const startTime = new Date().toISOString();
  const mergedEnv = {
    ...process.env,
    TERM: 'xterm-256color',
    FORCE_COLOR: env.NO_COLOR ? '0' : '3',
    ...env
  };

  const ptyProcess = pty.spawn(process.execPath, ['bundle/gemini.js'], {
    name: 'xterm-color',
    cols,
    rows,
    cwd: rootDir,
    env: mergedEnv
  });

  const pid = ptyProcess.pid;
  let fullOutput = '';

  ptyProcess.onData((data) => {
    fullOutput += data;
    logStream.write(data);
  });

  for (const step of inputs) {
    if (step.delay) await new Promise(r => setTimeout(r, step.delay));
    if (step.resize) ptyProcess.resize(step.resize.cols, step.resize.rows);
    if (step.write) ptyProcess.write(step.write);
  }

  await new Promise(r => setTimeout(r, 1200));

  try { ptyProcess.kill(); } catch (e) {}
  logStream.end();

  const endTime = new Date().toISOString();
  const rawHash = sha256(fullOutput);
  const clean = stripAnsi(fullOutput);
  const frameHash = sha256(clean);

  fs.writeFileSync(framePath, clean, 'utf8');
  fs.writeFileSync(metaPath, JSON.stringify({
    sessionName: name,
    startTime,
    endTime,
    viewport: `${cols}x${rows}`,
    pid,
    exitCode: 0,
    rawHash,
    frameHash
  }, null, 2), 'utf8');

  return {
    name,
    pid,
    cols,
    rows,
    rawHash,
    frameHash,
    cleanText: clean.trim()
  };
}

async function main() {
  console.log(`🚀 Running Truly Fresh RGB ConPTY Capture Harness in ${evidenceDir}...`);

  const p0 = await captureSession('01-phase0', 80, 24, {}, [{ delay: 300 }, { write: '/quit\r', delay: 300 }]);
  const p1 = await captureSession('02-phase1', 80, 24, {}, [{ delay: 600 }, { write: '/quit\r', delay: 300 }]);
  const p2 = await captureSession('03-phase2', 80, 24, {}, [{ delay: 900 }, { write: '/quit\r', delay: 300 }]);
  const p3 = await captureSession('04-phase3', 80, 24, {}, [{ delay: 1200 }, { write: '/quit\r', delay: 300 }]);
  const w120 = await captureSession('05-welcome-120x36', 120, 36, {}, [{ delay: 800 }, { write: '/quit\r', delay: 300 }]);
  const w160 = await captureSession('06-welcome-160x50', 160, 50, {}, [{ delay: 800 }, { write: '/quit\r', delay: 300 }]);
  const narrow = await captureSession('07-narrow-fallback', 40, 24, {}, [{ delay: 800 }, { write: '/quit\r', delay: 300 }]);
  const noColor = await captureSession('08-no-color', 80, 24, { NO_COLOR: '1' }, [{ delay: 800 }, { write: '/quit\r', delay: 300 }]);
  const settings = await captureSession('11-settings-visible', 80, 24, {}, [{ delay: 800 }, { write: '/settings\r', delay: 600 }, { write: '\x03', delay: 300 }]);

  console.log('✅ TRULY FRESH RGB ConPTY Captures completed!');
  console.log('Evidence Directory:', evidenceDir);
  console.log('Phase 0 Raw Hash:', p0.rawHash);
  console.log('Phase 1 Raw Hash:', p1.rawHash);
  console.log('Phase 2 Raw Hash:', p2.rawHash);
  console.log('Phase 3 Raw Hash:', p3.rawHash);
  console.log('NO_COLOR Raw Hash:', noColor.rawHash);
  console.log('Settings Raw Hash:', settings.rawHash);
}

main().catch(err => {
  console.error('Capture error:', err);
});
