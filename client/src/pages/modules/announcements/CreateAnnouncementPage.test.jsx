import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import CreateAnnouncementPage from './CreateAnnouncementPage';

vi.mock('../../../services/announcementService', () => ({
  createAnnouncement: vi.fn(),
  generateAnnouncementDraft: vi.fn(),
}));

describe('CreateAnnouncementPage', () => {
  it('renders a responsive editor workspace with accessible publishing controls', () => {
    render(<MemoryRouter><CreateAnnouncementPage /></MemoryRouter>);

    expect(screen.getByRole('heading', { name: 'Create Announcement' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Title/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Content/)).toBeInTheDocument();
    expect(screen.getByLabelText('Audience')).toBeInTheDocument();
    expect(screen.getByLabelText('Category')).toBeInTheDocument();
    expect(screen.getByText('Publishing settings')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish Now' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'General Assembly' } });
    fireEvent.change(screen.getByLabelText(/Content/), { target: { value: 'All members are invited.' } });

    expect(screen.getByRole('button', { name: 'Publish Now' })).toBeEnabled();
    expect(screen.getByText('24 characters')).toBeInTheDocument();
  });
});
