// Deans and office staff join by invite link and get an internal number from this value upward.
// It is not something a person should be shown or asked to remember.
export const INTERNAL_ID_START = 95000000;

export function isInternalSchoolId(schoolId) {
  return Number(schoolId) >= INTERNAL_ID_START;
}

export function visibleSchoolId(schoolId) {
  return schoolId === null || schoolId === undefined || schoolId === '' || isInternalSchoolId(schoolId) ? null : schoolId;
}
