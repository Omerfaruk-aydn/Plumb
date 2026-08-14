/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Box, Text } from 'ink';
import { validateAzureConfig, type AzureDeployment } from '@plumb/provider';
import { useKeypress, type Key } from '../hooks/useKeypress.js';
import { theme } from '../semantic-colors.js';
import {
  saveAzureConfiguration,
  loadAzureExistingConfig,
  removeAzureConfiguration,
  refreshAzureModelStatus,
} from '../utils/azureCloudConfigActions.js';

export interface PlumbAzureCloudConfigFormProps {
  onContinue: (modelHint?: string) => void;
  onCancel: () => void;
}

type Mode =
  | 'loading'
  | 'summary'
  | 'browse'
  | 'editing-endpoint'
  | 'editing-credential'
  | 'editing-deployment-model'
  | 'editing-deployment-name'
  | 'saving'
  | 'removing'
  | 'refreshing';

type ControlKind = 'text' | 'secret' | 'deployment' | 'action';
interface Control {
  id: string;
  kind: ControlKind;
  deploymentIndex?: number;
}

const SUMMARY_ACTIONS = [
  { id: 'continue', label: 'Continue' },
  { id: 'edit', label: 'Edit configuration' },
  { id: 'refresh', label: 'Refresh models/status' },
  { id: 'remove', label: 'Remove configuration' },
  { id: 'back', label: 'Back' },
] as const;

function isConfigured(endpoint: string, hasCredential: boolean): boolean {
  return !!endpoint.trim() && hasCredential;
}

export const PlumbAzureCloudConfigForm: React.FC<
  PlumbAzureCloudConfigFormProps
> = ({ onContinue, onCancel }) => {
  const [mode, setMode] = useState<Mode>('loading');
  const [endpoint, setEndpoint] = useState('');
  const [credential, setCredential] = useState('');
  const [hasExistingCredential, setHasExistingCredential] = useState(false);
  const [deployments, setDeployments] = useState<AzureDeployment[]>([]);
  const [focusIndex, setFocusIndex] = useState(0);
  const [textBuffer, setTextBuffer] = useState('');
  const [pendingDeploymentModel, setPendingDeploymentModel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const existing = await loadAzureExistingConfig();
      if (cancelled) return;
      setEndpoint(existing.endpoint);
      setDeployments([...existing.deployments]);
      setHasExistingCredential(existing.hasCredential);
      setFocusIndex(0);
      setMode(
        isConfigured(existing.endpoint, existing.hasCredential)
          ? 'summary'
          : 'browse',
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const controls: Control[] = useMemo(() => {
    const list: Control[] = [
      { id: 'endpoint', kind: 'text' },
      { id: 'credential', kind: 'secret' },
    ];
    deployments.forEach((_, i) => {
      list.push({
        id: `deployment-${i}`,
        kind: 'deployment',
        deploymentIndex: i,
      });
    });
    list.push({ id: 'add-deployment', kind: 'action' });
    list.push({ id: 'save', kind: 'action' });
    list.push({ id: 'cancel', kind: 'action' });
    return list;
  }, [deployments]);

  useEffect(() => {
    if (mode === 'browse' && focusIndex >= controls.length) {
      setFocusIndex(Math.max(0, controls.length - 1));
    }
  }, [controls.length, focusIndex, mode]);

  const stateRef = useRef({
    mode,
    endpoint,
    credential,
    hasExistingCredential,
    deployments,
    focusIndex,
    textBuffer,
    pendingDeploymentModel,
    controls,
    onContinue,
    onCancel,
  });
  stateRef.current = {
    mode,
    endpoint,
    credential,
    hasExistingCredential,
    deployments,
    focusIndex,
    textBuffer,
    pendingDeploymentModel,
    controls,
    onContinue,
    onCancel,
  };

  const runSave = useCallback(async () => {
    const s = stateRef.current;
    setMode('saving');
    setSaveError(null);
    const result = await saveAzureConfiguration({
      endpoint: s.endpoint,
      credential: s.credential,
      hasExistingCredential: s.hasExistingCredential,
      deployments: s.deployments,
    });
    if (result.success) {
      s.onContinue(undefined);
      return;
    }
    setError(result.error ?? null);
    setSaveError(result.error ?? 'Failed to save configuration.');
    setMode('browse');
  }, []);

  const runRemove = useCallback(async () => {
    setMode('removing');
    await removeAzureConfiguration();
    setEndpoint('');
    setCredential('');
    setDeployments([]);
    setHasExistingCredential(false);
    setFocusIndex(0);
    setMode('browse');
  }, []);

  const runRefresh = useCallback(async () => {
    setMode('refreshing');
    await refreshAzureModelStatus();
    setMode('summary');
  }, []);

  const handleKeypress = useCallback(
    (key: Key) => {
      const s = stateRef.current;
      if (
        s.mode === 'loading' ||
        s.mode === 'saving' ||
        s.mode === 'removing' ||
        s.mode === 'refreshing'
      ) {
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
          const action = SUMMARY_ACTIONS[s.focusIndex]?.id;
          if (action === 'continue') {
            s.onContinue(undefined);
          } else if (action === 'edit') {
            setFocusIndex(0);
            setMode('browse');
          } else if (action === 'refresh') {
            void runRefresh();
          } else if (action === 'remove') {
            void runRemove();
          } else {
            s.onCancel();
          }
          return;
        }
        return;
      }

      if (
        s.mode === 'editing-endpoint' ||
        s.mode === 'editing-credential' ||
        s.mode === 'editing-deployment-model' ||
        s.mode === 'editing-deployment-name'
      ) {
        if (key.name === 'enter') {
          if (s.mode === 'editing-endpoint') {
            setEndpoint(s.textBuffer);
            setMode('browse');
            setFocusIndex((i) => Math.min(i + 1, s.controls.length - 1));
          } else if (s.mode === 'editing-credential') {
            setCredential(s.textBuffer);
            setMode('browse');
            setFocusIndex((i) => Math.min(i + 1, s.controls.length - 1));
          } else if (s.mode === 'editing-deployment-model') {
            setPendingDeploymentModel(s.textBuffer);
            const current = s.controls[s.focusIndex];
            const existingName =
              current.deploymentIndex !== undefined
                ? (s.deployments[current.deploymentIndex]?.deploymentName ?? '')
                : '';
            setTextBuffer(existingName);
            setMode('editing-deployment-name');
          } else {
            const current = s.controls[s.focusIndex];
            const idx = current.deploymentIndex;
            const modelId = s.pendingDeploymentModel.trim();
            const deploymentName = s.textBuffer.trim();
            setDeployments((list) => {
              const next = [...list];
              if (idx !== undefined && idx < next.length) {
                if (!modelId || !deploymentName) {
                  next.splice(idx, 1);
                } else {
                  next[idx] = { modelId, deploymentName };
                }
              }
              return next;
            });
            setMode('browse');
          }
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
      const control = s.controls[s.focusIndex];
      if (!control) return;
      if (
        key.name === 'backspace' &&
        control.kind === 'deployment' &&
        control.deploymentIndex !== undefined
      ) {
        const idx = control.deploymentIndex;
        setDeployments((list) => list.filter((_, i) => i !== idx));
        return;
      }
      if (key.name === 'enter') {
        if (control.id === 'endpoint') {
          setTextBuffer(s.endpoint);
          setMode('editing-endpoint');
          return;
        }
        if (control.id === 'credential') {
          setTextBuffer('');
          setMode('editing-credential');
          return;
        }
        if (
          control.kind === 'deployment' &&
          control.deploymentIndex !== undefined
        ) {
          const d = s.deployments[control.deploymentIndex];
          setPendingDeploymentModel(d?.modelId ?? '');
          setTextBuffer(d?.modelId ?? '');
          setMode('editing-deployment-model');
          return;
        }
        if (control.id === 'add-deployment') {
          setDeployments((list) => {
            const next = [...list, { modelId: '', deploymentName: '' }];
            setFocusIndex(2 + next.length - 1);
            return next;
          });
          setPendingDeploymentModel('');
          setTextBuffer('');
          setMode('editing-deployment-model');
          return;
        }
        if (control.id === 'save') {
          const validation = validateAzureConfig({
            endpoint: s.endpoint,
            credential: s.credential,
            hasExistingCredential: s.hasExistingCredential,
            deployments: s.deployments,
          });
          if (Object.keys(validation).length > 0) {
            setError(Object.values(validation)[0] ?? null);
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
    [runRemove, runRefresh, runSave],
  );

  useKeypress(handleKeypress, {
    isActive:
      mode !== 'loading' &&
      mode !== 'saving' &&
      mode !== 'removing' &&
      mode !== 'refreshing',
  });

  if (mode === 'loading') {
    return (
      <Box>
        <Text color={theme.text.secondary}>Loading configuration…</Text>
      </Box>
    );
  }

  if (mode === 'summary' || mode === 'removing' || mode === 'refreshing') {
    return (
      <Box flexDirection="column">
        <Text bold color={theme.text.primary}>
          Azure OpenAI
        </Text>
        <Text color={theme.status.success}>Status: Configured</Text>
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.text.secondary}>Endpoint</Text>
          <Text color={theme.text.primary}> {endpoint}</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.text.secondary}>Credential</Text>
          <Text color={theme.text.primary}> API Key: Configured</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.text.secondary}>
            Deployments ({deployments.length})
          </Text>
          {deployments.length === 0 ? (
            <Text color={theme.text.primary}> (none)</Text>
          ) : (
            deployments.map((d) => (
              <Text key={d.modelId} color={theme.text.primary}>
                {' '}
                {d.modelId} → {d.deploymentName}
              </Text>
            ))
          )}
        </Box>
        <Box marginTop={1} flexDirection="column">
          {mode === 'removing' ? (
            <Text color={theme.text.secondary}>Removing configuration…</Text>
          ) : mode === 'refreshing' ? (
            <Text color={theme.text.secondary}>Refreshing model status…</Text>
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

  const isFocused = (id: string) => controls[focusIndex]?.id === id;

  return (
    <Box flexDirection="column">
      <Text bold color={theme.text.primary}>
        Azure OpenAI — Configure
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.text.secondary}>Endpoint / Resource</Text>
        <Text
          color={isFocused('endpoint') ? theme.text.accent : theme.text.primary}
        >
          {isFocused('endpoint') ? '> ' : '  '}
          Endpoint:{' '}
          {mode === 'editing-endpoint' ? textBuffer : endpoint || '(not set)'}
          {mode === 'editing-endpoint' ? '█' : ''}
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.text.secondary}>Credential</Text>
        <Text
          color={
            isFocused('credential') ? theme.text.accent : theme.text.primary
          }
        >
          {isFocused('credential') ? '> ' : '  '}
          API Key:{' '}
          {mode === 'editing-credential'
            ? '•'.repeat(textBuffer.length)
            : hasExistingCredential
              ? 'Configured (Enter to replace)'
              : '(not set)'}
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.text.secondary}>
          Deployments ({deployments.length})
        </Text>
        {deployments.map((d, i) => {
          const control = controls.find(
            (c) => c.kind === 'deployment' && c.deploymentIndex === i,
          )!;
          const focused = controls[focusIndex] === control;
          const editingModel = focused && mode === 'editing-deployment-model';
          const editingName = focused && mode === 'editing-deployment-name';
          return (
            <Text
              key={control.id}
              color={focused ? theme.text.accent : theme.text.primary}
            >
              {focused ? '> ' : '  '}
              {editingModel
                ? `${textBuffer}█ → ${d.deploymentName}`
                : editingName
                  ? `${pendingDeploymentModel} → ${textBuffer}█`
                  : `${d.modelId || '(model)'} → ${d.deploymentName || '(deployment)'}`}
            </Text>
          );
        })}
        <Text
          color={
            isFocused('add-deployment') ? theme.text.accent : theme.text.primary
          }
        >
          {isFocused('add-deployment') ? '> ' : '  '}+ Add deployment
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {(error || saveError) && (
          <Text color={theme.status.error}>{saveError ?? error}</Text>
        )}
        <Text
          color={isFocused('save') ? theme.text.accent : theme.text.primary}
        >
          {isFocused('save') ? '> ' : '  '}
          {mode === 'saving' ? 'Saving…' : 'Save'}
        </Text>
        <Text
          color={isFocused('cancel') ? theme.text.accent : theme.text.primary}
        >
          {isFocused('cancel') ? '> ' : '  '}Cancel
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.text.secondary}>
          ↑↓ navigate • Enter edit/select • Backspace on a deployment removes it
          • Esc back/cancel
        </Text>
      </Box>
    </Box>
  );
};
