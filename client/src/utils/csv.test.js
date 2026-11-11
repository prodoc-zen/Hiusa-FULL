import { describe, expect, it } from 'vitest';
import { buildCsv, csvCell } from './csv';

describe('csv', () => {
  it('prefixes a single quote on cells a spreadsheet would run as a formula', () => {
    ['=1+1', '@SUM(A1)', '@x', '-cmd', '+63 917 123 4567', '+1+1', '-1-1', '\tx', '\rx', '\n=1+1', '\nx', ' =1+1', '  +1', ' -1', ' @SUM(A1)'].forEach((value) => {
      expect(csvCell(value).replace(/^"|"$/g, '')).toMatch(/^'/);
    });
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell(' plain')).toBe(' plain');
    expect(csvCell('a =b')).toBe('a =b');
  });

  it('leaves a plain number alone so exported amounts stay numeric', () => {
    expect(csvCell(-325)).toBe('-325');
    expect(csvCell('-325.00')).toBe('-325.00');
    expect(csvCell('+63')).toBe('+63');
    expect(csvCell(180.5)).toBe('180.5');
    expect(csvCell('+639171234567')).toBe('+639171234567');
    expect(csvCell('-1')).toBe('-1');
    const widest = `-${'9'.repeat(30)}.${'9'.repeat(30)}`;
    expect(csvCell(widest)).toBe(widest);
  });

  it('still guards text that only starts like a number', () => {
    ['-325.00 PHP', '-', '+', '-.5', '-5.', '--5', '+-5', '-1e5', '-325.00\n'].forEach((value) => {
      expect(csvCell(value).replace(/^"|"$/g, '')).toMatch(/^'/);
    });
  });

  it('stays fast on a long run of spaces', () => {
    const started = Date.now();
    csvCell(`${' '.repeat(1_000_000)}x`);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('stays fast on a very long run of digits after a sign', () => {
    const started = Date.now();
    expect(csvCell(`-${'9'.repeat(1_000_000)}x`).startsWith("'")).toBe(true);
    expect(csvCell(`-${'9'.repeat(1_000_000)}`).startsWith("'")).toBe(true);
    expect(Date.now() - started).toBeLessThan(500);
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
