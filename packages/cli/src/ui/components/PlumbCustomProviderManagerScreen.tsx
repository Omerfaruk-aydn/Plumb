/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import type {
  CustomProviderDefinition,
  CustomProviderDialect,
  CustomCredentialPlacement,
  CustomProviderValidationErrors,
} from '@plumb/provider';
import { useKeypress, type Key } from '../hooks/useKeypress.js';
import { theme } from '../semantic-colors.js';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';
import type { CustomProviderConfigActions } from '../utils/customProviderConfigActions.js';
import {
  formatManualModelsText,
  formatSafeHeadersText,
  parseManualModelsText,
  parseSafeHeadersText,
} from '../utils/customProviderFormEncoding.js';

export interface PlumbCustomProviderManagerScreenProps {
  actions: CustomProviderConfigActions;
  onClose: () => void;
}

const DIALECT_OPTIONS: Array<{ value: CustomProviderDialect; label: string }> =
  [
    { value: 'openai-completions', label: 'OpenAI-compatible' },
    { value: 'anthropic-messages', label: 'Anthropic-compatible' },
    { value: 'google-generative-ai', label: 'Gemini-compatible' },
  ];

function placementOptionsFor(
  dialect: CustomProviderDialect,
): Array<{ value: CustomCredentialPlacement; label: string }> {
  const base: Array<{ value: CustomCredentialPlacement; label: string }> = [
    { value: 'none', label: 'No credential' },
    { value: 'bearer', label: 'Bearer (Authorization header)' },
    { value: 'x-api-key', label: 'x-api-key header' },
    { value: 'api-key', label: 'api-key header' },
  ];
  if (dialect === 'google-generative-ai') {
    base.push({ value: 'query-key', label: 'Query parameter (?key=)' });
  }
  return base;
}

interface FormState {
  id?: string;
  displayName: string;
  dialect: CustomProviderDialect;
  baseUrl: string;
  credentialPlacement: CustomCredentialPlacement;
  apiKey: string;
  hasExistingCredential: boolean;
  safeHeadersText: string;
  manualModelsText: string;
}

function emptyForm(): FormState {
  return {
    displayName: '',
    dialect: 'openai-completions',
    baseUrl: '',
    credentialPlacement: 'bearer',
    apiKey: '',
    hasExistingCredential: false,
    safeHeadersText: '',
    manualModelsText: '',
  };
}

function formFromDefinition(
  definition: CustomProviderDefinition,
  hasExistingCredential: boolean,
): FormState {
  return {
    id: definition.id,
    displayName: definition.displayName,
    dialect: definition.dialect,
    baseUrl: definition.baseUrl,
    credentialPlacement: definition.credentialPlacement,
    apiKey: '',
    hasExistingCredential,
    safeHeadersText: formatSafeHeadersText(definition.safeHeaders),
    manualModelsText: formatManualModelsText(definition.manualModels),
  };
}

type FieldId =
  | 'displayName'
  | 'dialect'
  | 'baseUrl'
  | 'credentialPlacement'
  | 'apiKey'
  | 'safeHeaders'
  | 'manualModels'
  | 'save'
  | 'cancel';

const FIELD_ORDER: FieldId[] = [
  'displayName',
  'dialect',
  'baseUrl',
  'credentialPlacement',
  'apiKey',
  'safeHeaders',
  'manualModels',
  'save',
  'cancel',
];

type Mode =
  | 'loading'
  | 'list'
  | 'form-browse'
  | 'form-editing-text'
  | 'form-saving'
  | 'deleting';

export const PlumbCustomProviderManagerScreen: React.FC<
  PlumbCustomProviderManagerScreenProps
> = ({ actions, onClose }) => {
  const [mode, setMode] = useState<Mode>('loading');
  const [definitions, setDefinitions] = useState<CustomProviderDefinition[]>(
    [],
  );
  const [listIndex, setListIndex] = useState(0);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [focusIndex, setFocusIndex] = useState(0);
  const [textBuffer, setTextBuffer] = useState('');
  const [errors, setErrors] = useState<CustomProviderValidationErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const list = await actions.list();
    setDefinitions(list);
    return list;
  }, [actions]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await reload();
      if (cancelled) return;
      setListIndex(0);
      setMode('list');
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const listItems = useMemo(
    () => [
      ...definitions.map((d) => ({
        key: d.id,
        label: `${d.displayName} — ${d.dialect} — ${d.baseUrl}`,
      })),
      { key: '__add__', label: '+ Add custom provider' },
      { key: '__back__', label: 'Back' },
    ],
    [definitions],
  );

  const openCreate = useCallback(() => {
    setForm(emptyForm());
    setErrors({});
    setSaveError(null);
    setFocusIndex(0);
    setMode('form-browse');
  }, []);

  const openEdit = useCallback(
    async (definition: CustomProviderDefinition) => {
      const hasExistingCredential = await actions.hasCredential(definition.id);
      setForm(formFromDefinition(definition, hasExistingCredential));
      setErrors({});
      setSaveError(null);
      setFocusIndex(0);
      setMode('form-browse');
    },
    [actions],
  );

  const runDelete = useCallback(
    async (providerId: string) => {
      setMode('deleting');
      await actions.remove(providerId);
      const list = await reload();
      setListIndex((i) => Math.min(i, Math.max(0, list.length)));
      setStatusMessage('Removed.');
      setMode('list');
    },
    [actions, reload],
  );

  const runSave = useCallback(async () => {
    setMode('form-saving');
    setSaveError(null);
    const result = await actions.save(
      {
        id: form.id,
        displayName: form.displayName,
        dialect: form.dialect,
        baseUrl: form.baseUrl,
        credentialPlacement: form.credentialPlacement,
        safeHeaders: parseSafeHeadersText(form.safeHeadersText),
        manualModels: parseManualModelsText(form.manualModelsText),
      },
      form.apiKey || undefined,
    );
    if (!result.success) {
      setErrors(result.fieldErrors ?? {});
      setSaveError(result.error ?? 'Failed to save custom provider.');
      setMode('form-browse');
      return;
    }
    await reload();
    setStatusMessage(form.id ? 'Updated.' : 'Created.');
    setMode('list');
  }, [actions, form, reload]);

  const handleKeypress = useCallback(
    (key: Key) => {
      if (mode === 'loading' || mode === 'form-saving' || mode === 'deleting') {
        return;
      }
      setStatusMessage(null);

      if (mode === 'list') {
        if (key.name === 'escape') {
          onClose();
          return;
        }
        if (key.name === 'up') {
          setListIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (key.name === 'down') {
          setListIndex((i) => Math.min(listItems.length - 1, i + 1));
          return;
        }
        if (key.sequence === 'd' && listIndex < definitions.length) {
          void runDelete(definitions[listIndex].id);
          return;
        }
        if (key.name === 'enter') {
          const item = listItems[listIndex];
          if (item.key === '__add__') {
            openCreate();
          } else if (item.key === '__back__') {
            onClose();
          } else {
            void openEdit(definitions[listIndex]);
          }
        }
        return;
      }

      // Form modes below.
      if (mode === 'form-editing-text') {
        if (key.name === 'enter') {
          const id = FIELD_ORDER[focusIndex];
          setForm((f) => ({ ...f, [textFieldKey(id)]: textBuffer }));
          setMode('form-browse');
          setFocusIndex((i) => Math.min(i + 1, FIELD_ORDER.length - 1));
          return;
        }
        if (key.name === 'escape') {
          setMode('form-browse');
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

      // mode === 'form-browse'
      if (key.name === 'escape') {
        setMode('list');
        return;
      }
      const currentField = FIELD_ORDER[focusIndex];
      if (
        key.name === 'up' &&
        currentField !== 'dialect' &&
        currentField !== 'credentialPlacement'
      ) {
        setFocusIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (
        key.name === 'down' &&
        currentField !== 'dialect' &&
        currentField !== 'credentialPlacement'
      ) {
        setFocusIndex((i) => Math.min(FIELD_ORDER.length - 1, i + 1));
        return;
      }
      if (key.name === 'enter') {
        if (currentField === 'displayName' || currentField === 'baseUrl') {
          setTextBuffer(form[currentField]);
          setMode('form-editing-text');
          return;
        }
        if (currentField === 'apiKey') {
          setTextBuffer('');
          setMode('form-editing-text');
          return;
        }
        if (currentField === 'safeHeaders') {
          setTextBuffer(form.safeHeadersText);
          setMode('form-editing-text');
          return;
        }
        if (currentField === 'manualModels') {
          setTextBuffer(form.manualModelsText);
          setMode('form-editing-text');
          return;
        }
        if (currentField === 'save') {
          void runSave();
          return;
        }
        if (currentField === 'cancel') {
          setMode('list');
          return;
        }
      }
    },
    [
      mode,
      listItems,
      listIndex,
      definitions,
      focusIndex,
      textBuffer,
      form,
      onClose,
      openCreate,
      openEdit,
      runDelete,
      runSave,
    ],
  );

  useKeypress(handleKeypress, {
    isActive:
      mode !== 'loading' && mode !== 'form-saving' && mode !== 'deleting',
  });

  if (mode === 'loading') {
    return (
      <Box>
        <Text color={theme.text.secondary}>Loading custom providers…</Text>
      </Box>
    );
  }

  if (mode === 'list' || mode === 'deleting') {
    return (
      <Box flexDirection="column">
        <Text bold color={theme.text.primary}>
          Custom Providers
        </Text>
        {statusMessage && (
          <Text color={theme.status.success}>{statusMessage}</Text>
        )}
        <Box marginTop={1} flexDirection="column">
          {mode === 'deleting' ? (
            <Text color={theme.text.secondary}>Removing…</Text>
          ) : (
            listItems.map((item, i) => (
              <Text
                key={item.key}
                color={listIndex === i ? theme.text.accent : theme.text.primary}
              >
                {listIndex === i ? '> ' : '  '}
                {item.label}
              </Text>
            ))
          )}
        </Box>
        <Box marginTop={1}>
          <Text color={theme.text.secondary}>
            ↑↓ navigate • Enter open • d delete • Esc back
          </Text>
        </Box>
      </Box>
    );
  }

  // Form modes.
  const isEditingThis = (id: FieldId) =>
    mode === 'form-editing-text' && FIELD_ORDER[focusIndex] === id;

  const renderRow = (id: FieldId): React.ReactNode => {
    const isFocused = FIELD_ORDER[focusIndex] === id && mode === 'form-browse';
    if (id === 'dialect') {
      if (isFocused) {
        return (
          <Box flexDirection="column" key={id}>
            <Text color={theme.text.primary}>Dialect</Text>
            <RadioButtonSelect
              items={DIALECT_OPTIONS.map((o) => ({
                key: o.value,
                value: o.value,
                label: o.label,
              }))}
              initialIndex={Math.max(
                0,
                DIALECT_OPTIONS.findIndex((o) => o.value === form.dialect),
              )}
              isFocused
              onSelect={(value) => {
                setForm((f) => ({
                  ...f,
                  dialect: value,
                  credentialPlacement:
                    value === 'anthropic-messages'
                      ? 'x-api-key'
                      : value === 'google-generative-ai'
                        ? 'query-key'
                        : 'bearer',
                }));
                setFocusIndex((i) => i + 1);
              }}
            />
          </Box>
        );
      }
      return (
        <Text key={id} color={theme.text.primary}>
          {'  '}Dialect:{' '}
          {DIALECT_OPTIONS.find((o) => o.value === form.dialect)?.label}
        </Text>
      );
    }
    if (id === 'credentialPlacement') {
      const options = placementOptionsFor(form.dialect);
      if (isFocused) {
        return (
          <Box flexDirection="column" key={id}>
            <Text color={theme.text.primary}>Credential placement</Text>
            <RadioButtonSelect
              items={options.map((o) => ({
                key: o.value,
                value: o.value,
                label: o.label,
              }))}
              initialIndex={Math.max(
                0,
                options.findIndex((o) => o.value === form.credentialPlacement),
              )}
              isFocused
              onSelect={(value) => {
                setForm((f) => ({ ...f, credentialPlacement: value }));
                setFocusIndex((i) => i + 1);
              }}
            />
          </Box>
        );
      }
      return (
        <Text key={id} color={theme.text.primary}>
          {'  '}Credential placement:{' '}
          {options.find((o) => o.value === form.credentialPlacement)?.label}
        </Text>
      );
    }
    if (id === 'apiKey') {
      const display = isEditingThis(id)
        ? '•'.repeat(textBuffer.length)
        : form.hasExistingCredential
          ? 'Configured (Enter to replace)'
          : '(not set)';
      return (
        <Text
          key={id}
          color={isFocused ? theme.text.accent : theme.text.primary}
        >
          {isFocused ? '> ' : '  '}API key: {display}
        </Text>
      );
    }
    if (id === 'save' || id === 'cancel') {
      return (
        <Text
          key={id}
          color={isFocused ? theme.text.accent : theme.text.primary}
        >
          {isFocused ? '> ' : '  '}
          {id === 'save'
            ? mode === 'form-saving'
              ? 'Saving…'
              : 'Save'
            : 'Cancel'}
        </Text>
      );
    }
    const labels: Record<string, string> = {
      displayName: 'Name',
      baseUrl: 'Base URL',
      safeHeaders: 'Safe headers (Name: value, …)',
      manualModels: 'Manual models (comma-separated)',
    };
    const value = isEditingThis(id)
      ? textBuffer
      : id === 'safeHeaders'
        ? form.safeHeadersText
        : id === 'manualModels'
          ? form.manualModelsText
          : form[id];
    const error = errors[id];
    return (
      <Box flexDirection="column" key={id}>
        <Text color={isFocused ? theme.text.accent : theme.text.primary}>
          {isFocused ? '> ' : '  '}
          {labels[id]}: {value || '(not set)'}
          {isEditingThis(id) ? '█' : ''}
        </Text>
        {error && <Text color={theme.status.error}> {error}</Text>}
      </Box>
    );
  };

  return (
    <Box flexDirection="column">
      <Text bold color={theme.text.primary}>
        {form.id ? 'Edit custom provider' : 'Add custom provider'}
      </Text>
      <Box marginTop={1} flexDirection="column">
        {FIELD_ORDER.filter((f) => f !== 'save' && f !== 'cancel').map(
          renderRow,
        )}
      </Box>
      <Box marginTop={1} flexDirection="column">
        {saveError && <Text color={theme.status.error}>{saveError}</Text>}
        {renderRow('save')}
        {renderRow('cancel')}
      </Box>
      <Box marginTop={1}>
        <Text color={theme.text.secondary}>
          ↑↓ navigate • Enter select/edit • Esc back/cancel
        </Text>
      </Box>
    </Box>
  );
};

type TextFieldKey =
  | 'displayName'
  | 'baseUrl'
  | 'apiKey'
  | 'safeHeadersText'
  | 'manualModelsText';

/**
 * Only ever called while `mode === 'form-editing-text'`, which the keypress
 * handler only enters for these five fields (dialect/credentialPlacement
 * use RadioButtonSelect, save/cancel are actions) -- the fallback exists so
 * this stays a total function without an unsafe cast.
 */
function textFieldKey(id: FieldId): TextFieldKey {
  switch (id) {
    case 'safeHeaders':
      return 'safeHeadersText';
    case 'manualModels':
      return 'manualModelsText';
    case 'displayName':
    case 'baseUrl':
    case 'apiKey':
      return id;
    default:
      return 'displayName';
  }
}
