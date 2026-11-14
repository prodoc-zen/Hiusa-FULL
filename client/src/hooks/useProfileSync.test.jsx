import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useProfileSync from './useProfileSync';

function Probe() {
  useProfileSync();
  return null;
}

const officer = { role: 'SBO_OFFICER', active_profile_id: 2 };
const student = { role: 'STUDENT', active_profile_id: 1 };

// The browser fires `storage` only in the other tabs, with the value that tab just wrote.
function otherTabWrites(key, value) {
  if (value === null) localStorage.removeItem(key);
  else localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: localStorage.getItem(key) }));
  });
}

describe('useProfileSync', () => {
  let reload;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('auth_token', 'token-1');
    localStorage.setItem('user', JSON.stringify(officer));
    reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('reloads this tab when another tab switched to a different profile', () => {
    render(<Probe />);
    otherTabWrites('user', student);

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads when another tab signed in as someone else or signed out', () => {
    const { unmount } = render(<Probe />);
    otherTabWrites('auth_token', 'token-2');
    expect(reload).toHaveBeenCalledTimes(1);
    unmount();

    reload.mockClear();
    render(<Probe />);
    otherTabWrites('auth_token', null);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('leaves the tab alone when the stored user was rewritten with the same active profile', () => {
    render(<Probe />);
    otherTabWrites('user', { ...officer, first_name: 'Maria' });

    expect(reload).not.toHaveBeenCalled();
  });

  it('ignores storage keys that are not the sign-in', () => {
    render(<Probe />);
    otherTabWrites('hiusa_desktop_sidebar_collapsed', 'true');

    expect(reload).not.toHaveBeenCalled();
  });

  it('stops listening once the layout is gone', () => {
    const { unmount } = render(<Probe />);
    unmount();
    otherTabWrites('user', student);

    expect(reload).not.toHaveBeenCalled();
  });
});
