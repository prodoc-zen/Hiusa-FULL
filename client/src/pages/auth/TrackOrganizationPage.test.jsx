import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TrackOrganizationPage from './TrackOrganizationPage';
import { getApplicationTracking } from '../../services/organizationApplicationService';

vi.mock('../../services/organizationApplicationService', () => ({ getApplicationTracking: vi.fn() }));

function renderTracking() {
  render(<MemoryRouter initialEntries={['/track-organization/8?expires=123&signature=private']}><Routes>
    <Route path="/track-organization/:applicationId" element={<TrackOrganizationPage />} />
  </Routes></MemoryRouter>);
}

describe('Organization application tracking', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the endorsement handoff and review stages from an emailed link', async () => {
    getApplicationTracking.mockResolvedValue({ data: { application: {
      name: 'Computing Council', college: 'College of Computing', status: 'endorsed',
      submitted_at: '2026-10-14T00:00:00Z', email_verified_at: '2026-10-14T01:00:00Z', endorsed_at: '2026-10-14T02:00:00Z', reviewed_at: null, remarks: null,
    } } });
    renderTracking();
    expect(await screen.findByText('With SAO')).toBeInTheDocument();
    expect(screen.getByText('Computing Council · College of Computing')).toBeInTheDocument();
    expect(screen.getByText('Department Head review')).toBeInTheDocument();
    expect(screen.getByText('SAO decision')).toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(getApplicationTracking).toHaveBeenCalledWith('8', 'expires=123&signature=private');
  });

  it('shows rejection remarks and a way to recover the edit link', async () => {
    getApplicationTracking.mockResolvedValue({ data: { application: {
      name: 'Computing Council', college: 'College of Computing', status: 'rejected',
      submitted_at: '2026-10-14T00:00:00Z', email_verified_at: '2026-10-14T01:00:00Z', endorsed_at: null, reviewed_at: '2026-10-14T02:00:00Z', remarks: 'Fix the file format.',
    } } });
    renderTracking();
    expect((await screen.findAllByText('Returned for changes')).length).toBeGreaterThan(0);
    expect(screen.getByText('Fix the file format.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Lost the edit link? Request another' })).toHaveAttribute('href', '/register-organization/edit-link');
  });

  it('offers a new private link when the emailed one expires', async () => {
    getApplicationTracking.mockRejectedValue({ response: { status: 403 } });
    renderTracking();
    expect(await screen.findByRole('alert')).toHaveTextContent('tracking link has expired');
    expect(screen.getByRole('link', { name: 'Request a new tracking link' })).toHaveAttribute('href', '/track-organization');
  });

  it('marks each stage complete when SAO approves the organization', async () => {
    getApplicationTracking.mockResolvedValue({ data: { application: {
      name: 'Computing Council', college: 'College of Computing', status: 'approved',
      submitted_at: '2026-10-14T00:00:00Z', email_verified_at: '2026-10-14T01:00:00Z', endorsed_at: '2026-10-14T02:00:00Z', reviewed_at: '2026-10-14T03:00:00Z', remarks: null,
    } } });
    renderTracking();
    expect(await screen.findByText('Approved')).toBeInTheDocument();
    expect(screen.queryByText('Waiting')).not.toBeInTheDocument();
  });
});
