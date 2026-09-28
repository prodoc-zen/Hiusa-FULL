import { useEffect } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardLayout from './DashboardLayout';

vi.mock('../../services/notificationService', () => ({
  getNotifications: vi.fn().mockResolvedValue({ data: { data: [] } }),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
}));

vi.mock('../../services/authService', () => ({
  logout: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./Sidebar', () => ({
  default: ({ desktopCollapsed, onToggleDesktop }) => <button type="button" onClick={onToggleDesktop}>{desktopCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}</button>,
}));
vi.mock('./TopBar', () => ({ default: () => <div>Top bar</div> }));

let mountCount = 0;

function TrackedPage({ label }) {
  useEffect(() => {
    mountCount += 1;
  }, []);
  return <p>{label}</p>;
}

function NavigateButton({ to }) {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(to)}>Go to {to}</button>;
}

describe('DashboardLayout', () => {
  it('wraps the routed page in route-fade-in, remounted fresh on every pathname change', () => {
    mountCount = 0;
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route element={<DashboardLayout />}>
            <Route path="/dashboard" element={(
              <>
                <TrackedPage label="Page one" />
                <NavigateButton to="/dashboard/other" />
              </>
            )} />
            <Route path="/dashboard/other" element={<TrackedPage label="Page two" />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Page one').closest('.route-fade-in')).not.toBeNull();
    expect(mountCount).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Go to /dashboard/other' }));

    expect(screen.getByText('Page two').closest('.route-fade-in')).not.toBeNull();
    expect(mountCount).toBe(2);
  });
});

describe('DashboardLayout desktop sidebar width', () => {
  beforeEach(() => localStorage.clear());

  function renderLayout() {
    return render(<MemoryRouter initialEntries={['/dashboard/admin']}><Routes><Route path="/dashboard" element={<DashboardLayout />}><Route path="admin" element={<div>Admin page</div>} /></Route></Routes></MemoryRouter>);
  }

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
