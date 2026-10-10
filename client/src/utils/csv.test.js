import { describe, expect, it } from 'vitest';
import { buildCsv, csvCell } from './csv';

describe('csv', () => {
  it('prefixes a single quote on cells a spreadsheet would run as a formula', () => {
    ['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx'].forEach((value) => {
      expect(csvCell(value).replace(/^"|"$/g, '')).toMatch(/^'/);
    });
    expect(csvCell('plain')).toBe('plain');
  });

  it('quotes cells holding commas, quotes or line breaks and doubles inner quotes', () => {
    expect(csvCell('Dela Cruz, Juan')).toBe('"Dela Cruz, Juan"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('a\nb')).toBe('"a\nb"');
  });

  it('builds a header and one line per row', () => {
    expect(buildCsv(['a', 'b'], [[1, 'x'], [2, '=y']])).toBe("a,b\r\n1,x\r\n2,'=y");
  });
});
