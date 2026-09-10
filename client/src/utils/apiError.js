export function getApiErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  const validationErrors = error?.response?.data?.errors || error?.validationErrors;
  const firstValidationError = Object.values(validationErrors || {}).flat()[0];

  if (error?.userMessage) return error.userMessage;

  const status = Number(error?.response?.status || 0);
  const message = firstValidationError || error?.response?.data?.message;
  const containsTechnicalDetails = typeof message === 'string' && (
    /SQLSTATE|PDOException|QueryException|Unknown column|Connection:\s*\w+|Stack trace|vendor[\\/].*\.php|select\s+(?:exists|\*|.+\sfrom\s)/i.test(message)
  );

  if (containsTechnicalDetails || status >= 500) {
    return status === 503
      ? 'This service is temporarily unavailable. Please wait a moment and try again.'
      : fallback;
  }

  return message || fallback;
}
