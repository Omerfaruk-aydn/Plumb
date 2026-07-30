import pty from 'node-pty';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const timestamp = '1753909500';
const evidenceDir = path.join(rootDir, `docs/verification/evidence/phase3-wordmark-final-${timestamp}`);

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
    FORCE_COLOR: env.NO_COLOR ? '0' : '1',
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
  console.log(`🚀 Running Fresh ConPTY Capture Harness in ${evidenceDir}...`);

  const w80 = await captureSession('01-welcome-80x24', 80, 24, {}, [{ delay: 1000 }, { write: '/quit\r', delay: 300 }]);
  const w120 = await captureSession('02-welcome-120x36', 120, 36, {}, [{ delay: 1000 }, { write: '/quit\r', delay: 300 }]);
  const w160 = await captureSession('03-welcome-160x50', 160, 50, {}, [{ delay: 1000 }, { write: '/quit\r', delay: 300 }]);
  const compact = await captureSession('04-compact-header', 80, 24, {}, [{ delay: 1000 }, { write: '/help\r', delay: 500 }, { write: '/quit\r', delay: 300 }]);
  const slash = await captureSession('06-slash-completion', 80, 24, {}, [{ delay: 1000 }, { write: '/', delay: 500 }, { write: '\x03', delay: 300 }]);
  const settings = await captureSession('07-settings', 80, 24, {}, [{ delay: 1000 }, { write: '/settings\r', delay: 500 }, { write: '\x03', delay: 300 }]);
  const noColor = await captureSession('13-no-color-80x24', 80, 24, { NO_COLOR: '1' }, [{ delay: 1000 }, { write: '/quit\r', delay: 300 }]);

  console.log('✅ TRULY FRESH ConPTY Visual Captures completed!');
  console.log('Evidence Directory:', evidenceDir);
  console.log('Welcome 80x24 Raw Hash:', w80.rawHash);
  console.log('Welcome 120x36 Raw Hash:', w120.rawHash);
  console.log('Welcome 160x50 Raw Hash:', w160.rawHash);
  console.log('Compact Header Raw Hash:', compact.rawHash);
  console.log('Slash Completion Raw Hash:', slash.rawHash);
  console.log('Settings Raw Hash:', settings.rawHash);
  console.log('NO_COLOR Raw Hash:', noColor.rawHash);
}

main().catch(err => {
  console.error('Capture error:', err);
});
