import { findRowAction } from '../../../test/rowActions';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AcademicYearsPage from './AcademicYearsPage';
import CreateClearancePeriodModal from '../../modules/clearances/CreateClearancePeriodModal';
import { activateAcademicSemester, closeAcademicSemester, closeAcademicYear, createAcademicYear, deleteAcademicSemester, getAcademicYears, makeAcademicYearCurrent, reopenAcademicSemester, updateAcademicSemesterDates } from '../../../services/systemAdministrationService';

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
  updateAcademicSemesterDates: vi.fn(),
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
    expect(screen.queryByRole('link', { name: /administrators after elections/ })).not.toBeInTheDocument();
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
    expect(within(dialog).getByText(/A semester in AY 2026-2027 is active, so this is refused\. Close it first, or activate a semester in this year to make it current\./)).toBeInTheDocument();
    expect(makeAcademicYearCurrent).not.toHaveBeenCalled();
  });

  it('disables Make current while the server would refuse it, and keeps it enabled otherwise', async () => {
    vi.mocked(getAcademicYears).mockResolvedValue([
      years[0],
      { ...years[1], semesters: [{ id: 11, number: 1, status: 'active', starts_on: '2026-08-01', ends_on: '2026-12-15' }] },
    ]);
    const { unmount } = renderPage();

    fireEvent.click(await findRowAction('Make current'));
    const dialog = await screen.findByRole('dialog', { name: 'Make this the current year' });
    const confirm = within(dialog).getByRole('button', { name: 'Make current' });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(makeAcademicYearCurrent).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled();
    unmount();

    vi.mocked(getAcademicYears).mockResolvedValue([
      years[0],
      { ...years[1], semesters: [{ id: 11, number: 1, status: 'completed', starts_on: '2026-08-01', ends_on: '2026-12-15' }] },
    ]);
    renderPage();
    fireEvent.click(await findRowAction('Make current'));
    expect(within(await screen.findByRole('dialog', { name: 'Make this the current year' })).getByRole('button', { name: 'Make current' })).toBeEnabled();
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

    const openActivate = async (items, name) => {
      vi.mocked(getAcademicYears).mockResolvedValue(items);
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name }));
      return screen.findByRole('dialog', { name: 'Activate semester' });
    };
    const nextYear = { ...years[0], semesters: [{ id: 21, number: 1, status: 'upcoming', starts_on: '2026-08-02', ends_on: '2026-12-15' }] };

    it('says activating a semester in another year also completes the current year, which cannot be reopened', async () => {
      const dialog = await openActivate([
        nextYear,
        { ...years[1], semesters: [
          { id: 11, number: 1, status: 'completed', starts_on: '2026-08-01', ends_on: '2026-12-15' },
          { id: 12, number: 2, status: 'active', starts_on: '2026-12-16', ends_on: '2027-05-31' },
        ] },
      ], 'Activate 1st semester of AY 2027-2028');
      expect(within(dialog).getByText(/This closes the current semester, 2nd semester, AY 2026-2027\./)).toBeInTheDocument();
      expect(within(dialog).getByText(/This also completes AY 2026-2027\. A completed year cannot be reopened\./)).toBeInTheDocument();
      expect(within(dialog).queryByText(/cannot be undone from the app/)).not.toBeInTheDocument();
    });

    it('says the same when no semester is active at the moment', async () => {
      const dialog = await openActivate([
        nextYear,
        { ...years[1], semesters: [
          { id: 11, number: 1, status: 'completed', starts_on: '2026-08-01', ends_on: '2026-12-15' },
          { id: 12, number: 2, status: 'completed', starts_on: '2026-12-16', ends_on: '2027-05-31' },
        ] },
      ], 'Activate 1st semester of AY 2027-2028');
      expect(within(dialog).getByText(/This semester becomes the active one\./)).toBeInTheDocument();
      expect(within(dialog).getByText(/This also completes AY 2026-2027\. A completed year cannot be reopened\./)).toBeInTheDocument();
    });

    it('says a same-year activation can be reversed by reopening the closed semester once the new one is closed', async () => {
      const dialog = await openActivate(withSemesters, 'Activate 2nd semester of AY 2026-2027');
      expect(within(dialog).queryByText(/cannot be undone from the app/)).not.toBeInTheDocument();
      expect(within(dialog).queryByText(/also completes/)).not.toBeInTheDocument();
      expect(within(dialog).getByText(/You can reopen 1st semester, AY 2026-2027 from this page after the new one is closed\./)).toBeInTheDocument();
    });

    it('does not promise a year completion or an undo when nothing is active and the year stays the same', async () => {
      const dialog = await openActivate([{ ...years[1], semesters: [
        { id: 11, number: 1, status: 'completed', starts_on: '2026-08-01', ends_on: '2026-12-15' },
        { id: 12, number: 2, status: 'upcoming', starts_on: '2026-08-02', ends_on: '2027-05-31' },
      ] }], 'Activate 2nd semester of AY 2026-2027');
      expect(within(dialog).getByText(/This semester becomes the active one\. You can close it from this page when it is over\./)).toBeInTheDocument();
      expect(within(dialog).queryByText(/cannot be undone from the app/)).not.toBeInTheDocument();
      expect(within(dialog).queryByText(/also completes/)).not.toBeInTheDocument();
    });

    it('tells the SAO the closed semester stays reopenable only while no other semester is active and its year is not completed', async () => {
      vi.mocked(getAcademicYears).mockResolvedValue(withSemesters);
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Close 1st semester of AY 2026-2027' }));
      const dialog = await screen.findByRole('dialog', { name: 'Close semester' });
      expect(within(dialog).getByText(/You can reopen it from this page while no other semester is active and its academic year is not completed\./)).toBeInTheDocument();
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

    it('is held back with a sentence while any semester is active', async () => {
      vi.mocked(getAcademicYears).mockResolvedValue([{ ...years[1], semesters: [
        { id: 11, number: 1, status: 'completed', starts_on: '2026-08-01', ends_on: '2026-12-15' },
        { id: 12, number: 2, status: 'active', starts_on: '2026-12-16', ends_on: '2027-05-31' },
      ] }]);
      renderPage();
      expect(await screen.findByRole('button', { name: 'Close 2nd semester of AY 2026-2027' })).toBeInTheDocument();
      const reopen = screen.getByRole('button', { name: 'Reopen 1st semester of AY 2026-2027' });
      expect(reopen).toBeDisabled();
      expect(reopen).toHaveAccessibleDescription('Close the 2nd semester of AY 2026-2027 first.');
      fireEvent.click(reopen);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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

    it('says when the next semester can start and holds back Activate until then', async () => {
      vi.mocked(getAcademicYears).mockResolvedValue(closing({ starts_on: '2999-12-19', ends_on: '3000-05-31' }));
      renderPage();
      const dialog = await openClose();

      expect(within(dialog).getByText(/2nd semester, AY 2026-2027 starts on December 19, 2999\. Until then no semester is active\./)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Activate 2nd semester of AY 2026-2027' })).toBeDisabled();
      expect(screen.queryByText('Not started yet')).not.toBeInTheDocument();
    });

    it('warns that no semester will be active when there is nothing to start after it', async () => {
      vi.mocked(getAcademicYears).mockResolvedValue(closing(null));
      renderPage();

      expect(within(await openClose()).getByText(/No other semester is set up, so no semester will be active until you add one and activate it\./)).toBeInTheDocument();
    });
  });

  describe('every semester row shows its action', () => {
    const sem = (id, number, status, starts_on, ends_on = '2999-12-31') => ({ id, number, status, starts_on, ends_on });
    const thisYear = (semesters, overrides = {}) => ({ ...years[1], ...overrides, semesters });
    const nextYear = (semesters, overrides = {}) => ({ ...years[0], ...overrides, semesters });
    const activateButton = (number, label) => screen.findByRole('button', { name: `Activate ${number === 1 ? '1st' : '2nd'} semester of AY ${label}` });

    it('shows Activate on the first semester of a new year that has not started, disabled with the date', async () => {
      vi.mocked(getAcademicYears).mockResolvedValue([
        nextYear([sem(21, 1, 'upcoming', '2999-08-01')]),
        thisYear([sem(11, 1, 'active', '2026-08-01', '2026-12-15'), sem(12, 2, 'upcoming', '2999-01-05')]),
      ]);
      renderPage();
      const button = await activateButton(1, '2027-2028');
      expect(button).toBeDisabled();
      expect(button).toHaveAccessibleDescription('Starts on August 1, 2999. Change its dates or activate it from that day.');
      expect(screen.getByRole('button', { name: 'Close 1st semester of AY 2026-2027' })).toBeEnabled();
    });

    it('offers Edit dates on an upcoming semester only, never on an active or completed one', async () => {
      vi.mocked(getAcademicYears).mockResolvedValue([
        nextYear([sem(21, 1, 'upcoming', '2999-08-01')]),
        thisYear([sem(11, 1, 'completed', '2026-08-01', '2026-12-15'), sem(12, 2, 'active', '2026-12-16', '2027-05-31')]),
      ]);
      renderPage();

      expect(await screen.findByRole('button', { name: 'Edit dates of 1st semester of AY 2027-2028' })).toBeEnabled();
      expect(screen.getAllByRole('button', { name: /^Edit dates of/ })).toHaveLength(1);
    });

    it('changes the dates of an upcoming semester and reloads the calendar', async () => {
      vi.mocked(getAcademicYears)
        .mockResolvedValueOnce([nextYear([sem(21, 1, 'upcoming', '2027-08-01', '2027-12-15')]), thisYear([])])
        .mockResolvedValueOnce([nextYear([sem(21, 1, 'upcoming', '2027-08-10', '2027-12-18')]), thisYear([])]);
      vi.mocked(updateAcademicSemesterDates).mockResolvedValue({});
      renderPage();

      fireEvent.click(await screen.findByRole('button', { name: 'Edit dates of 1st semester of AY 2027-2028' }));
      const dialog = await screen.findByRole('dialog', { name: 'Edit dates of the 1st semester, AY 2027-2028' });
      expect(within(dialog).getByLabelText(/Starts on/)).toHaveValue('2027-08-01');
      expect(within(dialog).getByLabelText(/Ends on/)).toHaveValue('2027-12-15');
      fireEvent.change(within(dialog).getByLabelText(/Starts on/), { target: { value: '2027-08-10' } });
      fireEvent.change(within(dialog).getByLabelText(/Ends on/), { target: { value: '2027-12-18' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save dates' }));

      await waitFor(() => expect(updateAcademicSemesterDates).toHaveBeenCalledWith(21, { starts_on: '2027-08-10', ends_on: '2027-12-18' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(await screen.findByText(/August 10, 2027 to December 18, 2027/)).toBeInTheDocument();
    });

    it('keeps the dialog open and says why when the server refuses the new dates', async () => {
      vi.mocked(getAcademicYears).mockResolvedValue([nextYear([sem(21, 1, 'upcoming', '2027-08-01', '2027-12-15')]), thisYear([])]);
      vi.mocked(updateAcademicSemesterDates)
        .mockRejectedValueOnce({ response: { status: 422, data: { message: 'x', errors: { semester: ['3 requirement deadlines in this semester fall outside these dates. Change those deadlines first, or pick dates that include them.'] } } } })
        .mockRejectedValueOnce({ response: { status: 422, data: { message: 'x', errors: { starts_on: ['Semester dates cannot overlap.'] } } } });
      renderPage();

      fireEvent.click(await screen.findByRole('button', { name: 'Edit dates of 1st semester of AY 2027-2028' }));
      const dialog = await screen.findByRole('dialog', { name: 'Edit dates of the 1st semester, AY 2027-2028' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save dates' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('3 requirement deadlines in this semester fall outside these dates.');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save dates' }));
      expect(await within(dialog).findByText('Semester dates cannot overlap.')).toBeInTheDocument();
      expect(within(dialog).queryByText(/3 requirement deadlines/)).not.toBeInTheDocument();
    });

    it('asks for the current year to be completed first, naming the semester to activate', async () => {
      vi.mocked(getAcademicYears).mockResolvedValue([
        nextYear([sem(21, 1, 'upcoming', '2026-08-02')]),
        thisYear([sem(11, 1, 'active', '2026-08-01', '2026-12-15'), sem(12, 2, 'upcoming', '2026-10-05')]),
      ]);
      renderPage();
      const button = await activateButton(1, '2027-2028');
      expect(button).toBeDisabled();
      expect(button).toHaveAccessibleDescription('Activate the 2nd semester of AY 2026-2027 first.');
      fireEvent.click(button);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(await activateButton(2, '2026-2027')).toBeEnabled();
    });

    it('asks for the missing semester to be added when the current year has only one', async () => {
      vi.mocked(getAcademicYears).mockResolvedValue([
        nextYear([sem(21, 1, 'upcoming', '2026-08-02')]),
        thisYear([sem(11, 1, 'active', '2026-08-01', '2026-12-15')]),
      ]);
      renderPage();
      expect(await activateButton(1, '2027-2028')).toHaveAccessibleDescription('Add the 2nd semester to AY 2026-2027 and complete both first.');
    });

    it('enables Activate once both semesters of the current year are completed', async () => {
      vi.mocked(getAcademicYears).mockResolvedValue([
        nextYear([sem(21, 1, 'upcoming', '2026-08-02')]),
        thisYear([sem(11, 1, 'completed', '2026-08-01', '2026-12-15'), sem(12, 2, 'completed', '2026-12-16', '2027-05-31')]),
      ]);
      renderPage();
      const button = await activateButton(1, '2027-2028');
      expect(button).toBeEnabled();
      expect(button).not.toHaveAccessibleDescription();
    });

    it('sends the SAO back to the older year when a newer year was made current without a semester', async () => {
      vi.mocked(getAcademicYears).mockResolvedValue([
        nextYear([sem(21, 1, 'upcoming', '2999-08-01')], { is_current: true }),
        thisYear([sem(11, 1, 'completed', '2026-08-01', '2026-12-15'), sem(12, 2, 'upcoming', '2026-10-05')], { is_current: false }),
      ]);
      renderPage();
      expect(await activateButton(2, '2026-2027')).toHaveAccessibleDescription('Make AY 2026-2027 the current year first.');
      expect(screen.getByRole('button', { name: 'Reopen 1st semester of AY 2026-2027' })).toBeEnabled();
    });

    it('names the active semester to close when it is the thing in the way of the older year', async () => {
      vi.mocked(getAcademicYears).mockResolvedValue([
        nextYear([sem(21, 1, 'active', '2026-08-02')], { is_current: true }),
        thisYear([sem(11, 1, 'completed', '2026-08-01', '2026-12-15'), sem(12, 2, 'upcoming', '2026-10-05')], { is_current: false }),
      ]);
      renderPage();
      expect(await activateButton(2, '2026-2027')).toHaveAccessibleDescription('Close the 1st semester of AY 2027-2028 first.');
    });

    it('moves from the last semester of the current year to the first of the new year, always leaving a button to press', async () => {
      const first = nextYear([sem(21, 1, 'upcoming', '2026-08-02')]);
      const states = {
        before: [first, thisYear([sem(11, 1, 'active', '2026-08-01', '2026-12-15'), sem(12, 2, 'upcoming', '2026-10-05')])],
        secondLive: [first, thisYear([sem(11, 1, 'completed', '2026-08-01', '2026-12-15'), sem(12, 2, 'active', '2026-10-05')])],
        newLive: [nextYear([sem(21, 1, 'active', '2026-08-02')], { is_current: true }), thisYear([sem(11, 1, 'completed', '2026-08-01', '2026-12-15'), sem(12, 2, 'completed', '2026-10-05')], { is_current: false, closed_at: '2026-11-12T00:00:00Z' })],
      };
      vi.mocked(getAcademicYears).mockResolvedValueOnce(states.before).mockResolvedValueOnce(states.secondLive).mockResolvedValueOnce(states.newLive);
      vi.mocked(activateAcademicSemester).mockResolvedValue({});
      renderPage();

      expect(await activateButton(1, '2027-2028')).toBeDisabled();
      fireEvent.click(await activateButton(2, '2026-2027'));
      fireEvent.click(within(await screen.findByRole('dialog', { name: 'Activate semester' })).getByRole('button', { name: 'Activate semester' }));
      await waitFor(() => expect(activateAcademicSemester).toHaveBeenCalledWith(12));

      await waitFor(() => expect(screen.getByRole('button', { name: 'Close 2nd semester of AY 2026-2027' })).toBeEnabled());
      const next = await activateButton(1, '2027-2028');
      expect(next).toBeEnabled();
      fireEvent.click(next);
      const dialog = await screen.findByRole('dialog', { name: 'Activate semester' });
      expect(within(dialog).getByText(/This also completes AY 2026-2027\./)).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Activate semester' }));
      await waitFor(() => expect(activateAcademicSemester).toHaveBeenCalledWith(21));

      expect(await screen.findByRole('button', { name: 'Close 1st semester of AY 2027-2028' })).toBeEnabled();
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
