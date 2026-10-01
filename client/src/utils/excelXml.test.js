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
});
