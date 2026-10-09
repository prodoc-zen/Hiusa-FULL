import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SaoClearancesPage from './SaoClearancesPage';

const mocks = vi.hoisted(() => ({
  getClearancePeriods: vi.fn(),
  getClearancePeriodStudents: vi.fn(),
  createClearancePeriod: vi.fn(),
  deleteClearancePeriod: vi.fn(),
}));

vi.mock('../../../services/clearanceService', () => ({
  getClearancePeriods: mocks.getClearancePeriods,
  getClearancePeriodStudents: mocks.getClearancePeriodStudents,
  createClearancePeriod: mocks.createClearancePeriod,
  deleteClearancePeriod: mocks.deleteClearancePeriod,
}));

function envelope(data) {
  return { data: { data, current_page: 1, last_page: 1, per_page: 20, total: data.length } };
}

const PERIOD = { id: 1, title: 'Second Semester Clearance', academic_year: '2026-2027', description: null, required_roles: ['sao', 'adviser'], deadline_at: null };

describe('SaoClearancesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a first-run empty state with a call to open a period', async () => {
    mocks.getClearancePeriods.mockResolvedValue(envelope([]));
    render(<SaoClearancesPage />);
    expect(await screen.findByText('No clearance periods yet')).toBeInTheDocument();
  });

  it('shows a retryable error state', async () => {
    mocks.getClearancePeriods.mockRejectedValueOnce(new Error('down'));
    render(<SaoClearancesPage />);
    expect(await screen.findByText('Failed to load clearance periods.')).toBeInTheDocument();

    mocks.getClearancePeriods.mockResolvedValue(envelope([]));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No clearance periods yet')).toBeInTheDocument();
  });

  it('lists a period with its required roles and computes completion progress from the roster', async () => {
    mocks.getClearancePeriods.mockResolvedValue(envelope([PERIOD]));
    mocks.getClearancePeriodStudents.mockResolvedValue(envelope([
      { student_id: 1, student_name: 'Maria Santos', organization_id: 3, is_complete: true, signatures: [] },
      { student_id: 2, student_name: 'Juan Cruz', organization_id: 3, is_complete: false, signatures: [] },
    ]));

    render(<SaoClearancesPage />);
    expect(await screen.findByText('Second Semester Clearance')).toBeInTheDocument();
    expect(screen.getByText('Organization adviser')).toBeInTheDocument();
    expect(await screen.findByText('1 of 2')).toBeInTheDocument();
  });

  describe('deleting a period', () => {
    async function openDeleteDialog() {
      mocks.getClearancePeriods.mockResolvedValue(envelope([PERIOD]));
      mocks.getClearancePeriodStudents.mockResolvedValue(envelope([]));
      render(<SaoClearancesPage />);
      fireEvent.click(await screen.findByRole('button', { name: /Delete Second Semester Clearance/ }));
      const dialog = await screen.findByRole('dialog', { name: 'Delete this clearance period?' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete period' }));
    }

    it('deletes after confirmation and reloads the list', async () => {
      mocks.deleteClearancePeriod.mockResolvedValue({ data: { message: 'Deleted.' } });
      await openDeleteDialog();

      await waitFor(() => expect(mocks.deleteClearancePeriod).toHaveBeenCalledWith(1));
      await waitFor(() => expect(mocks.getClearancePeriods).toHaveBeenCalledTimes(2));
    });

    it('shows the server message when signed entries block the delete', async () => {
      mocks.deleteClearancePeriod.mockRejectedValue({ response: { status: 409, data: { message: 'This clearance period already has signed entries and cannot be deleted.' } } });
      await openDeleteDialog();

      expect(await screen.findByRole('alert')).toHaveTextContent('This clearance period already has signed entries and cannot be deleted.');
      expect(mocks.getClearancePeriods).toHaveBeenCalledTimes(1);
    });
  });

  it('opens a new clearance period with the selected required roles', async () => {
    mocks.getClearancePeriods.mockResolvedValue(envelope([]));
    mocks.createClearancePeriod.mockResolvedValue({ data: PERIOD });

    render(<SaoClearancesPage />);
    await screen.findByText('No clearance periods yet');
    fireEvent.click(screen.getAllByRole('button', { name: 'New clearance period' })[0]);

    // Required fields render as "Title*" (label text immediately followed by
    // the asterisk marker, no separating space), so exact matches miss them.
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Second Semester Clearance' } });
    fireEvent.change(screen.getByLabelText(/^Academic year/), { target: { value: '2026-2027' } });
    fireEvent.click(screen.getByRole('button', { name: 'Student Affairs Office (SAO)' }));

    const submit = screen.getByRole('button', { name: 'Open this period' });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);

    await waitFor(() => expect(mocks.createClearancePeriod).toHaveBeenCalledWith({
      academic_year: '2026-2027',
      title: 'Second Semester Clearance',
      description: undefined,
      required_roles: ['sao'],
      deadline_at: undefined,
    }));
  });
});
