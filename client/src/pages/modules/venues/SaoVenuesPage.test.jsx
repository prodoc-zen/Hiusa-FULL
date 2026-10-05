import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SaoVenuesPage from './SaoVenuesPage';

const venueMocks = vi.hoisted(() => ({
  getVenues: vi.fn(),
  getVenueBookings: vi.fn(),
  updateVenue: vi.fn(),
}));

vi.mock('../../../services/venueService', () => ({
  ...venueMocks,
  createVenue: vi.fn(),
  deleteVenue: vi.fn(),
  getVenueAvailability: vi.fn(),
  reviewVenueBooking: vi.fn(),
}));

describe('SaoVenuesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'SUPER_ADMIN' }));
    venueMocks.getVenues.mockResolvedValue({ data: [{ id: 8, name: 'Main Hall', location: 'Campus', capacity: 100, is_active: true }] });
    venueMocks.getVenueBookings.mockResolvedValue({ data: { data: [], total: 0, current_page: 1, last_page: 1 } });
    venueMocks.updateVenue.mockResolvedValue({ data: { id: 8, is_active: false } });
  });

  it('changes venue status through the status switch', async () => {
    render(<SaoVenuesPage />);
    const [switchControl] = await screen.findAllByRole('switch', { name: 'Main Hall active status' });
    expect(switchControl).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('button', { name: 'Mark inactive' })).not.toBeInTheDocument();

    fireEvent.click(switchControl);
    await waitFor(() => expect(venueMocks.updateVenue).toHaveBeenCalledWith(8, { is_active: false }));
  });
});
