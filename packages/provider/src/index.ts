/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * PLUMB Provider Subsystem — barrel export.
 * OMP-derived multi-provider catalog, auth, and model transport for PLUMB.
 *
 * Upstream source: https://github.com/can1357/oh-my-pi.git
 * Upstream SHA: 4df68d60438423b384b2b47fb3d6835641624757
 * Upstream license: MIT (c) 2025 Mario Zechner, (c) 2025-2026 Can Bölük
 *
 * All public API uses PLUMB naming per the integration contract.
 */

// Types
export {
  type PlumbProvider,
  type PlumbProviderId,
  type PlumbModel,
  type PlumbModelSpec,
  type PlumbKnownApi,
  type PlumbStreamEvent,
  type PlumbStreamOptions,
  type PlumbStreamFunction,
  type PlumbMessage,
  type PlumbContentPart,
  type PlumbTool,
  type PlumbCredential,
  type PlumbCredentialEntry,
  type PlumbOAuthCredential,
  type PlumbApiKeyCredential,
  type PlumbCredentialSource,
  type PlumbAuthMethod,
  type PlumbThinkingConfig,
  type PlumbThinkingControlMode,
  type PlumbUsage,
  type PlumbModelPricing,
  type PlumbOpenAICompat,
  type PlumbAnthropicCompat,
  type PlumbBedrockCompat,
  PlumbProviderCategory,
} from './types.js';

// Provider catalog
export {
  PLUMB_PROVIDERS,
  SELECTABLE_PROVIDERS,
  ALL_PROVIDERS,
  PRODUCTION_READY_PROVIDER_IDS,
  getPlumbProvider,
  getProvidersByCategory,
  getProviderSetupGroups,
  CODING_PLAN_PROVIDERS,
  OAUTH_PROVIDERS,
  API_KEY_PROVIDERS,
  LOCAL_PROVIDERS,
  UNAUTHENTICATED_PROVIDERS,
} from './catalog/providers.js';

// Credential store (OS-protected via KeychainService in core)
export {
  type IPlumbCredentialStore,
  createPlumbCredentialStore,
  ensurePlumbCredentialStore,
  getPlumbCredentialStore,
  resetPlumbCredentialStore,
} from './auth/credential-store.js';

// Provider registry
export {
  PlumbProviderRegistry,
  getPlumbProviderRegistry,
  resetPlumbProviderRegistry,
  type PlumbProviderState,
  type PlumbProviderAuthState,
} from './registry/provider-registry.js';

// Model registry
export {
  PlumbModelRegistry,
  getPlumbModelRegistry,
  resetPlumbModelRegistry,
  registerBundledModels,
} from './registry/model-registry.js';

// Bundled model catalog initialization
export { initBundledModels } from './catalog/models.js';

// Streaming transport
export {
  plumbModelStream,
  registerPlumbTransport,
  hasPlumbTransport,
} from './transports/streaming.js';

// Coding plan implementations
export {
  ZHIPU_CODING_PLAN_PROVIDER,
  ZHIPU_API_BASE_URL,
  ZHIPU_AUTH_URL,
  ZHIPU_CODING_PLAN_MODELS,
  validateZhipuCodingPlanKey,
  discoverZhipuCodingPlanModels,
  loginZhipuCodingPlan,
} from './plans/zhipu-coding-plan.js';
export type {
  ZhipuLoginCallbacks,
  ZhipuLoginResult,
} from './plans/zhipu-coding-plan.js';

// Generic coding plan integration
export {
  CODING_PLANS,
  getCodingPlan,
  createCodingPlanProvider,
  getAllCodingPlanProviders,
  validateCodingPlanApiKey,
  loginCodingPlan,
  loginQwenPortal,
} from './plans/coding-plans.js';
export type {
  CodingPlanDefinition,
  CodingPlanLoginCallbacks,
  CodingPlanLoginResult,
  ApiKeyValidationResult,
} from './plans/coding-plans.js';
