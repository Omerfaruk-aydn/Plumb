/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { createContext, useContext } from 'react';
import type { QuotaStats } from '../types.js';
import type { UserTierId } from '@plumb/core';
import type {
  ProQuotaDialogRequest,
  ValidationDialogRequest,
  OverageMenuDialogRequest,
  EmptyWalletDialogRequest,
} from './UIStateContext.js';

export interface QuotaState {
  userTier?: UserTierId;
  stats?: QuotaStats;
  proQuotaRequest?: ProQuotaDialogRequest | null;
  validationRequest?: ValidationDialogRequest | null;
  overageMenuRequest?: OverageMenuDialogRequest | null;
  emptyWalletRequest?: EmptyWalletDialogRequest | null;
}

export const QuotaContext = createContext<QuotaState | null>(null);

export const useQuotaState = () => {
  const context = useContext(QuotaContext);
  if (!context) {
    throw new Error('useQuotaState must be used within a QuotaProvider');
  }
  return context;
};
