import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OrganizationSelectPage from './OrganizationSelectPage';

const mocks = vi.hoisted(() => ({ getOrganizations: vi.fn() }));

vi.mock('../../services/organizationService', () => mocks);

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/select-organization']}>
      <Routes>
        <Route path="/select-organization" element={<OrganizationSelectPage />} />
        <Route path="/login" element={<p>Login page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('OrganizationSelectPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.getOrganizations.mockResolvedValue({ data: [{ id: 3, name: 'Computer Studies Student Council', organization_type: 'SBO' }] });
  });

  it('asks for the organization beside the field when none is chosen', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue to login' })).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: 'Continue to login' }));

    expect(await screen.findByText('Select your organization to continue.')).toBeInTheDocument();
    expect(screen.queryByText('Login page')).not.toBeInTheDocument();
  });

  it('says so when the list cannot be loaded', async () => {
    mocks.getOrganizations.mockRejectedValue(new Error('offline'));
    renderPage();

    expect(await screen.findByText('We could not load the organization list. Try again.')).toBeInTheDocument();
  });
});
