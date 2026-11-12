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
vi.mock('../../../utils/openProtectedFile', () => openMocks);

const FILES = [
  { id: 7, requirement: 'Venue Reservation Letter', original_name: 'venue.pdf', open_url: '/events/9/submission/files/7', reviews: [] },
  { id: 8, requirement: 'Request Letter', original_name: 'request.pdf', open_url: '/events/9/submission/files/8', reviews: [] },
];
const waiting = (files = FILES) => ({ id: 41, entity_type: 'event', entity_id: 9, title: 'Foundation Day', required_role: 'SUPER_ADMIN', requester: { first_name: 'Ana', last_name: 'Cruz' }, summary: { requirement_files: files } });

async function openFiles() {
  fireEvent.click(await screen.findByRole('button', { name: 'Actions for Foundation Day' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'View files' }));
  return screen.getByRole('region', { name: 'SAO event files' });
}

const mark = (section, name, value) => {
  fireEvent.click(within(section).getByRole('button', { name: `Review ${name}` }));
  fireEvent.change(within(section).getByLabelText(`Review of ${name}`), { target: { value } });
};

const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Actions for Foundation Day' }));
const closeMenu = () => fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Approve' }), { key: 'Escape' });

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

  describe('in a completed semester', () => {
    const sentence = 'This semester is completed, so its requirements are read only.';

    it('shows no Add requirement form, toggle, Edit or Remove and says why', async () => {
      mocks.getEventRequirements.mockResolvedValue({ data: [{ id: 1, name: 'Proposal', description: '', allowed_extensions: ['pdf'], is_active: true, template_url: 'https://example.edu/proposal' }] });
      render(<EventRequirementsTab readOnly />);
      await screen.findAllByText('Proposal');
      expect(screen.getAllByText(sentence).length).toBeGreaterThan(0);
      expect(screen.queryByRole('button', { name: 'Add requirement' })).not.toBeInTheDocument();
      expect(screen.queryByText('Add event requirement')).not.toBeInTheDocument();
      expect(screen.queryByRole('switch')).not.toBeInTheDocument();
      fireEvent.click(screen.getAllByRole('button', { name: 'Actions for Proposal' })[0]);
      expect(await screen.findByRole('menuitem', { name: 'View sample' })).toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: 'Edit requirement' })).not.toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: 'Remove requirement' })).not.toBeInTheDocument();
    });

    it('keeps the form, the toggle, Edit and Remove in an active or upcoming semester', async () => {
      render(<EventRequirementsTab />);
      await screen.findAllByText('Proposal');
      expect(screen.queryByText(sentence)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add requirement' })).toBeInTheDocument();
      expect(screen.getAllByRole('switch', { name: 'Deactivate Proposal' }).length).toBeGreaterThan(0);
      fireEvent.click(screen.getAllByRole('button', { name: 'Actions for Proposal' })[0]);
      expect(await screen.findByRole('menuitem', { name: 'Edit requirement' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Remove requirement' })).toBeInTheDocument();
    });
  });

  it('keeps the requirements table to the columns that fit its card and shows the details under the name', async () => {
    mocks.getEventRequirements.mockResolvedValue({ data: [{ id: 1, name: 'Proposal', description: '', allowed_extensions: ['pdf'], venue_type: 'on_campus', is_optional: false, is_active: true }] });
    render(<EventRequirementsTab />);
    await screen.findAllByText('Proposal');
    const table = screen.getByRole('table', { name: 'Event requirements' });
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['#', 'File', 'Status', 'Actions']);
    expect(within(table).getByText('PDF · On campus · Required')).toBeInTheDocument();
    expect(within(table).getByText('Sample format required')).toBeInTheDocument();
  });

  it('holds back Add requirement and says why when no semester is active or selected', async () => {
    render(<EventRequirementsTab noSemester />);
    await screen.findAllByText('Proposal');
    const button = screen.getByRole('button', { name: 'Add requirement' });
    expect(button).toBeDisabled();
    const note = screen.getByText('There is no active semester. Activate or select a semester before adding a requirement.');
    expect(button).toHaveAccessibleDescription(note.textContent);
    fireEvent.change(screen.getByPlaceholderText('Event proposal'), { target: { value: 'Permit' } });
    fireEvent.click(button);
    expect(mocks.createEventRequirement).not.toHaveBeenCalled();
  });

  it('keeps Add requirement open and the note away while a semester is selected', async () => {
    render(<EventRequirementsTab />);
    await screen.findAllByText('Proposal');
    expect(screen.getByRole('button', { name: 'Add requirement' })).toBeEnabled();
    expect(screen.queryByText(/There is no active semester/)).not.toBeInTheDocument();
  });

  it('still lets SAO edit, activate and remove existing event requirements without a semester', async () => {
    render(<EventRequirementsTab noSemester />);
    await screen.findAllByText('Proposal');
    expect(screen.getAllByRole('switch', { name: 'Deactivate Proposal' })[0]).toBeEnabled();
    fireEvent.click(screen.getAllByRole('button', { name: 'Actions for Proposal' })[0]);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit requirement' }));
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    expect(screen.queryByText(/There is no active semester/)).not.toBeInTheDocument();
  });

  it('sends the description when adding a requirement', async () => {
    mocks.createEventRequirement.mockResolvedValue({ data: { id: 3 } });
    render(<EventRequirementsTab />);
    await screen.findAllByText('Proposal');
    fireEvent.change(screen.getByPlaceholderText('Event proposal'), { target: { value: 'Permit' } });
    fireEvent.change(screen.getByLabelText(/^Instructions for organizations/), { target: { value: 'Signed by adviser' } });
    fireEvent.change(screen.getByLabelText(/^Sample format/), { target: { value: 'link' } });
    fireEvent.change(screen.getByLabelText(/^Sample link/), { target: { value: 'https://example.edu/permit-format' } });
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
    fireEvent.change(screen.getByLabelText(/^Sample format/), { target: { value: 'file' } });
    const file = new File(['%PDF-1.4'], 'sample.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Sample PDF file'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Add requirement' }));
    await waitFor(() => expect(mocks.createEventRequirement).toHaveBeenCalledWith(expect.objectContaining({ template: file })));
    expect(mocks.uploadEventRequirementTemplate).not.toHaveBeenCalled();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Proposal' }))[0]);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'View sample' }));
    await waitFor(() => expect(openMocks.openProtectedFile).toHaveBeenCalledWith('/event-requirements/3/template'));
  });

  it('lets SAO save a sample link and validates its protocol', async () => {
    mocks.createEventRequirement.mockResolvedValue({ data: { id: 3 } });
    render(<EventRequirementsTab />);
    await screen.findAllByText('Proposal');
    fireEvent.change(screen.getByPlaceholderText('Event proposal'), { target: { value: 'Program' } });
    fireEvent.change(screen.getByLabelText(/^Sample format/), { target: { value: 'link' } });
    fireEvent.change(screen.getByLabelText('Sample link'), { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add requirement' }));
    expect(screen.getByText('Enter a valid http or https sample link.')).toBeInTheDocument();
    expect(mocks.createEventRequirement).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Sample link'), { target: { value: 'https://example.edu/proposal-guide' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add requirement' }));
    await waitFor(() => expect(mocks.createEventRequirement).toHaveBeenCalledWith(expect.objectContaining({ template_url: 'https://example.edu/proposal-guide' })));
    expect(mocks.setEventRequirementTemplateLink).not.toHaveBeenCalled();
  });

  it('opens a sample link and keeps a sample mandatory when editing', async () => {
    const openWindow = vi.spyOn(window, 'open').mockImplementation(() => null);
    mocks.updateEventRequirement.mockResolvedValue({ data: { id: 1 } });
    mocks.getEventRequirements.mockResolvedValue({ data: [{ id: 1, name: 'Proposal', description: '', allowed_extensions: ['pdf'], venue_type: 'all', is_optional: false, is_active: true, template_url: 'https://example.edu/sample' }] });
    render(<EventRequirementsTab />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Proposal' }))[0]);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'View sample' }));
    expect(openWindow).toHaveBeenCalledWith('https://example.edu/sample', '_blank', 'noopener,noreferrer');
    fireEvent.click(screen.getAllByRole('button', { name: 'Actions for Proposal' })[0]);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit requirement' }));
    expect(screen.getByLabelText(/^Sample format/)).toHaveValue('link');
    expect(screen.queryByRole('option', { name: 'No sample' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove sample' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mocks.updateEventRequirement).toHaveBeenCalledWith(1, expect.objectContaining({ template_url: 'https://example.edu/sample' })));
    expect(mocks.removeEventRequirementTemplate).not.toHaveBeenCalled();
    openWindow.mockRestore();
  });

  it('rejects a non-PDF sample before creating a requirement', async () => {
    render(<EventRequirementsTab />);
    await screen.findAllByText('Proposal');
    fireEvent.change(screen.getByPlaceholderText('Event proposal'), { target: { value: 'Another proposal' } });
    fireEvent.change(screen.getByLabelText(/^Sample format/), { target: { value: 'file' } });
    fireEvent.change(screen.getByLabelText('Sample PDF file'), { target: { files: [new File(['png'], 'sample.png', { type: 'image/png' })] } });
    expect(screen.getByText('Choose a PDF sample template.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add requirement' }));
    expect(mocks.createEventRequirement).not.toHaveBeenCalled();
  });

  it('can remove a sample only from an inactive requirement after confirmation', async () => {
    mocks.getEventRequirements.mockResolvedValue({ data: [{ id: 1, name: 'Proposal', description: '', allowed_extensions: ['pdf'], venue_type: 'all', is_optional: false, template_original_name: 'sample.pdf', is_active: false }] });
    render(<EventRequirementsTab />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Proposal' }))[0]);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit requirement' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove sample' }));
    expect(mocks.removeEventRequirementTemplate).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove sample' }));
    await waitFor(() => expect(mocks.removeEventRequirementTemplate).toHaveBeenCalledWith(1));
    expect(mocks.deleteEventRequirement).not.toHaveBeenCalled();
  });

  it('does not create an event requirement without a sample', async () => {
    render(<EventRequirementsTab />);
    await screen.findAllByText('Proposal');
    fireEvent.change(screen.getByPlaceholderText('Event proposal'), { target: { value: 'Permit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add requirement' }));
    expect(screen.getByText('Choose a PDF sample file.')).toBeInTheDocument();
    expect(mocks.createEventRequirement).not.toHaveBeenCalled();
  });

  it('lists events waiting for SAO and approves one after confirming', async () => {
    mocks.getApprovalRequests.mockResolvedValue({ data: { data: [{ id: 41, entity_id: 9, title: 'Foundation Day', requester: { first_name: 'Ana', last_name: 'Cruz' } }] } });
    mocks.reviewApprovalRequest.mockResolvedValue({ data: {} });
    render(<EventRequirementsTab mode="reviews" />);

    expect(await screen.findByText('Foundation Day')).toBeInTheDocument();
    expect(mocks.getApprovalRequests).toHaveBeenCalledWith(expect.objectContaining({ entity_type: 'event', status: 'pending', per_page: 100 }));

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Foundation Day' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'View files' }));
    expect(screen.getByText('No files have been submitted for this event.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Foundation Day' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Approve' }));
    expect(mocks.reviewApprovalRequest).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Approve event' }));
    await waitFor(() => expect(mocks.reviewApprovalRequest).toHaveBeenCalledWith(41, { status: 'approved', remarks: undefined }));
  });

  it('opens the files of the event a link named and tells the page when the SAO opens or hides one', async () => {
    mocks.getApprovalRequests.mockResolvedValue({ data: { data: [{ ...waiting(), requester: {} }, { ...waiting(), id: 42, entity_id: 12, title: 'Sports Fest', requester: {} }] } });
    const onEventOpen = vi.fn();
    render(<EventRequirementsTab mode="reviews" initialEventId="12" onEventOpen={onEventOpen} />);
    await screen.findByText('Sports Fest');
    expect(screen.getAllByRole('region', { name: 'SAO event files' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Sports Fest' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Hide files' }));
    expect(screen.queryByRole('region', { name: 'SAO event files' })).not.toBeInTheDocument();
    expect(onEventOpen).toHaveBeenLastCalledWith(null);

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Foundation Day' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'View files' }));
    expect(onEventOpen).toHaveBeenLastCalledWith(9);
  });

  it('lists each submitted file with a status, a file link and a Review action under a filled Action column', async () => {
    mocks.getApprovalRequests.mockResolvedValue({ data: { data: [waiting()] } });
    render(<EventRequirementsTab mode="reviews" />);
    const section = await openFiles();

    expect(within(section).getAllByRole('listitem')).toHaveLength(2);
    expect(within(section).getByText('Action')).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Review Venue Reservation Letter' })).toBeInTheDocument();
    fireEvent.click(within(section).getByRole('button', { name: 'request.pdf' }));
    expect(openMocks.openProtectedFile).toHaveBeenCalledWith('/events/9/submission/files/8');
  });

  it('puts the file list straight in the Events waiting for SAO card, with no bordered box of its own', async () => {
    mocks.getApprovalRequests.mockResolvedValue({ data: { data: [waiting()] } });
    render(<EventRequirementsTab mode="reviews" />);
    const section = await openFiles();

    expect(section.querySelector('.rounded-card')).toBeNull();
    expect(section.querySelector('.border')).toBeNull();
  });

  it('keeps Approve off until every file is accepted, then approves with the marks', async () => {
    mocks.getApprovalRequests.mockResolvedValue({ data: { data: [waiting()] } });
    mocks.reviewApprovalRequest.mockResolvedValue({ data: {} });
    render(<EventRequirementsTab mode="reviews" />);
    const section = await openFiles();

    openMenu();
    expect(screen.getByRole('menuitem', { name: 'Approve' })).toBeDisabled();
    closeMenu();
    expect(screen.getByText('Accept every file to approve. Reject the event to send back a file with a note.')).toBeInTheDocument();

    mark(section, 'Venue Reservation Letter', 'ok');
    mark(section, 'Request Letter', 'ok');
    openMenu();
    expect(screen.getByRole('menuitem', { name: 'Approve' })).toBeEnabled();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Approve' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve event' }));

    await waitFor(() => expect(mocks.reviewApprovalRequest).toHaveBeenCalledWith(41, { status: 'approved', remarks: undefined, files: [{ id: 7, status: 'ok' }, { id: 8, status: 'ok' }] }));
  });

  it('keeps Approve off while a file needs changes and sends the marked files with their notes on Reject', async () => {
    mocks.getApprovalRequests.mockResolvedValue({ data: { data: [waiting()] } });
    mocks.reviewApprovalRequest.mockResolvedValue({ data: {} });
    render(<EventRequirementsTab mode="reviews" />);
    const section = await openFiles();

    mark(section, 'Request Letter', 'needs_changes');
    openMenu();
    expect(screen.getByRole('menuitem', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Reject' })).toBeDisabled();
    closeMenu();

    fireEvent.change(within(section).getByLabelText('Note for the organization'), { target: { value: 'The seal is missing.' } });
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reject' }));
    fireEvent.change(await screen.findByLabelText(/Remarks for rejection/), { target: { value: 'Fix the letter' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject event' }));

    await waitFor(() => expect(mocks.reviewApprovalRequest).toHaveBeenCalledWith(41, { status: 'rejected', remarks: 'Fix the letter', files: [{ id: 8, status: 'needs_changes', note: 'The seal is missing.' }] }));
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
