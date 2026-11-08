import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardLayout from './DashboardLayout';
import { PERIOD_EVENT, PERIOD_KEY } from '../../utils/academicPeriodStore';
import { SUB_ACCOUNT_KEY } from '../../utils/subAccountStore';

const mocks = vi.hoisted(() => ({ getActiveAcademicPeriod: vi.fn() }));

vi.mock('../../services/systemAdministrationService', () => ({ getActiveAcademicPeriod: mocks.getActiveAcademicPeriod }));
vi.mock('../../services/authService', () => ({ logout: vi.fn(), getAccountProfiles: vi.fn(), switchAccountProfile: vi.fn() }));
vi.mock('./Sidebar', () => ({ default: () => <nav>Side bar</nav> }));
vi.mock('./TopBar', () => ({ default: () => <div>Top bar</div> }));

const live = { id: 3, number: 1, status: 'active', academic_year: { label: '2026-2027' } };
const upcoming = { id: 4, number: 2, status: 'upcoming', academic_year: { label: '2026-2027' } };

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/dashboard/department-head']}>
      <Routes>
        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route path="department-head" element={<p>Dean page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('DashboardLayout planning and workspace banners', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('user', JSON.stringify({ role: 'DEPARTMENT_HEAD' }));
    mocks.getActiveAcademicPeriod.mockResolvedValue(live);
  });

  it('says in plain words what planning an upcoming semester means', async () => {
    localStorage.setItem(PERIOD_KEY, JSON.stringify(upcoming));
    renderLayout();

    const banner = await screen.findByRole('complementary', { name: 'Planning' });
    expect(banner).toHaveTextContent("You're planning AY 2026-2027 · 2nd Semester. New events, tasks and requirements you add are saved to that period.");
    expect(screen.queryByText(/Advance Planning Mode/)).not.toBeInTheDocument();
  });

  it('shows the banner when a period is chosen from the top bar and removes it on return', async () => {
    renderLayout();
    await screen.findByText('Dean page');
    expect(screen.queryByRole('complementary', { name: 'Planning' })).not.toBeInTheDocument();

    act(() => { window.dispatchEvent(new CustomEvent(PERIOD_EVENT, { detail: upcoming })); });
    fireEvent.click(await screen.findByRole('button', { name: 'Back to current semester' }));

    expect(screen.queryByRole('complementary', { name: 'Planning' })).not.toBeInTheDocument();
  });

  it('shows no planning banner while the current semester is chosen', async () => {
    localStorage.setItem(PERIOD_KEY, JSON.stringify(live));
    renderLayout();
    await screen.findByText('Dean page');

    expect(screen.queryByRole('complementary', { name: 'Planning' })).not.toBeInTheDocument();
  });

  it('shows the viewing banner for a dean inside an organization space, not the old oversight copy', async () => {
    sessionStorage.setItem(SUB_ACCOUNT_KEY, JSON.stringify({ id: 12, name: 'Computing Society', acronym: 'CS' }));
    renderLayout();

    expect(await screen.findByRole('button', { name: 'Back to mine' })).toBeInTheDocument();
    expect(screen.queryByText(/Sub-Account Oversight|Dean Supervisor/)).not.toBeInTheDocument();
  });
});
