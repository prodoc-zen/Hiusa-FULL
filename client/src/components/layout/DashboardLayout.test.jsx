import { lazy, Suspense, useEffect } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
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
vi.mock('./TopBar', () => ({ default: ({ title }) => <div>Top bar<span data-testid="page-title">{title}</span></div> }));

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
  it('wraps routed pages in route-fade-in without remounting matching page components', () => {
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
    expect(mountCount).toBe(1);
  });

  it('keeps the dashboard shell visible while a lazy route loads', () => {
    const LoadingPage = lazy(() => new Promise(() => {}));
    render(
      <MemoryRouter initialEntries={['/dashboard/elections']}>
        <Suspense fallback={<p>Whole app loading</p>}>
          <Routes>
            <Route path="/dashboard" element={<DashboardLayout />}>
              <Route path="elections" element={<LoadingPage />} />
            </Route>
          </Routes>
        </Suspense>
      </MemoryRouter>,
    );

    expect(screen.getByText('Top bar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading page' })).toBeInTheDocument();
    expect(screen.queryByText('Whole app loading')).not.toBeInTheDocument();
  });

  it('preserves a nested page while switching its child routes', () => {
    mountCount = 0;
    function ElectionParent() {
      useEffect(() => { mountCount += 1; }, []);
      return <><NavigateButton to="/dashboard/elections/results" /><Outlet /></>;
    }

    render(
      <MemoryRouter initialEntries={['/dashboard/elections/candidates']}>
        <Routes>
          <Route path="/dashboard" element={<DashboardLayout />}>
            <Route path="elections" element={<ElectionParent />}>
              <Route path="candidates" element={<p>Candidates</p>} />
              <Route path="results" element={<p>Results</p>} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Candidates')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Go to /dashboard/elections/results' }));
    expect(screen.getByText('Results')).toBeInTheDocument();
    expect(mountCount).toBe(1);
  });
});

describe('DashboardLayout page titles', () => {
  it.each([
    ['/dashboard/super-admin/agency', 'Agency overview'],
    ['/dashboard/department-head/organizations', 'Organizations'],
    ['/dashboard/super-admin/organizations/12', 'Organization overview'],
    ['/dashboard/super-admin/organizations', 'Organizations'],
    ['/dashboard/super-admin/compliance', 'Compliance and Accreditation'],
    ['/dashboard/super-admin/financial-reports', 'Dashboard'],
    ['/dashboard/super-admin/approvals', 'Dashboard'],
    ['/dashboard/super-admin/event-requirements', 'Dashboard'],
  ])('titles %s as %s', (path, title) => {
    render(<MemoryRouter initialEntries={[path]}><Routes><Route path="*" element={<DashboardLayout />} /></Routes></MemoryRouter>);
    expect(screen.getByTestId('page-title')).toHaveTextContent(title);
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
