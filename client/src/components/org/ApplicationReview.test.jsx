import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ApplicationReview from './ApplicationReview';

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

function renderReview(role = 'DEPARTMENT_HEAD') {
  render(<MemoryRouter><ApplicationReview applicationId={8} viewerRole={role} /></MemoryRouter>);
}

const mark = (requirement, value) => fireEvent.change(screen.getByLabelText(`Review of ${requirement}`), { target: { value } });
const acceptAll = () => { mark('Constitution', 'ok'); mark('Officer list', 'ok'); };

describe('ApplicationReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOrganizationApplication.mockResolvedValue({ data: detail() });
  });

  it('shows the applicant by name with the school ID only as small text, and opens a requirement file', async () => {
    openMocks.openProtectedFile.mockResolvedValue();
    renderReview();

    expect(await screen.findByText('Ana Cruz')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Chess Club' })).toBeInTheDocument();
    expect(screen.getByText(/ana\.cruz@example\.test · ID 20260042/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'constitution.pdf' }));
    await waitFor(() => expect(openMocks.openProtectedFile).toHaveBeenCalledWith('/organization-applications/8/documents/11'));
  });

  it('shows a loading state, then an error with a retry', async () => {
    mocks.getOrganizationApplication.mockRejectedValueOnce({ response: { status: 500 } });
    renderReview();
    expect(screen.getAllByRole('status', { name: 'Loading card' }).length).toBeGreaterThan(0);

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Ana Cruz')).toBeInTheDocument();
  });

  it('says plainly when the application is not in the reviewer queue', async () => {
    mocks.getOrganizationApplication.mockRejectedValue({ response: { status: 404 } });
    renderReview();

    expect(await screen.findByText('This application is not in your queue.')).toBeInTheDocument();
  });

  it('starts every requirement as Not checked and keeps Endorse off until each one is Accepted', async () => {
    renderReview();
    await screen.findByText('Ana Cruz');

    expect(screen.getByLabelText('Review of Constitution')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Endorse' })).toBeDisabled();
    expect(screen.getByText('Endorse turns on when every requirement is Accepted.')).toBeInTheDocument();

    mark('Constitution', 'ok');
    expect(screen.getByRole('button', { name: 'Endorse' })).toBeDisabled();
    mark('Officer list', 'ok');
    expect(screen.getByRole('button', { name: 'Endorse' })).toBeEnabled();
  });

  it('lets the dean endorse with a comment and then shows the read-only summary', async () => {
    mocks.reviewOrganizationApplication.mockResolvedValue({ data: detail({ status: 'pending_sao' }) });
    renderReview();
    await screen.findByText('Ana Cruz');

    acceptAll();
    fireEvent.change(screen.getByLabelText(/Comments for the applicant/), { target: { value: 'Looks good.' } });
    mocks.getOrganizationApplication.mockResolvedValue({ data: detail({ status: 'pending_sao', endorsement_note: 'Looks good.' }) });
    fireEvent.click(screen.getByRole('button', { name: 'Endorse' }));

    await waitFor(() => expect(mocks.reviewOrganizationApplication).toHaveBeenCalledTimes(1));
    expect(mocks.reviewOrganizationApplication).toHaveBeenCalledWith(8, {
      action: 'endorse',
      remarks: 'Looks good.',
      requirements: [
        { requirement_type_id: 1, status: 'ok', note: null },
        { requirement_type_id: 2, status: 'ok', note: null },
      ],
    });
    expect(notifyMocks.success).toHaveBeenCalledWith('Endorsed. The SAO is next.');
    expect(await screen.findByRole('region', { name: 'Summary' })).toHaveTextContent('Endorsed by the Department Head. With the SAO for a decision.');
    expect(screen.queryByRole('button', { name: 'Endorse' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Review of Constitution')).not.toBeInTheDocument();
  });

  it('shows a note box only under a Needs changes row, and returns with that note', async () => {
    mocks.reviewOrganizationApplication.mockResolvedValue({ data: detail({ status: 'returned' }) });
    renderReview();
    await screen.findByText('Ana Cruz');

    expect(screen.queryByLabelText('Note for the applicant')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Return with comments' })).toBeDisabled();
    mark('Constitution', 'needs_changes');
    expect(screen.getByRole('button', { name: 'Return with comments' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Note for the applicant'), { target: { value: 'Sign the last page.' } });

    expect(screen.getByRole('button', { name: 'Endorse' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Return with comments' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Return with comments' }));

    await waitFor(() => expect(mocks.reviewOrganizationApplication).toHaveBeenCalledWith(8, {
      action: 'return',
      remarks: null,
      requirements: [{ requirement_type_id: 1, status: 'needs_changes', note: 'Sign the last page.' }],
    }));
  });

  it('drops the note of a row that was switched back to Accepted', async () => {
    mocks.reviewOrganizationApplication.mockResolvedValue({ data: detail({ status: 'returned' }) });
    renderReview();
    await screen.findByText('Ana Cruz');

    mark('Constitution', 'needs_changes');
    fireEvent.change(screen.getByLabelText('Note for the applicant'), { target: { value: 'Unsigned.' } });
    mark('Constitution', 'ok');
    fireEvent.change(screen.getByLabelText(/Comments for the applicant/), { target: { value: 'Add your adviser.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Return with comments' }));

    await waitFor(() => expect(mocks.reviewOrganizationApplication).toHaveBeenCalledWith(8, {
      action: 'return',
      remarks: 'Add your adviser.',
      requirements: [{ requirement_type_id: 1, status: 'ok', note: null }],
    }));
  });

  it('allows a return on a general comment alone', async () => {
    mocks.reviewOrganizationApplication.mockResolvedValue({ data: detail({ status: 'returned' }) });
    renderReview();
    await screen.findByText('Ana Cruz');

    fireEvent.change(screen.getByLabelText(/Comments for the applicant/), { target: { value: 'Add your adviser.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Return with comments' }));

    await waitFor(() => expect(mocks.reviewOrganizationApplication).toHaveBeenCalledWith(8, { action: 'return', remarks: 'Add your adviser.', requirements: [] }));
  });

  it('gives the SAO approve, return with comments and reject, with reject needing a comment', async () => {
    mocks.getOrganizationApplication.mockResolvedValue({ data: detail({ status: 'pending_sao', endorsement_note: 'Strong constitution.' }) });
    mocks.reviewOrganizationApplication.mockResolvedValue({ data: detail({ status: 'rejected' }) });
    renderReview('SUPER_ADMIN');
    await screen.findByText('Ana Cruz');

    expect(screen.getByText('Note from the Department Head').nextSibling).toHaveTextContent('Strong constitution.');
    acceptAll();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reject application' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Comments for the applicant/), { target: { value: 'Same purpose as an existing club.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject application' }));

    await waitFor(() => expect(mocks.reviewOrganizationApplication).toHaveBeenCalledWith(8, expect.objectContaining({ action: 'reject', remarks: 'Same purpose as an existing club.' })));
  });

  it('has one filled button in the decision area', async () => {
    mocks.getOrganizationApplication.mockResolvedValue({ data: detail({ status: 'pending_sao' }) });
    renderReview('SUPER_ADMIN');
    const decision = await screen.findByRole('region', { name: 'Decision' });

    const filled = within(decision).getAllByRole('button').filter((button) => button.className.includes('bg-brand-700') || button.className.includes('bg-danger'));
    expect(filled).toHaveLength(1);
  });

  it('shows the server message when the application moved on while the reviewer was reading it', async () => {
    mocks.reviewOrganizationApplication.mockRejectedValue({ response: { status: 409, data: { message: 'This application is not waiting for you. Refresh the list.' } } });
    renderReview();
    await screen.findByText('Ana Cruz');

    acceptAll();
    fireEvent.click(screen.getByRole('button', { name: 'Endorse' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This application is not waiting for you. Refresh the list.');
    await waitFor(() => expect(mocks.getOrganizationApplication).toHaveBeenCalledTimes(2));
  });

  it('attaches a file to one requirement and reloads, keeping what was marked', async () => {
    mocks.attachReviewFile.mockResolvedValue({ data: { id: 5 } });
    renderReview();
    await screen.findByText('Ana Cruz');
    mark('Officer list', 'needs_changes');
    fireEvent.change(screen.getByLabelText('Note for the applicant'), { target: { value: 'Add the adviser.' } });
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
    expect(screen.getByLabelText('Note for the applicant')).toHaveValue('Add the adviser.');
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
    renderReview('SUPER_ADMIN');
    await screen.findByText('Ana Cruz');

    expect(screen.queryByRole('button', { name: 'Remove dean-note.pdf' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove sao-note.pdf' }));

    await waitFor(() => expect(mocks.removeReviewFile).toHaveBeenCalledWith(8, 7));
  });

  it('is read only once the application is with someone else, and reads as a summary', async () => {
    mocks.getOrganizationApplication.mockResolvedValue({ data: detail({
      status: 'pending_sao',
      requirements: [{ id: 1, name: 'Constitution', document: { id: 11, name: 'constitution.pdf', open_url: '/x' }, reviews: [{ stage: 'dean', stage_label: 'Department Head', status: 'needs_changes', note: 'Sign it.' }], review_files: [] }],
    }) });
    renderReview();
    await screen.findByText('Ana Cruz');

    expect(screen.getByText(/Department Head:/).parentElement).toHaveTextContent('Department Head: Needs changes. Sign it.');
    expect(screen.queryByLabelText('Review of Constitution')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Endorse' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Summary' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to applications' })).toHaveAttribute('href', '/dashboard/organization-applications');
  });
});
