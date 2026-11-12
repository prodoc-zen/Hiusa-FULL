import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RequirementsTab from './RequirementsTab';

const mocks = vi.hoisted(() => ({
  getRequirementTypes: vi.fn(), createRequirementType: vi.fn(), updateRequirementType: vi.fn(), deleteRequirementType: vi.fn(),
  uploadRequirementSample: vi.fn(), setRequirementSampleLink: vi.fn(), removeRequirementSample: vi.fn(),
}));
const sampleMocks = vi.hoisted(() => ({ openProtectedFile: vi.fn() }));
vi.mock('../../../services/complianceService', () => mocks);
vi.mock('../../../services/systemAdministrationService', () => ({ getAcademicYears: vi.fn().mockResolvedValue([{ id: 1, label: '2026-2027' }, { id: 2, label: '2027-2028' }]) }));
vi.mock('../../../utils/openProtectedFile', () => sampleMocks);

describe('Organization requirement samples', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequirementTypes.mockResolvedValue({ data: { data: [] } });
    mocks.createRequirementType.mockResolvedValue({ data: { id: 7 } });
    mocks.uploadRequirementSample.mockResolvedValue({ data: {} });
    mocks.setRequirementSampleLink.mockResolvedValue({ data: {} });
  });

  it('does not replace the selected category with an older response', async () => {
    let finishOld;
    mocks.getRequirementTypes.mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve; }))
      .mockResolvedValue({ data: { data: [{ id: 8, name: 'Current semester report' }] } });
    const { rerender } = render(<RequirementsTab currentAcademicYear="2026-2027" onChanged={() => {}} />);
    rerender(<RequirementsTab currentAcademicYear="2026-2027" category="semestral_report" onChanged={() => {}} />);
    await screen.findAllByText('Current semester report');
    await act(async () => finishOld({ data: { data: [{ id: 7, name: 'Old registration' }] } }));
    expect(screen.queryAllByText('Old Registration')).toHaveLength(0);
    expect(screen.getAllByText('Current semester report').length).toBeGreaterThan(0);
  });

  it('holds back New requirement and says why when no semester is active or selected', async () => {
    render(<RequirementsTab currentAcademicYear="2026-2027" noSemester onChanged={() => {}} />);
    const button = (await screen.findAllByRole('button', { name: 'New requirement' }))[0];
    expect(button).toBeDisabled();
    const note = screen.getByText('There is no active semester. Activate or select a semester before adding a requirement.');
    expect(button).toHaveAccessibleDescription(note.textContent);
    fireEvent.click(button);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps New requirement open and the note away while a semester is selected', async () => {
    render(<RequirementsTab currentAcademicYear="2026-2027" onChanged={() => {}} />);
    expect((await screen.findAllByRole('button', { name: 'New requirement' }))[0]).toBeEnabled();
    expect(screen.queryByText(/There is no active semester/)).not.toBeInTheDocument();
  });

  it('leaves edit, activate, delete and sample actions on existing requirements usable without a semester', async () => {
    mocks.getRequirementTypes.mockResolvedValue({ data: { data: [{ id: 5, name: 'Old pledge', is_active: true, template_url: 'https://example.edu/pledge.pdf', deadline_at: '2026-12-01T09:00:00Z', allowed_extensions: ['pdf'] }] } });
    render(<RequirementsTab currentAcademicYear="2026-2027" noSemester onChanged={() => {}} />);
    await screen.findAllByText('Old pledge');
    expect(screen.getAllByRole('switch', { name: 'Deactivate Old pledge' })[0]).toBeEnabled();
    fireEvent.click(screen.getAllByRole('button', { name: 'Actions for Old pledge' })[0]);
    for (const name of ['View sample', 'Edit requirement', 'Mark inactive', 'Delete requirement']) {
      expect(await screen.findByRole('menuitem', { name })).not.toBeDisabled();
    }
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

  it('only offers the academic year of the semester the SAO is working in', async () => {
    const dialog = await openNewRequirement();
    const year = within(dialog).getByLabelText(/^Academic year/);
    expect(year).toBeDisabled();
    expect(year).toHaveValue('2026-2027');
    expect(within(year).queryByRole('option', { name: /2027-2028/ })).not.toBeInTheDocument();
  });

  it('shows the Manila day of a deadline stored at midnight and sends that same day back on save', async () => {
    mocks.getRequirementTypes.mockResolvedValue({ data: { data: [{ id: 5, name: 'Constitution', academic_year: '2026-2027', deadline_at: '2026-12-30T16:00:00.000000Z', is_active: true, template_url: 'https://example.edu/guide', allowed_extensions: ['pdf'] }] } });
    mocks.updateRequirementType.mockResolvedValue({ data: {} });
    render(<RequirementsTab currentAcademicYear="2026-2027" onChanged={() => {}} />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Constitution' }))[0]);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit requirement' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/^Deadline/)).toHaveValue('2026-12-31');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mocks.updateRequirementType).toHaveBeenCalledWith(5, expect.objectContaining({ deadline_at: '2026-12-31' })));
  });

  describe('deadline range', () => {
    const semester = { id: 3, starts_on: '2026-08-01', ends_on: '2026-12-31' };
    const message = 'The deadline must fall inside this semester, between August 1, 2026 and December 31, 2026.';

    async function fillAndSubmit(dialog) {
      fireEvent.change(within(dialog).getByLabelText(/^Deadline/), { target: { value: '2028-11-10' } });
      fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Valid ID' } });
      fireEvent.change(within(dialog).getByLabelText(/^Sample format/), { target: { value: 'link' } });
      fireEvent.change(within(dialog).getByLabelText(/^Sample link/), { target: { value: 'https://example.edu/id' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Add requirement' }));
    }

    async function openNew(props = { semester }) {
      render(<RequirementsTab currentAcademicYear="2026-2027" onChanged={() => {}} {...props} />);
      fireEvent.click((await screen.findAllByRole('button', { name: 'New requirement' }))[0]);
      return screen.findByRole('dialog');
    }

    async function openEdit(type) {
      mocks.getRequirementTypes.mockResolvedValue({ data: { data: [type] } });
      render(<RequirementsTab currentAcademicYear="2026-2027" semester={semester} onChanged={() => {}} />);
      fireEvent.click((await screen.findAllByRole('button', { name: `Actions for ${type.name}` }))[0]);
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit requirement' }));
      return screen.findByRole('dialog');
    }

    const stored = { id: 5, name: 'Valid ID', academic_year: '2026-2027', academic_semester_id: 3, is_active: true, template_url: 'https://example.edu/id', allowed_extensions: ['pdf'] };

    it('limits the date picker to the semester and says the range in the field hint', async () => {
      const dialog = await openNew();
      const deadline = within(dialog).getByLabelText(/^Deadline/);
      expect(deadline).toHaveAttribute('min', '2026-08-01');
      expect(deadline).toHaveAttribute('max', '2026-12-31');
      expect(within(dialog).getByText('Pick a day from August 1, 2026 to December 31, 2026.')).toBeInTheDocument();
    });

    it('refuses a deadline outside the semester before anything is sent', async () => {
      const dialog = await openNew();
      await fillAndSubmit(dialog);
      expect(await within(dialog).findByText(message)).toBeInTheDocument();
      expect(mocks.createRequirementType).not.toHaveBeenCalled();
    });

    it('shows the server refusal under the deadline when the date still gets through', async () => {
      mocks.createRequirementType.mockRejectedValue({ response: { status: 422, data: { message, errors: { deadline_at: [message] } } } });
      const dialog = await openNew({});
      await fillAndSubmit(dialog);
      expect((await within(dialog).findAllByText(message)).length).toBeGreaterThan(0);
    });

    it('lets a stored deadline that is already outside the semester stay while the rest is edited', async () => {
      mocks.updateRequirementType.mockResolvedValue({ data: {} });
      const dialog = await openEdit({ ...stored, deadline_at: '2028-11-10T15:59:59.000000Z' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
      await waitFor(() => expect(mocks.updateRequirementType).toHaveBeenCalledWith(5, expect.objectContaining({ deadline_at: '2028-11-10' })));
    });

    it('refuses moving a stored deadline to a day outside the semester', async () => {
      const dialog = await openEdit({ ...stored, deadline_at: '2026-11-10T15:59:59.000000Z' });
      fireEvent.change(within(dialog).getByLabelText(/^Deadline/), { target: { value: '2027-02-01' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
      expect(await within(dialog).findByText(message)).toBeInTheDocument();
      expect(mocks.updateRequirementType).not.toHaveBeenCalled();
    });
  });
});
