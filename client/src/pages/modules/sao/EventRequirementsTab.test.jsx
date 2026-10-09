import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EventRequirementsTab from './EventRequirementsTab';

const mocks = vi.hoisted(() => ({
  getEventRequirements: vi.fn(), createEventRequirement: vi.fn(), updateEventRequirement: vi.fn(),
  reorderEventRequirements: vi.fn(), deleteEventRequirement: vi.fn(), getApprovalRequests: vi.fn(), reviewApprovalRequest: vi.fn(),
}));
vi.mock('../../../services/eventService', () => ({
  getEventRequirements: mocks.getEventRequirements, createEventRequirement: mocks.createEventRequirement,
  updateEventRequirement: mocks.updateEventRequirement, reorderEventRequirements: mocks.reorderEventRequirements,
  deleteEventRequirement: mocks.deleteEventRequirement,
}));
vi.mock('../../../services/approvalService', () => ({ getApprovalRequests: mocks.getApprovalRequests, reviewApprovalRequest: mocks.reviewApprovalRequest }));
vi.mock('../../../components/events/EventSubmissionPanel', () => ({ default: () => <div>Submission files</div> }));

describe('EventRequirementsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEventRequirements.mockResolvedValue({ data: [
      { id: 1, name: 'Proposal', description: 'Signed', allowed_extensions: ['pdf'], is_active: true },
      { id: 2, name: 'Budget', description: '', allowed_extensions: ['xlsx'], is_active: true },
    ] });
    mocks.getApprovalRequests.mockResolvedValue({ data: { data: [] } });
  });

  it('shows instructions without reorder controls', async () => {
    render(<EventRequirementsTab />);
    expect(await screen.findByText('Signed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move Proposal down' })).not.toBeInTheDocument();
  });

  it('sends the description when adding a requirement', async () => {
    mocks.createEventRequirement.mockResolvedValue({ data: { id: 3 } });
    render(<EventRequirementsTab />);
    await screen.findByText('Proposal');
    fireEvent.change(screen.getByPlaceholderText('Event proposal'), { target: { value: 'Permit' } });
    fireEvent.change(screen.getByLabelText('Instructions for organizations'), { target: { value: 'Signed by adviser' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add requirement' }));
    await waitFor(() => expect(mocks.createEventRequirement).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Permit', description: 'Signed by adviser', allowed_extensions: ['pdf'],
    })));
  });

  it('lists events waiting for SAO and approves one', async () => {
    mocks.getApprovalRequests.mockResolvedValue({ data: { data: [{ id: 41, entity_id: 9, title: 'Foundation Day', requester: { first_name: 'Ana', last_name: 'Cruz' } }] } });
    mocks.reviewApprovalRequest.mockResolvedValue({ data: {} });
    render(<EventRequirementsTab />);

    expect(await screen.findByText('Foundation Day')).toBeInTheDocument();
    expect(mocks.getApprovalRequests).toHaveBeenCalledWith({ entity_type: 'event', status: 'pending', per_page: 100 });

    fireEvent.click(screen.getByRole('button', { name: 'View files' }));
    expect(screen.getByText('Submission files')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Approve/ }));
    await waitFor(() => expect(mocks.reviewApprovalRequest).toHaveBeenCalledWith(41, { status: 'approved', remarks: undefined }));
  });

  it('keeps Reject disabled until remarks are written, then rejects', async () => {
    mocks.getApprovalRequests.mockResolvedValue({ data: { data: [{ id: 41, entity_id: 9, title: 'Foundation Day', requester: {} }] } });
    mocks.reviewApprovalRequest.mockResolvedValue({ data: {} });
    render(<EventRequirementsTab />);
    await screen.findByText('Foundation Day');

    const reject = screen.getByRole('button', { name: /Reject/ });
    expect(reject).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Remarks for rejection'), { target: { value: 'Missing budget' } });
    expect(reject).toBeEnabled();
    fireEvent.click(reject);

    await waitFor(() => expect(mocks.reviewApprovalRequest).toHaveBeenCalledWith(41, { status: 'rejected', remarks: 'Missing budget' }));
  });

  it('shows the empty queue message', async () => {
    render(<EventRequirementsTab />);
    expect(await screen.findByText('No event submissions are waiting for review.')).toBeInTheDocument();
  });

  it('shows a load error and retries', async () => {
    mocks.getEventRequirements.mockRejectedValueOnce(new Error('offline'));
    render(<EventRequirementsTab />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load event requirements.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Proposal')).toBeInTheDocument();
  });

  it('surfaces the server message when a requirement with files cannot be removed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.deleteEventRequirement.mockRejectedValue({ response: { status: 409, data: { message: 'Submitted files prevent removal.' } } });
    render(<EventRequirementsTab />);
    await screen.findByText('Proposal');

    fireEvent.click(screen.getByRole('button', { name: 'Remove Proposal' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Submitted files prevent removal.');
  });
});
