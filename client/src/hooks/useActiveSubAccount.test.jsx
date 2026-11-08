import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import useActiveSubAccount from './useActiveSubAccount';
import { SUB_ACCOUNT_KEY } from '../utils/subAccountStore';

describe('useActiveSubAccount', () => {
  beforeEach(() => sessionStorage.clear());

  it('starts from the space saved in this tab', () => {
    sessionStorage.setItem(SUB_ACCOUNT_KEY, JSON.stringify({ id: 5, name: 'Computing Society', acronym: 'CS' }));
    const { result } = renderHook(() => useActiveSubAccount());

    expect(result.current.subAccountId).toBe(5);
    expect(result.current.subAccount.name).toBe('Computing Society');
  });

  it('enters and leaves a space, and every reader sees the change', () => {
    const first = renderHook(() => useActiveSubAccount());
    const second = renderHook(() => useActiveSubAccount());

    act(() => first.result.current.enter({ id: 9, name: 'Arts Guild', acronym: 'AG', members_count: 3, color: '#000' }));

    expect(second.result.current.subAccountId).toBe(9);
    expect(JSON.parse(sessionStorage.getItem(SUB_ACCOUNT_KEY))).toEqual({ id: 9, name: 'Arts Guild', acronym: 'AG' });

    act(() => second.result.current.leave());

    expect(first.result.current.subAccount).toBeNull();
    expect(sessionStorage.getItem(SUB_ACCOUNT_KEY)).toBeNull();
  });

  it('ignores a saved value with no organization id', () => {
    sessionStorage.setItem(SUB_ACCOUNT_KEY, JSON.stringify({ name: 'No id' }));

    expect(renderHook(() => useActiveSubAccount()).result.current.subAccount).toBeNull();
  });
});
