import { describe, expect, it } from 'vitest';
import { displayAuditValue, formatDisplayText, humanizeIdentifier } from './displayText';

describe('display text formatting', () => {
  it('tidies a name or title that was stored entirely in lower case', () => {
    expect(formatDisplayText('john carlo')).toBe('John Carlo');
    expect(formatDisplayText('prepare meeting minutes')).toBe('Prepare Meeting Minutes');
    expect(formatDisplayText('college of arts and sciences')).toBe('College of Arts and Sciences');
    expect(formatDisplayText("o'neill de-la cruz")).toBe("O'Neill De-La Cruz");
    expect(formatDisplayText('élise dela cruz')).toBe('Élise Dela Cruz');
  });

  it('shows anything with a capital letter exactly as it was typed', () => {
    expect(formatDisplayText('QA Alpha Event')).toBe('QA Alpha Event');
    expect(formatDisplayText('HIUSA T-Shirt (L/XL)')).toBe('HIUSA T-Shirt (L/XL)');
    expect(formatDisplayText('<b>x</b> QA-HTML')).toBe('<b>x</b> QA-HTML');
    expect(formatDisplayText("Faculty Adviser's Data Sheet")).toBe("Faculty Adviser's Data Sheet");
    expect(formatDisplayText('VP Internal QA')).toBe('VP Internal QA');
    expect(formatDisplayText('VMGO')).toBe('VMGO');
    expect(formatDisplayText('EDITED')).toBe('EDITED');
    expect(formatDisplayText('jOhN CARLO')).toBe('jOhN CARLO');
    expect(formatDisplayText('=1+1 QA formula')).toBe('=1+1 QA formula');
  });

  it('preserves canonical acronyms, email addresses, URLs, and identifiers', () => {
    expect(formatDisplayText('hiusa psits-ccs sao gcash')).toBe('HIUSA PSITS-CCS SAO GCash');
    expect(formatDisplayText('Contact Jane@Example.COM https://example.com/ABC AY2026')).toBe('Contact Jane@Example.COM https://example.com/ABC AY2026');
    expect(formatDisplayText(null)).toBeNull();
  });
  it('keeps the case of a section letter and the BS program abbreviation', () => {
    expect(formatDisplayText('1-A')).toBe('1-A');
    expect(formatDisplayText('4-A')).toBe('4-A');
    expect(formatDisplayText('1-a')).toBe('1-A');
    expect(formatDisplayText('BS Information Technology')).toBe('BS Information Technology');
    expect(formatDisplayText('bs information technology')).toBe('BS Information Technology');
    expect(formatDisplayText('Prepare a plan')).toBe('Prepare a plan');
    expect(formatDisplayText('prepare a plan')).toBe('Prepare a Plan');
    expect(formatDisplayText('Section for 1-A and 2-B')).toBe('Section for 1-A and 2-B');
  });

  it('uses readable labels for roles and database identifiers', () => {
    expect(humanizeIdentifier('SBO_OFFICER')).toBe('SBO Officer');
    expect(humanizeIdentifier('STATUS_CHANGE')).toBe('Status Change');
    expect(humanizeIdentifier('academic_structure')).toBe('Academic Structure');
    expect(humanizeIdentifier('ClearanceSignature')).toBe('Clearance Signature');
    expect(humanizeIdentifier('OrganizationApplication')).toBe('Organization Application');
  });

  it('humanizes enum-like audit values without changing normal text', () => {
    expect(displayAuditValue('pending_approval')).toBe('Pending Approval');
    expect(displayAuditValue('A user-provided description')).toBe('A user-provided description');
    expect(displayAuditValue(null)).toBe('Not set');
  });
});
