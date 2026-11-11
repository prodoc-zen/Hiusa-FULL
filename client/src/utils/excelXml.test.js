import { describe, expect, it } from 'vitest';
import { buildExcelXml } from './excelXml';

describe('merchandise Excel export', () => {
  it('keeps every row and escapes user supplied cell content', () => {
    const xml = buildExcelXml(['Name', 'Order'], [['Ana & Ben', 'ORD-1'], ['<script>', 'ORD-2']]);

    expect(xml).toContain('Ana &amp; Ben');
    expect(xml).toContain('&lt;script&gt;');
    expect(xml).toContain('ORD-2');
    expect(xml.match(/<Row>/g)).toHaveLength(3);
  });

  it('writes a cell that starts with a formula character as text with a leading quote', () => {
    const xml = buildExcelXml(['Name'], [['=1+1'], ['+1+1'], ['-cmd'], ['@SUM(A1)'], ['+63 917 123 4567'], ['plain']]);

    ['=1+1', '+1+1', '-cmd', '@SUM(A1)', '+63 917 123 4567'].forEach((value) => expect(xml).toContain(`>&apos;${value}<`));
    expect(xml).toContain('>plain<');
  });

  it('leaves a plain number without a leading quote', () => {
    const xml = buildExcelXml(['Amount'], [['-325.00'], [-325], ['+63']]);

    expect(xml).toContain('>-325.00<');
    expect(xml).toContain('>-325<');
    expect(xml).toContain('>+63<');
    expect(xml).not.toContain('&apos;');
  });
});
