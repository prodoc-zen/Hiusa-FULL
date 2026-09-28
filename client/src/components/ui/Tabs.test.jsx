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

  it('omits aria-controls when no panel is wired, and sets it when a panelId is given', () => {
    render(<Tabs tabs={TABS} value="overview" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: 'Overview' })).not.toHaveAttribute('aria-controls');

    const tabsWithPanels = TABS.map((tab) => ({ ...tab, panelId: `panel-${tab.key}` }));
    render(<Tabs tabs={tabsWithPanels} value="overview" onChange={() => {}} />);
    expect(screen.getAllByRole('tab', { name: 'Overview' })[1]).toHaveAttribute('aria-controls', 'panel-overview');
  });

  it('gives every tab a unique id even when two Tabs render on the same page', () => {
    render(
      <>
        <Tabs tabs={TABS} value="overview" onChange={() => {}} />
        <Tabs tabs={TABS} value="overview" onChange={() => {}} />
      </>,
    );
    const overviewTabs = screen.getAllByRole('tab', { name: 'Overview' });
    expect(overviewTabs).toHaveLength(2);
    expect(overviewTabs[0].id).not.toBe(overviewTabs[1].id);
    expect(overviewTabs[0].id).toBeTruthy();
    expect(overviewTabs[1].id).toBeTruthy();
  });
});
