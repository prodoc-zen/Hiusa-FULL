import { findRowAction } from '../../../test/rowActions';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AcademicYearsPage from './AcademicYearsPage';
import CreateClearancePeriodModal from '../../modules/clearances/CreateClearancePeriodModal';
import { activateAcademicSemester, closeAcademicSemester, closeAcademicYear, createAcademicYear, deleteAcademicSemester, getAcademicYears, makeAcademicYearCurrent, reopenAcademicSemester } from '../../../services/systemAdministrationService';

vi.mock('../../../services/systemAdministrationService', () => ({
  getAcademicYears: vi.fn(),
  createAcademicYear: vi.fn(),
  updateAcademicYear: vi.fn(),
  makeAcademicYearCurrent: vi.fn(),
  closeAcademicYear: vi.fn(),
  createAcademicSemester: vi.fn(),
  activateAcademicSemester: vi.fn(),
  closeAcademicSemester: vi.fn(),
  reopenAcademicSemester: vi.fn(),
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
    expect(screen.getByRole('link', { name: "Review each organization's administrators after elections: add the new ones, remove the old ones" })).toHaveAttribute('href', '/dashboard/super-admin/admins');
    expect(screen.queryByText(/hand over/i)).not.toBeInTheDocument();
    // The table renders a desktop row and a mobile card for each year.
    fireEvent.click(screen.getAllByRole('button', { name: 'Actions for 2026-2027' })[0]);
    expect(screen.queryByRole('menuitem', { name: 'Remove 2026-2027' })).not.toBeInTheDocument();
    expect(await findRowAction('Remove 2027-2028', '2027-2028')).toBeInTheDocument();
  });

  it('makes another year current after confirmation', async () => {
    vi.mocked(getAcademicYears).mockResolvedValue(years);
    vi.mocked(makeAcademicYearCurrent).mockResolvedValue({ ...years[0], is_current: true });
    renderPage();

    fireEvent.click(await findRowAction('Make current'));
    const dialog = await screen.findByRole('dialog', { name: 'Make this the current year' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make current' }));

    await waitFor(() => expect(makeAcademicYearCurrent).toHaveBeenCalledWith(2));
  });

  it('tells the SAO that making a year current does not start a semester and is refused while another year is live', async () => {
    vi.mocked(getAcademicYears).mockResolvedValue([
      years[0],
      { ...years[1], semesters: [{ id: 11, number: 1, status: 'active', starts_on: '2026-08-01', ends_on: '2026-12-15' }] },
    ]);
    renderPage();

    fireEvent.click(await findRowAction('Make current'));
    const dialog = await screen.findByRole('dialog', { name: 'Make this the current year' });
    expect(within(dialog).getByText(/This does not start a semester\./)).toBeInTheDocument();
    expect(within(dialog).getByText(/A semester in AY 2026-2027 is active, so this is refused until you activate a semester in this year\./)).toBeInTheDocument();
    expect(makeAcademicYearCurrent).not.toHaveBeenCalled();
  });

  it('warns that a completed year cannot be reopened before closing it', async () => {
    vi.mocked(getAcademicYears).mockResolvedValue([
      { ...years[1], semesters: [{ id: 1, number: 1, status: 'completed' }, { id: 2, number: 2, status: 'completed' }] },
    ]);
    renderPage();
    fireEvent.click(await findRowAction('Close year'));
    const dialog = await screen.findByRole('dialog', { name: 'Complete academic year' });
    expect(within(dialog).getByText(/A completed year cannot be reopened\./)).toBeInTheDocument();
    expect(closeAcademicYear).not.toHaveBeenCalled();
  });

  it('closes the year only after both semesters are completed', async () => {
    vi.mocked(getAcademicYears).mockResolvedValue([
      { ...years[1], semesters: [{ id: 1, number: 1, status: 'completed' }, { id: 2, number: 2, status: 'completed' }] },
    ]);
    vi.mocked(closeAcademicYear).mockResolvedValue({ ...years[1], is_current: false });
    renderPage();
    fireEvent.click(await findRowAction('Close year'));
    const dialog = await screen.findByRole('dialog', { name: 'Complete academic year' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close year' }));
    await waitFor(() => expect(closeAcademicYear).toHaveBeenCalledWith(1));
  });

  describe('deleting a semester', () => {
    const withSemesters = [{ ...years[1], semesters: [
      { id: 11, number: 1, status: 'active', starts_on: '2026-08-01', ends_on: '2026-12-15' },
      { id: 12, number: 2, status: 'upcoming', starts_on: '2026-10-05', ends_on: '2027-05-31' },
    ] }];

    it('offers delete only for semesters that are not active and shows a plain status with a Close or Activate button', async () => {
      vi.mocked(getAcademicYears).mockResolvedValue(withSemesters);
      renderPage();
      expect((await screen.findAllByText('Current'))[0]).toHaveClass('bg-green-50', 'text-green-800');
      expect(screen.getAllByText('Active', { exact: true })[0]).toBeInTheDocument();
      expect(screen.queryByRole('switch')).not.toBeInTheDocument();
      expect(screen.queryByText('Inactive')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Close 1st semester of AY 2026-2027' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Activate 2nd semester of AY 2026-2027' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Delete 2nd semester of AY 2026-2027' })).toBeInTheDocument();
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

      const alert = await within(dialog).findByRole('alert');
      expect(within(alert).getByText('This semester cannot be deleted because of: events, tasks.')).toBeInTheDocument();
      expect(within(alert).getByText('events')).toBeInTheDocument();
      expect(within(alert).getByText('tasks')).toBeInTheDocument();
    });
  });

  describe('changing the active semester', () => {
    const withSemesters = [{ ...years[1], semesters: [
      { id: 11, number: 1, status: 'active', starts_on: '2026-08-01', ends_on: '2026-12-15' },
      { id: 12, number: 2, status: 'upcoming', starts_on: '2026-10-05', ends_on: '2027-05-31' },
    ] }];

    it('sends nothing when Close semester is pressed and closes the semester only after confirmation', async () => {
      vi.mocked(getAcademicYears).mockResolvedValue(withSemesters);
      vi.mocked(closeAcademicSemester).mockResolvedValue({});
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Close 1st semester of AY 2026-2027' }));

      const dialog = await screen.findByRole('dialog', { name: 'Close semester' });
      expect(within(dialog).getAllByText('1st semester, AY 2026-2027').length).toBeGreaterThan(0);
      expect(within(dialog).getByText(/Members stop seeing its data, and the app has no active semester until the next one is activated\./)).toBeInTheDocument();
      expect(within(dialog).getByText(/You can activate 2nd semester, AY 2026-2027 afterwards\./)).toBeInTheDocument();
      expect(closeAcademicSemester).not.toHaveBeenCalled();
      expect(activateAcademicSemester).not.toHaveBeenCalled();

      const confirm = within(dialog).getByRole('button', { name: 'Close semester' });
      expect(confirm).toBeDisabled();
      fireEvent.click(confirm);
      expect(closeAcademicSemester).not.toHaveBeenCalled();

      const typed = within(dialog).getByLabelText(/Type 1st semester, AY 2026-2027 to confirm/);
      fireEvent.change(typed, { target: { value: '1st semester' } });
      expect(confirm).toBeDisabled();
      fireEvent.change(typed, { target: { value: '1st semester, AY 2026-2027' } });
      expect(confirm).toBeEnabled();
      fireEvent.click(confirm);
      await waitFor(() => expect(closeAcademicSemester).toHaveBeenCalledTimes(1));
      expect(closeAcademicSemester).toHaveBeenCalledWith(11, '1st semester, AY 2026-2027');
    });

    it('sends nothing on cancel and shows the server refusal inline when activating is refused', async () => {
      vi.mocked(getAcademicYears).mockResolvedValue(withSemesters);
      vi.mocked(activateAcademicSemester).mockRejectedValue({ response: { status: 422, data: { message: 'The given data was invalid.', errors: { semester: ['The current semester still has an election that is upcoming or open: Council Election (Computer Society).'] } } } });
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Activate 2nd semester of AY 2026-2027' }));
      let dialog = await screen.findByRole('dialog', { name: 'Activate semester' });
      expect(within(dialog).getByText(/This closes the current semester, 1st semester, AY 2026-2027\./)).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(activateAcademicSemester).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Activate 2nd semester of AY 2026-2027' }));
      dialog = await screen.findByRole('dialog', { name: 'Activate semester' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Activate semester' }));

      expect(await within(dialog).findByRole('alert')).toHaveTextContent('Council Election (Computer Society)');
      expect(activateAcademicSemester).toHaveBeenCalledWith(12);
    });
  });

  describe('reopening a completed semester', () => {
    const completed = (overrides = {}) => [{ ...years[1], ...overrides, semesters: [
      { id: 11, number: 1, status: 'completed', starts_on: '2026-08-01', ends_on: '2026-12-15' },
      { id: 12, number: 2, status: 'upcoming', starts_on: '2999-01-05', ends_on: '3000-05-31' },
    ] }];

    it('reopens only after one confirmation that says what it does', async () => {
      vi.mocked(getAcademicYears).mockResolvedValue(completed());
      vi.mocked(reopenAcademicSemester).mockResolvedValue({});
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Reopen 1st semester of AY 2026-2027' }));

      const dialog = await screen.findByRole('dialog', { name: 'Reopen semester' });
      expect(within(dialog).getByText(/the active semester and AY 2026-2027 the current year again/)).toBeInTheDocument();
      expect(reopenAcademicSemester).not.toHaveBeenCalled();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Reopen semester' }));

      await waitFor(() => expect(reopenAcademicSemester).toHaveBeenCalledWith(11));
      await waitFor(() => expect(getAcademicYears).toHaveBeenCalledTimes(2));
    });

    it('is not offered while any semester is active', async () => {
      vi.mocked(getAcademicYears).mockResolvedValue([{ ...years[1], semesters: [
        { id: 11, number: 1, status: 'completed', starts_on: '2026-08-01', ends_on: '2026-12-15' },
        { id: 12, number: 2, status: 'active', starts_on: '2026-12-16', ends_on: '2027-05-31' },
      ] }]);
      renderPage();
      expect(await screen.findByRole('button', { name: 'Close 2nd semester of AY 2026-2027' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Reopen/ })).not.toBeInTheDocument();
    });

    it('is not offered for a semester of a completed year', async () => {
      vi.mocked(getAcademicYears).mockResolvedValue(completed({ closed_at: '2027-06-01T00:00:00Z', is_current: false }));
      renderPage();
      expect(await screen.findByText('1st semester')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Reopen/ })).not.toBeInTheDocument();
    });

    it('shows the server refusal inline', async () => {
      vi.mocked(getAcademicYears).mockResolvedValue(completed());
      vi.mocked(reopenAcademicSemester).mockRejectedValue({ response: { status: 422, data: { message: 'The given data was invalid.', errors: { semester: ['A semester is already active. Close it before reopening another one.'] } } } });
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Reopen 1st semester of AY 2026-2027' }));
      const dialog = await screen.findByRole('dialog', { name: 'Reopen semester' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Reopen semester' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('A semester is already active.');
    });
  });

  describe('closing the live semester', () => {
    const closing = (next) => [{ ...years[1], semesters: [
      { id: 11, number: 1, status: 'active', starts_on: '2026-08-01', ends_on: '2026-12-15' },
      ...(next ? [{ id: 12, number: 2, status: 'upcoming', ...next }] : []),
    ] }];
    const openClose = async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Close 1st semester of AY 2026-2027' }));
      return screen.findByRole('dialog', { name: 'Close semester' });
    };

    it('says when the next semester can start and never offers to activate one that has not started', async () => {
      vi.mocked(getAcademicYears).mockResolvedValue(closing({ starts_on: '2999-12-19', ends_on: '3000-05-31' }));
      renderPage();
      const dialog = await openClose();

      expect(within(dialog).getByText(/2nd semester, AY 2026-2027 starts on December 19, 2999\. Until then no semester is active\./)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Activate 2nd semester of AY 2026-2027' })).not.toBeInTheDocument();
      expect(screen.getByText('Not started yet')).toBeInTheDocument();
    });

    it('warns that no semester will be active when there is nothing to start after it', async () => {
      vi.mocked(getAcademicYears).mockResolvedValue(closing(null));
      renderPage();

      expect(within(await openClose()).getByText(/No other semester is set up, so no semester will be active until you add one and activate it\./)).toBeInTheDocument();
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
