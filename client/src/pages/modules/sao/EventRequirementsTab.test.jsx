import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EventRequirementsTab from './EventRequirementsTab';

const mocks = vi.hoisted(() => ({
  getEventRequirements: vi.fn(), createEventRequirement: vi.fn(), updateEventRequirement: vi.fn(),
  reorderEventRequirements: vi.fn(), deleteEventRequirement: vi.fn(), getApprovalRequests: vi.fn(), reviewApprovalRequest: vi.fn(),
  uploadEventRequirementTemplate: vi.fn(), removeEventRequirementTemplate: vi.fn(), setEventRequirementTemplateLink: vi.fn(),
}));
const openMocks = vi.hoisted(() => ({ openProtectedFile: vi.fn() }));
vi.mock('../../../services/eventService', () => ({
  getEventRequirements: mocks.getEventRequirements, createEventRequirement: mocks.createEventRequirement,
  updateEventRequirement: mocks.updateEventRequirement, reorderEventRequirements: mocks.reorderEventRequirements,
  deleteEventRequirement: mocks.deleteEventRequirement,
  uploadEventRequirementTemplate: mocks.uploadEventRequirementTemplate,
  removeEventRequirementTemplate: mocks.removeEventRequirementTemplate,
  setEventRequirementTemplateLink: mocks.setEventRequirementTemplateLink,
}));
vi.mock('../../../services/approvalService', () => ({ getApprovalRequests: mocks.getApprovalRequests, reviewApprovalRequest: mocks.reviewApprovalRequest }));
vi.mock('../../../components/events/EventSubmissionPanel', () => ({ default: () => <div>Submission files</div> }));
vi.mock('../../../utils/openProtectedFile', () => openMocks);

describe('EventRequirementsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEventRequirements.mockResolvedValue({ data: [
      { id: 1, name: 'Proposal', description: 'Signed', allowed_extensions: ['pdf'], is_active: true },
      { id: 2, name: 'Budget', description: '', allowed_extensions: ['xlsx'], is_active: true },
    ] });
    mocks.getApprovalRequests.mockResolvedValue({ data: { data: [] } });
    mocks.uploadEventRequirementTemplate.mockResolvedValue({ data: {} });
    mocks.removeEventRequirementTemplate.mockResolvedValue({ data: {} });
    mocks.setEventRequirementTemplateLink.mockResolvedValue({ data: {} });
    openMocks.openProtectedFile.mockResolvedValue();
  });

  it('shows instructions without reorder controls', async () => {
    render(<EventRequirementsTab />);
    expect((await screen.findAllByText('Signed')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Move Proposal down' })).not.toBeInTheDocument();
  });

  it('sends the description when adding a requirement', async () => {
    mocks.createEventRequirement.mockResolvedValue({ data: { id: 3 } });
    render(<EventRequirementsTab />);
    await screen.findAllByText('Proposal');
    fireEvent.change(screen.getByPlaceholderText('Event proposal'), { target: { value: 'Permit' } });
    fireEvent.change(screen.getByLabelText('Instructions for organizations'), { target: { value: 'Signed by adviser' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add requirement' }));
    await waitFor(() => expect(mocks.createEventRequirement).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Permit', description: 'Signed by adviser', allowed_extensions: ['pdf'],
    })));
  });

  it('lets SAO attach a PDF sample and open it from the requirement list', async () => {
    mocks.createEventRequirement.mockResolvedValue({ data: { id: 3 } });
    mocks.getEventRequirements.mockResolvedValueOnce({ data: [] }).mockResolvedValue({ data: [{ id: 3, name: 'Proposal', allowed_extensions: ['pdf'], template_original_name: 'sample.pdf', is_active: true }] });
    render(<EventRequirementsTab />);
    await screen.findByText('No files required yet');
    fireEvent.change(screen.getByPlaceholderText('Event proposal'), { target: { value: 'Proposal' } });
    fireEvent.change(screen.getByLabelText('Sample format'), { target: { value: 'file' } });
    const file = new File(['%PDF-1.4'], 'sample.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Sample PDF file'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Add requirement' }));
    await waitFor(() => expect(mocks.uploadEventRequirementTemplate).toHaveBeenCalledWith(3, file));
    fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Proposal' }))[0]);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'View sample' }));
    await waitFor(() => expect(openMocks.openProtectedFile).toHaveBeenCalledWith('/event-requirements/3/template'));
  });

  it('lets SAO save a sample link and validates its protocol', async () => {
    mocks.createEventRequirement.mockResolvedValue({ data: { id: 3 } });
    render(<EventRequirementsTab />);
    await screen.findAllByText('Proposal');
    fireEvent.change(screen.getByPlaceholderText('Event proposal'), { target: { value: 'Program' } });
    fireEvent.change(screen.getByLabelText('Sample format'), { target: { value: 'link' } });
    fireEvent.change(screen.getByLabelText('Sample link'), { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add requirement' }));
    expect(screen.getByText('Enter a valid http or https sample link.')).toBeInTheDocument();
    expect(mocks.createEventRequirement).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Sample link'), { target: { value: 'https://example.edu/proposal-guide' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add requirement' }));
    await waitFor(() => expect(mocks.setEventRequirementTemplateLink).toHaveBeenCalledWith(3, 'https://example.edu/proposal-guide'));
  });

  it('opens and removes an existing sample link from a requirement', async () => {
    const openWindow = vi.spyOn(window, 'open').mockImplementation(() => null);
    mocks.updateEventRequirement.mockResolvedValue({ data: { id: 1 } });
    mocks.getEventRequirements.mockResolvedValue({ data: [{ id: 1, name: 'Proposal', description: '', allowed_extensions: ['pdf'], venue_type: 'all', is_optional: false, is_active: true, template_url: 'https://example.edu/sample' }] });
    render(<EventRequirementsTab />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Proposal' }))[0]);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'View sample' }));
    expect(openWindow).toHaveBeenCalledWith('https://example.edu/sample', '_blank', 'noopener,noreferrer');
    fireEvent.click(screen.getAllByRole('button', { name: 'Actions for Proposal' })[0]);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit requirement' }));
    expect(screen.getByLabelText('Sample format')).toHaveValue('link');
    fireEvent.change(screen.getByLabelText('Sample format'), { target: { value: 'none' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mocks.removeEventRequirementTemplate).toHaveBeenCalledWith(1));
    openWindow.mockRestore();
  });

  it('rejects a non-PDF sample before creating a requirement', async () => {
    render(<EventRequirementsTab />);
    await screen.findAllByText('Proposal');
    fireEvent.change(screen.getByPlaceholderText('Event proposal'), { target: { value: 'Another proposal' } });
    fireEvent.change(screen.getByLabelText('Sample format'), { target: { value: 'file' } });
    fireEvent.change(screen.getByLabelText('Sample PDF file'), { target: { files: [new File(['png'], 'sample.png', { type: 'image/png' })] } });
    expect(screen.getByText('Choose a PDF sample template.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add requirement' }));
    expect(mocks.createEventRequirement).not.toHaveBeenCalled();
  });

  it('confirms removal of an existing sample without removing the requirement', async () => {
    mocks.getEventRequirements.mockResolvedValue({ data: [{ id: 1, name: 'Proposal', description: '', allowed_extensions: ['pdf'], venue_type: 'all', is_optional: false, template_original_name: 'sample.pdf', is_active: true }] });
    render(<EventRequirementsTab />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Proposal' }))[0]);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit requirement' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove sample' }));
    expect(mocks.removeEventRequirementTemplate).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove sample' }));
    await waitFor(() => expect(mocks.removeEventRequirementTemplate).toHaveBeenCalledWith(1));
    expect(mocks.deleteEventRequirement).not.toHaveBeenCalled();
  });

  it('lists events waiting for SAO and approves one after confirming', async () => {
    mocks.getApprovalRequests.mockResolvedValue({ data: { data: [{ id: 41, entity_id: 9, title: 'Foundation Day', requester: { first_name: 'Ana', last_name: 'Cruz' } }] } });
    mocks.reviewApprovalRequest.mockResolvedValue({ data: {} });
    render(<EventRequirementsTab mode="reviews" />);

    expect(await screen.findByText('Foundation Day')).toBeInTheDocument();
    expect(mocks.getApprovalRequests).toHaveBeenCalledWith({ entity_type: 'event', status: 'pending', per_page: 100 });

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Foundation Day' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'View files' }));
    expect(screen.getByText('Submission files')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Foundation Day' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Approve' }));
    expect(mocks.reviewApprovalRequest).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Approve event' }));
    await waitFor(() => expect(mocks.reviewApprovalRequest).toHaveBeenCalledWith(41, { status: 'approved', remarks: undefined }));
  });

  it('keeps event decisions inside the three-dot action menu', async () => {
    mocks.getApprovalRequests.mockResolvedValue({ data: { data: [{ id: 41, entity_id: 9, title: 'Foundation Day', requester: {} }] } });
    render(<EventRequirementsTab mode="reviews" />);
    await screen.findByText('Foundation Day');

    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Foundation Day' }));
    expect(screen.getByRole('menuitem', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Reject' })).toBeInTheDocument();
  });

  it('asks for remarks in a confirmation before rejecting', async () => {
    mocks.getApprovalRequests.mockResolvedValue({ data: { data: [{ id: 41, entity_id: 9, title: 'Foundation Day', requester: {} }] } });
    mocks.reviewApprovalRequest.mockResolvedValue({ data: {} });
    render(<EventRequirementsTab mode="reviews" />);
    await screen.findByText('Foundation Day');

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Foundation Day' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Reject' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reject event' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Write why this event is rejected');
    expect(screen.getByLabelText(/Remarks for rejection/)).toHaveFocus();
    expect(mocks.reviewApprovalRequest).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Remarks for rejection/), { target: { value: 'Missing budget' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject event' }));

    await waitFor(() => expect(mocks.reviewApprovalRequest).toHaveBeenCalledWith(41, { status: 'rejected', remarks: 'Missing budget' }));
  });

  it('shows the empty queue message', async () => {
    render(<EventRequirementsTab mode="reviews" />);
    expect(await screen.findByText('No event submissions are waiting for review.')).toBeInTheDocument();
  });

  it('shows a load error and retries', async () => {
    mocks.getEventRequirements.mockRejectedValueOnce(new Error('offline'));
    render(<EventRequirementsTab />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load event requirements.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect((await screen.findAllByText('Proposal')).length).toBeGreaterThan(0);
  });

  it('surfaces the server message when a requirement with files cannot be removed', async () => {
    mocks.deleteEventRequirement.mockRejectedValue({ response: { status: 409, data: { message: 'Submitted files prevent removal.' } } });
    render(<EventRequirementsTab />);
    await screen.findAllByText('Proposal');

    fireEvent.click(screen.getAllByRole('button', { name: 'Actions for Proposal' })[0]);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove requirement' }));
    expect(mocks.deleteEventRequirement).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove requirement' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Submitted files prevent removal.');
  });
});
