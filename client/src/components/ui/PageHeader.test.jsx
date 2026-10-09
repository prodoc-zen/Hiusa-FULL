import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import PageHeader from './PageHeader';

function renderHeader(props) {
  return render(
    <MemoryRouter>
      <PageHeader {...props} />
    </MemoryRouter>,
  );
}

describe('PageHeader', () => {
  it('uses the accessible muted-strong tone for the description on the page background, at or under 75ch', () => {
    renderHeader({ title: 'Members', description: 'Everyone in your organization.' });
    const description = screen.getByText('Everyone in your organization.');
    expect(description).toHaveClass('text-ink-muted-strong');
    expect(description).not.toHaveClass('text-ink-muted');
    expect(description).toHaveClass('max-w-[75ch]');
  });

  it('renders exactly one h1 with the title', () => {
    renderHeader({ title: 'Budgets', purpose: 'Plan and track budgets.' });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Budgets' })).toBeInTheDocument();
  });

  it('shows the purpose line in the description slot', () => {
    renderHeader({ title: 'Budgets', purpose: 'Review approval requests awaiting your sign-off.' });
    const purpose = screen.getByText('Review approval requests awaiting your sign-off.');
    expect(purpose).toHaveClass('max-w-[75ch]', 'text-ink-muted-strong');
  });

  it('keeps a page-written description when purpose is also passed', () => {
    renderHeader({ title: 'Budgets', description: 'Page text', purpose: 'Meta text' });
    expect(screen.getByText('Page text')).toBeInTheDocument();
    expect(screen.queryByText('Meta text')).not.toBeInTheDocument();
  });

  it('renders a Breadcrumb nav with links, and a plain last crumb marked as the current page', () => {
    renderHeader({
      title: 'Budgets',
      breadcrumbs: [{ label: 'Home', to: '/dashboard' }, { label: 'Finance', to: '/dashboard/finance' }, { label: 'Budgets', to: '/dashboard/finance/budget-allocation' }],
    });
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/dashboard');
    expect(within(nav).getByRole('link', { name: 'Finance' })).toHaveAttribute('href', '/dashboard/finance');
    expect(within(nav).queryByRole('link', { name: 'Budgets' })).not.toBeInTheDocument();
    const last = within(nav).getByText('Budgets');
    expect(last).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getAllByRole('listitem')).toHaveLength(3);
  });

  it('keeps a middle crumb without a link as plain text', () => {
    renderHeader({ title: 'Page', breadcrumbs: [{ label: 'Home', to: '/' }, { label: 'Group' }, { label: 'Page' }] });
    expect(screen.getByText('Group')).not.toHaveAttribute('aria-current');
    expect(screen.queryByRole('link', { name: 'Group' })).not.toBeInTheDocument();
  });

  it('renders no breadcrumb nav when none are passed', () => {
    renderHeader({ title: 'Page' });
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('renders meta, actions and the primary slot with the primary last', () => {
    renderHeader({
      title: 'Events',
      meta: <span>View only</span>,
      actions: <button type="button">Export</button>,
      primary: <button type="button">New event</button>,
    });
    expect(screen.getByText('View only')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['Export', 'New event']);
  });

  it('renders the stepper and next step after the title, in that order', () => {
    renderHeader({
      title: 'Event',
      stepper: <div data-testid="stepper">stepper</div>,
      nextStep: <div data-testid="next">next</div>,
    });
    const heading = screen.getByRole('heading', { level: 1 });
    const stepper = screen.getByTestId('stepper');
    const next = screen.getByTestId('next');
    expect(heading.compareDocumentPosition(stepper) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(stepper.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('still renders with only a title and the original actions prop', () => {
    renderHeader({ title: 'Plain', actions: <button type="button">Go</button> });
    expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument();
  });
});
