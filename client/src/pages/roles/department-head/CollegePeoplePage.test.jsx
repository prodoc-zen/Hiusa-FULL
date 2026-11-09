import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CollegePeoplePage from './CollegePeoplePage';

const people = vi.hoisted(() => ({ getCollegePeople: vi.fn() }));
const college = vi.hoisted(() => ({ removeCollegeStaff: vi.fn() }));
vi.mock('../../../services/collegePeopleService', () => people);
vi.mock('../../../services/collegeOrganizationService', () => college);
vi.mock('../../../components/people/AddStaffModal', () => ({
  default: ({ open }) => (open ? <div role="dialog" aria-label="Add office staff" /> : null),
}));
vi.mock('../../../components/org/ApplicantGrantModal', () => ({
  default: ({ open }) => (open ? <div role="dialog" aria-label="Allow a student to apply" /> : null),
}));
vi.mock('../../../components/students/StudentRecordsUpload', () => ({
  default: ({ collegeId, onSaved }) => (
    <div data-testid="records-upload">
      <p>{`upload for college ${collegeId}`}</p>
      <button type="button" onClick={onSaved}>Finish upload</button>
    </div>
  ),
}));
vi.mock('../../../lib/notify', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const pageOf = (rows, extra = {}) => ({ data: { data: rows, current_page: 1, last_page: 1, per_page: 25, total: rows.length, ...extra } });

const student = { school_id: 20261234, name: 'Ana Alvarez', email: 'ana@school.test', program: 'BSIT', year_level: '2nd Year', status: 'signed_up', organizations: [{ id: 3, name: 'Computing Society', position_title: 'Treasurer' }] };
const unclaimed = { school_id: 20260001, name: 'Cara Cruz', email: null, program: 'BSIT', year_level: '1st Year', status: 'not_signed_up', organizations: [] };
const dean = { school_id: 10001, name: 'Dana Dean', email: 'dana@school.test', role: 'DEPARTMENT_HEAD', position_title: 'Dean', is_lead_head: true, is_you: true };
const secretary = { school_id: 7100101, name: 'Sol Secretary', email: 'sol@school.test', role: 'ADMIN', position_title: 'College Secretary', is_lead_head: false, is_you: false };
const leader = { school_id: 20269999, name: 'Pia Perez', email: 'pia@school.test', role: 'ADMIN', position_title: 'President', organization: { id: 3, name: 'Computing Society' } };

const byTab = { students: [student, unclaimed], staff: [dean, secretary], leaders: [leader] };

const renderPage = () => render(<MemoryRouter><CollegePeoplePage /></MemoryRouter>);
const tab = (name) => fireEvent.click(screen.getByRole('tab', { name }));

describe('College people page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    people.getCollegePeople.mockImplementation(({ tab: key }) => Promise.resolve(pageOf(byTab[key])));
    localStorage.setItem('user', JSON.stringify({ role: 'DEPARTMENT_HEAD', organization: { id: 9, college_id: 5, organization_type: 'COLLEGE' } }));
    college.removeCollegeStaff.mockResolvedValue({ data: {} });
  });

  it('opens on students with names first, school ID as small detail, and sign-up status', async () => {
    renderPage();
    expect((await screen.findAllByText('Ana Alvarez')).length).toBeGreaterThan(0);
    expect(people.getCollegePeople).toHaveBeenCalledWith({ tab: 'students', q: undefined, page: 1, per_page: 20 });
    expect(screen.getAllByText('ana@school.test · ID 20261234').length).toBeGreaterThan(0);
    expect(screen.getAllByText('BSIT · 2nd Year').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Year 2nd Year/)).not.toBeInTheDocument();
    expect(screen.getAllByText('Computing Society').length).toBeGreaterThan(0);
    expect(within(screen.getByRole('table')).queryByText('Signed up')).not.toBeInTheDocument();
    expect(screen.getAllByText('Not signed up').length).toBeGreaterThan(0);
    expect(screen.getAllByText('ID 20260001').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Add staff' })).not.toBeInTheDocument();
  });

  it('shows loading, then an error with a working retry', async () => {
    people.getCollegePeople.mockRejectedValueOnce({ response: { data: { message: 'Server is busy.' } } });
    renderPage();
    expect(await screen.findByText('Server is busy.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect((await screen.findAllByText('Ana Alvarez')).length).toBeGreaterThan(0);
    expect(people.getCollegePeople).toHaveBeenCalledTimes(2);
  });

  it('prints a year level once, and has no Account column for a status the badge already says', async () => {
    people.getCollegePeople.mockImplementation(({ tab: key }) => Promise.resolve(pageOf(key === 'students' ? [{ ...student, year_level: '4th Year' }, { ...unclaimed, year_level: '1' }] : byTab[key])));
    renderPage();
    await screen.findAllByText('Ana Alvarez');

    expect(screen.getAllByText('BSIT · 4th Year').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Year 4th Year/)).not.toBeInTheDocument();
    expect(screen.getAllByText('BSIT · Year 1').length).toBeGreaterThan(0);
    expect(screen.queryByRole('columnheader', { name: 'Account' })).not.toBeInTheDocument();
    expect(screen.queryByText('Account')).not.toBeInTheDocument();
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
    tab('Leaders');
    expect(await screen.findByText('No organization leaders yet')).toBeInTheDocument();
  });

  it('searches with a debounce and says so when nothing matches', async () => {
    renderPage();
    await screen.findAllByText('Ana Alvarez');
    people.getCollegePeople.mockResolvedValue(pageOf([]));
    fireEvent.change(screen.getByLabelText('Search students'), { target: { value: 'zzz' } });
    await waitFor(() => expect(people.getCollegePeople).toHaveBeenLastCalledWith({ tab: 'students', q: 'zzz', page: 1, per_page: 20 }));
    expect(await screen.findByText('No results for "zzz"')).toBeInTheDocument();
  });

  it('clears the search from a Clear link and from the no-match state', async () => {
    renderPage();
    await screen.findAllByText('Ana Alvarez');
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search students'), { target: { value: 'zzz' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByLabelText('Search students')).toHaveValue('');
    await waitFor(() => expect(people.getCollegePeople).toHaveBeenLastCalledWith({ tab: 'students', q: undefined, page: 1, per_page: 20 }));
  });

  it('keeps one filled button on each tab', async () => {
    renderPage();
    await screen.findAllByText('Ana Alvarez');
    const filled = () => screen.queryAllByRole('button').filter((button) => button.classList.contains('bg-brand-700'));
    expect(filled().map((button) => button.textContent)).toEqual(['Allow a student to apply']);
    tab('Office staff');
    await screen.findAllByText('Sol Secretary');
    expect(filled().map((button) => button.textContent)).toEqual(['Add staff']);
    tab('Leaders');
    await screen.findAllByText('Pia Perez');
    expect(filled()).toHaveLength(0);
  });

  it('lists organization leaders with their organization and access', async () => {
    renderPage();
    await screen.findAllByText('Ana Alvarez');
    tab('Leaders');
    expect((await screen.findAllByText('Pia Perez')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Computing Society').length).toBeGreaterThan(0);
    expect(screen.getAllByText('President').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Organization head').length).toBeGreaterThan(0);
    expect(people.getCollegePeople).toHaveBeenLastCalledWith({ tab: 'leaders', q: undefined, page: 1, per_page: 20 });
  });

  it('opens the add staff dialog from the office staff tab only', async () => {
    renderPage();
    await screen.findAllByText('Ana Alvarez');
    tab('Office staff');
    await screen.findAllByText('Sol Secretary');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add staff' }));
    expect(await screen.findByRole('dialog', { name: 'Add office staff' })).toBeInTheDocument();
  });

  it('shows the ID number of staff who came from the school records as small text, but not an internal number', async () => {
    people.getCollegePeople.mockImplementation(({ tab: key }) => Promise.resolve(pageOf(key === 'staff' ? [dean, secretary, { ...secretary, school_id: 95000007, name: 'Ira Internal', email: 'ira@school.test' }] : byTab[key])));
    renderPage();
    await screen.findAllByText('Ana Alvarez');
    tab('Office staff');
    await screen.findAllByText('Sol Secretary');
    expect(screen.getAllByText('sol@school.test · ID 7100101').length).toBeGreaterThan(0);
    expect(screen.getAllByText('ira@school.test').length).toBeGreaterThan(0);
    expect(screen.queryByText(/95000007/)).not.toBeInTheDocument();
  });

  it('is one student list: no second records table, and not signed up students sit in the same list', async () => {
    renderPage();
    await screen.findAllByText('Ana Alvarez');
    expect(screen.getAllByRole('table')).toHaveLength(1);
    expect(screen.getAllByText('Cara Cruz').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Not signed up').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Student records' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hide student records' })).not.toBeInTheDocument();
    expect(screen.queryByText('Student records')).not.toBeInTheDocument();
  });

  it('opens the student records upload from the students toolbar, for the own college of the dean, on the students tab only', async () => {
    renderPage();
    await screen.findAllByText('Ana Alvarez');
    expect(screen.queryByTestId('records-upload')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Upload student records' }));
    expect(await screen.findByRole('dialog', { name: 'Upload student records' })).toBeInTheDocument();
    expect(screen.getByTestId('records-upload')).toHaveTextContent('upload for college 5');
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));
    await waitFor(() => expect(screen.queryByTestId('records-upload')).not.toBeInTheDocument());
    tab('Office staff');
    await screen.findAllByText('Sol Secretary');
    expect(screen.queryByRole('button', { name: 'Upload student records' })).not.toBeInTheDocument();
  });

  it('reloads the list from the first page, showing everyone, after records are saved', async () => {
    renderPage();
    await screen.findAllByText('Ana Alvarez');
    fireEvent.click(screen.getByRole('button', { name: 'Upload student records' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Finish upload' }));
    await waitFor(() => expect(people.getCollegePeople.mock.calls.filter(([params]) => params.tab === 'students').length).toBe(2));
    expect(people.getCollegePeople).toHaveBeenLastCalledWith({ tab: 'students', q: undefined, page: 1, per_page: 20 });
  });

  it('filters the one list to signed up or not signed up students and clears the filter', async () => {
    renderPage();
    await screen.findAllByText('Ana Alvarez');
    const show = screen.getByLabelText('Show');
    fireEvent.change(show, { target: { value: 'not_signed_up' } });
    await waitFor(() => expect(people.getCollegePeople).toHaveBeenLastCalledWith({ tab: 'students', q: undefined, show: 'not_signed_up', page: 1, per_page: 20 }));
    fireEvent.click(await screen.findByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(people.getCollegePeople).toHaveBeenLastCalledWith({ tab: 'students', q: undefined, page: 1, per_page: 20 }));
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'signed_up' } });
    await waitFor(() => expect(people.getCollegePeople).toHaveBeenLastCalledWith({ tab: 'students', q: undefined, show: 'signed_up', page: 1, per_page: 20 }));
    tab('Office staff');
    await screen.findAllByText('Sol Secretary');
    expect(screen.queryByLabelText('Show')).not.toBeInTheDocument();
    expect(people.getCollegePeople).toHaveBeenLastCalledWith({ tab: 'staff', q: undefined, page: 1, per_page: 20 });
  });

  it('lets the dean allow a student to apply from the students tab', async () => {
    renderPage();
    await screen.findAllByText('Ana Alvarez');
    fireEvent.click(screen.getByRole('button', { name: 'Allow a student to apply' }));
    expect(await screen.findByRole('dialog', { name: 'Allow a student to apply' })).toBeInTheDocument();
    tab('Office staff');
    await screen.findAllByText('Sol Secretary');
    expect(screen.queryByRole('button', { name: 'Allow a student to apply' })).not.toBeInTheDocument();
  });

  it('offers to upload student records when the college has no students yet', async () => {
    people.getCollegePeople.mockImplementation(({ tab: key }) => Promise.resolve(pageOf(key === 'students' ? [] : byTab[key])));
    renderPage();
    await screen.findByText('No students yet');
    fireEvent.click(screen.getAllByRole('button', { name: 'Upload student records' }).at(-1));
    expect(await screen.findByTestId('records-upload')).toBeInTheDocument();
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
    await waitFor(() => expect(college.removeCollegeStaff).toHaveBeenCalledWith(7100101));
    await waitFor(() => expect(people.getCollegePeople.mock.calls.filter(([params]) => params.tab === 'staff').length).toBe(2));
  });
});
