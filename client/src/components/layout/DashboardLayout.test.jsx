import { lazy, Suspense, useEffect, useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  it('renders routed pages without a fade wrapper and without remounting matching page components', () => {
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

    expect(screen.getByText('Page one').closest('.route-fade-in')).toBeNull();
    expect(mountCount).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Go to /dashboard/other' }));

    expect(screen.getByText('Page two').closest('.route-fade-in')).toBeNull();
    expect(mountCount).toBe(1);
  });

  it('starts with a skip link that moves focus past the menu to the page content', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route element={<DashboardLayout />}>
            <Route path="/dashboard" element={<TrackedPage label="Page one" />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const skip = screen.getByRole('link', { name: 'Skip to main content' });
    expect(document.querySelector('a, button')).toBe(skip);
    fireEvent.click(skip);
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('makes the scrolling main the containing block, so a hidden file input cannot stretch the document past the shell', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route element={<DashboardLayout />}>
            <Route path="/dashboard" element={<TrackedPage label="Page one" />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const main = screen.getByText('Page one').closest('main');
    expect(main).toHaveClass('relative', 'overflow-y-auto');
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

  it('keeps the shell and shows a plain message when a page file cannot be loaded', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const OfflinePage = lazy(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/Announcements.js')));
    render(
      <MemoryRouter initialEntries={['/dashboard/announcements']}>
        <Routes>
          <Route path="/dashboard" element={<DashboardLayout />}>
            <Route path="announcements" element={<OfflinePage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('This page could not load')).toBeInTheDocument();
    expect(screen.getByText('Check your connection and try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByText('Top bar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument();
    consoleError.mockRestore();
  });

  it('shows the page again on Try again, and clears the message when the person opens another page', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    let failing = true;
    const FlakyPage = () => {
      if (failing) throw new Error('boom');
      return <p>Recovered page</p>;
    };
    render(
      <MemoryRouter initialEntries={['/dashboard/flaky']}>
        <NavigateButton to="/dashboard/other" />
        <Routes>
          <Route path="/dashboard" element={<DashboardLayout />}>
            <Route path="flaky" element={<FlakyPage />} />
            <Route path="other" element={<TrackedPage label="Page two" />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('This page could not load')).toBeInTheDocument();

    failing = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Recovered page')).toBeInTheDocument();

    failing = true;
    fireEvent.click(screen.getByRole('button', { name: 'Go to /dashboard/other' }));
    expect(await screen.findByText('Page two')).toBeInTheDocument();
    expect(screen.queryByText('This page could not load')).not.toBeInTheDocument();
    consoleError.mockRestore();
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

describe('DashboardLayout page header', () => {
  beforeEach(() => localStorage.clear());

  it.each([
    ['SUPER_ADMIN', '/dashboard/organization-applications', 'Applications', /Review verified applications/],
    ['ADMIN', '/dashboard/finance/budget-allocation', 'Budgets', /Plan and review organization budgets/],
    ['DEPARTMENT_HEAD', '/dashboard/department-head/organizations', 'Organizations', /student organizations in your college/],
    ['STUDENT', '/dashboard/events/activity-calendar', 'Events', /Browse approved activities/],
    ['SBO_OFFICER', '/dashboard/events/activity-calendar', 'Calendar', /Browse approved activities/],
  ])('gives a page without a header of its own one h1 and no lead line or breadcrumbs for %s on %s', (role, path, title, purpose) => {
    renderRouted(path, <p>Plain page body</p>, role);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.queryByText(purpose)).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument();
    expect(screen.getByText('Plain page body')).toBeInTheDocument();
  });

  it('prints a role home as a plain title, where the briefing already says the rest', () => {
    renderRouted('/dashboard/admin', <p>Briefing</p>);
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByText(/what needs attention/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument();
  });

  it('shows the default header while a lazy page loads, so the person still sees where they are', () => {
    const LoadingPage = lazy(() => new Promise(() => {}));
    renderRouted('/dashboard/finance/budget-allocation', <LoadingPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Budgets' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading page' })).toBeInTheDocument();
  });

  it('adds no title of its own when the page renders a PageHeader', () => {
    renderRouted('/dashboard/finance/budget-allocation', <PageHeader title="Budget planning" description="Own description." />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Budget planning' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Budgets' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument();
    expect(screen.getByText('Own description.')).toBeInTheDocument();
    expect(screen.queryByText(/Plan and review organization budgets/)).not.toBeInTheDocument();
  });

  it('keeps one h1 for a page that still writes its own h1', async () => {
    renderRouted('/dashboard/my-clearance', <h1>My clearance</h1>, 'STUDENT');

    await waitFor(() => expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1));
    expect(screen.getByRole('heading', { level: 1, name: 'My clearance' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument();
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

  it('shows no welcome banner or tour entry on a first visit, and stores nothing about one', () => {
    localStorage.clear();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN', first_name: 'President', last_name: 'Admin' }));

    render(
      <MemoryRouter initialEntries={['/dashboard/admin']}>
        <Routes>
          <Route path="/dashboard" element={<DashboardLayout />}>
            <Route path="admin" element={<div>Admin Home Page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Admin Home Page')).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Welcome and tour guide' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Start 2-Min Tour|Welcome to your HIUSA Workspace/)).not.toBeInTheDocument();

    act(() => { window.dispatchEvent(new CustomEvent('hiusa-open-onboarding-tour')); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(localStorage.getItem('hiusa_tour_seen_ADMIN')).toBeNull();
  });
});
