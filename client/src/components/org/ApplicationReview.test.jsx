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
const apiMocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('../../services/api', () => ({ default: apiMocks }));
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
  history: [],
  requirements: [
    { id: 1, name: 'Constitution', document: { id: 11, name: 'constitution.pdf', open_url: '/organization-applications/8/documents/11' }, reviews: [], review_files: [] },
    { id: 2, name: 'Officer list', document: { id: 12, name: 'officers.pdf', open_url: '/organization-applications/8/documents/12' }, reviews: [], review_files: [] },
  ],
  ...extra,
});

function renderReview(role = 'DEPARTMENT_HEAD') {
  render(<MemoryRouter><ApplicationReview applicationId={8} viewerRole={role} /></MemoryRouter>);
}

// A row that needs nothing is one line; the reviewer opens it to mark it.
const openRow = (requirement) => {
  if (!screen.queryByLabelText(`Review of ${requirement}`)) fireEvent.click(screen.getByRole('button', { name: new RegExp(`^(Review|Change) ${requirement}$`) }));
};
const mark = (requirement, value) => {
  openRow(requirement);
  fireEvent.change(screen.getByLabelText(`Review of ${requirement}`), { target: { value } });
};
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

    openRow('Constitution');
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
    openRow('Constitution');
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

  it('puts a quiet Add a comment link in the decision area, for the dean and the SAO', async () => {
    renderReview();
    const decision = await screen.findByRole('region', { name: 'Decision' });
    const link = within(decision).getByRole('button', { name: 'Add a comment' });
    expect(link.className).not.toMatch(/bg-brand|bg-danger|border/);
    expect(screen.queryByLabelText(/^Comment$/)).not.toBeInTheDocument();
  });

  it('shows the comment link to the SAO too', async () => {
    mocks.getOrganizationApplication.mockResolvedValue({ data: detail({ status: 'pending_sao' }) });
    renderReview('SUPER_ADMIN');

    expect(within(await screen.findByRole('region', { name: 'Decision' })).getByRole('button', { name: 'Add a comment' })).toBeInTheDocument();
  });

  it('saves a comment without making a decision and shows it in the history', async () => {
    const saved = { id: 3, kind: 'comment', label: 'Comment', note: 'Check the adviser.', by: 'Rosa Lim', stage_label: 'Department Head', at: '2026-10-02T09:00:00+08:00' };
    apiMocks.post.mockResolvedValue({ data: detail({ history: [saved] }) });
    renderReview();
    await screen.findByText('Ana Cruz');
    expect(screen.queryByRole('region', { name: 'History' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add a comment' }));
    const save = screen.getByRole('button', { name: 'Save comment' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Comment$/), { target: { value: '  Check the adviser.  ' } });
    mocks.getOrganizationApplication.mockResolvedValue({ data: detail({ history: [saved] }) });
    fireEvent.click(save);

    await waitFor(() => expect(apiMocks.post).toHaveBeenCalledWith('/organization-applications/8/comments', { note: 'Check the adviser.' }));
    const history = await screen.findByRole('region', { name: 'History' });
    expect(within(history).getByText('Check the adviser.')).toBeInTheDocument();
    expect(within(history).getByText(/Rosa Lim/)).toBeInTheDocument();
    expect(mocks.reviewOrganizationApplication).not.toHaveBeenCalled();
    expect(notifyMocks.success).toHaveBeenCalledWith('Comment saved.');
    expect(screen.queryByLabelText(/^Comment$/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Endorse' })).toBeDisabled();
  });

  it('keeps the typed comment and says why when saving fails', async () => {
    apiMocks.post.mockRejectedValue({ response: { status: 422, data: { message: 'Write a note before saving.' } } });
    renderReview();
    await screen.findByText('Ana Cruz');

    fireEvent.click(screen.getByRole('button', { name: 'Add a comment' }));
    fireEvent.change(screen.getByLabelText(/^Comment$/), { target: { value: 'Keep me.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save comment' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Write a note before saving.');
    expect(screen.getByLabelText(/^Comment$/)).toHaveValue('Keep me.');
  });

  it('closes the comment box without saving when cancelled', async () => {
    renderReview();
    await screen.findByText('Ana Cruz');

    fireEvent.click(screen.getByRole('button', { name: 'Add a comment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByLabelText(/^Comment$/)).not.toBeInTheDocument();
    expect(apiMocks.post).not.toHaveBeenCalled();
  });

  it('lists earlier comments and decisions in the history, oldest first', async () => {
    mocks.getOrganizationApplication.mockResolvedValue({ data: detail({ status: 'pending_sao', history: [
      { id: 1, kind: 'comment', label: 'Comment', note: 'Looks complete.', by: 'Rosa Lim', stage_label: 'Department Head', at: '2026-10-02T09:00:00+08:00' },
      { id: 2, kind: 'decision', label: 'Endorsed', note: null, by: 'Rosa Lim', stage_label: 'Department Head', at: '2026-10-03T09:00:00+08:00' },
    ] }) });
    renderReview('SUPER_ADMIN');

    const history = await screen.findByRole('region', { name: 'History' });
    const items = within(history).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Comment');
    expect(items[0]).toHaveTextContent('Looks complete.');
    expect(items[1]).toHaveTextContent('Endorsed');
  });

  it('does not offer a comment link once the application is with someone else', async () => {
    mocks.getOrganizationApplication.mockResolvedValue({ data: detail({ status: 'pending_sao' }) });
    renderReview();
    await screen.findByText('Ana Cruz');

    expect(screen.queryByRole('button', { name: 'Add a comment' })).not.toBeInTheDocument();
  });

  it('shows each requirement that needs nothing as one row with a status word and a file link, and no controls', async () => {
    renderReview();
    await screen.findByText('Ana Cruz');

    const rows = within(screen.getByRole('region', { name: 'Requirements' })).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    rows.forEach((row) => {
      expect(within(row).getByText('Not checked')).toBeInTheDocument();
      expect(within(row).getAllByRole('button')).toHaveLength(2);
    });
    expect(screen.queryByLabelText(/^Review of /)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Attach a file to (Constitution|Officer list)$/)).not.toBeInTheDocument();
  });

  it('opens one row at a time for review, and closes it when another is opened', async () => {
    renderReview();
    await screen.findByText('Ana Cruz');

    fireEvent.click(screen.getByRole('button', { name: 'Review Constitution' }));
    expect(screen.getByLabelText('Review of Constitution')).toBeInTheDocument();
    expect(screen.queryByLabelText('Review of Officer list')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Review Officer list' }));
    expect(screen.getByLabelText('Review of Officer list')).toBeInTheDocument();
    expect(screen.queryByLabelText('Review of Constitution')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close Officer list' }));
    expect(screen.queryByLabelText(/^Review of /)).not.toBeInTheDocument();
  });

  it('keeps a row open while it is marked Needs changes, and an Accepted row closes to one line', async () => {
    renderReview();
    await screen.findByText('Ana Cruz');

    mark('Constitution', 'needs_changes');
    mark('Officer list', 'ok');
    expect(screen.getByLabelText('Note for the applicant')).toBeInTheDocument();
    expect(screen.getByLabelText('Review of Constitution')).toHaveValue('needs_changes');
    expect(screen.getByLabelText('Review of Officer list')).toHaveValue('ok');

    fireEvent.click(screen.getByRole('button', { name: 'Close Officer list' }));
    expect(screen.queryByLabelText('Review of Officer list')).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Requirements' })).getAllByText('Accepted', { selector: 'span' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Change Officer list' }));
    expect(screen.getByLabelText('Review of Officer list')).toHaveValue('ok');
  });

  it('opens a requirement with no file attached, so the reviewer sees the controls without asking', async () => {
    mocks.getOrganizationApplication.mockResolvedValue({ data: detail({
      requirements: [
        { id: 1, name: 'Constitution', document: null, reviews: [], review_files: [] },
        { id: 2, name: 'Officer list', document: { id: 12, name: 'officers.pdf', open_url: '/x' }, reviews: [], review_files: [] },
      ],
    }) });
    renderReview();
    await screen.findByText('Ana Cruz');

    expect(screen.getByText('No file attached.')).toBeInTheDocument();
    expect(screen.getByText('Missing')).toBeInTheDocument();
    expect(screen.getByLabelText('Review of Constitution')).toBeInTheDocument();
    expect(screen.queryByLabelText('Review of Officer list')).not.toBeInTheDocument();
  });

  it('opens a requirement the other reviewer flagged, and keeps an accepted one to one line', async () => {
    mocks.getOrganizationApplication.mockResolvedValue({ data: detail({
      status: 'pending_sao',
      requirements: [
        { id: 1, name: 'Constitution', document: { id: 11, name: 'constitution.pdf', open_url: '/x' }, reviews: [{ stage: 'dean', stage_label: 'Department Head', status: 'needs_changes', note: 'Sign it.' }], review_files: [] },
        { id: 2, name: 'Officer list', document: { id: 12, name: 'officers.pdf', open_url: '/y' }, reviews: [{ stage: 'dean', stage_label: 'Department Head', status: 'ok', note: 'Complete.' }], review_files: [] },
      ],
    }) });
    renderReview('SUPER_ADMIN');
    await screen.findByText('Ana Cruz');

    expect(screen.getByLabelText('Review of Constitution')).toBeInTheDocument();
    expect(screen.getByText(/Sign it\./)).toBeInTheDocument();
    expect(screen.queryByText(/Complete\./)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Review of Officer list')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review Officer list' }));
    expect(screen.getByText(/Complete\./)).toBeInTheDocument();
    expect(screen.getByLabelText('Review of Officer list')).toBeInTheDocument();
  });

  it('shows an unmarked row to the SAO as Not checked even when the Department Head accepted it, and keeps Approve off', async () => {
    const dean = { stage: 'dean', stage_label: 'Department Head', status: 'ok', note: null };
    mocks.getOrganizationApplication.mockResolvedValue({ data: detail({
      status: 'pending_sao',
      requirements: [
        { id: 1, name: 'Constitution', document: { id: 11, name: 'constitution.pdf', open_url: '/x' }, reviews: [dean], review_files: [] },
        { id: 2, name: 'Officer list', document: { id: 12, name: 'officers.pdf', open_url: '/y' }, reviews: [dean], review_files: [] },
      ],
    }) });
    renderReview('SUPER_ADMIN');
    await screen.findByText('Ana Cruz');

    const rows = within(screen.getByRole('region', { name: 'Requirements' })).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    rows.forEach((row) => {
      expect(within(row).getByText('Not checked')).toBeInTheDocument();
      expect(within(row).queryByText('Accepted')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Review Constitution' }));
    expect(screen.getByText(/Department Head:/).parentElement).toHaveTextContent('Department Head: Accepted.');
    mark('Constitution', 'ok');
    expect(within(rows[0]).getByText('Accepted', { selector: 'span' })).toBeInTheDocument();
  });

  it('collapses a read-only accepted row and shows its note only on request', async () => {
    mocks.getOrganizationApplication.mockResolvedValue({ data: detail({
      status: 'pending_sao',
      requirements: [
        { id: 1, name: 'Constitution', document: { id: 11, name: 'constitution.pdf', open_url: '/x' }, reviews: [{ stage: 'dean', stage_label: 'Department Head', status: 'ok', note: 'Complete.' }], review_files: [] },
        { id: 2, name: 'Officer list', document: { id: 12, name: 'officers.pdf', open_url: '/y' }, reviews: [{ stage: 'dean', stage_label: 'Department Head', status: 'ok', note: null }], review_files: [] },
      ],
    }) });
    renderReview();
    await screen.findByText('Ana Cruz');

    expect(screen.getAllByText('Accepted')).toHaveLength(2);
    expect(screen.queryByText(/Complete\./)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Details Officer list' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Details Constitution' }));
    expect(screen.getByText(/Complete\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide details Constitution' }));
    expect(screen.queryByText(/Complete\./)).not.toBeInTheDocument();
  });
});
