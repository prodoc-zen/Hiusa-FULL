import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CollegePeoplePage from './CollegePeoplePage';

const people = vi.hoisted(() => ({ getCollegePeople: vi.fn(), inviteCollegeStaff: vi.fn() }));
const college = vi.hoisted(() => ({ removeCollegeStaff: vi.fn() }));
vi.mock('../../../services/collegePeopleService', () => people);
vi.mock('../../../services/collegeOrganizationService', () => college);
vi.mock('../../../lib/notify', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const pageOf = (rows, extra = {}) => ({ data: { data: rows, current_page: 1, last_page: 1, per_page: 25, total: rows.length, ...extra } });

const student = { school_id: 20261234, name: 'Ana Alvarez', email: 'ana@school.test', program: 'BSIT', year_level: '2', status: 'signed_up', organizations: [{ id: 3, name: 'Computing Society', position_title: 'Treasurer' }] };
const unclaimed = { school_id: 20260001, name: 'Cara Cruz', email: null, program: 'BSIT', year_level: '1', status: 'not_signed_up', organizations: [] };
const dean = { school_id: 10001, name: 'Dana Dean', email: 'dana@school.test', role: 'DEPARTMENT_HEAD', position_title: 'Dean', is_lead_head: true, is_you: true };
const secretary = { school_id: 10002, name: 'Sol Secretary', email: 'sol@school.test', role: 'ADMIN', position_title: 'College Secretary', is_lead_head: false, is_you: false };
const leader = { school_id: 20269999, name: 'Pia Perez', email: 'pia@school.test', role: 'ADMIN', position_title: 'President', organization: { id: 3, name: 'Computing Society' } };

const byTab = { students: [student, unclaimed], staff: [dean, secretary], leaders: [leader] };

const renderPage = () => render(<MemoryRouter><CollegePeoplePage /></MemoryRouter>);
const tab = (name) => fireEvent.click(screen.getByRole('tab', { name }));

describe('College people page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    people.getCollegePeople.mockImplementation(({ tab: key }) => Promise.resolve(pageOf(byTab[key])));
    people.inviteCollegeStaff.mockResolvedValue({ data: { magic_link: 'http://localhost/invite/abc' } });
    college.removeCollegeStaff.mockResolvedValue({ data: {} });
  });

  it('opens on students with names first, school ID as small detail, and sign-up status', async () => {
    renderPage();
    expect((await screen.findAllByText('Ana Alvarez')).length).toBeGreaterThan(0);
    expect(people.getCollegePeople).toHaveBeenCalledWith({ tab: 'students', q: undefined, page: 1 });
    expect(screen.getAllByText('ana@school.test · ID 20261234').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Computing Society').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Signed up').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Not signed up').length).toBeGreaterThan(0);
    expect(screen.getAllByText('ID 20260001').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Invite staff' })).not.toBeInTheDocument();
  });

  it('shows loading, then an error with a working retry', async () => {
    people.getCollegePeople.mockRejectedValueOnce({ response: { data: { message: 'Server is busy.' } } });
    renderPage();
    expect(await screen.findByText('Server is busy.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect((await screen.findAllByText('Ana Alvarez')).length).toBeGreaterThan(0);
    expect(people.getCollegePeople).toHaveBeenCalledTimes(2);
  });

  it('shows the error when a tab other than the first fails to load', async () => {
    renderPage();
    await screen.findAllByText('Ana Alvarez');
    people.getCollegePeople.mockRejectedValueOnce({ response: { data: { message: 'Staff list is unavailable.' } } });
    tab('Office staff');
    expect(await screen.findByText('Staff list is unavailable.')).toBeInTheDocument();
  });

  it('shows a plain empty state on a college with nobody yet', async () => {
    people.getCollegePeople.mockResolvedValue(pageOf([]));
    renderPage();
    expect(await screen.findByText('No students yet')).toBeInTheDocument();
    tab('Organization leaders');
    expect(await screen.findByText('No organization leaders yet')).toBeInTheDocument();
  });

  it('searches with a debounce and says so when nothing matches', async () => {
    renderPage();
    await screen.findAllByText('Ana Alvarez');
    people.getCollegePeople.mockResolvedValue(pageOf([]));
    fireEvent.change(screen.getByLabelText('Search students'), { target: { value: 'zzz' } });
    await waitFor(() => expect(people.getCollegePeople).toHaveBeenLastCalledWith({ tab: 'students', q: 'zzz', page: 1 }));
    expect(await screen.findByText('No results for "zzz"')).toBeInTheDocument();
  });

  it('lists organization leaders with their organization and access', async () => {
    renderPage();
    await screen.findAllByText('Ana Alvarez');
    tab('Organization leaders');
    expect((await screen.findAllByText('Pia Perez')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Computing Society').length).toBeGreaterThan(0);
    expect(screen.getAllByText('President').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Organization head').length).toBeGreaterThan(0);
    expect(people.getCollegePeople).toHaveBeenLastCalledWith({ tab: 'leaders', q: undefined, page: 1 });
  });

  it('creates an invite link for office staff without asking for any school ID', async () => {
    renderPage();
    await screen.findAllByText('Ana Alvarez');
    tab('Office staff');
    await screen.findAllByText('Sol Secretary');
    fireEvent.click(screen.getByRole('button', { name: 'Invite staff' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText(/school id/i)).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create link' }));
    await waitFor(() => expect(people.inviteCollegeStaff).toHaveBeenCalledWith({}));
    expect(await within(dialog).findByDisplayValue('http://localhost/invite/abc')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
  });

  it('passes the optional email along and shows an error when the link cannot be made', async () => {
    people.inviteCollegeStaff.mockRejectedValueOnce({ response: { data: { message: 'This college already has a pending link.' } } });
    renderPage();
    await screen.findAllByText('Ana Alvarez');
    tab('Office staff');
    await screen.findAllByText('Sol Secretary');
    fireEvent.click(screen.getByRole('button', { name: 'Invite staff' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Send it to/), { target: { value: 'sol@school.test' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create link' }));
    expect(await within(dialog).findByText('This college already has a pending link.')).toBeInTheDocument();
    expect(people.inviteCollegeStaff).toHaveBeenCalledWith({ email: 'sol@school.test' });
  });

  it('removes a staff member after confirming, but never offers it for the dean or yourself', async () => {
    renderPage();
    await screen.findAllByText('Ana Alvarez');
    tab('Office staff');
    await screen.findAllByText('Sol Secretary');
    expect(screen.queryByRole('button', { name: 'Remove Dana Dean' })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove Sol Secretary' })[0]);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(college.removeCollegeStaff).toHaveBeenCalledWith(10002));
    await waitFor(() => expect(people.getCollegePeople.mock.calls.filter(([params]) => params.tab === 'staff').length).toBe(2));
  });
});
