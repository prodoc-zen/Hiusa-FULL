import { describe, expect, it } from 'vitest';
import { INTERNAL_ID_START, isInternalSchoolId, visibleSchoolId } from './schoolId';

describe('school ID visibility', () => {
  it('hides internal numbers and keeps real school IDs', () => {
    expect(INTERNAL_ID_START).toBe(95000000);
    expect(isInternalSchoolId(95000000)).toBe(true);
    expect(isInternalSchoolId('95000012')).toBe(true);
    expect(isInternalSchoolId(94999999)).toBe(false);
    expect(visibleSchoolId(20261234)).toBe(20261234);
    expect(visibleSchoolId(95000001)).toBeNull();
  });

  it('treats a missing ID as nothing to show', () => {
    expect(visibleSchoolId(null)).toBeNull();
    expect(visibleSchoolId(undefined)).toBeNull();
    expect(visibleSchoolId('')).toBeNull();
  });
});
