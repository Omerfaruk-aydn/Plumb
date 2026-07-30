import pty from 'node-pty';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const evidenceDir = path.join(rootDir, 'docs/verification/evidence');

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
  const logStream = fs.createWriteStream(logPath, { flags: 'w' });

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

  const hash = sha256(fullOutput);
  const clean = stripAnsi(fullOutput);

  return {
    name,
    pid,
    cols,
    rows,
    logPath,
    hash,
    rawLength: fullOutput.length,
    cleanText: clean.substring(0, 500)
  };
}

async function main() {
  console.log('🚀 Running Real ConPTY Visual Capture Harness...');

  const welcome80x24 = await captureSession('01-welcome-80x24', 80, 24, {}, [{ delay: 1000 }, { write: '/quit\r', delay: 300 }]);
  const welcome120x36 = await captureSession('02-welcome-120x36', 120, 36, {}, [{ delay: 1000 }, { write: '/quit\r', delay: 300 }]);
  const welcome160x50 = await captureSession('03-welcome-160x50', 160, 50, {}, [{ delay: 1000 }, { write: '/quit\r', delay: 300 }]);
  const noColor = await captureSession('04-no-color', 80, 24, { NO_COLOR: '1' }, [{ delay: 1000 }, { write: '/quit\r', delay: 300 }]);

  console.log('✅ Real ConPTY visual captures completed!');
  console.log('Welcome 80x24 Hash:', welcome80x24.hash);
  console.log('Welcome 120x36 Hash:', welcome120x36.hash);
  console.log('Welcome 160x50 Hash:', welcome160x50.hash);
  console.log('NO_COLOR Hash:', noColor.hash);
}

main().catch(err => {
  console.error('Capture error:', err);
});
