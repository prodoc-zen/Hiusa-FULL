import { useEffect } from 'react';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const records = vi.hoisted(() => ({ getRecords: vi.fn() }));
vi.mock('./services/recordsService', () => records);
vi.mock('./components/layout/DashboardLayout', () => ({ default: () => <Outlet /> }));
vi.mock('./pages/auth/LandingPage', () => ({ default: () => <p>Landing</p> }));

const semester = { id: 4, number: 2, status: 'active', read_only: false, academic_year: { id: 2, label: '2026-2027' } };
const payload = {
  periods: [{ id: 2, label: '2026-2027', semesters: [{ id: 4, number: 2, status: 'active' }] }],
  semester,
  organizations: [{ id: 7, name: 'Code Guild', acronym: 'CG', college: 'College of Computing', lifecycle_status: 'active', counts: { events: 2, elections: 1, files: 3 } }],
  organization: null,
};

const nav = { go: null };
function Navigator() {
  const navigate = useNavigate();
  useEffect(() => { nav.go = navigate; }, [navigate]);
  return null;
}

describe('Records route after signing in without a page load', () => {
  beforeEach(() => {
    localStorage.clear();
    records.getRecords.mockResolvedValue(payload);
  });

  it.each(['SUPER_ADMIN', 'DEPARTMENT_HEAD'])('lists organizations for %s even though the app first rendered signed out', async (role) => {
    render(<MemoryRouter initialEntries={['/']}><App /><Navigator /></MemoryRouter>);
    expect(await screen.findByText('Landing')).toBeInTheDocument();

    localStorage.setItem('auth_token', 'token');
    localStorage.setItem('user', JSON.stringify({ role, first_name: 'Test', last_name: 'User' }));
    act(() => nav.go('/dashboard/records'));

    expect(await screen.findByRole('button', { name: /Code Guild/ })).toBeInTheDocument();
  });
});
