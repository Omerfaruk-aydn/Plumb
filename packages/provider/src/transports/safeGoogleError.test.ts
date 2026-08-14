/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  extractSafeGoogleErrorDetails,
  formatSafeGoogleErrorSummary,
} from './streaming.js';

describe('extractSafeGoogleErrorDetails', () => {
  it('extracts status, reason, domain, and fieldViolations safely', () => {
    const rawBody = JSON.stringify({
      error: {
        code: 400,
        message:
          'Invalid JSON payload received. Unknown field ya29.secret_token in request.',
        status: 'INVALID_ARGUMENT',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.BadRequest',
            fieldViolations: [
              {
                field: 'request.tools[0].functionDeclarations[0]',
                description: 'Invalid tool schema for function update_topic',
              },
            ],
          },
          {
            '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
            reason: 'API_KEY_INVALID',
            domain: 'googleapis.com',
          },
        ],
      },
    });

    const details = extractSafeGoogleErrorDetails(rawBody);

    expect(details.code).toBe(400);
    expect(details.status).toBe('INVALID_ARGUMENT');
    expect(details.reason).toBe('API_KEY_INVALID');
    expect(details.domain).toBe('googleapis.com');
    expect(details.detailTypes).toContain('BadRequest');
    expect(details.detailTypes).toContain('ErrorInfo');
    expect(details.fieldViolations).toHaveLength(1);
    expect(details.fieldViolations[0]?.field).toBe(
      'request.tools[0].functionDeclarations[0]',
    );
    expect(details.fieldViolations[0]?.description).toContain(
      'Invalid tool schema',
    );
    expect(details.safeMessage).not.toContain('ya29.secret_token');
    expect(details.safeMessage).toContain('[REDACTED_TOKEN]');
  });

  it('formats safe summary lines without dumping sensitive data', () => {
    const rawBody = JSON.stringify({
      error: {
        code: 400,
        status: 'INVALID_ARGUMENT',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.BadRequest',
            fieldViolations: [
              {
                field: 'request.tools[0]',
                description: 'Missing required field parameters',
              },
            ],
          },
        ],
      },
    });

    const details = extractSafeGoogleErrorDetails(rawBody);
    const summary = formatSafeGoogleErrorSummary(details);

    expect(summary).toContain('HTTP_ERROR_STATUS: INVALID_ARGUMENT');
    expect(summary).toContain('FIELD_VIOLATION_COUNT: 1');
    expect(summary).toContain(
      'FIELD_VIOLATION_1: request.tools[0]: Missing required field parameters',
    );
  });
});
