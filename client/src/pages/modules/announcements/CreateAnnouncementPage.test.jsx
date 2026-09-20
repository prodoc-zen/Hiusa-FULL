import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import CreateAnnouncementPage from './CreateAnnouncementPage';

vi.mock('../../../services/announcementService', () => ({
  createAnnouncement: vi.fn(),
  generateAnnouncementDraft: vi.fn(),
  getAnnouncementGenerationQuota: vi.fn(() => Promise.resolve({ data: { limit: 20, used: 3, remaining: 17 } })),
}));

describe('CreateAnnouncementPage', () => {
  it('renders a responsive editor workspace with accessible publishing controls', async () => {
    render(<MemoryRouter><CreateAnnouncementPage /></MemoryRouter>);

    expect(screen.getByRole('heading', { name: 'Create Announcement' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Title/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Content/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Instructions for AI draft/)).toBeInTheDocument();
    expect(screen.getByLabelText('Audience')).toBeInTheDocument();
    expect(screen.getByLabelText('Category')).toBeInTheDocument();
    expect(screen.getByText('Publishing settings')).toBeInTheDocument();
    expect(await screen.findByText('17 of 20 drafts left today')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish Now' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'General Assembly' } });
    fireEvent.change(screen.getByLabelText(/Content/), { target: { value: 'All members are invited.' } });

    expect(screen.getByRole('button', { name: 'Publish Now' })).toBeEnabled();
    expect(screen.getByText('24 characters')).toBeInTheDocument();
  });
});
