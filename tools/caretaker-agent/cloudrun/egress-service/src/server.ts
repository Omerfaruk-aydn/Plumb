/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from './app.js';

const port = process.env.PORT || 8080;

app.listen(port, () => {
  console.log(`Egress service listening on port ${port}`);
});
