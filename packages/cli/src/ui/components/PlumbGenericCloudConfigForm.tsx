/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Real production Ink configuration screen for the flat-schema cloud
 * providers (Bedrock, Vertex, watsonx) -- schema-driven from a
 * CloudProviderConfigSchema (see packages/provider/src/config/
 * cloudConfigSchema.ts) and a GenericCloudConfigActions instance (see
 * ../utils/genericCloudConfigActions.ts), so it never reimplements a
 * provider's field-visibility/validation rules itself. This is the exact
 * same interaction model as PlumbCloudProviderConfigForm (OCI's screen,
 * which stays separate because its IAM-subtype nested select and OCID
 * validation are genuinely bespoke) -- same navigation, same
 * save/cancel/remove/refresh/change-auth/clear-override semantics, same
 * secret masking -- so every flat-schema cloud provider gets identical UX
 * quality by construction, not by manual parity effort.
 */
import type React from 'react';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Box, Text } from 'ink';
import {
  getVisibleCloudFields,
  validateCloudConfig,
  type CloudProviderConfigSchema,
  type CloudConfigFormValues,
  type CloudConfigValidationErrors,
  type CloudConfigFieldDef,
} from '@google/gemini-cli-provider';
import { useKeypress, type Key } from '../hooks/useKeypress.js';
import { theme } from '../semantic-colors.js';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';
import type { GenericCloudConfigActions } from '../utils/genericCloudConfigActions.js';

export interface PlumbGenericCloudConfigFormProps {
  title: string;
  schema: CloudProviderConfigSchema;
  actions: GenericCloudConfigActions;
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
  | 'removing'
  | 'refreshing'
  | 'clearing-override';

const BASE_SUMMARY_ACTIONS = [
  { id: 'continue', label: 'Continue' },
  { id: 'edit', label: 'Edit configuration' },
  { id: 'change-auth', label: 'Change authentication' },
  { id: 'refresh', label: 'Refresh models/status' },
] as const;
const CLEAR_OVERRIDE_ACTION = {
  id: 'clear-override',
  label: 'Clear PLUMB override (use environment)',
} as const;
const TAIL_SUMMARY_ACTIONS = [
  { id: 'remove', label: 'Remove configuration' },
  { id: 'back', label: 'Back' },
] as const;

function isConfigured(
  schema: CloudProviderConfigSchema,
  values: CloudConfigFormValues,
): boolean {
  if (!schema.authModes.some((m) => m.id === values.authMode)) return false;
  const fields = getVisibleCloudFields(schema, values.authMode);
  for (const field of fields) {
    if (!field.required) continue;
    if (field.secret) {
      if (!values.hasExistingCredential) return false;
      continue;
    }
    const raw = values[field.id];
    if (typeof raw !== 'string' || !raw.trim()) return false;
  }
  return true;
}

export const PlumbGenericCloudConfigForm: React.FC<
  PlumbGenericCloudConfigFormProps
> = ({ title, schema, actions, onContinue, onCancel }) => {
  const [mode, setMode] = useState<Mode>('loading');
  const [values, setValues] = useState<CloudConfigFormValues>({
    authMode: '',
  });
  const [hasExistingCredential, setHasExistingCredential] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const [textBuffer, setTextBuffer] = useState('');
  const [errors, setErrors] = useState<CloudConfigValidationErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [sources, setSources] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const existing = await actions.load();
      if (cancelled) return;
      const cfg = existing.safeConfig;
      const authMode = cfg['authMode'] ?? '';
      const next: CloudConfigFormValues = {
        ...cfg,
        authMode,
        hasExistingCredential: existing.hasCredential,
      };
      setValues(next);
      setHasExistingCredential(existing.hasCredential);
      setSources(existing.sources ?? {});
      setFocusIndex(0);
      setMode(isConfigured(schema, next) ? 'summary' : 'browse');
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- actions/schema are stable per provider instance
  }, []);

  const visibleFields = useMemo(
    () => getVisibleCloudFields(schema, values.authMode),
    [schema, values.authMode],
  );

  const controls: Control[] = useMemo(() => {
    const list: Control[] = [{ id: 'authMode', kind: 'select' }];
    for (const field of visibleFields) {
      list.push({
        id: field.id,
        kind: field.secret
          ? 'secret'
          : field.type === 'select'
            ? 'select'
            : 'text',
        field,
      });
    }
    list.push({ id: 'save', kind: 'action' });
    list.push({ id: 'cancel', kind: 'action' });
    return list;
  }, [visibleFields]);

  useEffect(() => {
    if (mode === 'browse' && focusIndex >= controls.length) {
      setFocusIndex(Math.max(0, controls.length - 1));
    }
  }, [controls.length, focusIndex, mode]);

  const hasAnyOverride = Object.values(sources).some((s) => s === 'plumb');
  const summaryActions = useMemo(
    () => [
      ...BASE_SUMMARY_ACTIONS,
      ...(hasAnyOverride ? [CLEAR_OVERRIDE_ACTION] : []),
      ...TAIL_SUMMARY_ACTIONS,
    ],
    [hasAnyOverride],
  );

  const stateRef = useRef({
    mode,
    values,
    hasExistingCredential,
    focusIndex,
    textBuffer,
    controls,
    summaryActions,
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
    summaryActions,
    onContinue,
    onCancel,
  };

  const runSave = useCallback(async () => {
    const s = stateRef.current;
    setMode('saving');
    setSaveError(null);
    const result = await actions.save({
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
  }, [actions]);

  const runRemove = useCallback(async () => {
    setMode('removing');
    await actions.remove();
    setValues({ authMode: '' });
    setHasExistingCredential(false);
    setFocusIndex(0);
    setMode('browse');
  }, [actions]);

  const runRefresh = useCallback(async () => {
    setMode('refreshing');
    await actions.refresh();
    setMode('summary');
  }, [actions]);

  const runClearOverride = useCallback(async () => {
    setMode('clearing-override');
    await actions.clearOverrides();
    const existing = await actions.load();
    setValues((v) => ({ ...v, ...existing.safeConfig }));
    setSources(existing.sources ?? {});
    setMode('summary');
  }, [actions]);

  const handleKeypress = useCallback(
    (key: Key) => {
      const s = stateRef.current;
      if (
        s.mode === 'loading' ||
        s.mode === 'saving' ||
        s.mode === 'removing' ||
        s.mode === 'refreshing' ||
        s.mode === 'clearing-override'
      ) {
        return;
      }

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
          setFocusIndex((i) => Math.min(s.summaryActions.length - 1, i + 1));
          return;
        }
        if (key.name === 'enter') {
          const action = s.summaryActions[s.focusIndex]?.id;
          if (action === 'continue') {
            s.onContinue(undefined);
          } else if (action === 'edit') {
            const firstFieldIndex = s.controls.findIndex(
              (c) => c.kind === 'text' || c.kind === 'secret',
            );
            setFocusIndex(firstFieldIndex >= 0 ? firstFieldIndex : 0);
            setMode('browse');
          } else if (action === 'change-auth') {
            setFocusIndex(0);
            setMode('browse');
          } else if (action === 'refresh') {
            void runRefresh();
          } else if (action === 'clear-override') {
            void runClearOverride();
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
          const rawValue = s.values[control.id];
          const currentValue =
            control.kind === 'secret'
              ? ''
              : typeof rawValue === 'string'
                ? rawValue
                : '';
          setTextBuffer(currentValue);
          setMode('editing-text');
          return;
        }
        if (control.id === 'save') {
          const validation = validateCloudConfig(schema, {
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
    [runRemove, runRefresh, runClearOverride, runSave, schema],
  );

  useKeypress(handleKeypress, {
    isActive:
      mode !== 'loading' &&
      mode !== 'clearing-override' &&
      mode !== 'saving' &&
      mode !== 'removing' &&
      mode !== 'refreshing',
  });

  const getFieldValue = useCallback(
    (id: string): string => {
      const raw = values[id];
      return typeof raw === 'string' ? raw : '';
    },
    [values],
  );

  if (mode === 'loading') {
    return (
      <Box>
        <Text color={theme.text.secondary}>Loading configuration…</Text>
      </Box>
    );
  }

  const authLabel =
    schema.authModeField.options.find((o) => o.value === values.authMode)
      ?.label ?? '(not set)';

  if (
    mode === 'summary' ||
    mode === 'removing' ||
    mode === 'refreshing' ||
    mode === 'clearing-override'
  ) {
    const sourceLabel = (field: string): string =>
      sources[field] === 'plumb'
        ? ' (Source: PLUMB configuration)'
        : sources[field] === 'env'
          ? ' (Source: Environment)'
          : '';
    return (
      <Box flexDirection="column">
        <Text bold color={theme.text.primary}>
          {title}
        </Text>
        <Text color={theme.status.success}>Status: Configured</Text>
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.text.secondary}>{schema.authModeField.label}</Text>
          <Text color={theme.text.primary}> {authLabel}</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.text.secondary}>Configuration</Text>
          {visibleFields
            .filter((f) => !f.secret)
            .map((f) => (
              <Text key={f.id} color={theme.text.primary}>
                {' '}
                {f.label}: {getFieldValue(f.id) || '(not set)'}
                {sourceLabel(f.id)}
              </Text>
            ))}
        </Box>
        {visibleFields.some((f) => f.secret) && (
          <Box marginTop={1} flexDirection="column">
            <Text color={theme.text.secondary}>Credential</Text>
            <Text color={theme.text.primary}> API Key: Configured</Text>
          </Box>
        )}
        <Box marginTop={1} flexDirection="column">
          {mode === 'removing' ? (
            <Text color={theme.text.secondary}>Removing configuration…</Text>
          ) : mode === 'refreshing' ? (
            <Text color={theme.text.secondary}>Refreshing model status…</Text>
          ) : mode === 'clearing-override' ? (
            <Text color={theme.text.secondary}>Clearing PLUMB override…</Text>
          ) : (
            summaryActions.map((action, i) => (
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
      if (isFocused && mode === 'browse') {
        return (
          <Box flexDirection="column" key={control.id}>
            <Text color={theme.text.primary}>{schema.authModeField.label}</Text>
            <RadioButtonSelect
              items={schema.authModeField.options.map((o) => ({
                key: o.value,
                value: o.value,
                label: o.label,
              }))}
              initialIndex={Math.max(
                0,
                schema.authModeField.options.findIndex(
                  (o) => o.value === values.authMode,
                ),
              )}
              isFocused
              onSelect={(value) => {
                setValues((v) => ({ ...v, authMode: value }));
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
          {isFocused ? '> ' : '  '}
          {schema.authModeField.label}: {authLabel}
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
    const error = errors[control.id];
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
        {title} — Configure
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.text.secondary}>{schema.authModeField.label}</Text>
        {renderFieldRow(controls[0], focusIndex === 0)}
      </Box>
      {visibleFields.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.text.secondary}>Configuration</Text>
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
