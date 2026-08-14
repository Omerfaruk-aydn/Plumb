# PLUMB Source Origin Policy

**Date**: 2026-08-14

## Header Policy

Every source file carries a single header:

```
/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */
```

## Classification Rules

1. **PLUMB_PRODUCT_IDENTITY** — Replace with PLUMB branding
2. **THIRD_PARTY_PACKAGE_REFERENCE** — Keep as-is (npm packages, external deps)
3. **LICENSE_OR_PROVENANCE** — Preserve and standardize
4. **COMPATIBILITY_MIGRATION** — Keep deprecated aliases with removal plan
5. **HISTORICAL_TEST_FIXTURE** — Keep in test data only
