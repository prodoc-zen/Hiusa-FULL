import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EventSubmissionPanel from './EventSubmissionPanel';

const mocks = vi.hoisted(() => ({
  getEventSubmission: vi.fn(),
  submitEventRequirements: vi.fn(),
}));
const openMocks = vi.hoisted(() => ({ openProtectedFile: vi.fn() }));
vi.mock('../../services/eventService', () => mocks);
vi.mock('../../utils/openProtectedFile', () => openMocks);

const requirements = [
  { id: 1, name: 'Event Proposal', description: '', is_optional: false },
  { id: 2, name: 'Venue Permit', description: '', is_optional: true },
];
const uploadedFile = { id: 5, requirement_id: 1, original_name: 'proposal.pdf', requirement: { name: 'Event Proposal' } };

describe('EventSubmissionPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEventSubmission.mockResolvedValue({ data: { requirements, files: [], approval_status: null } });
  });

  afterEach(() => vi.restoreAllMocks());

  it('clears the previous event and ignores its late response when switching events', async () => {
    let finishOld;
    mocks.getEventSubmission.mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve; }))
      .mockResolvedValue({ data: { requirements: [{ id: 3, name: 'New event permit' }], files: [], approval_status: null } });
    const { rerender } = render(<EventSubmissionPanel eventId={9} role="ADMIN" />);
    rerender(<EventSubmissionPanel eventId={10} role="ADMIN" />);
    await screen.findAllByText('New event permit');
    await act(async () => finishOld({ data: { requirements, files: [uploadedFile], approval_status: null } }));
    expect(screen.queryAllByText('Event Proposal')).toHaveLength(0);
    expect(screen.getAllByText('New event permit').length).toBeGreaterThan(0);
  });

  it('lists uploaded files with the review status for the SAO', async () => {
    mocks.getEventSubmission.mockResolvedValue({ data: { requirements, files: [uploadedFile], approval_status: 'pending_sao' } });
    render(<EventSubmissionPanel eventId={9} role="SUPER_ADMIN" />);

    expect((await screen.findAllByText('proposal.pdf')).length).toBeGreaterThan(0);
    expect(screen.getByText('Review: pending sao')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Submit event files/ })).not.toBeInTheDocument();
    expect(mocks.getEventSubmission).toHaveBeenCalledWith(9);
  });

  it('lets an organization admin upload a file for each requirement', async () => {
    const submitted = { requirements, files: [uploadedFile], approval_status: 'pending_department_head' };
    mocks.submitEventRequirements.mockResolvedValue({ data: submitted });
    const onSubmitted = vi.fn();
    render(<EventSubmissionPanel eventId={9} role="ADMIN" onSubmitted={onSubmitted} />);

    const proposalInput = (await screen.findByText('Event Proposal', { selector: 'label' })).querySelector('input[type="file"]');
    const file = new File(['pdf'], 'proposal.pdf', { type: 'application/pdf' });
    fireEvent.change(proposalInput, { target: { files: [file] } });
    fireEvent.submit(screen.getByRole('button', { name: 'Submit event files to SAO' }).closest('form'));

    await waitFor(() => expect(mocks.submitEventRequirements).toHaveBeenCalledWith(9, { 1: file }));
    await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
    expect(await screen.findByText('Review: pending department head')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit event files to SAO' })).not.toBeInTheDocument();
  });

  it('keeps the submit button disabled and counts the required files still missing', async () => {
    mocks.getEventSubmission.mockResolvedValue({ data: { requirements: [...requirements, { id: 3, name: 'Risk assessment', description: '', is_optional: false }], files: [], approval_status: null } });
    render(<EventSubmissionPanel eventId={9} role="ADMIN" />);
    const send = await screen.findByRole('button', { name: 'Submit event files to SAO' });
    const pick = (name) => screen.getByText(name, { selector: 'label' }).querySelector('input[type="file"]');
    const pdf = (name) => new File(['pdf'], name, { type: 'application/pdf' });

    expect(send).toBeDisabled();
    expect(screen.getByText('2 files are still missing.')).toBeInTheDocument();

    fireEvent.change(pick('Event Proposal'), { target: { files: [pdf('proposal.pdf')] } });
    expect(send).toBeDisabled();
    expect(screen.getByText('1 file is still missing.')).toBeInTheDocument();

    fireEvent.change(pick('Risk assessment'), { target: { files: [pdf('risk.pdf')] } });
    expect(send).toBeEnabled();
    expect(screen.queryByText(/still missing/)).not.toBeInTheDocument();
  });

  it('does not count a file the organization already submitted or an optional one', async () => {
    mocks.getEventSubmission.mockResolvedValue({ data: { requirements, files: [uploadedFile], approval_status: 'rejected', approval_remarks: 'Replace the permit.' } });
    render(<EventSubmissionPanel eventId={9} role="ADMIN" />);

    expect(await screen.findByRole('button', { name: 'Submit event files to SAO' })).toBeEnabled();
    expect(screen.queryByText(/still missing/)).not.toBeInTheDocument();
  });

  it('does not tell an organization admin that the SAO sample is missing', async () => {
    render(<EventSubmissionPanel eventId={9} role="ADMIN" />);

    await screen.findByText('Event Proposal', { selector: 'label' });
    expect(screen.queryByText(/Sample format not provided/)).not.toBeInTheDocument();
  });

  it('allows the admin to upload SAO files after Department Head approval', async () => {
    mocks.getEventSubmission.mockResolvedValue({ data: { requirements, files: [], approval_status: 'approved', approval_stage: 'awaiting_requirements' } });
    render(<EventSubmissionPanel eventId={9} role="ADMIN" />);
    expect(await screen.findByRole('button', { name: 'Submit event files to SAO' })).toBeInTheDocument();
    expect(screen.getAllByText('Not submitted').length).toBeGreaterThan(0);
  });

  it('shows the upload error and keeps the form', async () => {
    mocks.submitEventRequirements.mockRejectedValue({ response: { status: 422, data: { message: 'The file must be a PDF.' } } });
    render(<EventSubmissionPanel eventId={9} role="ADMIN" />);

    await screen.findByText('Event Proposal', { selector: 'label' });
    fireEvent.submit(screen.getByRole('button', { name: 'Submit event files to SAO' }).closest('form'));

    expect(await screen.findByRole('alert')).toHaveTextContent('The file must be a PDF.');
    expect(screen.getByRole('button', { name: 'Submit event files to SAO' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(mocks.getEventSubmission).toHaveBeenLastCalledWith(9, { cache: false }));
  });

  it('opens an uploaded file in a new tab through the shared helper instead of downloading it', async () => {
    mocks.getEventSubmission.mockResolvedValue({ data: { requirements, files: [uploadedFile], approval_status: 'pending_sao' } });
    openMocks.openProtectedFile.mockResolvedValue();
    render(<EventSubmissionPanel eventId={9} role="SUPER_ADMIN" />);

    expect(screen.queryByRole('button', { name: 'Download' })).not.toBeInTheDocument();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Event Proposal' }))[0]);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'View submitted file' }));

    await waitFor(() => expect(openMocks.openProtectedFile).toHaveBeenCalledWith('/events/9/submission/files/5'));
  });

  it('shows why a file could not be opened', async () => {
    mocks.getEventSubmission.mockResolvedValue({ data: { requirements, files: [uploadedFile], approval_status: 'pending_sao' } });
    openMocks.openProtectedFile.mockRejectedValue({ userMessage: 'Allow pop-ups to open this file.' });
    render(<EventSubmissionPanel eventId={9} role="SUPER_ADMIN" />);

    fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Event Proposal' }))[0]);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'View submitted file' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Allow pop-ups to open this file.');
  });

  it('shows rejected remarks and keeps an existing file while resubmitting', async () => {
    mocks.getEventSubmission.mockResolvedValue({ data: { requirements, files: [uploadedFile], approval_status: 'rejected', approval_remarks: 'Replace the permit.' } });
    mocks.submitEventRequirements.mockResolvedValue({ data: { requirements, files: [uploadedFile], approval_status: 'pending' } });
    render(<EventSubmissionPanel eventId={9} role="ADMIN" />);

    expect(await screen.findByText(/Replace the permit/)).toBeInTheDocument();
    const proposalInput = screen.getByText('Event Proposal', { selector: 'label' }).querySelector('input[type="file"]');
    const permitInput = screen.getByText('Venue Permit', { selector: 'label' }).querySelector('input[type="file"]');
    expect(proposalInput).not.toBeRequired();
    expect(permitInput).not.toBeRequired();
    const permit = new File(['pdf'], 'permit.pdf', { type: 'application/pdf' });
    fireEvent.change(permitInput, { target: { files: [permit] } });
    fireEvent.submit(screen.getByRole('button', { name: 'Submit event files to SAO' }).closest('form'));
    await waitFor(() => expect(mocks.submitEventRequirements).toHaveBeenCalledWith(9, { 2: permit }));
  });

  it('shows the SAO sample beside a rejected upload and opens it', async () => {
    mocks.getEventSubmission.mockResolvedValue({ data: { requirements: [{ ...requirements[0], template_original_name: 'sample-proposal.pdf' }], files: [uploadedFile], approval_status: 'rejected', approval_remarks: 'Wrong format.' } });
    openMocks.openProtectedFile.mockResolvedValue();
    render(<EventSubmissionPanel eventId={9} role="ADMIN" />);
    expect(await screen.findByText('SAO sample: sample-proposal.pdf')).toBeInTheDocument();
    expect(screen.getByText(/Wrong format/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'View sample' }).at(-1));
    await waitFor(() => expect(openMocks.openProtectedFile).toHaveBeenCalledWith('/event-requirements/1/template'));
    expect(screen.getByRole('button', { name: 'Submit event files to SAO' })).toBeInTheDocument();
  });

  it('opens an SAO sample link from the upload form', async () => {
    const openWindow = vi.spyOn(window, 'open').mockImplementation(() => null);
    mocks.getEventSubmission.mockResolvedValue({ data: { requirements: [{ ...requirements[0], template_url: 'https://example.edu/sample' }], files: [], approval_status: null } });
    render(<EventSubmissionPanel eventId={9} role="ADMIN" />);
    expect(await screen.findByText('SAO sample: https://example.edu/sample')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View sample' }));
    expect(openWindow).toHaveBeenCalledWith('https://example.edu/sample', '_blank', 'noopener,noreferrer');
  });

  it('shows the empty state when SAO has listed no requirements', async () => {
    mocks.getEventSubmission.mockResolvedValue({ data: { requirements: [], files: [], approval_status: null } });
    render(<EventSubmissionPanel eventId={9} role="SUPER_ADMIN" />);
    expect(await screen.findByText('SAO has not listed any file requirements.')).toBeInTheDocument();
  });

  it('shows a load error and retries', async () => {
    mocks.getEventSubmission.mockRejectedValueOnce(new Error('offline'));
    mocks.getEventSubmission.mockResolvedValueOnce({ data: { requirements, files: [uploadedFile], approval_status: 'pending_sao' } });
    render(<EventSubmissionPanel eventId={9} role="SUPER_ADMIN" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load event requirements.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect((await screen.findAllByText('Event Proposal', { exact: false })).length).toBeGreaterThan(0);
  });

  describe('per-file review notes', () => {
    const flaggedFile = { ...uploadedFile, reviews: [{ stage: 'dean', status: 'needs_changes', note: 'The seal is missing.' }] };
    const permitFile = { id: 6, requirement_id: 2, original_name: 'permit.pdf', requirement: { name: 'Venue Permit' }, reviews: [{ stage: 'dean', status: 'ok', note: null }] };
    const returned = { requirements, files: [flaggedFile, permitFile], approval_status: 'rejected', approval_stage: 'rejected', approval_remarks: 'Fix the proposal.' };

    it('shows the note beside the file that needs changes and Accepted on the file that was accepted', async () => {
      mocks.getEventSubmission.mockResolvedValue({ data: returned });
      render(<EventSubmissionPanel eventId={9} role="ADMIN" />);

      expect((await screen.findAllByText('Department Head: Needs changes. The seal is missing.')).length).toBeGreaterThan(0);
      expect(screen.getAllByText('Needs changes').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Accepted').length).toBeGreaterThan(0);
    });

    it('asks only for the file that needs changes and keeps Submit off until it is replaced', async () => {
      mocks.getEventSubmission.mockResolvedValue({ data: returned });
      mocks.submitEventRequirements.mockResolvedValue({ data: { ...returned, approval_status: 'pending' } });
      render(<EventSubmissionPanel eventId={9} role="ADMIN" />);
      const send = await screen.findByRole('button', { name: 'Submit event files to SAO' });

      expect(send).toBeDisabled();
      expect(screen.getByText('1 file still needs to be replaced.')).toBeInTheDocument();
      const proposalInput = screen.getByText('Event Proposal', { selector: 'label' }).querySelector('input[type="file"]');
      expect(proposalInput).toBeRequired();
      expect(screen.getByText('Venue Permit', { selector: 'label' }).querySelector('input[type="file"]')).not.toBeRequired();

      const file = new File(['pdf'], 'proposal-v2.pdf', { type: 'application/pdf' });
      fireEvent.change(proposalInput, { target: { files: [file] } });
      expect(send).toBeEnabled();
      fireEvent.submit(send.closest('form'));
      await waitFor(() => expect(mocks.submitEventRequirements).toHaveBeenCalledWith(9, { 1: file }));
    });
  });
});
