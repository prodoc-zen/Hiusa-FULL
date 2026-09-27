import { render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Tabs from './Tabs';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'members', label: 'Members' },
  { key: 'settings', label: 'Settings' },
];

describe('Tabs', () => {
  it('moves focus and selection with the arrow keys', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={TABS} value="overview" onChange={onChange} />);

    const overview = screen.getByRole('tab', { name: 'Overview' });
    overview.focus();
    fireEvent.keyDown(overview, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('members');
    expect(screen.getByRole('tab', { name: 'Members' })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Members' }), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith('overview');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveFocus();
  });

  it('marks only the active tab as selected and focusable', () => {
    render(<Tabs tabs={TABS} value="members" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: 'Members' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('tabIndex', '-1');
  });
});
