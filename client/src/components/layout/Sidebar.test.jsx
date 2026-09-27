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

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
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

  it('keeps role-specific links in the collapsed rail', () => {
    localStorage.setItem('user', JSON.stringify({ role: 'SUPER_ADMIN', first_name: 'Sao', last_name: 'Director' }));
    render(<MemoryRouter initialEntries={['/dashboard/super-admin']}><SidebarHarness initialCollapsed /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: 'SAO Administration' }));
    expect(screen.getByRole('link', { name: 'Administrators' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Manage Users' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Administrators' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/dashboard/super-admin/admins');
  });

  it('keeps the existing mobile drawer and submenu behavior', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    const onClose = vi.fn();
    render(<MemoryRouter initialEntries={['/dashboard/admin']}><SidebarHarness initialCollapsed mobileOpen onClose={onClose} /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: 'Financial' }));
    expect(screen.queryByRole('region', { name: 'Financial links' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Budget Allocation' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.getByTestId('route')).toHaveTextContent('/dashboard/finance/budget-allocation');
  });
});
