import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EventSubmissionPanel from './EventSubmissionPanel';

const mocks = vi.hoisted(() => ({
  getEventSubmission: vi.fn(),
  submitEventRequirements: vi.fn(),
  downloadEventRequirementFile: vi.fn(),
}));
vi.mock('../../services/eventService', () => mocks);

const requirements = [
  { id: 1, name: 'Event Proposal', description: '', is_optional: false },
  { id: 2, name: 'Venue Permit', description: '', is_optional: true },
];
const uploadedFile = { id: 5, original_name: 'proposal.pdf', requirement: { name: 'Event Proposal' } };

describe('EventSubmissionPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEventSubmission.mockResolvedValue({ data: { requirements, files: [], approval_status: null } });
  });

  afterEach(() => vi.restoreAllMocks());

  it('lists uploaded files with the review status for the SAO', async () => {
    mocks.getEventSubmission.mockResolvedValue({ data: { requirements, files: [uploadedFile], approval_status: 'pending_sao' } });
    render(<EventSubmissionPanel eventId={9} role="SUPER_ADMIN" />);

    expect(await screen.findByText('proposal.pdf', { exact: false })).toBeInTheDocument();
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

  it('shows the upload error and keeps the form', async () => {
    mocks.submitEventRequirements.mockRejectedValue({ response: { status: 422, data: { message: 'The file must be a PDF.' } } });
    render(<EventSubmissionPanel eventId={9} role="ADMIN" />);

    await screen.findByText('Event Proposal', { selector: 'label' });
    fireEvent.submit(screen.getByRole('button', { name: 'Submit event files to SAO' }).closest('form'));

    expect(await screen.findByRole('alert')).toHaveTextContent('The file must be a PDF.');
    expect(screen.getByRole('button', { name: 'Submit event files to SAO' })).toBeInTheDocument();
  });

  it('downloads an uploaded file through the blob link pattern', async () => {
    mocks.getEventSubmission.mockResolvedValue({ data: { requirements, files: [uploadedFile], approval_status: 'pending_sao' } });
    mocks.downloadEventRequirementFile.mockResolvedValue({ data: new Blob(['pdf']) });
    URL.createObjectURL = vi.fn(() => 'blob:proposal');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<EventSubmissionPanel eventId={9} role="SUPER_ADMIN" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Download' }));

    await waitFor(() => expect(mocks.downloadEventRequirementFile).toHaveBeenCalledWith(9, 5));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:proposal');
  });

  it('shows a download error', async () => {
    mocks.getEventSubmission.mockResolvedValue({ data: { requirements, files: [uploadedFile], approval_status: 'pending_sao' } });
    mocks.downloadEventRequirementFile.mockRejectedValue({ response: { status: 404, data: { message: 'File not found.' } } });
    render(<EventSubmissionPanel eventId={9} role="SUPER_ADMIN" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Download' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('File not found.');
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
    expect(await screen.findByText('Event Proposal', { exact: false })).toBeInTheDocument();
  });
});
