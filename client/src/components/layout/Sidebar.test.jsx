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

    const financial = screen.getByRole('button', { name: 'Financial' });
    fireEvent.click(financial);
    expect(financial).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: 'Financial links' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Budget Allocation' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/dashboard/finance/budget-allocation');
    expect(screen.queryByRole('region', { name: 'Financial links' })).not.toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('link', { name: 'General Audit Log' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/dashboard/audit-logs');
    const financial = screen.getByRole('button', { name: 'Financial' });
    fireEvent.click(financial);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Financial links' })).not.toBeInTheDocument();
    expect(financial).toHaveFocus();
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

    fireEvent.click(screen.getByRole('button', { name: 'SAO Administration' }));
    expect(screen.getByRole('link', { name: 'Administrators' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Manage Users' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Administrators' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/dashboard/super-admin/admins');
  });

  it.each([
    ['ADMIN', '/dashboard/admin', 'Organization Setup', 'Manage Users'],
    ['SBO_OFFICER', '/dashboard/officer', 'Participant Biometrics', 'Manage Users'],
    ['DEPARTMENT_HEAD', '/dashboard/department-head', 'Announcements Feed', 'Organization Setup'],
    ['STUDENT', '/dashboard/student', 'Announcements Feed', 'Organization Setup'],
    ['SUPER_ADMIN', '/dashboard/super-admin', 'SAO Administration', 'Organization Setup'],
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

  it('keeps the existing mobile drawer and submenu behavior', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    const onClose = vi.fn();
    render(<MemoryRouter initialEntries={['/dashboard/admin']}><SidebarHarness initialCollapsed mobileOpen onClose={onClose} /></MemoryRouter>);
    expect(document.documentElement.style.getPropertyValue('--dashboard-sidebar-width')).toBe('0px');

    fireEvent.click(screen.getByRole('button', { name: 'Financial' }));
    expect(screen.queryByRole('region', { name: 'Financial links' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Budget Allocation' }));
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
