import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardLayout from './DashboardLayout';

vi.mock('./Sidebar', () => ({
  default: ({ desktopCollapsed, onToggleDesktop }) => <button type="button" onClick={onToggleDesktop}>{desktopCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}</button>,
}));
vi.mock('./TopBar', () => ({ default: () => <div>Top bar</div> }));

function renderLayout() {
  return render(<MemoryRouter initialEntries={['/dashboard/admin']}><Routes><Route path="/dashboard" element={<DashboardLayout />}><Route path="admin" element={<div>Admin page</div>} /></Route></Routes></MemoryRouter>);
}

describe('DashboardLayout desktop sidebar width', () => {
  beforeEach(() => localStorage.clear());

  it('makes room for the icon rail and remembers the desktop preference', () => {
    const view = renderLayout();
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.getByText('Top bar').parentElement).toHaveClass('lg:pl-[72px]');
    expect(localStorage.getItem('hiusa_desktop_sidebar_collapsed')).toBe('true');

    view.unmount();
    renderLayout();
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(localStorage.getItem('hiusa_desktop_sidebar_collapsed')).toBe('false');
  });
});
