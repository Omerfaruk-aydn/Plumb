/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { EnvHttpProxyAgent, fetch as undiciFetch } from 'undici';
import { debugLogger } from '../utils/debugLogger.js';
import { isSubpath, resolveToRealPath } from '../utils/paths.js';
import { isNodeError } from '../utils/errors.js';
import { type IdeInfo } from './detect-ide.js';

const logger = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  debug: (...args: any[]) =>
    debugLogger.debug('[DEBUG] [IDEConnectionUtils]', ...args),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: (...args: any[]) =>
    debugLogger.error('[ERROR] [IDEConnectionUtils]', ...args),
};

export type StdioConfig = {
  command: string;
  args: string[];
};

export type ConnectionConfig = {
  port?: string;
  authToken?: string;
  stdio?: StdioConfig;
};

export function validateWorkspacePath(
  ideWorkspacePath: string | undefined,
  cwd: string,
): { isValid: boolean; error?: string } {
  if (ideWorkspacePath === undefined) {
    return {
      isValid: false,
      error: `Failed to connect to IDE companion extension. Please ensure the extension is running. To install the extension, run /ide install.`,
    };
  }

  if (ideWorkspacePath === '') {
    return {
      isValid: false,
      error: `To use this feature, please open a workspace folder in your IDE and try again.`,
    };
  }

  const ideWorkspacePaths = ideWorkspacePath
    .split(path.delimiter)
    .map((p) => resolveToRealPath(p))
    .filter((e) => !!e);
  const realCwd = resolveToRealPath(cwd);
  const isWithinWorkspace = ideWorkspacePaths.some((workspacePath) =>
    isSubpath(workspacePath, realCwd),
  );

  if (!isWithinWorkspace) {
    return {
      isValid: false,
      error: `Directory mismatch. PLUMB is running in a different location than the open workspace in the IDE. Please run the CLI from one of the following directories: ${ideWorkspacePaths.join(
        ', ',
      )}`,
    };
  }
  return { isValid: true };
}

export function getPortFromEnv(): string | undefined {
  const port = process.env['GEMINI_CLI_IDE_SERVER_PORT'];
  if (!port) {
    return undefined;
  }
  return port;
}

export function getStdioConfigFromEnv(): StdioConfig | undefined {
  const command = process.env['PLUMB_IDE_SERVER_STDIO_COMMAND'];
  if (!command) {
    return undefined;
  }

  const argsStr = process.env['PLUMB_IDE_SERVER_STDIO_ARGS'];
  let args: string[] = [];
  if (argsStr) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const parsedArgs = JSON.parse(argsStr);
      if (Array.isArray(parsedArgs)) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        args = parsedArgs;
      } else {
        logger.error(
          'PLUMB_IDE_SERVER_STDIO_ARGS must be a JSON array string.',
        );
      }
    } catch (e) {
      logger.error('Failed to parse PLUMB_IDE_SERVER_STDIO_ARGS:', e);
    }
  }

  return { command, args };
}

/**
 * Matches a companion-written connection file under either the current or the
 * pre-rebrand name. The prefix is a non-capturing group so group 1 stays the
 * pid, which sortConnectionFiles relies on.
 */
const IDE_SERVER_FILE_REGEX = /^(?:plumb|gemini)-ide-server-(\d+)-\d+\.json$/;

/**
 * Temp subdirectories to look in, current name first.
 *
 * This file name is a wire contract with the IDE companion extension: the
 * extension writes it, core reads it. The two ship separately, so a user can
 * easily be running a newer CLI against an older companion that still writes
 * the old name -- reading both is what keeps IDE integration working across
 * that gap, rather than silently breaking it.
 */
const IDE_TMP_DIR_NAMES = ['plumb', 'gemini'];

/**
 * The single-file layout very old companion versions wrote. Exactly one path,
 * not a matrix over the names above: this format predates the rebrand, so no
 * companion has ever written it under the current name.
 */
function legacyConnectionFilePath(pid: number): string {
  return path.join(
    os.tmpdir(),
    'gemini',
    'ide',
    `gemini-ide-server-${pid}.json`,
  );
}

export async function getConnectionConfigFromFile(
  pid: number,
): Promise<
  (ConnectionConfig & { workspacePath?: string; ideInfo?: IdeInfo }) | undefined
> {
  // For backwards compatibility
  try {
    const portFile = legacyConnectionFilePath(pid);
    const portFileContents = await fs.promises.readFile(portFile, 'utf8');
    const parsed: unknown = JSON.parse(portFileContents);
    type ConfigType = ConnectionConfig & {
      workspacePath?: string;
      ideInfo?: IdeInfo;
    };
    const isConfig = (val: unknown): val is ConfigType =>
      typeof val === 'object' && val !== null;
    if (isConfig(parsed)) {
      return parsed;
    }
    throw new Error('Invalid connection config format');
  } catch {
    // For newer extension versions, the file name matches the pattern
    // /^(plumb|gemini)-ide-server-${pid}-\d+\.json$/. If multiple IDE
    // windows are open, multiple files matching the pattern are expected to
    // exist.
  }

  // Collected as (dir, file) pairs because the same file name can appear
  // under either temp directory and we still have to read it from the one it
  // was actually found in.
  const candidates: Array<{ dir: string; file: string }> = [];
  for (const dirName of IDE_TMP_DIR_NAMES) {
    const dir = path.join(os.tmpdir(), dirName, 'ide');
    let entries: string[];
    try {
      entries = await fs.promises.readdir(dir);
    } catch (e) {
      logger.debug(`Failed to read IDE connection directory ${dir}:`, e);
      continue;
    }
    for (const file of entries) {
      if (IDE_SERVER_FILE_REGEX.test(file)) {
        candidates.push({ dir, file });
      }
    }
  }

  if (candidates.length === 0) {
    return undefined;
  }

  sortConnectionFiles(candidates, pid);

  let fileContents: string[];
  try {
    fileContents = await Promise.all(
      candidates.map(({ dir, file }) =>
        fs.promises.readFile(path.join(dir, file), 'utf8'),
      ),
    );
  } catch (e) {
    logger.debug('Failed to read IDE connection config file(s):', e);
    return undefined;
  }
  const parsedContents = fileContents.map(
    (
      content,
    ):
      | (ConnectionConfig & { workspacePath?: string; ideInfo?: IdeInfo })
      | undefined => {
      try {
        const parsed: unknown = JSON.parse(content);
        type ConfigType = ConnectionConfig & {
          workspacePath?: string;
          ideInfo?: IdeInfo;
        };
        const isConfig = (val: unknown): val is ConfigType =>
          typeof val === 'object' && val !== null;
        if (isConfig(parsed)) {
          return parsed;
        }
        return undefined;
      } catch (e) {
        logger.debug('Failed to parse JSON from config file: ', e);
        return undefined;
      }
    },
  );

  const validWorkspaces = parsedContents.filter(
    (
      content,
    ): content is ConnectionConfig & {
      workspacePath?: string;
      ideInfo?: IdeInfo;
    } => {
      if (!content) {
        return false;
      }
      const { isValid } = validateWorkspacePath(
        content.workspacePath,
        process.cwd(),
      );
      return isValid;
    },
  );

  if (validWorkspaces.length === 0) {
    return undefined;
  }

  if (validWorkspaces.length === 1) {
    const selected = validWorkspaces[0];
    const fileIndex = parsedContents.indexOf(selected);
    if (fileIndex !== -1) {
      logger.debug(
        `Selected IDE connection file: ${candidates[fileIndex].file}`,
      );
    }
    return selected;
  }

  const portFromEnv = getPortFromEnv();
  if (portFromEnv) {
    const matchingPortIndex = validWorkspaces.findIndex(
      (content) => String(content.port) === portFromEnv,
    );
    if (matchingPortIndex !== -1) {
      const selected = validWorkspaces[matchingPortIndex];
      const fileIndex = parsedContents.indexOf(selected);
      if (fileIndex !== -1) {
        logger.debug(
          `Selected IDE connection file (matched port from env): ${candidates[fileIndex].file}`,
        );
      }
      return selected;
    }
  }

  const selected = validWorkspaces[0];
  const fileIndex = parsedContents.indexOf(selected);
  if (fileIndex !== -1) {
    logger.debug(
      `Selected first valid IDE connection file: ${candidates[fileIndex].file}`,
    );
  }
  return selected;
}

// Sort files to prioritize the one matching the target pid,
// then by whether the process is still alive, then by newest (largest PID).
function sortConnectionFiles(
  files: Array<{ dir: string; file: string }>,
  targetPid: number,
) {
  files.sort((first, second) => {
    const a = first.file;
    const b = second.file;
    const aMatch = a.match(IDE_SERVER_FILE_REGEX);
    const bMatch = b.match(IDE_SERVER_FILE_REGEX);
    const aPid = aMatch ? parseInt(aMatch[1], 10) : 0;
    const bPid = bMatch ? parseInt(bMatch[1], 10) : 0;

    if (aPid === targetPid && bPid !== targetPid) {
      return -1;
    }
    if (bPid === targetPid && aPid !== targetPid) {
      return 1;
    }

    const aIsAlive = isPidAlive(aPid);
    const bIsAlive = isPidAlive(bPid);

    if (aIsAlive && !bIsAlive) {
      return -1;
    }
    if (bIsAlive && !aIsAlive) {
      return 1;
    }

    // Newest PIDs first as a heuristic
    return bPid - aPid;
  });
}

function isPidAlive(pid: number): boolean {
  if (pid <= 0) {
    return false;
  }
  // Assume the process is alive since checking would introduce significant overhead.
  if (os.platform() === 'win32') {
    return true;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return isNodeError(e) && e.code === 'EPERM';
  }
}

export async function createProxyAwareFetch(ideServerHost: string) {
  // ignore proxy for the IDE server host to allow connecting to the ide mcp server
  const existingNoProxy = process.env['NO_PROXY'] || '';
  const agent = new EnvHttpProxyAgent({
    noProxy: [existingNoProxy, ideServerHost].filter(Boolean).join(','),
  });
  return async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const fetchOptions: RequestInit & { dispatcher?: unknown } = {
      ...init,
      dispatcher: agent,
    };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const options = fetchOptions as unknown as import('undici').RequestInit;
    try {
      const response = await undiciFetch(url, options);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return new Response(response.body as ReadableStream<unknown> | null, {
        status: response.status,
        statusText: response.statusText,
        headers: [...response.headers.entries()],
      });
    } catch (error) {
      const urlString = typeof url === 'string' ? url : url.href;
      logger.error(`IDE fetch failed for ${urlString}`, error);
      throw error;
    }
  };
}

export function getIdeServerHost() {
  let host: string;
  host = '127.0.0.1';
  if (isInContainer()) {
    // when ssh-connection (e.g. remote-ssh) or devcontainer setup:
    // --> host must be '127.0.0.1' to have cli companion working
    if (!isSshConnected() && !isDevContainer()) {
      host = 'host.docker.internal';
    }
  }
  logger.debug(`[getIdeServerHost] Mapping IdeServerHost to '${host}'`);
  return host;
}

function isInContainer() {
  return fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv');
}

function isSshConnected() {
  return !!process.env['SSH_CONNECTION'];
}

function isDevContainer() {
  return !!(
    process.env['VSCODE_REMOTE_CONTAINERS_SESSION'] ||
    process.env['REMOTE_CONTAINERS']
  );
}
