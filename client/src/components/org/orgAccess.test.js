import { describe, expect, it } from 'vitest';
import { grantableLevels } from './orgAccess';

describe('grantableLevels', () => {
  it('gives each level only the level below it, and the SAO none, since it names only a university-wide Admin from its own dialog', () => {
    expect(grantableLevels('DEPARTMENT_HEAD')).toEqual(['ADMIN', 'SBO_OFFICER', 'STUDENT']);
    expect(grantableLevels('ADMIN')).toEqual(['SBO_OFFICER', 'STUDENT']);
    expect(grantableLevels('SUPER_ADMIN')).toEqual([]);
    expect(grantableLevels('SBO_OFFICER')).toEqual([]);
  });
});
