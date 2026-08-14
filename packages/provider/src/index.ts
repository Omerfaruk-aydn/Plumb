/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

// Types
export {
  type PlumbProvider,
  type PlumbProviderId,
  type PlumbModel,
  type PlumbModelSpec,
  type PlumbKnownApi,
  type ToolChoiceEmissionPolicy,
  type PlumbRouteToolPolicy,
  type PlumbToolChoice,
  type PlumbProtocolCapabilityStatus,
  type PlumbProtocolCapabilitySource,
  type PlumbProtocolCapability,
  type PlumbStructuredToolProtocol,
  type PlumbRouteEndpointFamily,
  type PlumbEffectiveRouteEndpoint,
  type PlumbEffectiveToolRouteScope,
  type PlumbEffectiveToolChoiceContract,
  type PlumbEffectiveToolParserContract,
  type PlumbEffectiveToolReplayContract,
  type PlumbEffectiveToolRouteContract,
  type PlumbEffectiveToolRouteInput,
  type PlumbProviderProtocolMatrixRow,
  type PlumbProviderProtocolMatrix,
  type PlumbStreamEvent,
  type PlumbStreamOptions,
  type PlumbStreamFunction,
  type PlumbMessage,
  type PlumbContentPart,
  type PlumbTool,
  type PlumbToolExecutionRequest,
  type PlumbToolExecutionResult,
  type PlumbToolExecutionStatus,
  type PlumbToolExecutor,
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

export {
  resolveRouteToolPolicy,
  resolveEffectiveToolChoice,
  describeToolChoiceValue,
  resolveProviderRouteToolChoiceProof,
  deriveDialectToolChoiceCapability,
  deriveRouteToolChoiceCapability,
  resolveHonestProbeToolChoice,
  type ToolChoiceCapability,
  type ProviderRouteToolChoiceProof,
  type DialectToolChoiceCapability,
  type RouteToolChoiceCapability,
} from './tool-policy.js';

// Canonical effective provider + model + route tool contract and generated
// protocol inventory. Cache helpers require the complete route by construction.
export {
  resolveEffectiveWireModelId,
  makeEffectiveToolRouteKey,
  buildEffectiveToolRouteContract,
  createEffectiveToolRouteCache,
  generatePlumbProviderProtocolMatrix,
  PLUMB_PROVIDER_PROTOCOL_MATRIX,
  getPlumbProviderProtocolMatrix,
  type PlumbEffectiveToolRouteCache,
} from './route-contract.js';

// Honest, mutually-exclusive batch tool-route probe classification and the
// universal LIVE_MODEL_UNRESOLVED rule (never trust bundled fallback as live
// authority when user did not explicitly request a model).
export {
  BATCH_RESULT_CLASSES,
  ZERO_BATCH_COUNTERS,
  classifyBatchResult,
  computeBatchBreakdown,
  isLocalProvider,
  resolveLiveModelAuthority,
  liveModelUnresolvedClassification,
  resolveProbeAuthorityDecision,
  resolveModelAuthorityDimensions,
  type BatchResultClass,
  type BatchProbeResult,
  type ClassifiedBatchResult,
  type BatchBreakdown,
  type BatchBreakdownCounters,
  type LiveModelAuthority,
  type LiveModelAuthorityInput,
  type ModelAuthorityKind,
  type ProbeAuthorityDecision,
  type ProbeAuthorityInput,
  type DiscoveryStatus,
  type AccountUsability,
  type ModelAuthorityDimensions,
  type ModelAuthorityDimensionsInput,
} from './toolRouteContract.js';

// Provider catalog
export {
  PLUMB_PROVIDERS,
  SELECTABLE_PROVIDERS,
  ALL_PROVIDERS,
  PRODUCTION_READY_PROVIDER_IDS,
  getPlumbProvider,
  getProvidersByCategory,
  getProviderSetupGroups,
  resolveProviderAlias,
  resolvePlumbProviderId,
  CODING_PLAN_PROVIDERS,
  OAUTH_PROVIDERS,
  API_KEY_PROVIDERS,
  LOCAL_PROVIDERS,
  UNAUTHENTICATED_PROVIDERS,
} from './catalog/providers.js';

// Credential store (pure interface, factory-registered at runtime)
export {
  type IPlumbCredentialStore,
  registerPlumbCredentialStoreFactory,
  ensurePlumbCredentialStore,
  getPlumbCredentialStore,
  resetPlumbCredentialStore,
} from './auth/credential-store.js';

// Canonical OAuth credential resolver (refresh, single-flight, classification)
export {
  type CredentialClassification,
  type PlumbRefreshResult,
  type PlumbCredentialRefresher,
  type UsableCredentialResult,
  registerPlumbCredentialRefresher,
  resetPlumbCredentialRefresher,
  clearPlumbCredentialResolverInFlight,
  resolveUsablePlumbCredential,
} from './auth/credential-resolver.js';

// Canonical adoption of a completed OMP login result into the PLUMB
// credential authority (secure store + provider registry). Never starts a
// login of its own — see the module doc for the two-caller rationale.
export {
  type AdoptedPlumbLoginCredential,
  ompLoginCredentialToPlumb,
  adoptPlumbLoginResult,
} from './auth/credential-adoption.js';

// Provider registry
export {
  PlumbProviderRegistry,
  getPlumbProviderRegistry,
  isPlumbProviderRegistryInstantiated,
  resetPlumbProviderRegistry,
  type PlumbProviderState,
  type PlumbProviderAuthState,
  type PlumbProviderHealthState,
} from './registry/provider-registry.js';

// Model registry
export {
  composeModel,
  PlumbModelRegistry,
  getPlumbModelRegistry,
  resetPlumbModelRegistry,
  type PlumbModelAuthorityStats,
  type ResolveProbeModelInput,
  type ResolvedModelSelection,
  type RouteMismatchCategory,
  type RouteAuthorityState,
  type RouteAuthoritySource,
} from './registry/model-registry.js';
export type { ModelDiscoveryState } from './toolRouteContract.js';

// Google Vertex authority
export {
  resolveVertexProjectAuthority,
  type VertexProjectAuthorityInfo,
} from './transports/plumbGoogleVertex.js';

// Auto-mode model-routing policy
export {
  resolveAutoModel,
  type UsableProviderModels,
  type AutoModelSelection,
} from './registry/auto-model-policy.js';

// Model catalog (generated from OMP upstream)
export {
  getCatalogProviders,
  getCatalogModels,
  getCatalogModel,
  getCatalogModelCount,
  getAllCatalogModels,
} from './catalog/model-catalog.js';

// Model cache
export {
  readModelCache,
  writeModelCache,
  invalidateModelCache,
  invalidateAllModelCache,
  closeModelCache,
} from './registry/model-cache.js';

// Model discovery
export {
  discoverProviderModels,
  discoverProviderModelsDetailed,
  getDiscovery,
  getDiscoveryProviderIds,
  type ModelDiscoveryResult,
  type ModelDiscoveryStatus,
} from './registry/model-discovery.js';

// Bundled model catalog initialization
export { initBundledModels } from './catalog/models.js';

// Provider safe (non-secret) cloud configuration resolution seam
export {
  setProviderConfigResolver,
  resolveProviderSafeConfig,
  resolveProviderConfigValue,
  type ProviderSafeConfig,
  type ProviderConfigResolver,
} from './config/providerConfigResolver.js';

export {
  LOCAL_PROVIDER_IDS,
  isLocalProviderId,
  getLocalProviderEndpointDefinition,
  resolveLocalProviderBaseUrl,
  resolveOllamaNativeBaseUrl,
  validateLocalProviderBaseUrl,
  getLocalProviderConfigSchema,
  validateLocalProviderConfig,
  buildLocalProviderSaveOperation,
  type LocalProviderId,
  type LocalProviderEndpointDefinition,
} from './config/localProviderConfig.js';
export {
  GATEWAY_CONFIG_PROVIDER_IDS,
  isGatewayConfigProviderId,
  resolveGatewayProviderBaseUrl,
  getGatewayProviderConfigSchema,
  validateGatewayProviderConfig,
  buildGatewayProviderSaveOperation,
  type GatewayConfigProviderId,
} from './config/gatewayProviderConfig.js';
export {
  CUSTOM_PROVIDER_DEFINITION_VERSION,
  createCustomProviderId,
  isCustomProviderId,
  validateCustomProviderDefinition,
  normalizeCustomProviderDefinition,
  setCustomProviderDefinitions,
  upsertCustomProviderDefinition,
  removeCustomProviderDefinition,
  getCustomProviderDefinition,
  listCustomProviderDefinitions,
  customDefinitionToProvider,
  listCustomPlumbProviders,
  customDefinitionToModels,
  __resetCustomProviderDefinitionsForTests,
  type CustomProviderDialect,
  type CustomCredentialPlacement,
  type CustomProviderManualModel,
  type CustomProviderDefinition,
  type CustomProviderDefinitionInput,
  type CustomProviderValidationErrors,
} from './config/customProviderDefinitions.js';

// OCI Generative AI configuration domain schema/validator (canonical --
// the Ink UI renders from and validates through this, never a parallel
// implementation)
export {
  OCI_GENAI_CONFIG_SCHEMA,
  getVisibleOciFields,
  validateOciConfig,
  buildOciSaveOperation,
  type CloudConfigFieldType,
  type CloudConfigFieldOption,
  type CloudConfigFieldDef,
  type CloudAuthModeDef,
  type CloudProviderConfigSchema,
  type OciConfigFormValues,
  type OciConfigValidationErrors,
} from './config/ociGenaiConfigSchema.js';

// Generic flat-schema cloud config engine + the Bedrock/Vertex/watsonx
// schemas built on it (Azure's deployment-list shape is handled
// separately -- see azureConfigSchema.js).
export {
  getVisibleCloudFields,
  validateCloudConfig,
  buildCloudSaveOperation,
  type CloudConfigFormValues,
  type CloudConfigValidationErrors,
} from './config/cloudConfigSchema.js';
export {
  BEDROCK_CONFIG_SCHEMA,
  getVisibleBedrockFields,
  validateBedrockConfig,
  buildBedrockSaveOperation,
} from './config/bedrockConfigSchema.js';
export {
  VERTEX_CONFIG_SCHEMA,
  getVisibleVertexFields,
  validateVertexConfig,
  buildVertexSaveOperation,
} from './config/vertexConfigSchema.js';
export {
  WATSONX_CONFIG_SCHEMA,
  getVisibleWatsonxFields,
  validateWatsonxConfig,
  buildWatsonxSaveOperation,
} from './config/watsonxConfigSchema.js';
export {
  validateAzureConfig,
  buildAzureSaveOperation,
  encodeAzureDeploymentMap,
  decodeAzureDeploymentMap,
  decodeAzureEndpoint,
  type AzureDeployment,
  type AzureConfigFormValues,
  type AzureConfigValidationErrors,
} from './config/azureConfigSchema.js';

// OMP catalog (directly adapted from upstream)
export {
  getBundledModel,
  getBundledProviders,
  getBundledModels,
  calculateCost,
  modelsAreEqual,
} from './vendor-catalog/models.js';
export { buildModel, buildCompat } from './vendor-catalog/build.js';
export {
  createModelManager,
  type ModelManager,
  type ModelManagerOptions,
  type ModelResolutionResult,
  type ModelRefreshStrategy,
} from './vendor-catalog/model-manager.js';
export {
  readModelCache as readOmpModelCache,
  writeModelCache as writeOmpModelCache,
  removeModelCacheEntry as removeOmpModelCacheEntry,
} from './vendor-catalog/model-cache.js';
export {
  CATALOG_PROVIDERS,
  PROVIDER_DESCRIPTORS,
  DEFAULT_MODEL_PER_PROVIDER,
  getCatalogProviderEntry,
} from './vendor-catalog/provider-models/descriptors.js';
export { resolveModelThinking } from './vendor-catalog/model-thinking.js';
export { Effort, THINKING_EFFORTS } from './vendor-catalog/effort.js';
export type {
  Model as OmpModel,
  ModelSpec as OmpModelSpec,
  Api as OmpApi,
  KnownApi as OmpKnownApi,
  KnownProvider as OmpKnownProvider,
  Usage as OmpUsage,
} from './vendor-catalog/types.js';

// OMP provider registry (directly adapted from upstream)
export {
  PROVIDER_REGISTRY,
  getProviderDefinition,
} from './vendor-ai/registry/registry.js';
export type {
  ProviderDefinition,
  KeyResolver,
} from './vendor-ai/registry/types.js';

// OMP runtime adaptations (Node/bun-compat shims)
export { installBunGlobal } from './vendor-shims/bun-runtime.js';

// OMP OAuth (directly adapted from upstream)
export {
  refreshOAuthToken,
  getOAuthApiKey,
  getOAuthProviders,
  registerOAuthProvider,
} from './vendor-ai/registry/oauth/index.js';
export { OAuthCallbackFlow } from './vendor-ai/registry/oauth/callback-server.js';
export { generatePKCE } from './vendor-ai/registry/oauth/pkce.js';

// Schema normalization (diagnostic/dialect-serialization surface --
// see vendor-ai/utils/schema/CONSTRAINTS.md for the operational contract).
export {
  normalizeSchemaForGoogle,
  normalizeSchemaForCCA,
  normalizeSchemaForMCP,
  tryEnforceStrictSchema,
} from './vendor-ai/utils/schema/index.js';
export type {
  OAuthProvider,
  OAuthCredentials,
  OAuthLoginCallbacks,
  OAuthController,
} from './vendor-ai/registry/oauth/types.js';

// Streaming transport
export {
  plumbModelStream,
  enableToolRouteDiag,
  initToolRouteDiag,
  resetToolRouteDiag,
  getToolRouteDiag,
  getLastToolRouteDiag,
  createFreshDiagSnapshot,
  registerPlumbTransport,
  hasPlumbTransport,
  buildAntigravityRequest,
  extractSafeGoogleErrorDetails,
  formatSafeGoogleErrorSummary,
  recordToolRouteHttpFailure,
  recordToolRouteNetworkStarted,
  recordVertexPreflight,
  type ToolRouteRequestWireDetails,
  type SafeUpstreamErrorDetails,
  type SafeGoogleErrorDetails,
  type SafeFieldViolation,
  type AntigravityRequestDescriptor,
  type AntigravityRequestResult,
} from './transports/streaming.js';
export {
  antigravityTraceEnabled,
  makeAntigravityTraceId,
  writeSafeTraceEvent,
  computeCanonicalStructureHash,
  computeRequestStructureHash,
  computeBodyStructureHash,
  traceAntigravityRequestConstruction,
  traceAntigravityFinalHttpRequest,
  traceAntigravityHttpResponse,
  traceAntigravityError,
  type AntigravityTraceSource,
  type AntigravityTracePhase,
  type ContentGeneratorInstanceTrace,
} from './transports/antigravityTrace.js';

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

// Claude Subscription (Agent SDK)
export {
  getClaudeSubscriptionStatus,
  resolveClaudeCliCommand,
  runClaudeSubscriptionReauth,
  getClaudeSubscriptionModels,
  CLAUDE_SUBSCRIPTION_MODELS,
} from './transports/claudeSubscription.js';
export type {
  ClaudeSubscriptionAuthStatus,
  ClaudeSubscriptionStatusResult,
  ClaudeCliCommand,
  ClaudeCliProcessAdapter,
  ClaudeSubscriptionReauthOutcome,
  ClaudeSubscriptionReauthResult,
  ClaudeSubscriptionModelMetadata,
  ClaudeSubscriptionModelsResult,
} from './transports/claudeSubscription.js';

// Universal model inventory — single canonical aggregation layer
export {
  buildUniversalModelInventory,
  type BuildDescriptor,
  type InventoryBuildContext,
  type ModelIdentitySource,
  type ModelLimitSource,
  type ResolvedModelMetadata,
  type UniversalProviderEntry,
  type UniversalModelInventory,
} from './registry/universal-model-inventory.js';
