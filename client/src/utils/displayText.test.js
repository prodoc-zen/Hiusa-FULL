import { describe, expect, it } from 'vitest';
import { displayAuditValue, humanizeIdentifier } from './displayText';

describe('display text formatting', () => {
  it('uses readable labels for roles and database identifiers', () => {
    expect(humanizeIdentifier('SBO_OFFICER')).toBe('SBO Officer');
    expect(humanizeIdentifier('STATUS_CHANGE')).toBe('Status Change');
    expect(humanizeIdentifier('academic_structure')).toBe('Academic Structure');
  });

  it('humanizes enum-like audit values without changing normal text', () => {
    expect(displayAuditValue('pending_approval')).toBe('Pending Approval');
    expect(displayAuditValue('A user-provided description')).toBe('A user-provided description');
    expect(displayAuditValue(null)).toBe('Not set');
  });
});
