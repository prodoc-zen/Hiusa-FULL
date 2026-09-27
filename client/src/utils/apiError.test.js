import { describe, expect, it } from 'vitest';
import { getApiErrorMessage } from './apiError';

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
