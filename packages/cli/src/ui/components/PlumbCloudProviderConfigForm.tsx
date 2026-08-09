/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Real production Ink configuration screen for OCI Generative AI --
 * renders OCI_GENAI_CONFIG_SCHEMA's fields via getVisibleOciFields(),
 * validates/saves through validateOciConfig/ociCloudConfigActions. React
 * owns rendering/keyboard orchestration only; every rule about which
 * fields are visible, what's required, and how to split safe-config/secret
 * comes from the provider-package domain layer -- never reimplemented
 * here.
 *
 * All per-render state (mode/values/focusIndex/etc.) is mirrored into a
 * ref every render, and the single useKeypress handler reads exclusively
 * from that ref. This component re-renders on every keystroke (textBuffer
 * updates per character); a fresh handler closure passed to useKeypress
 * every render would force it to unsubscribe+resubscribe every render,
 * which is real subscription churn -- keeping the handler referentially
 * stable avoids it entirely.
 */
import type React from 'react';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Box, Text } from 'ink';
import {
  OCI_GENAI_CONFIG_SCHEMA,
  getVisibleOciFields,
  validateOciConfig,
  type OciConfigFormValues,
  type OciConfigValidationErrors,
  type CloudConfigFieldDef,
} from '@google/gemini-cli-provider';
import { useKeypress, type Key } from '../hooks/useKeypress.js';
import { theme } from '../semantic-colors.js';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';
import {
  saveOciConfiguration,
  loadOciExistingConfig,
  removeOciConfiguration,
} from '../utils/ociCloudConfigActions.js';

export interface PlumbCloudProviderConfigFormProps {
  onContinue: (modelHint?: string) => void;
  onCancel: () => void;
}

type ControlKind = 'select' | 'text' | 'secret' | 'action';

interface Control {
  id: string;
  kind: ControlKind;
  field?: CloudConfigFieldDef;
}

type Mode =
  | 'loading'
  | 'summary'
  | 'browse'
  | 'editing-text'
  | 'saving'
  | 'removing';

const AUTH_MODE_OPTIONS = OCI_GENAI_CONFIG_SCHEMA.authModeField.options;
const IAM_SUBTYPE_FIELD = OCI_GENAI_CONFIG_SCHEMA.authModes
  .find((m) => m.id === 'iam')!
  .fields.find((f) => f.id === 'iamAuthMode')!;

const SUMMARY_ACTIONS = [
  { id: 'continue', label: 'Continue' },
  { id: 'edit', label: 'Edit configuration' },
  { id: 'remove', label: 'Remove configuration' },
  { id: 'back', label: 'Back' },
] as const;

const EMPTY_VALUES: OciConfigFormValues = { authMode: '' };

const STRING_FIELD_IDS = [
  'region',
  'projectId',
  'compartmentId',
  'iamConfigPath',
  'iamConfigProfile',
  'credential',
] as const;
type StringFieldId = (typeof STRING_FIELD_IDS)[number];

function isStringFieldId(id: string): id is StringFieldId {
  return (STRING_FIELD_IDS as readonly string[]).includes(id);
}

function getStringFieldValue(values: OciConfigFormValues, id: string): string {
  return isStringFieldId(id) ? (values[id] ?? '') : '';
}

function getFieldError(
  errors: OciConfigValidationErrors,
  id: string,
): string | undefined {
  switch (id) {
    case 'authMode':
    case 'iamAuthMode':
    case 'region':
    case 'projectId':
    case 'compartmentId':
    case 'iamConfigPath':
    case 'iamConfigProfile':
    case 'credential':
      return errors[id];
    default:
      return undefined;
  }
}

function isConfigured(values: OciConfigFormValues): boolean {
  if (values.authMode !== 'api_key' && values.authMode !== 'iam') return false;
  if (!values.region?.trim() || !values.projectId?.trim()) return false;
  if (values.authMode === 'api_key') return !!values.hasExistingCredential;
  return !!values.iamAuthMode;
}

export const PlumbCloudProviderConfigForm: React.FC<
  PlumbCloudProviderConfigFormProps
> = ({ onContinue, onCancel }) => {
  const [mode, setMode] = useState<Mode>('loading');
  const [values, setValues] = useState<OciConfigFormValues>(EMPTY_VALUES);
  const [hasExistingCredential, setHasExistingCredential] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const [textBuffer, setTextBuffer] = useState('');
  const [errors, setErrors] = useState<OciConfigValidationErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  // Load persisted safe config + credential presence exactly once, on
  // mount -- never on every render, and never a bare network/keychain call
  // triggered merely by highlighting/navigation.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const existing = await loadOciExistingConfig();
      if (cancelled) return;
      const cfg = existing.safeConfig;
      const authMode: OciConfigFormValues['authMode'] = cfg['iamAuthMode']
        ? 'iam'
        : Object.keys(cfg).length > 0 || existing.hasCredential
          ? 'api_key'
          : '';
      const next: OciConfigFormValues = {
        authMode,
        iamAuthMode: cfg['iamAuthMode'],
        region: cfg['region'],
        projectId: cfg['projectId'],
        compartmentId: cfg['compartmentId'],
        iamConfigPath: cfg['iamConfigPath'],
        iamConfigProfile: cfg['iamConfigProfile'],
        hasExistingCredential: existing.hasCredential,
      };
      setValues(next);
      setHasExistingCredential(existing.hasCredential);
      setFocusIndex(0);
      setMode(isConfigured(next) ? 'summary' : 'browse');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleFields = useMemo(() => {
    if (values.authMode !== 'api_key' && values.authMode !== 'iam') return [];
    return getVisibleOciFields(values.authMode, values.iamAuthMode).filter(
      (f) => f.id !== 'iamAuthMode',
    );
  }, [values.authMode, values.iamAuthMode]);

  const controls: Control[] = useMemo(() => {
    const list: Control[] = [{ id: 'authMode', kind: 'select' }];
    if (values.authMode === 'iam') {
      list.push({ id: 'iamAuthMode', kind: 'select' });
    }
    for (const field of visibleFields) {
      list.push({
        id: field.id,
        kind: field.secret ? 'secret' : 'text',
        field,
      });
    }
    list.push({ id: 'save', kind: 'action' });
    list.push({ id: 'cancel', kind: 'action' });
    return list;
  }, [values.authMode, visibleFields]);

  useEffect(() => {
    if (mode === 'browse' && focusIndex >= controls.length) {
      setFocusIndex(Math.max(0, controls.length - 1));
    }
  }, [controls.length, focusIndex, mode]);

  // Mirrors every per-render value the keypress handler / save / remove
  // actions need, so those callbacks can stay referentially stable (see
  // module doc) instead of closing over state directly.
  const stateRef = useRef({
    mode,
    values,
    hasExistingCredential,
    focusIndex,
    textBuffer,
    controls,
    onContinue,
    onCancel,
  });
  stateRef.current = {
    mode,
    values,
    hasExistingCredential,
    focusIndex,
    textBuffer,
    controls,
    onContinue,
    onCancel,
  };

  const runSave = useCallback(async () => {
    const s = stateRef.current;
    setMode('saving');
    setSaveError(null);
    const result = await saveOciConfiguration({
      ...s.values,
      hasExistingCredential: s.hasExistingCredential,
    });
    if (result.success) {
      s.onContinue(undefined);
      return;
    }
    setErrors(result.fieldErrors ?? {});
    setSaveError(result.error ?? 'Failed to save configuration.');
    setMode('browse');
  }, []);

  const runRemove = useCallback(async () => {
    setMode('removing');
    await removeOciConfiguration();
    setValues(EMPTY_VALUES);
    setHasExistingCredential(false);
    setFocusIndex(0);
    setMode('browse');
  }, []);

  const handleKeypress = useCallback(
    (key: Key) => {
      const s = stateRef.current;
      if (
        s.mode === 'loading' ||
        s.mode === 'saving' ||
        s.mode === 'removing'
      ) {
        return;
      }

      // The focused control's own RadioButtonSelect (always mounted while
      // focused -- see renderFieldRow) owns up/down/return for select-kind
      // controls entirely; this handler must not also process those keys,
      // or they would double-fire.
      if (s.mode === 'browse' && s.controls[s.focusIndex]?.kind === 'select') {
        if (key.name === 'escape') {
          s.onCancel();
        }
        return;
      }

      if (s.mode === 'summary') {
        if (key.name === 'escape') {
          s.onCancel();
          return;
        }
        if (key.name === 'up') {
          setFocusIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (key.name === 'down') {
          setFocusIndex((i) => Math.min(SUMMARY_ACTIONS.length - 1, i + 1));
          return;
        }
        if (key.name === 'enter') {
          const action = SUMMARY_ACTIONS[s.focusIndex].id;
          if (action === 'continue') {
            s.onContinue(undefined);
          } else if (action === 'edit') {
            setFocusIndex(0);
            setMode('browse');
          } else if (action === 'remove') {
            void runRemove();
          } else {
            s.onCancel();
          }
          return;
        }
        return;
      }

      if (s.mode === 'editing-text') {
        if (key.name === 'enter') {
          const id = s.controls[s.focusIndex].id;
          setValues((v) => ({ ...v, [id]: s.textBuffer }));
          setMode('browse');
          setFocusIndex((i) => Math.min(i + 1, s.controls.length - 1));
          return;
        }
        if (key.name === 'escape') {
          setMode('browse');
          return;
        }
        if (key.name === 'backspace') {
          setTextBuffer((b) => b.slice(0, -1));
          return;
        }
        if (
          key.name === 'up' ||
          key.name === 'down' ||
          key.name === 'left' ||
          key.name === 'right' ||
          key.name === 'tab'
        ) {
          return;
        }
        if (key.sequence && !key.ctrl && !key.alt) {
          setTextBuffer((b) => b + key.sequence);
        }
        return;
      }

      // mode === 'browse'
      if (key.name === 'escape') {
        s.onCancel();
        return;
      }
      if (key.name === 'up') {
        setFocusIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.name === 'down') {
        setFocusIndex((i) => Math.min(s.controls.length - 1, i + 1));
        return;
      }
      if (key.name === 'enter') {
        const control = s.controls[s.focusIndex];
        if (!control) return;
        if (control.kind === 'text' || control.kind === 'secret') {
          const currentValue =
            control.kind === 'secret'
              ? ''
              : getStringFieldValue(s.values, control.id);
          setTextBuffer(currentValue);
          setMode('editing-text');
          return;
        }
        if (control.id === 'save') {
          const validation = validateOciConfig({
            ...s.values,
            hasExistingCredential: s.hasExistingCredential,
          });
          if (Object.keys(validation).length > 0) {
            setErrors(validation);
            return;
          }
          void runSave();
          return;
        }
        if (control.id === 'cancel') {
          s.onCancel();
          return;
        }
      }
    },
    [runRemove, runSave],
  );

  useKeypress(handleKeypress, {
    isActive: mode !== 'loading' && mode !== 'saving' && mode !== 'removing',
  });

  const getFieldValue = useCallback(
    (id: string): string => getStringFieldValue(values, id),
    [values],
  );

  if (mode === 'loading') {
    return (
      <Box>
        <Text color={theme.text.secondary}>Loading configuration…</Text>
      </Box>
    );
  }

  if (mode === 'summary' || mode === 'removing') {
    const authLabel =
      values.authMode === 'iam'
        ? `OCI IAM — ${IAM_SUBTYPE_FIELD.options!.find((o) => o.value === values.iamAuthMode)?.label ?? values.iamAuthMode}`
        : 'Generative AI API Key';
    return (
      <Box flexDirection="column">
        <Text bold color={theme.text.primary}>
          Oracle OCI Generative AI
        </Text>
        <Text color={theme.status.success}>Status: Configured</Text>
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.text.secondary}>Authentication</Text>
          <Text color={theme.text.primary}> {authLabel}</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.text.secondary}>Cloud Context</Text>
          <Text color={theme.text.primary}> Region: {values.region}</Text>
          <Text color={theme.text.primary}> Project: {values.projectId}</Text>
          {values.compartmentId && (
            <Text color={theme.text.primary}>
              {'  '}Compartment: {values.compartmentId}
            </Text>
          )}
        </Box>
        {values.authMode === 'api_key' && (
          <Box marginTop={1} flexDirection="column">
            <Text color={theme.text.secondary}>Credential</Text>
            <Text color={theme.text.primary}> API Key: Configured</Text>
          </Box>
        )}
        <Box marginTop={1} flexDirection="column">
          {mode === 'removing' ? (
            <Text color={theme.text.secondary}>Removing configuration…</Text>
          ) : (
            SUMMARY_ACTIONS.map((action, i) => (
              <Text
                key={action.id}
                color={
                  focusIndex === i ? theme.text.accent : theme.text.primary
                }
              >
                {focusIndex === i ? '> ' : '  '}
                {action.label}
              </Text>
            ))
          )}
        </Box>
        <Box marginTop={1}>
          <Text color={theme.text.secondary}>
            ↑↓ navigate • Enter select • Esc back
          </Text>
        </Box>
      </Box>
    );
  }

  const renderFieldRow = (control: Control, isFocused: boolean) => {
    if (control.id === 'authMode') {
      const label =
        AUTH_MODE_OPTIONS.find((o) => o.value === values.authMode)?.label ??
        '(not set)';
      if (isFocused && mode === 'browse') {
        return (
          <Box flexDirection="column" key={control.id}>
            <Text color={theme.text.primary}>Authentication</Text>
            <RadioButtonSelect
              items={AUTH_MODE_OPTIONS.map((o) => ({
                key: o.value,
                value: o.value,
                label: o.label,
              }))}
              initialIndex={Math.max(
                0,
                AUTH_MODE_OPTIONS.findIndex((o) => o.value === values.authMode),
              )}
              isFocused
              onSelect={(value) => {
                setValues((v) => ({
                  ...v,
                  authMode: value === 'iam' ? 'iam' : 'api_key',
                }));
                setFocusIndex(1);
              }}
            />
          </Box>
        );
      }
      return (
        <Text
          key={control.id}
          color={isFocused ? theme.text.accent : theme.text.primary}
        >
          {isFocused ? '> ' : '  '}Authentication: {label}
        </Text>
      );
    }
    if (control.id === 'iamAuthMode') {
      const label =
        IAM_SUBTYPE_FIELD.options!.find((o) => o.value === values.iamAuthMode)
          ?.label ?? '(not set)';
      if (isFocused && mode === 'browse') {
        return (
          <Box flexDirection="column" key={control.id}>
            <Text color={theme.text.primary}>IAM Subtype</Text>
            <RadioButtonSelect
              items={IAM_SUBTYPE_FIELD.options!.map((o) => ({
                key: o.value,
                value: o.value,
                label: o.label,
              }))}
              initialIndex={Math.max(
                0,
                IAM_SUBTYPE_FIELD.options!.findIndex(
                  (o) => o.value === values.iamAuthMode,
                ),
              )}
              isFocused
              onSelect={(value) => {
                setValues((v) => ({ ...v, iamAuthMode: value }));
                setFocusIndex((i) => Math.min(i + 1, controls.length - 1));
              }}
            />
          </Box>
        );
      }
      return (
        <Text
          key={control.id}
          color={isFocused ? theme.text.accent : theme.text.primary}
        >
          {isFocused ? '> ' : '  '}IAM Subtype: {label}
        </Text>
      );
    }
    const field = control.field!;
    const isEditingThis = isFocused && mode === 'editing-text';
    if (field.secret) {
      const display = isEditingThis
        ? '•'.repeat(textBuffer.length)
        : hasExistingCredential
          ? 'Configured (Enter to replace)'
          : '(not set)';
      return (
        <Text
          key={control.id}
          color={isFocused ? theme.text.accent : theme.text.primary}
        >
          {isFocused ? '> ' : '  '}
          {field.label}: {display}
        </Text>
      );
    }
    const value = isEditingThis ? textBuffer : getFieldValue(control.id);
    const error = getFieldError(errors, control.id);
    return (
      <Box flexDirection="column" key={control.id}>
        <Text color={isFocused ? theme.text.accent : theme.text.primary}>
          {isFocused ? '> ' : '  '}
          {field.label}: {value || '(not set)'}
          {isEditingThis ? '█' : ''}
        </Text>
        {error && <Text color={theme.status.error}> {error}</Text>}
      </Box>
    );
  };

  return (
    <Box flexDirection="column">
      <Text bold color={theme.text.primary}>
        Oracle OCI Generative AI — Configure
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.text.secondary}>Authentication</Text>
        {renderFieldRow(controls[0], focusIndex === 0)}
        {values.authMode === 'iam' &&
          renderFieldRow(controls[1], focusIndex === 1)}
      </Box>
      {visibleFields.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.text.secondary}>Cloud Context / Credential</Text>
          {controls
            .filter((c) => c.kind === 'text' || c.kind === 'secret')
            .map((c) => renderFieldRow(c, controls[focusIndex] === c))}
        </Box>
      )}
      <Box marginTop={1} flexDirection="column">
        {saveError && <Text color={theme.status.error}>{saveError}</Text>}
        <Text
          color={
            controls[focusIndex]?.id === 'save'
              ? theme.text.accent
              : theme.text.primary
          }
        >
          {controls[focusIndex]?.id === 'save' ? '> ' : '  '}
          {mode === 'saving' ? 'Saving…' : 'Save'}
        </Text>
        <Text
          color={
            controls[focusIndex]?.id === 'cancel'
              ? theme.text.accent
              : theme.text.primary
          }
        >
          {controls[focusIndex]?.id === 'cancel' ? '> ' : '  '}Cancel
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.text.secondary}>
          ↑↓ navigate • Enter select/edit • Esc back/cancel
        </Text>
      </Box>
    </Box>
  );
};
