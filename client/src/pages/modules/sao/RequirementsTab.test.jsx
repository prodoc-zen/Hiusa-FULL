import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RequirementsTab from './RequirementsTab';

const mocks = vi.hoisted(() => ({
  getRequirementTypes: vi.fn(), createRequirementType: vi.fn(), updateRequirementType: vi.fn(), deleteRequirementType: vi.fn(),
  uploadRequirementSample: vi.fn(), setRequirementSampleLink: vi.fn(), removeRequirementSample: vi.fn(),
}));
const sampleMocks = vi.hoisted(() => ({ openProtectedFile: vi.fn() }));
vi.mock('../../../services/complianceService', () => mocks);
vi.mock('../../../services/systemAdministrationService', () => ({ getAcademicYears: vi.fn().mockResolvedValue([{ id: 1, label: '2026-2027' }]) }));
vi.mock('../../../utils/openProtectedFile', () => sampleMocks);

describe('Organization requirement samples', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequirementTypes.mockResolvedValue({ data: { data: [] } });
    mocks.createRequirementType.mockResolvedValue({ data: { id: 7 } });
    mocks.uploadRequirementSample.mockResolvedValue({ data: {} });
    mocks.setRequirementSampleLink.mockResolvedValue({ data: {} });
  });

  async function openNewRequirement() {
    render(<RequirementsTab currentAcademicYear="2026-2027" onChanged={() => {}} />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'New requirement' }))[0]);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Deadline/), { target: { value: '2026-12-01' } });
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Constitution' } });
    return dialog;
  }

  it('saves a sample link for an organization requirement', async () => {
    const dialog = await openNewRequirement();
    fireEvent.change(within(dialog).getByLabelText(/^Sample format/), { target: { value: 'link' } });
    fireEvent.change(within(dialog).getByLabelText(/^Sample link/), { target: { value: 'https://example.edu/guide' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add requirement' }));
    await waitFor(() => expect(mocks.createRequirementType).toHaveBeenCalledWith(expect.objectContaining({ template_url: 'https://example.edu/guide' })));
    expect(mocks.setRequirementSampleLink).not.toHaveBeenCalled();
  });

  it('saves an attached sample for an organization requirement', async () => {
    const dialog = await openNewRequirement();
    fireEvent.change(within(dialog).getByLabelText(/^Sample format/), { target: { value: 'file' } });
    const file = new File(['%PDF-1.4'], 'guide.pdf', { type: 'application/pdf' });
    fireEvent.change(within(dialog).getByLabelText(/^Sample file/), { target: { files: [file] } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add requirement' }));
    await waitFor(() => expect(mocks.createRequirementType).toHaveBeenCalledWith(expect.objectContaining({ template: file })));
    expect(mocks.uploadRequirementSample).not.toHaveBeenCalled();
  });

  it('requires the publisher to provide a sample before creating a requirement', async () => {
    const dialog = await openNewRequirement();
    expect(within(dialog).queryByRole('option', { name: 'No sample' })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add requirement' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Choose a sample file.');
    expect(mocks.createRequirementType).not.toHaveBeenCalled();
  });
});
