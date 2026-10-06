import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SaoEventRequirementsPage from './SaoEventRequirementsPage';

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

describe('SaoEventRequirementsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEventRequirements.mockResolvedValue({ data: [
      { id: 1, name: 'Proposal', description: 'Signed', allowed_extensions: ['pdf'], is_active: true },
      { id: 2, name: 'Budget', description: '', allowed_extensions: ['xlsx'], is_active: true },
    ] });
    mocks.getApprovalRequests.mockResolvedValue({ data: { data: [] } });
  });

  it('shows instructions without reorder controls', async () => {
    render(<SaoEventRequirementsPage />);
    expect(await screen.findByText('Signed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move Proposal down' })).not.toBeInTheDocument();
  });

  it('sends the description when adding a requirement', async () => {
    mocks.createEventRequirement.mockResolvedValue({ data: { id: 3 } });
    render(<SaoEventRequirementsPage />);
    await screen.findByText('Proposal');
    fireEvent.change(screen.getByPlaceholderText('Event proposal'), { target: { value: 'Permit' } });
    fireEvent.change(screen.getByLabelText('Instructions for organizations'), { target: { value: 'Signed by adviser' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add requirement' }));
    await waitFor(() => expect(mocks.createEventRequirement).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Permit', description: 'Signed by adviser', allowed_extensions: ['pdf'],
    })));
  });
});
