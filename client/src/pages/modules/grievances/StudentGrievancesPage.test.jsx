import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StudentGrievancesPage from './StudentGrievancesPage';

const mocks = vi.hoisted(() => ({
  getGrievances: vi.fn(),
  createGrievance: vi.fn(),
}));

vi.mock('../../../services/grievanceService', () => ({
  getGrievances: mocks.getGrievances,
  createGrievance: mocks.createGrievance,
}));

describe('StudentGrievancesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getGrievances.mockResolvedValue({ data: { data: [] } });
  });

  it('shows a first-run empty state on the "My grievances" tab when there are none', async () => {
    render(<StudentGrievancesPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'My grievances' }));
    expect(await screen.findByText('No grievances filed yet')).toBeInTheDocument();
  });

  it('shows a retryable error state when loading fails', async () => {
    mocks.getGrievances.mockRejectedValue(new Error('network'));
    render(<StudentGrievancesPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'My grievances' }));
    expect(await screen.findByText('Failed to load your grievances.')).toBeInTheDocument();

    mocks.getGrievances.mockResolvedValue({ data: { data: [] } });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No grievances filed yet')).toBeInTheDocument();
  });

  it('hides the anonymity toggle when addressed directly to SAO, since the org never sees it', () => {
    render(<StudentGrievancesPage />);
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

    render(<StudentGrievancesPage />);
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
    expect(await screen.findByText('Harassment near the guard post')).toBeInTheDocument();
    expect(screen.getByText('Critical urgency')).toBeInTheDocument();
    expect(screen.getByText('ai-service')).toBeInTheDocument();
  });
});
