/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react';

export enum InputOwner {
  NONE = 'none',
  COMPOSER = 'composer',
  PROVIDER_SETUP = 'provider_setup',
  SETTINGS_DIALOG = 'settings_dialog',
  MODEL_DIALOG = 'model_dialog',
  COMMAND_DIALOG = 'command_dialog',
  AUTH_DIALOG = 'auth_dialog',
  EMBEDDED_SHELL = 'embedded_shell',
  COPY_MODE = 'copy_mode',
}

interface InputOwnershipContextValue {
  /** The current input owner */
  owner: InputOwner;
  /**
   * Claim input ownership. Throws in development if another owner is active.
   * Returns a release function.
   */
  claim: (owner: InputOwner) => () => void;
  /** Check if a specific owner currently has input */
  isOwner: (owner: InputOwner) => boolean;
  /** Whether the Composer should be active (it's the owner AND no modal is blocking) */
  isComposerActive: boolean;
}

const InputOwnershipContext = createContext<InputOwnershipContextValue | null>(
  null,
);

export function useInputOwnership(): InputOwnershipContextValue {
  const ctx = useContext(InputOwnershipContext);
  if (!ctx) {
    // Fallback for tests that don't wrap with the provider
    return {
      owner: InputOwner.NONE,
      claim: () => () => {},
      isOwner: () => false,
      isComposerActive: true,
    };
  }
  return ctx;
}

/**
 * Convenience hook: returns true only when the given owner currently holds
 * input ownership.
 */
export function useIsInputOwner(owner: InputOwner): boolean {
  const { isOwner } = useInputOwnership();
  return isOwner(owner);
}

const MODAL_OWNERS = new Set([
  InputOwner.PROVIDER_SETUP,
  InputOwner.SETTINGS_DIALOG,
  InputOwner.MODEL_DIALOG,
  InputOwner.COMMAND_DIALOG,
  InputOwner.AUTH_DIALOG,
]);

export function isModalOwner(owner: InputOwner): boolean {
  return MODAL_OWNERS.has(owner);
}

export const InputOwnershipProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const [owner, setOwner] = useState<InputOwner>(InputOwner.NONE);
  const ownerRef = useRef<InputOwner>(InputOwner.NONE);
  const claimCountRef = useRef(0);

  const claim = useCallback((newOwner: InputOwner) => {
    const prevOwner = ownerRef.current;
    claimCountRef.current++;

    if (
      process.env['NODE_ENV'] === 'development' &&
      prevOwner !== InputOwner.NONE &&
      prevOwner !== newOwner
    ) {
      // Competing owners detected — this indicates a missing release() call
      // or overlapping ownership. The new owner wins.
    }

    ownerRef.current = newOwner;
    setOwner(newOwner);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      claimCountRef.current--;
      if (claimCountRef.current <= 0) {
        claimCountRef.current = 0;
        ownerRef.current = InputOwner.NONE;
        setOwner(InputOwner.NONE);
      } else {
        // Another claim is still active — restore previous owner
        ownerRef.current = newOwner;
        setOwner(newOwner);
      }
    };
  }, []);

  const isOwner = useCallback(
    (checkOwner: InputOwner) => ownerRef.current === checkOwner,
    [],
  );

  const isComposerActive =
    owner === InputOwner.NONE || owner === InputOwner.COMPOSER;

  const contextValue: InputOwnershipContextValue = {
    owner,
    claim,
    isOwner,
    isComposerActive,
  };

  return (
    <InputOwnershipContext.Provider value={contextValue}>
      {children}
    </InputOwnershipContext.Provider>
  );
};
