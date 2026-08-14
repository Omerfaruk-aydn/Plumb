# OMP Compat Audit Correction — Final Report

## HEAD: `932e4c6`

## Corrections Made

### 1. Removed ZAI thinking format generalization

Previous report claimed "Kimi/MiMo/GLM/Qwen all use ZAI format." **Wrong.**

Per actual OMP source (`buildOpenAICompat`):

- OpenCode providers: `thinkingFormat = "openai"` (default)
- All OpenCode reasoning models: `reasoning_effort` (NOT
  `thinking:{type:"enabled"}`)
- `thinking:{type:"enabled"}` is ONLY for direct DeepSeek API via `extraBody`
- Kimi on OpenCode: `supportsReasoningEffort = false` (no reasoning_effort)

### 2. Removed model-family regex

Previous code used `/deepseek/i`, `/kimi/i` regex. **Removed.**

Now metadata-driven: `model.thinking.mode === 'effort'` and
`model.thinking.supportedEfforts`.

### 3. Corrected request body per OMP contract

| Route                      | reasoning_effort | thinking obj | extraBody |
| -------------------------- | ---------------- | ------------ | --------- |
| OpenCode Zen + DeepSeek V4 | YES              | NO           | NO        |
| OpenCode Zen + HY3         | YES              | NO           | NO        |
| OpenCode Zen + Kimi K2     | NO               | NO           | NO        |
| OpenCode Zen + MiMo        | YES              | NO           | NO        |
| Direct DeepSeek API        | YES              | NO           | YES       |

---

## Compat Field Audit (47 fields)

| Category                              | Count |
| ------------------------------------- | ----- |
| PRESERVED_AND_USED                    | 6     |
| PRESERVED_BUT_UNUSED_BENIGN           | 14    |
| PRESERVED_BUT_UNUSED_RUNTIME_RELEVANT | 2     |
| DROPPED                               | 0     |
| NOT_APPLICABLE                        | 20    |

### Runtime relevant unused (2)

1. `maxTokensField` — some providers need `max_completion_tokens`
2. `streamIdleTimeoutMs` — DeepSeek reasoning stalls 5min

Neither is the current tool bug.

---

## Effective Compat Per Route

### OpenCode Zen / deepseek-v4-flash-free

```
thinkingFormat: "openai"
reasoning_effort: "max"
requiresReasoningContentForToolCalls: true
allowsSyntheticReasoningContentForToolCalls: false
reasoningContentField: "reasoning_content"
extraBody: none
```

### OpenCode Zen / hy3-free

```
thinkingFormat: "openai"
reasoning_effort: "xhigh"
requiresReasoningContentForToolCalls: true
allowsSyntheticReasoningContentForToolCalls: false
reasoningContentField: "reasoning_content"
```

---

## State

| Field                        | Value        |
| ---------------------------- | ------------ |
| `DROPPED`                    | 0            |
| `PSEUDO_TOOL_AUTO_EXECUTION` | ZERO         |
| `TEST_COUNTS`                | 118 ALL PASS |
| `NEW_HEAD`                   | `932e4c6`    |
| `CLEAN_BUILD`                | exit 0       |
| `MAIN_USER_WIP_PRESERVED`    | YES          |

**Do NOT claim LIVE_VERIFIED.**
