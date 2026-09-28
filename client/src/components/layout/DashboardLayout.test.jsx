import { useEffect } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import DashboardLayout from './DashboardLayout';

vi.mock('../../services/notificationService', () => ({
  getNotifications: vi.fn().mockResolvedValue({ data: { data: [] } }),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
}));

vi.mock('../../services/authService', () => ({
  logout: vi.fn().mockResolvedValue(undefined),
}));

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
