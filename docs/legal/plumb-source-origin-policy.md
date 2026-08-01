# PLUMB Source Origin Policy

**Date**: 2026-07-31

## Upstream Sources

### Google Gemini CLI (Apache-2.0)

- **Repository**: https://github.com/google-gemini/gemini-cli.git
- **Foundation commit**: dc859e8 (chore/release: bump version to
  0.55.0-nightly.20260729.g3499c84f7)
- **License**: Apache-2.0
- **Copyright**: Copyright 2025 Google LLC

### OMP / Oh My Pi (MIT)

- **Repository**: D:\PLUMB-upstreams\oh-my-pi
- **Pinned commit**: 4df68d60438423b384b2b47fb3d6835641624757
- **License**: MIT
- **Copyright**: Mario Zechner, Can Bölük

## Header Policy

### PLUMB-original files

```
/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */
```

### Gemini-derived Apache-2.0 files

```
/**
 * Copyright 2025 Google LLC
 * Modifications Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Modified by PLUMB. See NOTICE and THIRD_PARTY_NOTICES.md.
 */
```

### OMP-derived MIT files

```
/**
 * Portions Copyright (c) 2025 Mario Zechner
 * Portions Copyright (c) 2025-2026 Can Bölük
 * Modifications Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: MIT
 *
 * Adapted for PLUMB. See THIRD_PARTY_NOTICES.md.
 */
```

## Classification Rules

1. **PLUMB_PRODUCT_IDENTITY** — Replace with PLUMB branding
2. **GOOGLE_GEMINI_PROVIDER_TECHNICAL** — Keep accurate provider/protocol terms
3. **THIRD_PARTY_PACKAGE_REFERENCE** — Keep as-is (npm packages, external deps)
4. **LICENSE_OR_PROVENANCE** — Preserve and standardize
5. **COMPATIBILITY_MIGRATION** — Keep deprecated aliases with removal plan
6. **HISTORICAL_TEST_FIXTURE** — Keep in test data only
