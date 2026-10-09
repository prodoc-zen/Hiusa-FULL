import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import useRecordParam from './useRecordParam';

function setup(initialEntries) {
  const wrapper = ({ children }) => <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>;
  return renderHook(() => ({ record: useRecordParam(), location: useLocation(), navigate: useNavigate() }), { wrapper });
}

describe('useRecordParam', () => {
  it('reads the record parameter, or null when absent', () => {
    expect(setup(['/events?record=42']).result.current.record[0]).toBe('42');
    expect(setup(['/events']).result.current.record[0]).toBeNull();
  });

  it('opens a record, preserving the other params', () => {
    const { result } = setup(['/events?tab=list&status=pending']);
    act(() => result.current.record[1](7));
    expect(result.current.record[0]).toBe('7');
    const params = new URLSearchParams(result.current.location.search);
    expect(params.get('tab')).toBe('list');
    expect(params.get('status')).toBe('pending');
    expect(params.get('record')).toBe('7');
  });

  it('pushes a history entry on open so Back closes the drawer', () => {
    const { result } = setup(['/events']);
    act(() => result.current.record[1](7));
    expect(result.current.record[0]).toBe('7');
    act(() => result.current.navigate(-1));
    expect(result.current.record[0]).toBeNull();
    expect(result.current.location.pathname).toBe('/events');
  });

  it('clears a record opened from the list by stepping back, leaving no duplicate list entry', () => {
    const { result } = setup(['/events?tab=list']);
    act(() => result.current.record[1](7));
    act(() => result.current.record[1](null));
    expect(result.current.record[0]).toBeNull();
    expect(result.current.location.search).toBe('?tab=list');
    act(() => result.current.navigate(-1));
    expect(result.current.location.pathname).toBe('/events');
    expect(result.current.location.search).toBe('?tab=list');
  });

  it('clears a deep-linked record by replacing the entry and keeps the other params', () => {
    const { result } = setup(['/events?tab=list&record=9']);
    act(() => result.current.record[1](null));
    expect(result.current.record[0]).toBeNull();
    expect(result.current.location.search).toBe('?tab=list');
  });

  it('switches from one record to another with a single history entry', () => {
    const { result } = setup(['/events']);
    act(() => result.current.record[1](1));
    act(() => result.current.record[1](2));
    expect(result.current.record[0]).toBe('2');
    act(() => result.current.record[1](null));
    expect(result.current.record[0]).toBeNull();
    expect(result.current.location.pathname).toBe('/events');
    expect(result.current.location.search).toBe('');
  });

  it('treats an empty string and undefined as clear, and ignores clearing when nothing is open', () => {
    const { result } = setup(['/events?record=3']);
    act(() => result.current.record[1](''));
    expect(result.current.record[0]).toBeNull();
    act(() => result.current.record[1](undefined));
    expect(result.current.location.search).toBe('');
  });

  it('does not push again when the same record is opened', () => {
    const { result } = setup(['/events?record=5']);
    const before = result.current.location.key;
    act(() => result.current.record[1]('5'));
    expect(result.current.location.key).toBe(before);
  });

  it('keeps a stable setter between renders when nothing changed', () => {
    const { result, rerender } = setup(['/events']);
    const first = result.current.record[1];
    rerender();
    expect(result.current.record[1]).toBe(first);
  });
});
