import { describe, expect, it } from 'vitest';
import { displayAuditValue, formatDisplayText, humanizeIdentifier } from './displayText';

describe('display text formatting', () => {
  it('normalizes displayed names and titles regardless of entered casing', () => {
    expect(formatDisplayText('jOhN CARLO')).toBe('John Carlo');
    expect(formatDisplayText('PREPARE meeting MINUTES')).toBe('Prepare Meeting Minutes');
    expect(formatDisplayText('COLLEGE OF arts AND sciences')).toBe('College of Arts and Sciences');
    expect(formatDisplayText("o'NEILL de-la CRUZ")).toBe("O'Neill De-La Cruz");
    expect(formatDisplayText('élise DELA CRUZ')).toBe('Élise Dela Cruz');
  });

  it('preserves canonical acronyms, email addresses, URLs, and identifiers', () => {
    expect(formatDisplayText('hiusa psits-ccs sao gcash')).toBe('HIUSA PSITS-CCS SAO GCash');
    expect(formatDisplayText('Contact Jane@Example.COM https://example.com/ABC AY2026')).toBe('Contact Jane@Example.COM https://example.com/ABC AY2026');
    expect(formatDisplayText(null)).toBeNull();
  });
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
