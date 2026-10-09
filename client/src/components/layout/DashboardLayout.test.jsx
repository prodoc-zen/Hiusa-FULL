import { lazy, Suspense, useEffect, useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PageHeader from '../ui/PageHeader';
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

function renderRouted(path, page, role = 'ADMIN') {
  localStorage.setItem('user', JSON.stringify({ role, first_name: 'Test', last_name: 'User' }));
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<DashboardLayout />}>
          <Route path="*" element={page} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function crumbLabels() {
  return within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getAllByRole('listitem').map((item) => item.textContent);
}

describe('DashboardLayout page header', () => {
  beforeEach(() => localStorage.clear());

  it.each([
    ['SUPER_ADMIN', '/dashboard/super-admin/agency', 'Agency overview', /across organizations, colleges, and compliance/, ['Home', 'Organizations', 'Agency overview']],
    ['ADMIN', '/dashboard/finance/budget-allocation', 'Budgets', /Plan and review organization budgets/, ['Home', 'Finance', 'Budgets']],
    ['DEPARTMENT_HEAD', '/dashboard/department-head/organizations', 'Organizations', /student organizations in your college/, ['Home', 'Organizations']],
    ['STUDENT', '/dashboard/events/activity-calendar', 'Events', /Browse approved activities/, ['Home', 'Events']],
    ['SBO_OFFICER', '/dashboard/events/activity-calendar', 'Calendar', /Browse approved activities/, ['Home', 'Events and tasks', 'Calendar']],
  ])('gives a page without a header of its own one h1, a purpose and a breadcrumb for %s on %s', (role, path, title, purpose, crumbs) => {
    renderRouted(path, <p>Plain page body</p>, role);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByText(purpose)).toBeInTheDocument();
    expect(screen.getAllByRole('navigation', { name: 'Breadcrumb' })).toHaveLength(1);
    expect(crumbLabels()).toEqual(crumbs);
    expect(screen.getByText('Plain page body')).toBeInTheDocument();
  });

  it('leaves the purpose off a role home, where the briefing already says it', () => {
    renderRouted('/dashboard/admin', <p>Briefing</p>);
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByText(/what needs attention/i)).not.toBeInTheDocument();
    expect(crumbLabels()).toEqual(['Home']);
  });

  it('shows the default header while a lazy page loads, so the person still sees where they are', () => {
    const LoadingPage = lazy(() => new Promise(() => {}));
    renderRouted('/dashboard/finance/budget-allocation', <LoadingPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Budgets' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading page' })).toBeInTheDocument();
  });

  it('adds no title of its own when the page renders a PageHeader, and its breadcrumb is the only one', () => {
    renderRouted('/dashboard/finance/budget-allocation', <PageHeader title="Budget planning" description="Own description." />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Budget planning' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Budgets' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('navigation', { name: 'Breadcrumb' })).toHaveLength(1);
    expect(crumbLabels()).toEqual(['Home', 'Finance', 'Budgets']);
    expect(screen.getByText('Own description.')).toBeInTheDocument();
    expect(screen.queryByText(/Plan and review organization budgets/)).not.toBeInTheDocument();
  });

  it('keeps one h1 and gains the breadcrumb for a page that still writes its own h1', async () => {
    renderRouted('/dashboard/my-clearance', <h1>My clearance</h1>, 'STUDENT');

    await waitFor(() => expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1));
    expect(screen.getByRole('heading', { level: 1, name: 'My clearance' })).toBeInTheDocument();
    expect(crumbLabels()).toEqual(['Home', 'Support', 'My clearance']);
  });

  it('swaps back to the default header when the page header goes away', async () => {
    function Page() {
      const [open, setOpen] = useState(true);
      return <>{open && <PageHeader title="Budget planning" />}<button type="button" onClick={() => setOpen(false)}>Hide header</button></>;
    }
    renderRouted('/dashboard/finance/budget-allocation', <Page />);
    expect(screen.getByRole('heading', { level: 1, name: 'Budget planning' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Hide header' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Budgets' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('prints no header for a path with no meta, such as a redirect that is about to leave', () => {
    renderRouted('/dashboard/admin/sbo-positions', <p>Leaving</p>);
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument();
  });

  it('has one h1 after the person moves from a page with a header to a page without one', () => {
    function Pages() {
      const navigate = useNavigate();
      return (
        <>
          <PageHeader title="Own title" />
          <button type="button" onClick={() => navigate('/dashboard/events/check-in')}>Go on</button>
        </>
      );
    }
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN', first_name: 'Test', last_name: 'User' }));
    render(
      <MemoryRouter initialEntries={['/dashboard/finance/budget-allocation']}>
        <Routes>
          <Route element={<DashboardLayout />}>
            <Route path="/dashboard/finance/budget-allocation" element={<Pages />} />
            <Route path="/dashboard/events/check-in" element={<p>Check-in page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Go on' }));
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Check-in' })).toBeInTheDocument();
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
