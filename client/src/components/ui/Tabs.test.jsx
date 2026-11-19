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

  it('fits four tabs inside a 390px phone with tight padding, and keeps the roomy padding from sm up', () => {
    render(<Tabs tabs={TABS} value="overview" onChange={() => {}} />);
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab).toHaveClass('px-2', 'sm:px-4');
      expect(tab).toHaveClass('h-11', 'shrink-0', 'whitespace-nowrap');
    }
    expect(screen.getByRole('tablist')).toHaveClass('gap-0', 'sm:gap-1');
  });

  it('keeps the strip scrolling inside itself, so a tab that does not fit never widens the page', () => {
    render(<Tabs tabs={TABS} value="overview" onChange={() => {}} />);
    expect(screen.getByRole('tablist').parentElement).toHaveClass('overflow-x-auto');
    expect(screen.getByRole('tablist')).toHaveClass('w-max', 'min-w-full');
  });

  it('scrolls the strip so the selected tab is in view when it sits past an edge', () => {
    const { rerender } = render(<Tabs tabs={TABS} value="overview" onChange={() => {}} />);
    const scroller = screen.getByRole('tablist').parentElement;
    let scrollLeft = 0;
    Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: 300 });
    Object.defineProperty(scroller, 'scrollLeft', { configurable: true, get: () => scrollLeft, set: (next) => { scrollLeft = next; } });
    const settings = screen.getByRole('tab', { name: 'Settings' });
    Object.defineProperty(settings, 'offsetLeft', { configurable: true, value: 400 });
    Object.defineProperty(settings, 'offsetWidth', { configurable: true, value: 100 });

    rerender(<Tabs tabs={TABS} value="settings" onChange={() => {}} />);
    expect(scrollLeft).toBe(200);

    const overview = screen.getByRole('tab', { name: 'Overview' });
    Object.defineProperty(overview, 'offsetLeft', { configurable: true, value: 0 });
    Object.defineProperty(overview, 'offsetWidth', { configurable: true, value: 100 });
    rerender(<Tabs tabs={TABS} value="overview" onChange={() => {}} />);
    expect(scrollLeft).toBe(0);
  });

  it('leaves a strip the person has swiped alone when the parent re-renders with a new tabs array', () => {
    const { rerender } = render(<Tabs tabs={[...TABS]} value="overview" onChange={() => {}} />);
    const scroller = screen.getByRole('tablist').parentElement;
    let scrollLeft = 0;
    Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: 300 });
    Object.defineProperty(scroller, 'scrollLeft', { configurable: true, get: () => scrollLeft, set: (next) => { scrollLeft = next; } });
    const overview = screen.getByRole('tab', { name: 'Overview' });
    Object.defineProperty(overview, 'offsetLeft', { configurable: true, value: 0 });
    Object.defineProperty(overview, 'offsetWidth', { configurable: true, value: 100 });

    scrollLeft = 150;
    rerender(<Tabs tabs={[...TABS]} value="overview" onChange={() => {}} />);
    expect(scrollLeft).toBe(150);
  });

  it('keeps one weight across tabs so the indicator never drifts, and has no bold', () => {
    render(<Tabs tabs={TABS} value="members" onChange={() => {}} />);
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab).toHaveClass('font-medium');
      expect(tab.className).not.toMatch(/font-bold/);
    }
    expect(screen.getByRole('tab', { name: 'Members' })).toHaveClass('text-brand-700');
  });
});
