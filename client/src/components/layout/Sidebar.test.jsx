import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Sidebar from './Sidebar';

vi.mock('../../services/authService', () => ({ logout: vi.fn() }));

function SidebarHarness({ initialCollapsed = false, mobileOpen = false, onClose = () => {} }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const location = useLocation();
  return <>
    <Sidebar isOpen={mobileOpen} onClose={onClose} desktopCollapsed={collapsed} onToggleDesktop={() => setCollapsed((current) => !current)} />
    <output data-testid="route">{location.pathname}</output>
  </>;
}

describe('desktop sidebar rail', () => {
  beforeEach(() => {
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN', first_name: 'Test', last_name: 'Admin' }));
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  });

  afterEach(() => {
    localStorage.clear();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
  });

  it('collapses into labeled icon links and opens grouped routes on click', () => {
    render(<MemoryRouter initialEntries={['/dashboard/admin']}><SidebarHarness /></MemoryRouter>);

    expect(document.documentElement.style.getPropertyValue('--dashboard-sidebar-width')).toBe('260px');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(document.documentElement.style.getPropertyValue('--dashboard-sidebar-width')).toBe('72px');
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('title', 'Dashboard');

    const finance = screen.getByRole('button', { name: 'Finance' });
    fireEvent.click(finance);
    expect(finance).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: 'Finance links' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Budgets' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/dashboard/finance/budget-allocation');
    expect(screen.queryByRole('region', { name: 'Finance links' })).not.toBeInTheDocument();
  });

  it('uses the visible sidebar edge for modal bounds', () => {
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ right: 218 });
    const view = render(<MemoryRouter><SidebarHarness /></MemoryRouter>);

    expect(document.documentElement.style.getPropertyValue('--dashboard-sidebar-width')).toBe('218px');
    view.unmount();
    expect(document.documentElement.style.getPropertyValue('--dashboard-sidebar-width')).toBe('');
    bounds.mockRestore();
  });

  it('keeps direct links usable and closes the group panel with Escape', () => {
    render(<MemoryRouter initialEntries={['/dashboard/admin']}><SidebarHarness initialCollapsed /></MemoryRouter>);

    fireEvent.click(screen.getByRole('link', { name: 'Approvals' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/dashboard/approvals');
    const finance = screen.getByRole('button', { name: 'Finance' });
    fireEvent.click(finance);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Finance links' })).not.toBeInTheDocument();
    expect(finance).toHaveFocus();
  });

  it('keeps the organization badge out of the sidebar', () => {
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN', first_name: 'Test', last_name: 'Admin', organization: { name: 'Information Technology Students', acronym: 'PSITS' } }));
    render(<MemoryRouter initialEntries={['/dashboard/admin']}><SidebarHarness /></MemoryRouter>);
    expect(screen.queryByRole('img', { name: 'Information Technology Students' })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'HIUSA logo' })).toBeInTheDocument();
  });

  it('keeps role-specific links in the collapsed rail', () => {
    localStorage.setItem('user', JSON.stringify({ role: 'SUPER_ADMIN', first_name: 'Sao', last_name: 'Director' }));
    render(<MemoryRouter initialEntries={['/dashboard/super-admin']}><SidebarHarness initialCollapsed /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: 'Organizations' }));
    expect(screen.getByRole('link', { name: 'Administrators' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Manage Users' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Administrators' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/dashboard/super-admin/admins');
  });

  it.each([
    ['ADMIN', '/dashboard/admin', 'Members', 'Organization Setup'],
    ['SBO_OFFICER', '/dashboard/officer', 'Members and fingerprints', 'Manage Users'],
    ['DEPARTMENT_HEAD', '/dashboard/department-head', 'Election results', 'Organization Setup'],
    ['STUDENT', '/dashboard/student', 'Support', 'Organization Setup'],
    ['SUPER_ADMIN', '/dashboard/super-admin', 'Setup and records', 'SAO Administration'],
  ])('shows sensible navigation for %s without section captions', (role, path, expected, absent) => {
    localStorage.setItem('user', JSON.stringify({ role, first_name: 'Test', last_name: 'User' }));
    render(<MemoryRouter initialEntries={[path]}><SidebarHarness /></MemoryRouter>);

    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', path);
    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(screen.queryByText(absent)).not.toBeInTheDocument();
    expect(screen.queryByText('Overview')).not.toBeInTheDocument();
    expect(screen.queryByText(/S02\.1/)).not.toBeInTheDocument();
    expect(screen.queryByText('Account')).not.toBeInTheDocument();
  });

  it.each([false, true])('omits Evaluation and empty Governance for a Department Head with collapsed=%s', (initialCollapsed) => {
    localStorage.setItem('user', JSON.stringify({ role: 'DEPARTMENT_HEAD', first_name: 'Test', last_name: 'Head' }));
    render(<MemoryRouter initialEntries={['/dashboard/department-head']}><SidebarHarness initialCollapsed={initialCollapsed} /></MemoryRouter>);

    expect(screen.queryByRole('link', { name: 'Governance' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Evaluation' })).not.toBeInTheDocument();
    expect(screen.getByTestId('route')).toHaveTextContent('/dashboard/department-head');
    expect(screen.queryByRole('link', { name: 'Compliance' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Clearances' })).not.toBeInTheDocument();
  });

  it.each([
    ['ADMIN', ['Manage', 'Community', 'Records', 'Me']],
    ['SBO_OFFICER', ['Manage', 'Community', 'Records', 'Me']],
    ['DEPARTMENT_HEAD', ['College view (read only)']],
    ['STUDENT', []],
    ['SUPER_ADMIN', []],
  ])('prints the band headings of %s as plain text, in order, and no others', (role, bands) => {
    localStorage.setItem('user', JSON.stringify({ role, first_name: 'Test', last_name: 'User' }));
    render(<MemoryRouter initialEntries={['/dashboard/student']}><SidebarHarness /></MemoryRouter>);
    const headings = [...document.querySelectorAll('nav p.uppercase')];
    expect(headings.map((node) => node.textContent)).toEqual(bands);
    headings.forEach((heading) => expect(heading.closest('a, button')).toBeNull());
  });

  it.each(['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT', 'SUPER_ADMIN'])('ends %s with Profile and Study objectives', (role) => {
    localStorage.setItem('user', JSON.stringify({ role, first_name: 'Test', last_name: 'User' }));
    render(<MemoryRouter initialEntries={['/dashboard/profile']}><SidebarHarness /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/dashboard/profile');
    expect(screen.getByRole('link', { name: 'Study objectives' })).toHaveAttribute('href', '/dashboard/objectives');
    expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Study objectives' })).not.toHaveAttribute('aria-current');
  });

  it.each([
    '/dashboard/super-admin/organizations?status=pending',
    '/dashboard/super-admin/organizations?status=active',
    '/dashboard/super-admin/organizations/7',
  ])('keeps the SAO registrations link current and opened on %s', (url) => {
    localStorage.setItem('user', JSON.stringify({ role: 'SUPER_ADMIN', first_name: 'Sao', last_name: 'Director' }));
    render(<MemoryRouter initialEntries={[url]}><SidebarHarness /></MemoryRouter>);
    const link = screen.getByRole('link', { name: 'Registrations and organizations' });
    expect(link).toHaveAttribute('href', '/dashboard/super-admin/organizations?status=pending');
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
  });

  it('keeps the Admin Approvals row current through the New request flow', () => {
    render(<MemoryRouter initialEntries={['/dashboard/approval-requests/new/budget']}><SidebarHarness /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Approvals' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Approvals' })).toHaveAttribute('href', '/dashboard/approvals');
  });

  it('keeps the existing mobile drawer and submenu behavior', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    const onClose = vi.fn();
    render(<MemoryRouter initialEntries={['/dashboard/admin']}><SidebarHarness initialCollapsed mobileOpen onClose={onClose} /></MemoryRouter>);
    expect(document.documentElement.style.getPropertyValue('--dashboard-sidebar-width')).toBe('0px');

    fireEvent.click(screen.getByRole('button', { name: 'Finance' }));
    expect(screen.queryByRole('region', { name: 'Finance links' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Budgets' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.getByTestId('route')).toHaveTextContent('/dashboard/finance/budget-allocation');
  });

  it('makes the closed mobile drawer inert and closes the open drawer with Escape', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
    const onClose = vi.fn();
    const view = render(<MemoryRouter><SidebarHarness onClose={onClose} /></MemoryRouter>);
    expect(document.querySelector('aside')).toHaveAttribute('inert');
    view.rerender(<MemoryRouter><SidebarHarness mobileOpen onClose={onClose} /></MemoryRouter>);
    expect(screen.getByRole('dialog', { name: 'Navigation menu' })).not.toHaveAttribute('inert');
    expect(screen.getByRole('dialog', { name: 'Navigation menu' })).toHaveClass('mobile-nav-overlay');
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    view.unmount();
    expect(document.body.style.overflow).toBe('');
  });
});
