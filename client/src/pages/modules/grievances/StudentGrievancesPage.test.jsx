import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StudentGrievancesPage from './StudentGrievancesPage';

const mocks = vi.hoisted(() => ({
  getGrievances: vi.fn(),
  createGrievance: vi.fn(),
  deleteGrievance: vi.fn(),
}));

vi.mock('../../../services/grievanceService', () => ({
  getGrievances: mocks.getGrievances,
  createGrievance: mocks.createGrievance,
  deleteGrievance: mocks.deleteGrievance,
}));

describe('StudentGrievancesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getGrievances.mockResolvedValue({ data: { data: [] } });
  });

  it('shows a first-run empty state on the "My grievances" tab when there are none', async () => {
    render(<MemoryRouter><StudentGrievancesPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('tab', { name: 'My grievances' }));
    expect(await screen.findByText('No grievances filed')).toBeInTheDocument();
  });

  it('shows a retryable error state when loading fails', async () => {
    mocks.getGrievances.mockRejectedValue(new Error('network'));
    render(<MemoryRouter><StudentGrievancesPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('tab', { name: 'My grievances' }));
    expect(await screen.findByText('Failed to load your grievances.')).toBeInTheDocument();

    mocks.getGrievances.mockResolvedValue({ data: { data: [] } });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No grievances filed')).toBeInTheDocument();
  });

  it('hides the anonymity toggle when addressed directly to SAO, since the org never sees it', () => {
    render(<MemoryRouter><StudentGrievancesPage /></MemoryRouter>);
    expect(screen.getByText('File this anonymously to my organization')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Student Affairs Office' }));
    expect(screen.queryByText('File this anonymously to my organization')).not.toBeInTheDocument();
  });

  it('files a grievance, switches to the list, and shows its AI classification as advisory', async () => {
    mocks.createGrievance.mockResolvedValue({ data: { id: 1 } });
    mocks.getGrievances.mockResolvedValueOnce({ data: { data: [] } }).mockResolvedValue({
      data: {
        data: [{
          id: 1,
          title: 'Harassment near the guard post',
          description: 'Detailed account.',
          organization_id: 4,
          status: 'submitted',
          urgency: 'Critical',
          category: 'Safety & Security',
          classification_engine: 'ai-service',
          classification_reasoning: 'Harassment keyword detected.',
          created_at: new Date().toISOString(),
        }],
      },
    });

    render(<MemoryRouter><StudentGrievancesPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/what's this about/i), { target: { value: 'Harassment near the guard post' } });
    fireEvent.change(screen.getByLabelText(/tell us what happened/i), { target: { value: 'Detailed account.' } });
    fireEvent.click(screen.getByRole('button', { name: 'File this grievance' }));

    await waitFor(() => expect(mocks.createGrievance).toHaveBeenCalledWith({
      title: 'Harassment near the guard post',
      description: 'Detailed account.',
      addressed_to: 'organization',
      is_anonymous: false,
    }));

    expect(await screen.findByRole('tab', { selected: true })).toHaveTextContent('My grievances');
    expect(await screen.findByText('Harassment Near the Guard Post')).toBeInTheDocument();
    expect(screen.getByText('Critical urgency')).toBeInTheDocument();
    expect(screen.getByText('ai-service')).toBeInTheDocument();
  });

  describe('deleting a grievance', () => {
    const base = { description: 'Detail.', organization_id: 4, urgency: 'Low', category: 'Other', classification_engine: 'ai-service', created_at: new Date().toISOString() };
    const submitted = { ...base, id: 1, title: 'Broken lock', status: 'submitted' };
    const reviewed = { ...base, id: 2, title: 'Noisy lab', status: 'under_review' };

    async function openDeleteDialog() {
      mocks.getGrievances.mockResolvedValue({ data: { data: [submitted, reviewed] } });
      render(<MemoryRouter><StudentGrievancesPage /></MemoryRouter>);
      fireEvent.click(screen.getByRole('tab', { name: /My grievances/ }));
      fireEvent.click(await screen.findByRole('button', { name: 'Delete grievance Broken Lock' }));
      const dialog = await screen.findByRole('dialog', { name: 'Delete this grievance?' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete grievance' }));
    }

    it('offers delete only while the grievance is still submitted', async () => {
      mocks.getGrievances.mockResolvedValue({ data: { data: [submitted, reviewed] } });
      render(<MemoryRouter><StudentGrievancesPage /></MemoryRouter>);
      fireEvent.click(screen.getByRole('tab', { name: /My grievances/ }));
      await screen.findByText('Broken Lock');
      expect(screen.getAllByRole('button', { name: /Delete grievance/ })).toHaveLength(1);
      expect(screen.queryByRole('button', { name: 'Delete grievance Noisy Lab' })).not.toBeInTheDocument();
    });

    it('deletes after confirmation and reloads the list', async () => {
      mocks.deleteGrievance.mockResolvedValue({ data: { message: 'Deleted.' } });
      await openDeleteDialog();

      await waitFor(() => expect(mocks.deleteGrievance).toHaveBeenCalledWith(1));
      await waitFor(() => expect(mocks.getGrievances).toHaveBeenCalledTimes(2));
    });

    it('shows the server message when the grievance was already reviewed', async () => {
      mocks.deleteGrievance.mockRejectedValue({ response: { status: 409, data: { message: 'Only grievances that have not been reviewed can be deleted.' } } });
      await openDeleteDialog();

      const dialog = await screen.findByRole('dialog', { name: 'Delete this grievance?' });
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('Only grievances that have not been reviewed can be deleted.');
    });
  });
});
