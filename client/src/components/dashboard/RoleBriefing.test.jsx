import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RoleBriefing from './RoleBriefing';
import { getBriefing } from '../../services/dashboardService';

vi.mock('../../services/dashboardService', () => ({ getBriefing: vi.fn() }));

const briefing = (role, extra = {}) => ({
  data: {
    user: { first_name: 'Maria', role, organization: role === 'SUPER_ADMIN' ? null : { id: 1, name: 'Supreme Student Council', abbreviation: 'SSC' } },
    summary: { attention_count: 1, headline: 'One approval needs you today.' },
    attention: [{ id: 'a1', type: 'approval', severity: 'high', title: 'Foundation Week budget', detail: 'Requested 2 days ago', due_at: null, href: null }],
    pillars: { finance: { value: 38200, unit: 'php', label: 'Remaining budget', context: 'Of ₱60,000 allocated' } },
    insights: [],
    ...extra,
  },
});

const renderBriefing = () => render(<MemoryRouter><RoleBriefing /></MemoryRouter>);

describe('RoleBriefing', () => {
  beforeEach(() => vi.mocked(getBriefing).mockReset());

  it('shows a briefing-shaped skeleton while loading', async () => {
    let finish;
    vi.mocked(getBriefing).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderBriefing();
    expect(screen.getByRole('status', { name: 'Loading your briefing' })).toBeInTheDocument();
    finish(briefing('ADMIN'));
    expect(await screen.findByText('One approval needs you today.')).toBeInTheDocument();
  });

  it('renders the headline, the attention items and the study areas', async () => {
    vi.mocked(getBriefing).mockResolvedValue(briefing('ADMIN'));
    renderBriefing();
    expect(await screen.findByText('One approval needs you today.')).toBeInTheDocument();
    expect(screen.getByText('Foundation Week budget')).toBeInTheDocument();
    expect(screen.getByText('Remaining budget')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Create announcement/ })).toHaveAttribute('href', '/dashboard/announcements/create-announcement');
    expect(screen.getByRole('heading', { name: 'Needs attention' })).toBeInTheDocument();
    const indicators = screen.getByText('Organization indicators').closest('details');
    expect(indicators).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('Organization indicators'));
    expect(indicators).toHaveAttribute('open');
  });

  it('adds the organizations health table only for the SAO', async () => {
    vi.mocked(getBriefing).mockResolvedValue(briefing('SUPER_ADMIN', { organizations: [] }));
    renderBriefing();
    expect(await screen.findByText('No organizations yet')).toBeInTheDocument();
  });

  it('sends the SAO to the financial tab of the compliance home', async () => {
    vi.mocked(getBriefing).mockResolvedValue(briefing('SUPER_ADMIN', { organizations: [] }));
    renderBriefing();
    expect(await screen.findByRole('link', { name: /Review financial reports/ })).toHaveAttribute('href', '/dashboard/super-admin/compliance?tab=financial');
  });

  it('explains a failure and retries on request', async () => {
    vi.mocked(getBriefing).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(briefing('STUDENT'));
    renderBriefing();
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByText('One approval needs you today.')).toBeInTheDocument());
    expect(getBriefing).toHaveBeenCalledTimes(2);
  });
});
