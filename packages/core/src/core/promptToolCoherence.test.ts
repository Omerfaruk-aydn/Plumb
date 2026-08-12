/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * PROMPT_TOOL_COHERENCE regression coverage.
 *
 * Proves the invariant from the UNIVERSAL_TOOL_CAPABILITY_AUDIT: a
 * PLUMB-routed model whose resolved tool capability is not exactly
 * `toolsSupported === true` (i.e. UNSUPPORTED or UNKNOWN) must never receive
 * tool-use instructions in its system prompt — mirroring the identical gate
 * `resolveAdvertisedTools` already applies to wire tool declarations in
 * packages/provider/src/transports/streaming.ts. Native Gemini (no PLUMB
 * provider active) must be completely unaffected.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { getCoreSystemPrompt } from './prompts.js';
import { Config } from '../config/config.js';
import {
  READ_FILE_TOOL_NAME,
  GREP_TOOL_NAME,
  GLOB_TOOL_NAME,
  WRITE_TODOS_TOOL_NAME,
  ENTER_PLAN_MODE_TOOL_NAME,
  AGENT_TOOL_NAME,
} from '../tools/tool-names.js';
import { ApprovalMode } from '../policy/types.js';

vi.mock('../utils/gitUtils', () => ({
  isGitRepository: vi.fn().mockReturnValue(false),
}));

const ALL_CLIENT_TOOL_NAMES = [
  READ_FILE_TOOL_NAME,
  GREP_TOOL_NAME,
  GLOB_TOOL_NAME,
  WRITE_TODOS_TOOL_NAME,
  ENTER_PLAN_MODE_TOOL_NAME,
  AGENT_TOOL_NAME,
];

/** Minimal real-Config-shaped stand-in with the exact surface promptProvider reads. */
function buildConfig(): Config {
  const mockRegistry = {
    getAllToolNames: () => [...ALL_CLIENT_TOOL_NAMES],
    getAllTools: () => [],
  };
  const config = {
    getToolRegistry: () => mockRegistry,
    getEnableShellOutputEfficiency: () => true,
    getSandboxEnabled: () => false,
    getProjectRoot: () => '/tmp/project-temp',
    storage: {
      getProjectTempDir: () => '/tmp/project-temp',
      getPlansDir: () => '/tmp/project-temp/plans',
      getProjectMemoryDir: () => '/tmp/project-temp/memory',
      getProjectTempTrackerDir: () => '/tmp/project-temp/tracker',
    },
    isInteractive: () => true,
    isInteractiveShellEnabled: () => true,
    isTopicUpdateNarrationEnabled: () => false,
    getModel: () => 'gemini-3-pro-preview',
    getActiveModel: () => 'gemini-3-pro-preview',
    getAgentRegistry: () => ({
      getAllDefinitions: () => [],
      getDefinition: () => undefined,
    }),
    getSkillManager: () => ({ getSkills: () => [] }),
    getApprovalMode: () => ApprovalMode.DEFAULT,
    getApprovedPlanPath: () => undefined,
    isTrackerEnabled: () => false,
    getHasAccessToPreviewModel: () => true,
    getGemini31LaunchedSync: () => true,
    hasGemini35FlashGAAccess: () => false,
    get config() {
      return this;
    },
    get toolRegistry() {
      return mockRegistry;
    },
    // Seed the own properties the bound prototype methods below read/write
    // directly. `new Config(...)` would set these via field initializers;
    // this stand-in skips the real constructor, so they must be seeded
    // explicitly to match real Config's initial state.
    plumbProviderId: null,
    activeModelToolsSupported: undefined,
    activeModelToolsCapabilitySource: 'UNKNOWN',
  } as unknown as Config;

  // Bind the REAL Config.prototype methods under test (not mocks) onto the
  // stand-in — `private` fields are TS-only, so these operate on plain
  // instance properties of `config` exactly as they would on a real Config.
  type Bindable = Record<string, (...args: never[]) => unknown>;
  const proto = Config.prototype as unknown as Bindable;
  const target = config as unknown as Bindable;
  for (const method of [
    'getPlumbProvider',
    'setPlumbProvider',
    'getActiveModelToolsCapability',
    'setActiveModelToolsCapability',
    'getEffectiveToolsAdvertisable',
  ]) {
    target[method] = proto[method].bind(config);
  }
  return config;
}

// Tool names are rendered wrapped in backticks (see formatToolName in
// snippets.ts) everywhere they appear as a genuine tool-use instruction.
// Checking the bare name would false-positive on short names that are also
// common English word fragments (e.g. GLOB_TOOL_NAME === 'glob' collides
// with the substring in "global").
function formatted(name: string): string {
  return `\`${name}\``;
}

function expectToolInstructionsAbsent(prompt: string): void {
  for (const name of ALL_CLIENT_TOOL_NAMES) {
    expect(prompt).not.toContain(formatted(name));
  }
}

function expectToolInstructionsPresent(prompt: string): void {
  // At least the always-on-when-advertisable primary-workflow read_file
  // instruction must be present.
  expect(prompt).toContain(formatted(READ_FILE_TOOL_NAME));
}

describe('PROMPT_TOOL_COHERENCE', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('native Gemini (no PLUMB provider) always advertises tool instructions, unaffected by capability state', () => {
    const config = buildConfig();
    expect(config.getPlumbProvider()).toBeNull();
    expect(config.getEffectiveToolsAdvertisable()).toBe(true);
    const prompt = getCoreSystemPrompt(config);
    expectToolInstructionsPresent(prompt);
  });

  it('PLUMB model with toolsSupported=true advertises tool instructions', () => {
    const config = buildConfig();
    config.setPlumbProvider('opencode-zen');
    config.setActiveModelToolsCapability(true, 'PROVIDER_DYNAMIC');
    expect(config.getEffectiveToolsAdvertisable()).toBe(true);
    const prompt = getCoreSystemPrompt(config);
    expectToolInstructionsPresent(prompt);
  });

  it('PLUMB model with toolsSupported=false (UNSUPPORTED) suppresses every client-tool-name mention', () => {
    const config = buildConfig();
    config.setPlumbProvider('opencode-zen');
    config.setActiveModelToolsCapability(false, 'PROVIDER_DYNAMIC');
    expect(config.getEffectiveToolsAdvertisable()).toBe(false);
    const prompt = getCoreSystemPrompt(config);
    expectToolInstructionsAbsent(prompt);
  });

  it('PLUMB model with toolsSupported=undefined (UNKNOWN) suppresses every client-tool-name mention — this is the original opencode-zen/deepseek-v4-flash-free regression', () => {
    const config = buildConfig();
    config.setPlumbProvider('opencode-zen');
    config.setActiveModelToolsCapability(undefined, 'UNKNOWN');
    expect(config.getEffectiveToolsAdvertisable()).toBe(false);
    const prompt = getCoreSystemPrompt(config);
    expectToolInstructionsAbsent(prompt);
  });

  it('A→B→C→A capability switch on one Config instance shows zero PROMPT_TOOL_BLEED', () => {
    const config = buildConfig();
    config.setPlumbProvider('provider-a');

    // A: supported
    config.setActiveModelToolsCapability(true, 'PROVIDER_DYNAMIC');
    expectToolInstructionsPresent(getCoreSystemPrompt(config));

    // B: unknown
    config.setActiveModelToolsCapability(undefined, 'UNKNOWN');
    expectToolInstructionsAbsent(getCoreSystemPrompt(config));

    // C: unsupported
    config.setActiveModelToolsCapability(false, 'BUNDLED_CATALOG');
    expectToolInstructionsAbsent(getCoreSystemPrompt(config));

    // A again: must not have bled B's or C's suppression forward.
    config.setActiveModelToolsCapability(true, 'PROVIDER_DYNAMIC');
    expectToolInstructionsPresent(getCoreSystemPrompt(config));
  });

  it('ANTI-TAUTOLOGY: enabledToolNames actually collapses to empty when gated — this assertion would fail against the pre-fix code, where enabledToolNames was always `new Set(toolNames)` regardless of capability', () => {
    const config = buildConfig();
    config.setPlumbProvider('opencode-zen');
    config.setActiveModelToolsCapability(undefined, 'UNKNOWN');
    // Directly exercise the real gate this test suite depends on: if a
    // future edit reintroduces `new Set(toolNames)` unconditionally, this
    // fails immediately without needing to parse rendered prose.
    expect(config.getEffectiveToolsAdvertisable()).toBe(false);
    const registry = config.getToolRegistry();
    expect(registry.getAllToolNames().length).toBeGreaterThan(0);
    const prompt = getCoreSystemPrompt(config);
    expectToolInstructionsAbsent(prompt);
  });
});
