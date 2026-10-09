import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SystemCollegesPage from './SystemCollegesPage';

const mocks = vi.hoisted(() => ({
  getSystemColleges: vi.fn(), uploadSystemCollegeLogo: vi.fn(),
}));
vi.mock('../../../services/systemAdministrationService', () => mocks);

const renderPage = () => render(<MemoryRouter><SystemCollegesPage /></MemoryRouter>);

describe('SystemCollegesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSystemColleges.mockResolvedValue([{ id: 3, name: 'College of Arts', code: 'COA', is_active: true, organizations_count: 2 }]);
  });

  it('is view-only: no add, edit or delete controls', async () => {
    renderPage();
    expect(await screen.findByText('College of Arts')).toBeInTheDocument();
    expect(screen.getByText(/COA · 2 organizations/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add college/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.getByText(/fixed list managed in the system/i)).toBeInTheDocument();
  });

  it('links each college to its organizations', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: 'View organizations of College of Arts' });
    expect(link).toHaveAttribute('href', '/dashboard/super-admin/organizations?status=active&search=College%20of%20Arts');
  });

  it('uploads a logo and shows it', async () => {
    mocks.uploadSystemCollegeLogo.mockResolvedValue({ id: 3, logo_url: 'https://cdn.test/logo.png' });
    const { container } = renderPage();
    await screen.findByText('College of Arts');
    const file = new File(['x'], 'logo.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Logo file for College of Arts'), { target: { files: [file] } });
    await waitFor(() => expect(mocks.uploadSystemCollegeLogo).toHaveBeenCalledWith(3, file));
    expect(await screen.findByRole('status')).toHaveTextContent('Logo updated');
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.test/logo.png');
  });

  it('shows the upload error', async () => {
    mocks.uploadSystemCollegeLogo.mockRejectedValue({ response: { status: 422, data: { message: 'The logo must be an image.' } } });
    renderPage();
    await screen.findByText('College of Arts');
    fireEvent.change(screen.getByLabelText('Logo file for College of Arts'), { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('The logo must be an image.');
  });

  it('shows an error with retry', async () => {
    mocks.getSystemColleges.mockRejectedValueOnce(new Error('boom'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('College of Arts')).toBeInTheDocument();
  });

  it('shows empty and filtered states', async () => {
    mocks.getSystemColleges.mockResolvedValueOnce([]);
    const { unmount } = renderPage();
    expect(await screen.findByText('No colleges found')).toBeInTheDocument();
    unmount();
    renderPage();
    await screen.findByText('College of Arts');
    fireEvent.change(screen.getByLabelText('Search colleges'), { target: { value: 'zzz' } });
    expect(screen.getByText('No colleges match your search.')).toBeInTheDocument();
  });

  it('labels the search field with visible text', async () => {
    renderPage();
    await screen.findByText('College of Arts');
    expect(screen.getByLabelText('Search colleges').labels[0]).toHaveTextContent('Search colleges');
  });
});
