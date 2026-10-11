import { describe, expect, it } from 'vitest';
import { openFileErrorMessage, REGISTRATION_WITHDRAWN } from './openFileError';

describe('openFileErrorMessage', () => {
  it('says the registration was withdrawn when a registration file is gone', () => {
    expect(openFileErrorMessage({ response: { status: 404, data: new Blob(['{"message":"No query results for model"}']) } }, { registration: true })).toBe(REGISTRATION_WITHDRAWN);
  });

  it('says the file is no longer available for any other missing file', () => {
    expect(openFileErrorMessage({ response: { status: 404 } })).toBe('This file is no longer available.');
  });

  it('keeps the usual message for other failures', () => {
    expect(openFileErrorMessage({ userMessage: 'Allow pop-ups to open this file.' })).toBe('Allow pop-ups to open this file.');
    expect(openFileErrorMessage({ response: { status: 500 } })).toBe('Could not open this document.');
  });
});
