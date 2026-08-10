export function getApiErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  const validationErrors = error?.response?.data?.errors || error?.validationErrors;
  const firstValidationError = Object.values(validationErrors || {}).flat()[0];

  return firstValidationError || error?.response?.data?.message || fallback;
}
