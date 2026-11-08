import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ApplicationReviewDrawer from './ApplicationReviewDrawer';

const mocks = vi.hoisted(() => ({
  getOrganizationApplication: vi.fn(),
  reviewOrganizationApplication: vi.fn(),
  attachReviewFile: vi.fn(),
  removeReviewFile: vi.fn(),
}));
vi.mock('../../services/organizationApplicationService', () => mocks);
const openMocks = vi.hoisted(() => ({ openProtectedFile: vi.fn() }));
vi.mock('../../utils/openProtectedFile', () => openMocks);
const notifyMocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('../../lib/notify', () => ({ default: notifyMocks }));

const detail = (extra = {}) => ({
  id: 8,
  name: 'Chess Club',
  acronym: 'CHESS',
  status: 'pending_dean',
  round: 1,
  position_title: 'President',
  description: 'We play chess.',
  college: { id: 5, name: 'College of Engineering' },
  applicant: { school_id: 20260042, name: 'Ana Cruz', email: 'ana.cruz@example.test' },
  submitted_at: '2026-10-01T08:00:00+08:00',
  endorsement_note: null,
  remarks: null,
  review_files: [],
  requirements: [
    { id: 1, name: 'Constitution', document: { id: 11, name: 'constitution.pdf', open_url: '/organization-applications/8/documents/11' }, reviews: [], review_files: [] },
    { id: 2, name: 'Officer list', document: { id: 12, name: 'officers.pdf', open_url: '/organization-applications/8/documents/12' }, reviews: [], review_files: [] },
  ],
  ...extra,
});

function renderDrawer(role = 'DEPARTMENT_HEAD', handlers = {}) {
  const onClose = handlers.onClose ?? vi.fn();
  const onDecided = handlers.onDecided ?? vi.fn();
  render(<ApplicationReviewDrawer applicationId={8} viewerRole={role} onClose={onClose} onDecided={onDecided} />);
  return { onClose, onDecided };
}

describe('ApplicationReviewDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOrganizationApplication.mockResolvedValue({ data: detail() });
  });

  it('shows the applicant by name with the school ID only as small text, and opens a requirement file', async () => {
    openMocks.openProtectedFile.mockResolvedValue();
    renderDrawer();

    expect(await screen.findByText('Ana Cruz')).toBeInTheDocument();
    expect(screen.getByText(/ana\.cruz@example\.test · ID 20260042/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'constitution.pdf' }));
    await waitFor(() => expect(openMocks.openProtectedFile).toHaveBeenCalledWith('/organization-applications/8/documents/11'));
  });

  it('shows a loading state, then an error with a retry', async () => {
    mocks.getOrganizationApplication.mockRejectedValueOnce({ response: { status: 500 } });
    renderDrawer();
    expect(screen.getAllByRole('status', { name: 'Loading card' }).length).toBeGreaterThan(0);

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Ana Cruz')).toBeInTheDocument();
  });

  it('says plainly when the application is not in the reviewer queue', async () => {
    mocks.getOrganizationApplication.mockRejectedValue({ response: { status: 404 } });
    renderDrawer();

    expect(await screen.findByText('This application is not in your queue.')).toBeInTheDocument();
  });

  it('lets the dean endorse once every requirement is OK, with a general note', async () => {
    mocks.reviewOrganizationApplication.mockResolvedValue({ data: detail({ status: 'pending_sao' }) });
    const { onDecided } = renderDrawer();
    await screen.findByText('Ana Cruz');

    fireEvent.change(screen.getByLabelText('Note for Constitution'), { target: { value: 'Clear and signed.' } });
    fireEvent.change(screen.getByLabelText('General note'), { target: { value: 'Looks good.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Endorse to SAO' }));

    await waitFor(() => expect(mocks.reviewOrganizationApplication).toHaveBeenCalledTimes(1));
    expect(mocks.reviewOrganizationApplication).toHaveBeenCalledWith(8, {
      action: 'endorse',
      remarks: 'Looks good.',
      requirements: [{ requirement_type_id: 1, status: 'ok', note: 'Clear and signed.' }],
    });
    expect(notifyMocks.success).toHaveBeenCalledWith('Endorsed. The SAO is next.');
    expect(onDecided).toHaveBeenCalled();
  });

  it('turns endorse off while a requirement is marked and returns it with the note per requirement', async () => {
    mocks.reviewOrganizationApplication.mockResolvedValue({ data: detail({ status: 'returned' }) });
    renderDrawer();
    await screen.findByText('Ana Cruz');

    expect(screen.getByRole('button', { name: 'Return to applicant' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Review of Constitution'), { target: { value: 'needs_changes' } });
    fireEvent.change(screen.getByLabelText('Note for Constitution'), { target: { value: 'Sign the last page.' } });

    expect(screen.getByRole('button', { name: 'Endorse to SAO' })).toBeDisabled();
    expect(screen.getByText(/Endorse is off while a requirement is marked/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Return to applicant' }));

    await waitFor(() => expect(mocks.reviewOrganizationApplication).toHaveBeenCalledWith(8, {
      action: 'return',
      remarks: null,
      requirements: [{ requirement_type_id: 1, status: 'needs_changes', note: 'Sign the last page.' }],
    }));
  });

  it('allows a return on a general note alone', async () => {
    mocks.reviewOrganizationApplication.mockResolvedValue({ data: detail({ status: 'returned' }) });
    renderDrawer();
    await screen.findByText('Ana Cruz');

    fireEvent.change(screen.getByLabelText('General note'), { target: { value: 'Add your adviser.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Return to applicant' }));

    await waitFor(() => expect(mocks.reviewOrganizationApplication).toHaveBeenCalledWith(8, { action: 'return', remarks: 'Add your adviser.', requirements: [] }));
  });

  it('gives the SAO approve, return and reject, with reject needing a note', async () => {
    mocks.getOrganizationApplication.mockResolvedValue({ data: detail({ status: 'pending_sao', endorsement_note: 'Strong constitution.' }) });
    mocks.reviewOrganizationApplication.mockResolvedValue({ data: detail({ status: 'rejected' }) });
    renderDrawer('SUPER_ADMIN');
    await screen.findByText('Ana Cruz');

    expect(screen.getByText('Note from the Department Head').nextSibling).toHaveTextContent('Strong constitution.');
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('General note'), { target: { value: 'Same purpose as an existing club.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));

    await waitFor(() => expect(mocks.reviewOrganizationApplication).toHaveBeenCalledWith(8, { action: 'reject', remarks: 'Same purpose as an existing club.', requirements: [] }));
  });

  it('shows the server message when the application moved on while the reviewer was reading it', async () => {
    mocks.reviewOrganizationApplication.mockRejectedValue({ response: { status: 409, data: { message: 'This application is not waiting for you. Refresh the list.' } } });
    renderDrawer();
    await screen.findByText('Ana Cruz');

    fireEvent.click(screen.getByRole('button', { name: 'Endorse to SAO' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This application is not waiting for you. Refresh the list.');
    await waitFor(() => expect(mocks.getOrganizationApplication).toHaveBeenCalledTimes(2));
  });

  it('attaches a file to one requirement and reloads, keeping what was typed', async () => {
    mocks.attachReviewFile.mockResolvedValue({ data: { id: 5 } });
    renderDrawer();
    await screen.findByText('Ana Cruz');
    fireEvent.change(screen.getByLabelText('Note for Officer list'), { target: { value: 'Add the adviser.' } });
    mocks.getOrganizationApplication.mockResolvedValue({ data: detail({
      requirements: [
        { id: 1, name: 'Constitution', document: null, reviews: [], review_files: [{ id: 5, name: 'marked-up.pdf', stage: 'dean', stage_label: 'Department Head', open_url: '/organization-applications/8/review-files/5' }] },
        { id: 2, name: 'Officer list', document: null, reviews: [], review_files: [] },
      ],
    }) });

    const file = new File(['pdf'], 'marked-up.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Attach a file to Constitution'), { target: { files: [file] } });

    await waitFor(() => expect(mocks.attachReviewFile).toHaveBeenCalledWith(8, file, 1));
    expect(await screen.findByRole('button', { name: /marked-up\.pdf \(Department Head\)/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Note for Officer list')).toHaveValue('Add the adviser.');
  });

  it('removes only the attachments of the reviewer’s own stage', async () => {
    mocks.removeReviewFile.mockResolvedValue({});
    mocks.getOrganizationApplication.mockResolvedValue({ data: detail({
      status: 'pending_sao',
      review_files: [
        { id: 6, name: 'dean-note.pdf', stage: 'dean', stage_label: 'Department Head', open_url: '/organization-applications/8/review-files/6' },
        { id: 7, name: 'sao-note.pdf', stage: 'sao', stage_label: 'SAO', open_url: '/organization-applications/8/review-files/7' },
      ],
    }) });
    renderDrawer('SUPER_ADMIN');
    await screen.findByText('Ana Cruz');

    expect(screen.queryByRole('button', { name: 'Remove dean-note.pdf' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove sao-note.pdf' }));

    await waitFor(() => expect(mocks.removeReviewFile).toHaveBeenCalledWith(8, 7));
  });

  it('is read only once the application is with someone else', async () => {
    mocks.getOrganizationApplication.mockResolvedValue({ data: detail({
      status: 'pending_sao',
      requirements: [{ id: 1, name: 'Constitution', document: { id: 11, name: 'constitution.pdf', open_url: '/x' }, reviews: [{ stage: 'dean', stage_label: 'Department Head', status: 'needs_changes', note: 'Sign it.' }], review_files: [] }],
    }) });
    renderDrawer();
    await screen.findByText('Ana Cruz');

    expect(screen.getByText('Sign it.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Review of Constitution')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Endorse to SAO' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Close' }).length).toBeGreaterThan(0);
  });
});
