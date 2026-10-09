import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { PageHeaderRegistryContext } from '../../lib/pageHeaderRegistry';
import PageHeader from './PageHeader';

function renderAt(path, props, role = 'ADMIN') {
  localStorage.setItem('user', JSON.stringify({ role, first_name: 'Test', last_name: 'User' }));
  return render(<MemoryRouter initialEntries={[path]}><PageHeader {...props} /></MemoryRouter>);
}

describe('PageHeader falls back to pageMeta', () => {
  beforeEach(() => localStorage.clear());

  it('derives the breadcrumb for the current route when none is passed', () => {
    renderAt('/dashboard/finance/financial-ledger', { title: 'Ledger' });
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/dashboard/admin');
    expect(within(nav).getByRole('link', { name: 'Finance' })).toHaveAttribute('href', '/dashboard/finance/budget-allocation');
    expect(within(nav).queryByRole('link', { name: 'Ledger' })).not.toBeInTheDocument();
    expect(within(nav).getByText('Ledger')).toHaveAttribute('aria-current', 'page');
  });

  it('takes the title and purpose from pageMeta when the page passes neither', () => {
    renderAt('/dashboard/events/check-in', {});
    expect(screen.getByRole('heading', { level: 1, name: 'Check-in' })).toBeInTheDocument();
    expect(screen.getByText('Verify participants and manage event attendance.')).toBeInTheDocument();
  });

  it('keeps the page title and description when it passes its own', () => {
    renderAt('/dashboard/events/check-in', { title: 'Attendance', description: 'Own words.' });
    expect(screen.getByRole('heading', { level: 1, name: 'Attendance' })).toBeInTheDocument();
    expect(screen.getByText('Own words.')).toBeInTheDocument();
    expect(screen.queryByText('Verify participants and manage event attendance.')).not.toBeInTheDocument();
  });

  it('lets a page pass its own breadcrumbs, or an empty list to hide them', () => {
    const view = renderAt('/dashboard/events/check-in', { title: 'Attendance', breadcrumbs: [{ label: 'Home', to: '/' }, { label: 'Own' }] });
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByText('Own')).toBeInTheDocument();
    view.unmount();

    renderAt('/dashboard/events/check-in', { title: 'Attendance', breadcrumbs: [] });
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument();
  });

  it('adds nothing on a route pageMeta does not know', () => {
    renderAt('/dev/ui-kit', { title: 'UI kit' });
    expect(screen.getByRole('heading', { level: 1, name: 'UI kit' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument();
  });

  it('still renders what the page passes when there is no router, as in a page rendered on its own', () => {
    render(<PageHeader title="Alone" description="No router here." />);
    expect(screen.getByRole('heading', { level: 1, name: 'Alone' })).toBeInTheDocument();
    expect(screen.getByText('No router here.')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument();
  });

  it('registers with the layout while mounted and releases on unmount', () => {
    const calls = [];
    const registry = { register: () => { calls.push('register'); return () => calls.push('release'); } };
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    const view = render(
      <MemoryRouter initialEntries={['/dashboard/events/check-in']}>
        <PageHeaderRegistryContext value={registry}><PageHeader title="Attendance" /></PageHeaderRegistryContext>
      </MemoryRouter>,
    );
    expect(calls).toEqual(['register']);
    view.unmount();
    expect(calls).toEqual(['register', 'release']);
  });
});
