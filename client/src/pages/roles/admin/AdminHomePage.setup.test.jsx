import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminHomePage from './AdminHomePage';
import { setTrackerShown } from '../../../components/process/trackerPresence';

const mocks = vi.hoisted(() => ({ getAdminDashboard: vi.fn(), getBriefing: vi.fn(), getProcessStatus: vi.fn() }));
vi.mock('../../../services/adminDashboardService', () => ({ getAdminDashboard: mocks.getAdminDashboard }));
vi.mock('../../../services/dashboardService', () => ({ getBriefing: mocks.getBriefing }));
vi.mock('../../../services/processService', () => ({ getProcessStatus: mocks.getProcessStatus }));
vi.mock('../../../hooks/useRefetchOnReturn', () => ({ useRefetchOnReturn: () => {} }));

const step = (key, label, done) => ({ key, label, detail: `${label} detail.`, done, href: `/go/${key}` });
const checklist = (steps) => ({ completed: steps.filter((item) => item.done).length, total: steps.length, steps });

const process = {
  title: 'Setting up your organization',
  complete: false,
  steps: [
    { key: 'organization-approved', label: 'Organization approved', state: 'done' },
    { key: 'officers-access', label: 'Officers given access', state: 'done', count: 2 },
    { key: 'semester-requirements', label: 'Semester requirements submitted', state: 'current', count: 1, total: 3, action: { label: 'Submit requirements', path: '/dashboard/compliance' } },
    { key: 'next-election', label: 'Election of next officers', state: 'todo' },
  ],
};

describe('AdminHomePage setup progress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setTrackerShown(false);
    localStorage.clear();
    mocks.getAdminDashboard.mockResolvedValue({ data: { counts: { pending_orders: 1, approval_requests: 0, pending_tasks: 0, new_announcements: 0 }, movement: [], announcements: [] } });
    mocks.getProcessStatus.mockResolvedValue({ data: process });
    mocks.getBriefing.mockResolvedValue({
      data: {
        user: { first_name: 'Ana', role: 'ADMIN', organization: { id: 1, name: 'Computing Council' } },
        summary: { attention_count: 0, headline: 'Nothing needs you today.' },
        setup: checklist([
          step('positions', 'Set up your officer positions', true),
          step('members', 'Add your members', true),
          step('academic', 'Set up programs and sections', true),
          step('compliance', 'Submit your accreditation requirements', true),
          step('budget', 'Propose your first budget', true),
          step('event', 'Plan your first event', false),
        ]),
        attention: [],
        pillars: {},
        insights: [],
      },
    });
  });

  it('shows one setup checklist when the process tracker and the first-run steps are both unfinished', async () => {
    render(<MemoryRouter><AdminHomePage /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Setting up your organization' })).toBeInTheDocument();
    await waitFor(() => expect(mocks.getBriefing).toHaveBeenCalled());
    expect(await screen.findByText('Nothing needs you today.')).toBeInTheDocument();

    expect(screen.queryByRole('heading', { name: 'Getting started' })).not.toBeInTheDocument();
    expect(screen.getByText('Step 3 of 4')).toBeInTheDocument();
    expect(screen.queryByText(/of 6 done/)).not.toBeInTheDocument();
  });

  it('falls back to the first-run steps when the process tracker could not load', async () => {
    mocks.getProcessStatus.mockRejectedValue(new Error('offline'));
    render(<MemoryRouter><AdminHomePage /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Getting started' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Setting up your organization' })).not.toBeInTheDocument();
  });
});
