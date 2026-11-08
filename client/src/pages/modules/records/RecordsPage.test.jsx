import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RecordsPage from './RecordsPage';

const records = vi.hoisted(() => ({ getRecords: vi.fn() }));
const file = vi.hoisted(() => ({ openProtectedFile: vi.fn() }));
const notice = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('../../../services/recordsService', () => records);
vi.mock('../../../utils/openProtectedFile', () => file);
vi.mock('../../../lib/notify', () => ({ default: notice }));

const periods = [
  { id: 2, label: '2026-2027', semesters: [{ id: 3, number: 1, status: 'completed' }, { id: 4, number: 2, status: 'active' }] },
  { id: 1, label: '2025-2026', semesters: [{ id: 1, number: 1, status: 'completed' }, { id: 2, number: 2, status: 'completed' }] },
];
const past = { id: 3, number: 1, status: 'completed', read_only: true, academic_year: { id: 2, label: '2026-2027' } };
const current = { id: 4, number: 2, status: 'active', read_only: false, academic_year: { id: 2, label: '2026-2027' } };
const organizations = [
  { id: 7, name: 'Code Guild', acronym: 'CG', college: 'College of Computing', lifecycle_status: 'active', counts: { events: 2, elections: 1, files: 3 } },
  { id: 8, name: 'Builders Circle', acronym: 'BC', college: 'College of Engineering', lifecycle_status: 'archived', counts: { events: 0, elections: 0, files: 0 } },
];
const detail = {
  id: 7,
  name: 'Code Guild',
  acronym: 'CG',
  college: 'College of Computing',
  status: { lifecycle_status: 'active', recorded: true },
  officers: [{ school_id: 1, name: 'Ana Reyes', position_title: 'President', role: 'ADMIN' }],
  applications: [{ id: 5, name: 'Code Guild', status: 'approved', submitted_at: '2026-08-10T08:00:00Z', documents: [{ id: 9, item: 'Constitution', file_name: 'constitution.pdf', open_url: '/organization-applications/5/documents/9' }] }],
  documents: {
    compliance: [{ id: 11, source: 'compliance', item: 'Letter of Intent', file_name: 'loi.pdf', parent_title: '2026-2027, Semester 1', status: 'approved', submitted_at: '2026-09-01T08:00:00Z', open_url: '/compliance/submissions/11/document' }],
    event_files: [],
    financial_reports: [],
  },
  events: [{ id: 21, title: 'Orientation', status: 'completed', start_time: '2026-09-10T01:00:00Z', location: 'Hall' }],
  elections: [{ id: 31, title: 'SBO Election', status: 'closed', end_time: '2026-10-01T10:00:00Z', winners: [{ position: 'President', winners: [{ name: 'Ana Reyes', votes: 40 }] }] }],
};
const payload = (extra = {}) => ({ periods, semester: past, organizations, organization: null, ...extra });
const renderPage = (role = 'SUPER_ADMIN') => render(<MemoryRouter><RecordsPage role={role} /></MemoryRouter>);

describe('Records page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    records.getRecords.mockResolvedValue(payload());
    file.openProtectedFile.mockResolvedValue();
  });

  it('shows a skeleton first, then the period with a quiet Read only badge and the organization list', async () => {
    renderPage();
    expect(screen.getByRole('status', { name: 'Loading table' })).toBeInTheDocument();

    expect(await screen.findByRole('button', { name: /Code Guild/ })).toBeInTheDocument();
    expect(screen.getByText('Read only')).toBeInTheDocument();
    expect(screen.getByText('Choose an organization')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Builders Circle/ })).toBeInTheDocument();
    expect(records.getRecords).toHaveBeenCalledWith({});
  });

  it('opens an organization and lists officers, files, events and winners as plain sections', async () => {
    records.getRecords.mockImplementation((params) => Promise.resolve(payload(params.organization_id ? { organization: detail } : {})));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Code Guild/ }));

    const officers = await screen.findByRole('region', { name: /Officers/ });
    expect(within(officers).getByText('Ana Reyes')).toBeInTheDocument();
    expect(within(officers).getByText('President')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: /Compliance files/ })).getByText('Letter of Intent')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: /Event files/ })).getByText('No event files in this period.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: /Events/ })).getByText('Orientation')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: /Elections/ })).getByText(/Ana Reyes \(40 votes\)/)).toBeInTheDocument();
    expect(records.getRecords).toHaveBeenLastCalledWith({ organization_id: 7 });
  });

  it('says an election that has not closed ends later instead of calling it closed', async () => {
    const upcoming = { id: 32, title: 'Officer election', status: 'upcoming', end_time: '2027-01-05T09:00:00Z', winners: [] };
    records.getRecords.mockImplementation((params) => Promise.resolve(payload(params.organization_id ? { organization: { ...detail, elections: [detail.elections[0], upcoming] } } : {})));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Code Guild/ }));

    const elections = await screen.findByRole('region', { name: /Elections/ });
    expect(within(elections).getByText('Voting ends Jan 5, 2027')).toBeInTheDocument();
    expect(within(elections).getByText('Closed Oct 1, 2026')).toBeInTheDocument();
  });

  it('opens protected files through the authenticated helper and reports a failure', async () => {
    records.getRecords.mockResolvedValue(payload({ organization: detail }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Open loi.pdf' }));
    await waitFor(() => expect(file.openProtectedFile).toHaveBeenCalledWith('/compliance/submissions/11/document'));

    file.openProtectedFile.mockRejectedValueOnce(Object.assign(new Error('blocked'), { userMessage: 'Allow pop-ups to open this file.' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open constitution.pdf' }));
    await waitFor(() => expect(notice.error).toHaveBeenCalledWith('Allow pop-ups to open this file.'));
  });

  it('asks for another school year and another semester', async () => {
    renderPage();
    await screen.findByRole('button', { name: /Code Guild/ });

    fireEvent.click(screen.getByRole('radio', { name: '2nd semester' }));
    await waitFor(() => expect(records.getRecords).toHaveBeenLastCalledWith({ academic_semester_id: 4 }));

    fireEvent.change(screen.getByLabelText('School year'), { target: { value: '1' } });
    await waitFor(() => expect(records.getRecords).toHaveBeenLastCalledWith({ academic_year_id: 1 }));
  });

  it('collapses a record type with nothing in it to one muted line and keeps the others captioned', async () => {
    records.getRecords.mockResolvedValue(payload({ organization: detail }));
    renderPage();

    const empty = await screen.findByRole('region', { name: 'Event files' });
    expect(empty.querySelector('h3')).toBeNull();
    expect(empty.querySelector('ul')).toBeNull();
    expect(within(empty).getByText('No event files in this period.')).toHaveClass('text-ink-muted');
    expect(screen.getByRole('heading', { level: 3, name: /Officers/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /Compliance files/ })).toBeInTheDocument();
  });

  it('shows no badge for an organization in its default active state', async () => {
    records.getRecords.mockResolvedValue(payload({ organization: detail }));
    renderPage();

    await screen.findByRole('region', { name: /Officers/ });
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
    expect(screen.getByText('Archived')).toBeInTheDocument();
  });

  it('does not badge the current period as read only', async () => {
    records.getRecords.mockResolvedValue(payload({ semester: current }));
    renderPage();
    await screen.findByRole('button', { name: /Code Guild/ });
    expect(screen.queryByText('Read only')).not.toBeInTheDocument();
  });

  it('searches the organization list after a short pause', async () => {
    renderPage();
    await screen.findByRole('button', { name: /Code Guild/ });
    fireEvent.change(screen.getByLabelText('Find an organization'), { target: { value: 'guild' } });
    await waitFor(() => expect(records.getRecords).toHaveBeenLastCalledWith({ search: 'guild' }));
  });

  it('says so when the search finds nothing', async () => {
    records.getRecords.mockResolvedValue(payload({ organizations: [] }));
    renderPage('DEPARTMENT_HEAD');
    fireEvent.change(await screen.findByLabelText('Find an organization'), { target: { value: 'zzz' } });
    expect(await screen.findByText('No results for "zzz"')).toBeInTheDocument();
  });

  it('explains an empty list before anyone searches', async () => {
    records.getRecords.mockResolvedValue(payload({ organizations: [] }));
    renderPage('SUPER_ADMIN');

    expect(await screen.findByText('No organizations in this period')).toBeInTheDocument();
  });

  it('gives an organization admin their own records without a list', async () => {
    records.getRecords.mockResolvedValue(payload({ organizations: [], organization: detail }));
    renderPage('ADMIN');

    expect(await screen.findByRole('region', { name: /Officers/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('Find an organization')).not.toBeInTheDocument();
  });

  it('shows an error with a retry', async () => {
    records.getRecords.mockRejectedValueOnce(new Error('offline'));
    renderPage();

    expect(await screen.findByText('Records could not be loaded')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: /Code Guild/ })).toBeInTheDocument();
  });

  it('explains an empty archive', async () => {
    records.getRecords.mockResolvedValue({ periods: [], semester: null, organizations: [], organization: null });
    renderPage();

    expect(await screen.findByText('No school year records yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open academic years' })).toHaveAttribute('href', '/dashboard/super-admin/academic-years');
  });

  it('tells other roles who starts a semester instead of offering an action', async () => {
    records.getRecords.mockResolvedValue({ periods: [], semester: null, organizations: [], organization: null });
    renderPage('ADMIN');

    expect(await screen.findByText(/after the university administrator starts a semester/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open academic years' })).not.toBeInTheDocument();
  });

  it('warns when a past period has no recorded officers', async () => {
    records.getRecords.mockResolvedValue(payload({ organization: { ...detail, officers: [], status: { lifecycle_status: 'active', recorded: false } } }));
    renderPage();

    expect(await screen.findByText(/were not recorded for this period/)).toBeInTheDocument();
    expect(screen.getByText('No officers on record for this period.')).toBeInTheDocument();
  });
});
