/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { createContext, useContext } from 'react';

export const ShellFocusContext = createContext<boolean>(true);

export const useShellFocusState = () => useContext(ShellFocusContext);
