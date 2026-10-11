import { getApiErrorMessage } from './apiError';

export const REGISTRATION_WITHDRAWN = 'This registration was withdrawn by the Department Head, so its files are no longer available.';

export function isFileGone(error) {
  return Number(error?.response?.status) === 404;
}

// A file fetched as a blob hides the server's JSON message, so a 404 is explained here instead of falling back to a generic failure.
export function openFileErrorMessage(error, { registration = false } = {}) {
  if (isFileGone(error)) return registration ? REGISTRATION_WITHDRAWN : 'This file is no longer available.';
  return getApiErrorMessage(error, 'Could not open this document.');
}
