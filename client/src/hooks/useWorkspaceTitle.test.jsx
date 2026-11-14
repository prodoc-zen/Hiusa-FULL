import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import useWorkspaceTitle from './useWorkspaceTitle';

function Probe() {
  useWorkspaceTitle();
  return null;
}

describe('useWorkspaceTitle', () => {
  beforeEach(() => {
    localStorage.clear();
    document.title = 'HIUSA';
  });

  it('puts the active workspace in the browser tab title and restores it on leaving', () => {
    localStorage.setItem('user', JSON.stringify({ role: 'SBO_OFFICER', organization: { name: 'Computing Society', acronym: 'CS' } }));
    const { unmount } = render(<Probe />);

    expect(document.title).toBe('HIUSA · Officer · CS');
    unmount();
    expect(document.title).toBe('HIUSA');
  });
});
