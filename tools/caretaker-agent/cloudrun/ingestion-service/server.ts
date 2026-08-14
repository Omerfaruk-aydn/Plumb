/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from './app.js';

const port = parseInt(process.env.PORT || '8080', 10);
app.listen(port, '0.0.0.0', () => {
  console.log(`Server listening on port ${port}`);
});
