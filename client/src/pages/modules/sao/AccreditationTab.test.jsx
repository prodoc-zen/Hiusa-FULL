import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AccreditationTab from './AccreditationTab';

const mocks = vi.hoisted(() => ({ reviewSubmission: vi.fn(), sendComplianceReminder: vi.fn() }));
const openMocks = vi.hoisted(() => ({ openProtectedFile: vi.fn() }));
const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('../../../services/complianceService', () => mocks);
vi.mock('../../../utils/openProtectedFile', () => openMocks);
vi.mock('../../../lib/notify', () => ({ default: toasts }));

const LONG_FILE = 'constitution-and-by-laws-2026-2027-final-signed-by-all-officers.pdf';
const club = {
  organization_id: 7, organization_name: 'Computing Club', accreditation_status: 'incomplete', requirements: [
    { requirement_type_id: 4, requirement_name: 'Constitution', status: 'submitted', submission_id: 12, file_name: LONG_FILE, submitted_at: '2026-09-10T08:00:00Z', deadline_at: '2026-10-01' },
    { requirement_type_id: 5, requirement_name: 'Officer Roster', status: 'returned', submission_id: 13, file_name: 'roster.pdf', remarks: 'Missing signature.', deadline_at: '2026-10-01' },
    { requirement_type_id: 6, requirement_name: 'Adviser Letter', status: 'not_submitted', submission_id: null, file_name: null, deadline_at: '2026-10-01' },
    { requirement_type_id: 8, requirement_name: 'Member List', status: 'approved', submission_id: 14, file_name: 'members.pdf', deadline_at: '2026-10-01' },
  ],
};

function openRequirements(role, onChanged, organization = club) {
  render(<AccreditationTab role={role} onChanged={onChanged} overview={{ loading: false, error: '', academicYear: '2026-2027', organizations: [organization] }} />);
  fireEvent.click(screen.getAllByRole('button', { name: 'Actions for Computing Club' })[0]);
  fireEvent.click(screen.getByRole('menuitem', { name: 'View requirements' }));
  return screen.getByRole('dialog', { name: 'Computing Club' });
}

describe('Accreditation requirements', () => {
  it('draws a fully met requirements bar as progress, not as a failure', () => {
    render(<AccreditationTab overview={{ loading: false, error: '', academicYear: '2026-2027', organizations: [{
      organization_id: 8, organization_name: 'Nursing Student Council', accreditation_status: 'accredited', requirements: [
        { requirement_type_id: 1, requirement_name: 'Constitution', status: 'approved', deadline_at: '2026-01-01' },
        { requirement_type_id: 2, requirement_name: 'Member list', status: 'approved', deadline_at: '2026-01-01' },
      ],
    }] }} />);
    const bar = within(screen.getByRole('table')).getAllByRole('progressbar').find((meter) => !meter.hasAttribute('aria-label'));
    expect(bar).toHaveAttribute('aria-valuenow', '2');
    expect(bar.firstChild).not.toHaveClass('bg-danger');
  });

  it('says no organization matches a search instead of saying none exist yet', () => {
    render(<AccreditationTab overview={{ loading: false, error: '', academicYear: '2026-2027', organizations: [{
      organization_id: 7, organization_name: 'Computing Club', accreditation_status: 'incomplete', requirements: [],
    }] }} />);
    fireEvent.change(screen.getByLabelText('Search organizations'), { target: { value: 'zzz' } });
    expect(screen.getByText('No results for "zzz"')).toBeInTheDocument();
    expect(screen.queryByText('No organizations to track yet')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getAllByText('Computing Club').length).toBeGreaterThan(0);
  });

  it('omits the past-deadline column while retaining requirement details', () => {
    render(<AccreditationTab overview={{ loading: false, error: '', academicYear: '2026-2027', organizations: [{
      organization_id: 7, organization_name: 'Computing Club', accreditation_status: 'incomplete', requirements: [
        { requirement_type_id: 1, requirement_name: 'Constitution', status: 'not_submitted', deadline_at: '2020-01-01' },
        { requirement_type_id: 2, requirement_name: 'Member list', status: 'submitted', deadline_at: '2020-01-01' },
        { requirement_type_id: 3, requirement_name: 'Annual report', status: 'approved', deadline_at: '2020-01-01' },
      ],
    }] }} />);
    const table = screen.getByRole('table');
    expect(within(table).queryByRole('columnheader', { name: 'Past deadline' })).not.toBeInTheDocument();
    const row = within(table).getByText('Computing Club').closest('tr');
    fireEvent.click(within(row).getByRole('button', { name: 'Actions for Computing Club' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'View requirements' }));
    const dialog = screen.getByRole('dialog', { name: 'Computing Club' });
    expect(within(dialog).getAllByText('Constitution').length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText('Member list').length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText('Annual report').length).toBeGreaterThan(0);
  });
});

describe('Requirements of one organization', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists every requirement as one aligned Requirement, Status, File, Action row instead of a table', () => {
    const dialog = openRequirements('SUPER_ADMIN');

    expect(within(dialog).queryByRole('table')).not.toBeInTheDocument();
    ['Requirement', 'Status', 'File', 'Action'].forEach((name) => expect(within(dialog).getByText(name)).toBeInTheDocument());
    const rows = within(dialog).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    rows.forEach((row) => expect(row.querySelector('p').parentElement.children).toHaveLength(4));
    expect(within(rows[0]).getByText('Constitution')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Submitted')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Returned')).toBeInTheDocument();
    expect(within(rows[1]).getByText('SAO: Missing signature.')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Not submitted')).toBeInTheDocument();
    expect(within(rows[2]).getByText('No file')).toBeInTheDocument();
    expect(within(rows[3]).getByText('Approved')).toBeInTheDocument();
  });

  it('shows a long file name cut with an ellipsis and opens it from the name', async () => {
    openMocks.openProtectedFile.mockResolvedValue();
    const dialog = openRequirements('SUPER_ADMIN');

    const link = within(dialog).getByRole('button', { name: LONG_FILE });
    expect(link).toHaveAttribute('title', LONG_FILE);
    expect(within(link).getByText(LONG_FILE)).toHaveClass('truncate');
    expect(dialog.innerHTML).not.toContain('break-all');
    fireEvent.click(link);
    await waitFor(() => expect(openMocks.openProtectedFile).toHaveBeenCalledWith('/compliance/submissions/12/document'));
  });

  it('says why a file could not be opened', async () => {
    openMocks.openProtectedFile.mockRejectedValue({ userMessage: 'Allow pop-ups to open this file.' });
    const dialog = openRequirements('SUPER_ADMIN');

    fireEvent.click(within(dialog).getByRole('button', { name: 'roster.pdf' }));
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('Allow pop-ups to open this file.'));
  });

  it('lets the SAO approve or return a submitted file from its row, a comment being required to return', async () => {
    mocks.reviewSubmission.mockResolvedValue({ data: {} });
    const onChanged = vi.fn();
    const dialog = openRequirements('SUPER_ADMIN', onChanged);
    const row = within(dialog).getAllByRole('listitem')[0];

    fireEvent.click(within(row).getByRole('button', { name: 'Return' }));
    expect(toasts.error).toHaveBeenCalledWith('Enter a comment for this file before returning it.');
    expect(mocks.reviewSubmission).not.toHaveBeenCalled();

    fireEvent.change(within(row).getByLabelText('Comment for Constitution'), { target: { value: 'Add the seal.' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Return' }));
    await waitFor(() => expect(mocks.reviewSubmission).toHaveBeenCalledWith(12, { status: 'returned', remarks: 'Add the seal.', submitted_at: '2026-09-10T08:00:00Z' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());

    fireEvent.click(within(row).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(mocks.reviewSubmission).toHaveBeenLastCalledWith(12, { status: 'approved', remarks: 'Add the seal.', submitted_at: '2026-09-10T08:00:00Z' }));
    expect(within(dialog).getAllByRole('button', { name: 'Approve' })).toHaveLength(1);
  });

  it('gives the Department Head the same list to read, without the SAO decision controls', () => {
    const dialog = openRequirements('DEPARTMENT_HEAD');

    expect(within(dialog).getAllByRole('listitem')).toHaveLength(4);
    expect(within(dialog).getByRole('button', { name: LONG_FILE })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Comment for Constitution')).not.toBeInTheDocument();
  });

  describe('Approve selected', () => {
    const busyClub = {
      ...club,
      requirements: [
        ...club.requirements,
        { requirement_type_id: 9, requirement_name: 'Budget Plan', status: 'submitted', submission_id: 15, file_name: 'budget.pdf', submitted_at: '2026-09-11T08:00:00Z', deadline_at: '2026-10-01' },
        { requirement_type_id: 10, requirement_name: 'Activity Calendar', status: 'submitted', submission_id: 16, file_name: 'calendar.pdf', submitted_at: '2026-09-12T08:00:00Z', deadline_at: '2026-10-01' },
      ],
    };

    it('has a labelled box on every submitted file and none on a file that is not waiting', () => {
      const dialog = openRequirements('SUPER_ADMIN', undefined, busyClub);

      ['Constitution', 'Budget Plan', 'Activity Calendar'].forEach((name) => expect(within(dialog).getByRole('checkbox', { name: `Select ${name}` })).toBeEnabled());
      ['Officer Roster', 'Adviser Letter', 'Member List'].forEach((name) => expect(within(dialog).getByRole('checkbox', { name: `Select ${name}` })).toBeDisabled());
      expect(within(dialog).getByRole('button', { name: 'Approve selected' })).toBeDisabled();
    });

    it('shows the in-between state for some and the full state for all submitted files', () => {
      const dialog = openRequirements('SUPER_ADMIN', undefined, busyClub);
      const all = within(dialog).getByRole('checkbox', { name: 'Select all submitted' });

      expect(all).not.toBePartiallyChecked();
      fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Select Budget Plan' }));
      expect(all).toBePartiallyChecked();
      expect(all).not.toBeChecked();
      fireEvent.click(all);
      expect(all).toBeChecked();
      expect(all).not.toBePartiallyChecked();
      expect(within(dialog).getByRole('button', { name: 'Approve selected (3)' })).toBeEnabled();
      fireEvent.click(all);
      expect(within(dialog).getByRole('checkbox', { name: 'Select Constitution' })).not.toBeChecked();
    });

    it('approves each selected file with the single review call and says which ones failed', async () => {
      mocks.reviewSubmission.mockResolvedValueOnce({ data: {} }).mockRejectedValueOnce({ userMessage: 'This submission was already decided.' }).mockResolvedValueOnce({ data: {} });
      const onChanged = vi.fn();
      const dialog = openRequirements('SUPER_ADMIN', onChanged, busyClub);

      fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Select all submitted' }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Approve selected (3)' }));

      await waitFor(() => expect(mocks.reviewSubmission).toHaveBeenCalledTimes(3));
      expect(mocks.reviewSubmission).toHaveBeenNthCalledWith(1, 12, { status: 'approved', submitted_at: '2026-09-10T08:00:00Z' });
      expect(mocks.reviewSubmission).toHaveBeenNthCalledWith(2, 15, { status: 'approved', submitted_at: '2026-09-11T08:00:00Z' });
      expect(mocks.reviewSubmission).toHaveBeenNthCalledWith(3, 16, { status: 'approved', submitted_at: '2026-09-12T08:00:00Z' });
      await waitFor(() => expect(toasts.error).toHaveBeenCalledWith(expect.stringContaining('Approved 2 of 3 submissions. 1 could not be approved: This submission was already decided.'), expect.anything()));
      expect(onChanged).toHaveBeenCalled();
      await waitFor(() => expect(within(dialog).getByRole('checkbox', { name: 'Select Budget Plan' })).toBeChecked());
      expect(within(dialog).getByRole('checkbox', { name: 'Select Constitution' })).not.toBeChecked();
    });

    it('offers nothing to select to the Department Head', () => {
      const dialog = openRequirements('DEPARTMENT_HEAD', undefined, busyClub);

      expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
      expect(within(dialog).queryByRole('button', { name: /Approve selected/ })).not.toBeInTheDocument();
    });
  });

  it('sends a reminder for one requirement from its row, and not for an approved one', async () => {
    const dialog = openRequirements('SUPER_ADMIN');

    expect(within(dialog).queryByRole('button', { name: 'Send compliance reminder for Member List' })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send compliance reminder for Officer Roster' }));
    expect(await screen.findByRole('dialog', { name: 'Notify Computing Club' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Requirement/)).toHaveValue('5');
  });
});
