import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AcademicYearsPage from './AcademicYearsPage';
import CreateClearancePeriodModal from '../../modules/clearances/CreateClearancePeriodModal';
import { closeAcademicYear, createAcademicYear, deleteAcademicSemester, getAcademicYears, makeAcademicYearCurrent } from '../../../services/systemAdministrationService';

vi.mock('../../../services/systemAdministrationService', () => ({
  getAcademicYears: vi.fn(),
  createAcademicYear: vi.fn(),
  updateAcademicYear: vi.fn(),
  makeAcademicYearCurrent: vi.fn(),
  closeAcademicYear: vi.fn(),
  createAcademicSemester: vi.fn(),
  activateAcademicSemester: vi.fn(),
  closeAcademicSemester: vi.fn(),
  deleteAcademicYear: vi.fn(),
  deleteAcademicSemester: vi.fn(),
}));
vi.mock('../../../services/clearanceService', () => ({ createClearancePeriod: vi.fn() }));
vi.mock('../../../lib/notify', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const years = [
  { id: 2, label: '2027-2028', starts_on: '2027-08-01', ends_on: '2028-05-31', is_current: false },
  { id: 1, label: '2026-2027', starts_on: '2026-08-01', ends_on: '2027-05-31', is_current: true },
];

const renderPage = () => render(<MemoryRouter><AcademicYearsPage /></MemoryRouter>);

describe('AcademicYearsPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('names the current year, links the start-of-year work, and protects the current row', async () => {
    vi.mocked(getAcademicYears).mockResolvedValue(years);
    renderPage();

    expect(await screen.findByText('2026-2027 is the current year')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /accreditation requirements/ })).toHaveAttribute('href', '/dashboard/super-admin/compliance');
    expect(screen.getByRole('link', { name: /Hand over administrator roles/ })).toHaveAttribute('href', '/dashboard/super-admin/admins');
    // The table renders a desktop row and a mobile card for each year.
    expect(screen.queryAllByRole('button', { name: 'Remove 2026-2027' })).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: 'Remove 2027-2028' }).length).toBeGreaterThan(0);
  });

  it('makes another year current after confirmation', async () => {
    vi.mocked(getAcademicYears).mockResolvedValue(years);
    vi.mocked(makeAcademicYearCurrent).mockResolvedValue({ ...years[0], is_current: true });
    renderPage();

    fireEvent.click((await screen.findAllByRole('button', { name: 'Make current' }))[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Make this the current year' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make current' }));

    await waitFor(() => expect(makeAcademicYearCurrent).toHaveBeenCalledWith(2));
  });

  it('closes the year only after both semesters are completed', async () => {
    vi.mocked(getAcademicYears).mockResolvedValue([
      { ...years[1], semesters: [{ id: 1, number: 1, status: 'completed' }, { id: 2, number: 2, status: 'completed' }] },
    ]);
    vi.mocked(closeAcademicYear).mockResolvedValue({ ...years[1], is_current: false });
    renderPage();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Close year' }))[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Complete academic year' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close year' }));
    await waitFor(() => expect(closeAcademicYear).toHaveBeenCalledWith(1));
  });

  describe('deleting a semester', () => {
    const withSemesters = [{ ...years[1], semesters: [
      { id: 11, number: 1, status: 'active', starts_on: '2026-08-01', ends_on: '2026-12-15' },
      { id: 12, number: 2, status: 'upcoming', starts_on: '2027-01-05', ends_on: '2027-05-31' },
    ] }];

    it('offers delete only for semesters that are not active', async () => {
      vi.mocked(getAcademicYears).mockResolvedValue(withSemesters);
      renderPage();
      expect(await screen.findByRole('button', { name: 'Delete 2nd semester of AY 2026-2027' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Delete 1st semester of AY 2026-2027' })).not.toBeInTheDocument();
    });

    it('deletes after confirmation and reloads the calendar', async () => {
      vi.mocked(getAcademicYears).mockResolvedValue(withSemesters);
      vi.mocked(deleteAcademicSemester).mockResolvedValue('');
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Delete 2nd semester of AY 2026-2027' }));
      const dialog = await screen.findByRole('dialog', { name: 'Delete semester' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete semester' }));

      await waitFor(() => expect(deleteAcademicSemester).toHaveBeenCalledWith(12));
      await waitFor(() => expect(getAcademicYears).toHaveBeenCalledTimes(2));
    });

    it('shows the server message and the blocking reasons on a 409', async () => {
      vi.mocked(getAcademicYears).mockResolvedValue(withSemesters);
      vi.mocked(deleteAcademicSemester).mockRejectedValue({ response: { status: 409, data: { message: 'This semester cannot be deleted because of: events, tasks.', reasons: ['events', 'tasks'] } } });
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Delete 2nd semester of AY 2026-2027' }));
      const dialog = await screen.findByRole('dialog', { name: 'Delete semester' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete semester' }));

      const alert = await screen.findByRole('alert');
      expect(within(alert).getByText('This semester cannot be deleted because of: events, tasks.')).toBeInTheDocument();
      expect(within(alert).getByText('events')).toBeInTheDocument();
      expect(within(alert).getByText('tasks')).toBeInTheDocument();
    });
  });

  it('suggests the label from the start date and shows field errors from the server', async () => {
    vi.mocked(getAcademicYears).mockResolvedValue([]);
    vi.mocked(createAcademicYear).mockRejectedValue({ response: { status: 422, data: { message: 'Invalid', errors: { starts_on: ['These dates overlap 2026-2027.'] } } } });
    renderPage();

    expect(await screen.findByText('No academic year set')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Add academic year' })[0]);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Starts on/), { target: { value: '2027-08-01' } });
    expect(within(dialog).getByLabelText(/Label/)).toHaveValue('2027-2028');
    fireEvent.change(within(dialog).getByLabelText(/Ends on/), { target: { value: '2028-05-31' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add academic year' }));

    expect(await within(dialog).findByText('These dates overlap 2026-2027.')).toBeInTheDocument();
    expect(createAcademicYear).toHaveBeenCalledWith({ label: '2027-2028', starts_on: '2027-08-01', ends_on: '2028-05-31' });
  });
});

describe('CreateClearancePeriodModal', () => {
  it('starts with the current academic year filled in', async () => {
    vi.mocked(getAcademicYears).mockResolvedValue(years);
    render(<CreateClearancePeriodModal open onClose={vi.fn()} onCreated={vi.fn()} />);

    await waitFor(() => expect(screen.getByLabelText(/Academic year/)).toHaveValue('2026-2027'));
  });
});
