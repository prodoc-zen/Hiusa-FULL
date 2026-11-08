import { beforeEach, describe, expect, it } from 'vitest';
import { PERIOD_KEY, readSelectedPeriod, writeSelectedPeriod } from './academicPeriodStore';

describe('academicPeriodStore', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('keeps the chosen period across tabs by saving it to localStorage', () => {
    writeSelectedPeriod({ id: 7, number: 1 });

    expect(JSON.parse(localStorage.getItem(PERIOD_KEY))).toEqual({ id: 7, number: 1 });
    expect(readSelectedPeriod()).toEqual({ id: 7, number: 1 });
  });

  it('carries a period picked before the move over from sessionStorage once', () => {
    sessionStorage.setItem(PERIOD_KEY, JSON.stringify({ id: 4, number: 2 }));

    expect(readSelectedPeriod()).toEqual({ id: 4, number: 2 });
    expect(JSON.parse(localStorage.getItem(PERIOD_KEY))).toEqual({ id: 4, number: 2 });
    expect(sessionStorage.getItem(PERIOD_KEY)).toBeNull();
  });

  it('clears the choice', () => {
    writeSelectedPeriod({ id: 7 });
    writeSelectedPeriod(null);

    expect(readSelectedPeriod()).toBeNull();
  });

  it('ignores a stored value that is not a period', () => {
    localStorage.setItem(PERIOD_KEY, 'not json');

    expect(readSelectedPeriod()).toBeNull();
  });
});
