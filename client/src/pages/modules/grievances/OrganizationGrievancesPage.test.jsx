import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OrganizationGrievancesPage from './OrganizationGrievancesPage';

const mocks = vi.hoisted(() => ({
  getGrievances: vi.fn(),
  updateGrievanceStatus: vi.fn(),
}));

vi.mock('../../../services/grievanceService', () => ({
  getGrievances: mocks.getGrievances,
  updateGrievanceStatus: mocks.updateGrievanceStatus,
}));

const ANONYMOUS_GRIEVANCE = {
  id: 1,
  title: 'Unsafe stairwell',
  description: 'The back stairwell light has been out for a week.',
  organization_id: 4,
  status: 'submitted',
  urgency: 'High',
  category: 'Safety & Security',
  is_anonymous: true,
  created_at: new Date().toISOString(),
};

function envelope(data) {
  return { data: { data, current_page: 1, last_page: 1, per_page: 20, total: data.length } };
}

describe('OrganizationGrievancesPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows an empty state when the organization has no grievances', async () => {
    mocks.getGrievances.mockResolvedValue(envelope([]));
    render(<OrganizationGrievancesPage />);
    expect(await screen.findByText('No grievances yet')).toBeInTheDocument();
  });

  it('shows a retryable error state', async () => {
    mocks.getGrievances.mockRejectedValueOnce(new Error('down'));
    render(<OrganizationGrievancesPage />);
    expect(await screen.findByText('Failed to load grievances addressed to your organization.')).toBeInTheDocument();

    mocks.getGrievances.mockResolvedValue(envelope([]));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No grievances yet')).toBeInTheDocument();
  });

  it('never renders an identity for an anonymous filer, showing a dignified confidential badge instead', async () => {
    mocks.getGrievances.mockResolvedValue(envelope([ANONYMOUS_GRIEVANCE]));
    render(<OrganizationGrievancesPage />);
    const [titleElement] = await screen.findAllByText('Unsafe Stairwell');
    const table = within(titleElement.closest('[data-view="table"]'));
    expect(table.getByText('Unsafe Stairwell')).toBeInTheDocument();
    expect(table.getByText('Confidential')).toBeInTheDocument();
    expect(table.queryByText(/Student \d/)).not.toBeInTheDocument();
  });

  it('opens the detail drawer, shows the confidentiality note, and resolves with required remarks', async () => {
    mocks.getGrievances.mockResolvedValue(envelope([ANONYMOUS_GRIEVANCE]));
    mocks.updateGrievanceStatus.mockResolvedValue({ data: { ...ANONYMOUS_GRIEVANCE, status: 'resolved', remarks: 'Bulb replaced.' } });

    render(<OrganizationGrievancesPage />);
    const [tableTrigger] = await screen.findAllByText('Unsafe Stairwell');
    fireEvent.click(tableTrigger);

    expect(screen.getByText('Filed anonymously')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));

    // The confirmation modal reuses the "Resolve" label for its confirm
    // button, so it is now the second "Resolve" button on the page.
    const modalConfirm = screen.getAllByRole('button', { name: 'Resolve' })[1];
    expect(modalConfirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/remarks/i), { target: { value: 'Bulb replaced.' } });
    expect(modalConfirm).not.toBeDisabled();
    fireEvent.click(modalConfirm);

    await waitFor(() => expect(mocks.updateGrievanceStatus).toHaveBeenCalledWith(1, { status: 'resolved', remarks: 'Bulb replaced.' }));
  });
});
