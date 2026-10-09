import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Home, Store } from 'lucide-react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Sidebar from './Sidebar';

vi.mock('../../services/authService', () => ({ logout: vi.fn() }));

// Two items open the same page and differ only by their query, which no real role has today.
vi.mock('./navigation', async (importOriginal) => {
  const actual = await importOriginal();
  const rows = [
    { id: 'dashboard', label: 'Dashboard', icon: Home, path: '/dashboard/super-admin', exact: true },
    { id: 'pending', label: 'Pending registrations', icon: Store, path: '/dashboard/super-admin/organizations?status=pending' },
    { id: 'all', label: 'All organizations', icon: Store, path: '/dashboard/super-admin/organizations' },
  ];
  return { ...actual, getNavForRole: () => rows, getNavLeaves: () => rows };
});

function renderAt(url) {
  return render(<MemoryRouter initialEntries={[url]}><Sidebar isOpen={false} onClose={() => {}} desktopCollapsed={false} onToggleDesktop={() => {}} /></MemoryRouter>);
}

function currentLinks() {
  return screen.getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page').map((link) => link.textContent);
}

describe('sidebar active item with two items on one path', () => {
  beforeEach(() => {
    localStorage.setItem('user', JSON.stringify({ role: 'SUPER_ADMIN', first_name: 'Sao', last_name: 'Director' }));
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  });

  it('highlights only the item whose query the page carries', () => {
    renderAt('/dashboard/super-admin/organizations?status=pending');
    expect(currentLinks()).toEqual(['Pending registrations']);
  });

  it('highlights the plain item when the query belongs to neither', () => {
    renderAt('/dashboard/super-admin/organizations?status=returned');
    expect(currentLinks()).toEqual(['All organizations']);
  });

  it('highlights the plain item without a query and on a record under the path', () => {
    renderAt('/dashboard/super-admin/organizations');
    expect(currentLinks()).toEqual(['All organizations']);
  });

  it('never lights Dashboard on a sub-page', () => {
    renderAt('/dashboard/super-admin/organizations/7');
    expect(currentLinks()).toEqual(['All organizations']);
  });

  it('lights Dashboard on the home page only', () => {
    renderAt('/dashboard/super-admin');
    expect(currentLinks()).toEqual(['Dashboard']);
  });
});
