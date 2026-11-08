import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import MyOrganizationApplicationPage from './MyOrganizationApplicationPage';

const mocks = vi.hoisted(() => ({
  getMyOrganizationApplication: vi.fn(),
  resubmitOrganizationApplication: vi.fn(),
}));
vi.mock('../../../services/organizationApplicationService', () => mocks);
const openMocks = vi.hoisted(() => ({ openProtectedFile: vi.fn() }));
vi.mock('../../../utils/openProtectedFile', () => openMocks);

const application = (extra = {}) => ({
  id: 8,
  name: 'Chess Club',
  acronym: 'CHESS',
  status: 'returned',
  round: 1,
  position_title: 'President',
  description: 'We play chess.',
  college: { id: 5, name: 'College of Engineering' },
  submitted_at: '2026-10-01T08:00:00+08:00',
  returned_by_role: 'DEPARTMENT_HEAD',
  remarks: 'Please fix the constitution.',
  endorsement_note: null,
  review_files: [{ id: 3, name: 'checklist.pdf', stage: 'dean', stage_label: 'Department Head', open_url: '/my/organization-applications/8/review-files/3' }],
  requirements: [
    {
      id: 1,
      name: 'Constitution',
      description: null,
      allowed_extensions: ['pdf'],
      document: { id: 11, name: 'constitution.pdf', open_url: '/my/organization-applications/8/documents/11' },
      reviews: [{ stage: 'dean', stage_label: 'Department Head', status: 'needs_changes', note: 'Sign the last page.' }],
      review_files: [{ id: 4, name: 'marked-up.pdf', stage: 'dean', stage_label: 'Department Head', open_url: '/my/organization-applications/8/review-files/4' }],
    },
    {
      id: 2,
      name: 'Officer list',
      description: null,
      allowed_extensions: ['pdf'],
      document: { id: 12, name: 'officers.pdf', open_url: '/my/organization-applications/8/documents/12' },
      reviews: [{ stage: 'dean', stage_label: 'Department Head', status: 'ok', note: null }],
      review_files: [],
    },
  ],
  ...extra,
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/dashboard/student/organization-applications/8']}>
      <Routes>
        <Route path="/dashboard/student/organization-applications/:applicationId" element={<MyOrganizationApplicationPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('MyOrganizationApplicationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMyOrganizationApplication.mockResolvedValue({ data: application() });
  });

  it('shows who returned it, the note, and what to fix per requirement', async () => {
    renderPage();

    expect(await screen.findByText('Your Department Head returned it. Fix what is listed below, then send it again.')).toBeInTheDocument();
    expect(mocks.getMyOrganizationApplication).toHaveBeenCalledWith('8');
    expect(screen.getByText('Note from your Department Head').nextSibling).toHaveTextContent('Please fix the constitution.');
    expect(screen.getByText('Needs changes')).toBeInTheDocument();
    expect(screen.getByText('Sign the last page.')).toBeInTheDocument();
    // The accepted requirement is one line: the OK badge says it, so no note line repeats it.
    expect(screen.queryByText('No problem found.')).not.toBeInTheDocument();
    expect(screen.getByText('OK')).toBeInTheDocument();
  });

  it('shows a requirement that needs nothing as one row, and the one that needs changes expanded', async () => {
    renderPage();
    await screen.findByText('Sign the last page.');

    const row = (name) => screen.getAllByRole('listitem').find((item) => within(item).queryByText(name));
    const constitution = row('Constitution');
    const officers = row('Officer list');
    expect(within(constitution).getByText('Needs changes')).toBeInTheDocument();
    expect(within(constitution).getByText('Sign the last page.')).toBeInTheDocument();
    expect(within(constitution).getByRole('button', { name: /marked-up\.pdf/ })).toBeInTheDocument();
    expect(within(officers).getByText('OK')).toBeInTheDocument();
    expect(within(officers).getByRole('button', { name: 'officers.pdf' })).toBeInTheDocument();
    expect(within(officers).queryByText(/Department Head:/)).not.toBeInTheDocument();
    expect(within(officers).queryByRole('button', { name: /Details/ })).not.toBeInTheDocument();
  });

  it('keeps an accepted requirement with a note or attachment to one line until Details is opened', async () => {
    const accepted = application({ status: 'pending_sao', remarks: null });
    accepted.requirements[0].reviews = [{ stage: 'dean', stage_label: 'Department Head', status: 'ok', note: 'Clear scan.' }];
    mocks.getMyOrganizationApplication.mockResolvedValue({ data: accepted });
    renderPage();
    await screen.findByText('Your Department Head endorsed it. The SAO decides next.');

    expect(screen.queryByText('Clear scan.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /marked-up\.pdf/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Details Constitution' }));
    expect(screen.getByText('Clear scan.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /marked-up\.pdf \(Department Head\)/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide details Constitution' }));
    expect(screen.queryByText('Clear scan.')).not.toBeInTheDocument();
  });

  it('says a file nobody has reviewed yet is not reviewed yet, as one row', async () => {
    const waiting = application({ status: 'pending_dean', remarks: null });
    waiting.requirements.forEach((requirement) => { requirement.reviews = []; requirement.review_files = []; });
    mocks.getMyOrganizationApplication.mockResolvedValue({ data: waiting });
    renderPage();
    await screen.findByText('Your Department Head is reviewing it.');

    expect(screen.getAllByText('Not reviewed yet')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Details/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'constitution.pdf' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'officers.pdf' })).toBeInTheDocument();
  });

  it('expands a requirement with no file and marks it Missing', async () => {
    const missing = application({ status: 'pending_dean', remarks: null });
    missing.requirements[1].document = null;
    missing.requirements[1].reviews = [];
    mocks.getMyOrganizationApplication.mockResolvedValue({ data: missing });
    renderPage();

    expect(await screen.findByText('No file yet.')).toBeInTheDocument();
    expect(screen.getByText('Missing')).toBeInTheDocument();
  });

  it('asks for new files only for requirements that need changes, and can show every upload', async () => {
    renderPage();
    await screen.findByText('Sign the last page.');

    expect(screen.getByLabelText(/Constitution/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Officer list/)).not.toBeInTheDocument();
    expect(screen.getByText('Showing the 1 file that needs changes.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all 2 uploads' }));

    expect(screen.getByLabelText(/Officer list/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument();
  });

  it('shows every upload and never says every file was accepted when it was returned on a note alone', async () => {
    const noted = application({ remarks: 'Replace the constitution with the signed copy.' });
    noted.requirements.forEach((requirement) => { requirement.reviews = []; requirement.review_files = []; });
    mocks.getMyOrganizationApplication.mockResolvedValue({ data: noted });
    renderPage();
    await screen.findByText('Replace the constitution with the signed copy.');

    expect(screen.getByLabelText(/Constitution/, { selector: 'input' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Officer list/, { selector: 'input' })).toBeInTheDocument();
    expect(screen.queryByText('Every file was accepted.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument();
  });

  it('says every file was accepted only when each one is, and still lets the applicant reach every upload', async () => {
    const accepted = application({ remarks: 'Add a cover letter.' });
    accepted.requirements.forEach((requirement) => { requirement.reviews = [{ stage: 'dean', stage_label: 'Department Head', status: 'ok', note: null }]; requirement.review_files = []; });
    mocks.getMyOrganizationApplication.mockResolvedValue({ data: accepted });
    renderPage();
    await screen.findByText('Add a cover letter.');

    expect(screen.getByText(/Every file was accepted\./)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Officer list/, { selector: 'input' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all 2 uploads' }));
    expect(screen.getByLabelText(/Constitution/, { selector: 'input' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Officer list/, { selector: 'input' })).toBeInTheDocument();
  });

  it('opens the applicant file and the reviewer attachments through the protected route', async () => {
    openMocks.openProtectedFile.mockResolvedValue();
    renderPage();
    await screen.findByText('Sign the last page.');

    fireEvent.click(screen.getAllByRole('button', { name: 'constitution.pdf' })[0]);
    fireEvent.click(screen.getByRole('button', { name: /marked-up\.pdf \(Department Head\)/ }));
    fireEvent.click(screen.getByRole('button', { name: /checklist\.pdf \(Department Head\)/ }));

    await waitFor(() => expect(openMocks.openProtectedFile).toHaveBeenCalledTimes(3));
    expect(openMocks.openProtectedFile).toHaveBeenNthCalledWith(1, '/my/organization-applications/8/documents/11');
    expect(openMocks.openProtectedFile).toHaveBeenNthCalledWith(2, '/my/organization-applications/8/review-files/4');
    expect(openMocks.openProtectedFile).toHaveBeenNthCalledWith(3, '/my/organization-applications/8/review-files/3');
  });

  it('sends a returned application again with only the replaced file', async () => {
    const sent = application({ status: 'pending_dean', round: 2, remarks: null, returned_by_role: null });
    mocks.resubmitOrganizationApplication.mockResolvedValue({ data: sent });
    renderPage();
    await screen.findByText('Sign the last page.');

    expect(screen.getByLabelText(/Organization name/)).toHaveValue('Chess Club');
    const replacement = new File(['pdf'], 'constitution-v2.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText(/Constitution/), { target: { files: [replacement] } });
    fireEvent.submit(screen.getByRole('button', { name: 'Send again' }).closest('form'));

    await waitFor(() => expect(mocks.resubmitOrganizationApplication).toHaveBeenCalledTimes(1));
    expect(mocks.resubmitOrganizationApplication).toHaveBeenCalledWith('8', expect.objectContaining({ name: 'Chess Club', acronym: 'CHESS', position_title: 'President' }), { 1: replacement });
    expect(await screen.findByText('Your Department Head is reviewing it.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send again' })).not.toBeInTheDocument();
  });

  it('keeps the form and shows the server message when sending again fails', async () => {
    mocks.resubmitOrganizationApplication.mockRejectedValue({ response: { status: 409, data: { message: 'Only a returned application can be sent again.' } } });
    renderPage();
    await screen.findByText('Sign the last page.');

    fireEvent.submit(screen.getByRole('button', { name: 'Send again' }).closest('form'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Only a returned application can be sent again.');
    expect(screen.getByRole('button', { name: 'Send again' })).toBeEnabled();
  });

  it('offers no form while the application is with a reviewer', async () => {
    mocks.getMyOrganizationApplication.mockResolvedValue({ data: application({ status: 'pending_sao', remarks: null, endorsement_note: 'Strong constitution.' }) });
    renderPage();

    expect(await screen.findByText('Your Department Head endorsed it. The SAO decides next.')).toBeInTheDocument();
    expect(screen.getByText('Note from your Department Head').nextSibling).toHaveTextContent('Strong constitution.');
    expect(screen.queryByRole('button', { name: 'Send again' })).not.toBeInTheDocument();
    expect(screen.getByText('With the SAO')).toBeInTheDocument();
  });

  it('says there is nothing to submit when the application lists no requirements', async () => {
    mocks.getMyOrganizationApplication.mockResolvedValue({ data: application({ status: 'pending_dean', remarks: null, requirements: [] }) });
    renderPage();

    expect(await screen.findByText('Nothing to submit yet')).toBeInTheDocument();
    expect(screen.getByText('No requirements are listed for this application.')).toBeInTheDocument();
  });

  it('says what an approval means for the student', async () => {
    mocks.getMyOrganizationApplication.mockResolvedValue({ data: application({ status: 'approved', remarks: null, review_files: [] }) });
    renderPage();

    expect(await screen.findByText('Approved. You are now President of Chess Club. Switch to it from the account menu.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send again' })).not.toBeInTheDocument();
  });

  it('shows the SAO as the one who rejected it', async () => {
    mocks.getMyOrganizationApplication.mockResolvedValue({ data: application({ status: 'rejected', remarks: 'A club with this purpose exists.' }) });
    renderPage();

    expect(await screen.findByText('The SAO did not approve this application.')).toBeInTheDocument();
    expect(screen.getByText('Note from the SAO').nextSibling).toHaveTextContent('A club with this purpose exists.');
  });

  it('shows an error with a retry, and a plain message when the application is not theirs', async () => {
    mocks.getMyOrganizationApplication.mockRejectedValueOnce({ response: { status: 404 } });
    renderPage();

    expect(await screen.findByText('This application is not yours or no longer exists.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    const [, form] = [null, await screen.findByRole('button', { name: 'Send again' })];
    expect(within(form.closest('form')).getByLabelText(/Organization name/)).toBeInTheDocument();
  });
});
