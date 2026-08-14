# PLUMB Production Source Provenance Record

## 1. Overview

This document records the strict source provenance and licensing validation for
the PLUMB production rebuild.

---

## 2. Baseline Sources & Verification

| Donor / Source   | Canonical Repository       | Verified Remote URL                               | Pinned Immutable SHA                       | License    | Verification Status |
| :--------------- | :------------------------- | :------------------------------------------------ | :----------------------------------------- | :--------- | :------------------ |
| **PLUMB**        | `google-gemini/gemini-cli` | `https://github.com/google-gemini/gemini-cli.git` | `dc859e8e48868ef5d1cc3b6708dbbdf3817cb9c9` | Apache-2.0 | `VERIFIED_CLEAN`    |
| **Qwen Code**    | `QwenLM/qwen-code`         | `https://github.com/QwenLM/qwen-code.git`         | `584f6a4bec686e641e48e0ba819ef9d308f9dccc` | Apache-2.0 | `VERIFIED_CLEAN`    |
| **Kesit Legacy** | `Omerfaruk-aydn/KES-T`     | `https://github.com/Omerfaruk-aydn/KES-T.git`     | `368da051e164341a5322ba4f5dc39fc08c9b578d` | Apache-2.0 | `VERIFIED_CLEAN`    |

---

## 3. License Compliance & Legal Protections

1. All baseline code utilized in PLUMB is strictly derived from verified
   open-source Apache-2.0 licensed repositories.
2. Copyright notices, LICENSE headers, and NOTICE files are preserved under
   `THIRD_PARTY_NOTICES.md` and `NOTICE`.
3. Forbidden source categories are strictly excluded:
   - No leaked code
   - No decompiled binaries
   - No reconstructed proprietary source
   - No unofficial/unverified mirrors
   - No FSL competing-use source (Crush)
   - No proprietary Anthropic Claude Code source

---

## 4. Single-Owner Architecture Principle

To eliminate runtime ambiguity and multiple raw-mode/terminal owners:

- **Ink/React Terminal Renderer**: Owned exclusively by PLUMB runtime.
- **Terminal Lifecycle & Raw Mode**: Owned exclusively by PLUMB.
- **Tool Execution & Session Management**: Owned exclusively by PLUMB core with
  Kesit security enforcement hooks.
- **Diff & Checkpoint Views**: Qwen Ink components imported as single-owner
  subviews within Gemini UI container.
