import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PrivacyConsentDialog from './PrivacyConsentDialog';

const mocks = vi.hoisted(() => ({
  acceptPrivacyNotice: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('../../services/authService', () => mocks);

const agreeBox = () => screen.getByLabelText(/agree to the processing of my personal data/);

function renderDialog(user) {
  if (user) localStorage.setItem('user', JSON.stringify(user));
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route path="/dashboard" element={<PrivacyConsentDialog />} />
        <Route path="/login" element={<p>Login page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PrivacyConsentDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.acceptPrivacyNotice.mockResolvedValue({ data: { success: true, data: { privacy_accepted_at: '2026-11-15T08:00:00.000000Z', privacy_notice_version: '2026-11' } } });
    mocks.logout.mockResolvedValue(undefined);
  });

  afterEach(() => localStorage.clear());

  it('appears for a signed in person with no agreement on record and cannot be dismissed', () => {
    renderDialog({ school_id: 2600101, role: 'STUDENT', privacy_accepted_at: null });

    const dialog = screen.getByRole('dialog', { name: 'Before you continue' });
    expect(dialog).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close modal' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Data Privacy Notice' })).toHaveAttribute('href', '/privacy');

    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.mouseDown(dialog.parentElement);
    expect(screen.getByRole('dialog', { name: 'Before you continue' })).toBeInTheDocument();
  });

  it.each([
    ['has agreed', { school_id: 1, role: 'STUDENT', privacy_accepted_at: '2026-11-01T00:00:00.000000Z' }],
    ['has a stored sign in from before the notice', { school_id: 1, role: 'STUDENT' }],
    ['must change the password first', { school_id: 1, role: 'STUDENT', privacy_accepted_at: null, must_change_password: true }],
  ])('stays away for someone who %s', (_name, user) => {
    renderDialog(user);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('asks for the box to be ticked before anything is sent', () => {
    renderDialog({ school_id: 2600101, role: 'STUDENT', privacy_accepted_at: null });

    fireEvent.click(screen.getByRole('button', { name: 'Agree and continue' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Read the Data Privacy Notice and tick the box to agree.');
    expect(mocks.acceptPrivacyNotice).not.toHaveBeenCalled();
  });

  it('records the agreement, keeps the rest of the stored person and closes', async () => {
    renderDialog({ school_id: 2600101, role: 'STUDENT', first_name: 'Hannah', privacy_accepted_at: null });

    fireEvent.click(agreeBox());
    fireEvent.click(screen.getByRole('button', { name: 'Agree and continue' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocks.acceptPrivacyNotice).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem('user'))).toMatchObject({
      school_id: 2600101,
      first_name: 'Hannah',
      privacy_accepted_at: '2026-11-15T08:00:00.000000Z',
      privacy_notice_version: '2026-11',
    });
  });

  it('stays open and says so when the agreement could not be recorded', async () => {
    mocks.acceptPrivacyNotice.mockRejectedValue(Object.assign(new Error('failed'), { response: { status: 500, data: { message: 'Server error.' } } }));
    renderDialog({ school_id: 2600101, role: 'STUDENT', privacy_accepted_at: null });

    fireEvent.click(agreeBox());
    fireEvent.click(screen.getByRole('button', { name: 'Agree and continue' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Before you continue' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('user')).privacy_accepted_at).toBeNull();
  });

  it('signs out instead and lands on the sign in page', async () => {
    renderDialog({ school_id: 2600101, role: 'STUDENT', privacy_accepted_at: null });

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByText('Login page')).toBeInTheDocument();
    expect(mocks.logout).toHaveBeenCalledTimes(1);
    expect(mocks.acceptPrivacyNotice).not.toHaveBeenCalled();
  });
});
