import { describe, expect, it } from 'vitest';
import * as Charts from './index';

describe('charts barrel', () => {
  it('re-exports every chart component and the palette', () => {
    expect(typeof Charts.TrendChart).toBe('function');
    expect(typeof Charts.BarList).toBe('function');
    expect(typeof Charts.Donut).toBe('function');
    expect(typeof Charts.StackedBar).toBe('function');
    expect(typeof Charts.Meter).toBe('function');
    expect(Array.isArray(Charts.SERIES_COLORS)).toBe(true);
    expect(typeof Charts.seriesColor).toBe('function');
  });
});
