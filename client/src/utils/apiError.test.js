import { describe, expect, it } from 'vitest';
import { getApiErrorMessage, getLoadErrorDescription } from './apiError';

describe('API error messages', () => {
  it('keeps useful validation guidance', () => {
    const error = { response: { status: 422, data: { errors: { deadline: ['Choose a due date before the event starts.'] } } } };

    expect(getApiErrorMessage(error)).toBe('Choose a due date before the event starts.');
  });

  it('never displays database details to a user', () => {
    const error = { response: { status: 500, data: { message: "SQLSTATE[42S22]: Unknown column 'decision_status'" } } };

    expect(getApiErrorMessage(error, 'We could not save your changes. Please try again.'))
      .toBe('We could not save your changes. Please try again.');
  });

  it('uses a clear temporary-service message for a 503 response', () => {
    const error = { response: { status: 503, data: { message: 'Provider request failed.' } } };

    expect(getApiErrorMessage(error)).toBe('This service is temporarily unavailable. Please wait a moment and try again.');
  });

  it('keeps the actionable financial-report migration message', () => {
    const error = { response: { status: 503, data: { error_code: 'FINANCIAL_REPORT_SCHEMA_OUTDATED', message: 'Financial report generation is unavailable because this server has not applied the latest database migration. Run "php artisan migrate" and try again.' } } };

    expect(getApiErrorMessage(error)).toContain('Run "php artisan migrate"');
  });
});

describe('load failure description', () => {
  it('tells the person to check the connection only when no reply came back', () => {
    expect(getLoadErrorDescription(new Error('Network Error'))).toBe('Check your connection and try again.');
  });

  it('says how long to wait after too many requests', () => {
    const error = { isRateLimited: true, retryAfterSeconds: 12, userMessage: 'Too many requests. Please try again in 12 seconds.', response: { status: 429 } };

    expect(getLoadErrorDescription(error)).toBe('Too many requests. Please try again in 12 seconds.');
  });

  it('blames the server, not the connection, for a server fault', () => {
    expect(getLoadErrorDescription({ response: { status: 500, data: { message: 'Server Error' } } })).toBe('The server had a problem. Please try again in a moment.');
    expect(getLoadErrorDescription({ response: { status: 503, data: {} } })).toBe('This service is temporarily unavailable. Please wait a moment and try again.');
  });
});
