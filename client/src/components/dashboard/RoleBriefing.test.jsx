import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RoleBriefing from './RoleBriefing';
import { getBriefing } from '../../services/dashboardService';

vi.mock('../../services/dashboardService', () => ({ getBriefing: vi.fn() }));

const step = (key, label, extra = {}) => ({ key, label, detail: `${label} detail.`, done: false, href: `/go/${key}`, ...extra });
const withProgress = (steps) => ({ completed: steps.filter((item) => item.done).length, total: steps.length, steps });

const briefing = (role, extra = {}) => ({
  data: {
    user: { first_name: 'Maria', role, organization: role === 'SUPER_ADMIN' ? null : { id: 1, name: 'Supreme Student Council', abbreviation: 'SSC' } },
    summary: { attention_count: 1, headline: 'One approval needs you today.' },
    setup: null,
    attention: [{ id: 'a1', type: 'approval', severity: 'high', title: 'Foundation Week budget', detail: 'Requested 2 days ago', due_at: null, href: null }],
    pillars: { finance: { value: 38200, unit: 'php', label: 'Remaining budget', context: 'Of ₱60,000 allocated' } },
    insights: [],
    ...extra,
  },
});

const renderBriefing = () => render(<MemoryRouter><RoleBriefing /></MemoryRouter>);

describe('RoleBriefing', () => {
  beforeEach(() => {
    vi.mocked(getBriefing).mockReset();
    localStorage.clear();
  });

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
    expect(screen.getByRole('link', { name: /New announcement/ })).toHaveAttribute('href', '/dashboard/announcements/create-announcement');
    expect(screen.getByRole('heading', { name: 'Needs attention' })).toBeInTheDocument();
    const indicators = screen.getByText('Organization indicators').closest('details');
    expect(indicators).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('Organization indicators'));
    expect(indicators).toHaveAttribute('open');
  });

  it('explains a failure and retries on request', async () => {
    vi.mocked(getBriefing).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(briefing('STUDENT'));
    renderBriefing();
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByText('One approval needs you today.')).toBeInTheDocument());
    expect(getBriefing).toHaveBeenCalledTimes(2);
  });

  describe('the setup card', () => {
    const adminSetup = withProgress([
      step('positions', 'Set up your officer positions'),
      step('members', 'Add your members'),
      step('academic', 'Set up programs and sections'),
      step('compliance', 'Submit your accreditation requirements'),
      step('budget', 'Propose your first budget'),
      step('event', 'Plan your first event'),
    ]);

    it('sits above Needs attention while steps are open', async () => {
      vi.mocked(getBriefing).mockResolvedValue(briefing('ADMIN', { setup: adminSetup }));
      renderBriefing();
      const setupTitle = await screen.findByRole('heading', { name: 'Getting started' });
      const attentionTitle = screen.getByRole('heading', { name: 'Needs attention' });
      expect(setupTitle.compareDocumentPosition(attentionTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const indicators = screen.getByText('Organization indicators');
      expect(attentionTitle.compareDocumentPosition(indicators) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('is gone once every step is done', async () => {
      vi.mocked(getBriefing).mockResolvedValue(briefing('ADMIN', { setup: withProgress([{ ...step('positions', 'Set up your officer positions'), done: true, href: null }]) }));
      renderBriefing();
      await screen.findByRole('heading', { name: 'Needs attention' });
      expect(screen.queryByRole('heading', { name: 'Getting started' })).not.toBeInTheDocument();
    });

    it('stays hidden for the same person after Hide checklist', async () => {
      vi.mocked(getBriefing).mockResolvedValue(briefing('ADMIN', { setup: adminSetup }));
      const { unmount } = renderBriefing();
      fireEvent.click(await screen.findByRole('button', { name: 'Hide checklist' }));
      expect(screen.queryByRole('heading', { name: 'Getting started' })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: /New announcement/ })).toBeInTheDocument();
      unmount();

      renderBriefing();
      await screen.findByRole('heading', { name: 'Needs attention' });
      expect(screen.queryByRole('heading', { name: 'Getting started' })).not.toBeInTheDocument();
    });
  });

  describe('first screen per role', () => {
    it('ADMIN: positions, members, first event, with the rest behind Show all', async () => {
      const setup = withProgress([
        step('positions', 'Set up your officer positions'),
        step('members', 'Add your members'),
        step('academic', 'Set up programs and sections'),
        step('compliance', 'Submit your accreditation requirements'),
        step('budget', 'Propose your first budget'),
        step('event', 'Plan your first event'),
      ]);
      vi.mocked(getBriefing).mockResolvedValue(briefing('ADMIN', { setup }));
      renderBriefing();

      const card = (await screen.findByRole('heading', { name: 'Getting started' })).closest('section');
      expect(screen.getByText(/Set up HIUSA for Supreme Student Council/)).toBeInTheDocument();
      const rows = within(card).getAllByRole('listitem');
      expect(rows.map((row) => row.querySelector('p').textContent)).toEqual(['Set up your officer positions', 'Add your members', 'Plan your first event']);
      expect(within(card).getByRole('link', { name: 'Add positions' })).toHaveAttribute('href', '/go/positions');
      expect(within(card).getByRole('link', { name: 'Add members' })).toHaveAttribute('href', '/go/members');
      expect(within(card).getByRole('link', { name: 'Propose an event' })).toHaveAttribute('href', '/go/event');
      expect(within(card).queryByText('Propose your first budget')).not.toBeInTheDocument();

      fireEvent.click(within(card).getByRole('button', { name: 'Show all 6 steps' }));
      expect(within(card).getAllByRole('listitem').map((row) => row.querySelector('p').textContent)).toEqual([
        'Set up your officer positions', 'Add your members', 'Plan your first event',
        'Set up programs and sections', 'Submit your accreditation requirements', 'Propose your first budget',
      ]);
    });

    it('ADMIN: the one filled button is the first step, not a header action', async () => {
      const setup = withProgress([step('positions', 'Set up your officer positions'), step('members', 'Add your members')]);
      vi.mocked(getBriefing).mockResolvedValue(briefing('ADMIN', { setup }));
      renderBriefing();
      const first = await screen.findByRole('link', { name: 'Add positions' });
      expect(first).toHaveClass('bg-brand-700');
      expect(screen.getByRole('link', { name: 'Add members' })).not.toHaveClass('bg-brand-700');
      expect(screen.queryByRole('link', { name: /New announcement/ })).not.toBeInTheDocument();
    });

    it('DEPARTMENT_HEAD: a blocked register step shows its note and no button', async () => {
      const setup = withProgress([
        step('register', 'Register your first student organization', { href: null, blocked: true, note: 'Waiting for the SAO to open the semester' }),
        step('follow', 'Follow your registration', { href: null }),
        step('review', 'Review approvals', { href: '/dashboard/department-head/approvals' }),
      ]);
      vi.mocked(getBriefing).mockResolvedValue(briefing('DEPARTMENT_HEAD', { setup }));
      renderBriefing();

      const card = (await screen.findByRole('heading', { name: 'Getting started' })).closest('section');
      expect(screen.getByText(/Your college: Supreme Student Council/)).toBeInTheDocument();
      const [register, follow, review] = within(card).getAllByRole('listitem');
      expect(register).toHaveTextContent('Register your first student organization');
      expect(register).toHaveTextContent('Waiting for the SAO to open the semester');
      expect(within(register).queryByRole('link')).not.toBeInTheDocument();
      expect(within(register).queryByRole('button')).not.toBeInTheDocument();
      expect(within(follow).queryByRole('link')).not.toBeInTheDocument();
      expect(within(review).getByRole('link', { name: 'Open approvals' })).toHaveAttribute('href', '/dashboard/department-head/approvals');
    });

    it('DEPARTMENT_HEAD: a returned registration offers Edit and resubmit and leads the attention list', async () => {
      const setup = withProgress([
        { ...step('register', 'Register your first student organization'), done: true, href: null },
        step('follow', 'Follow your registration', { href: '/dashboard/department-head/organizations?status=returned' }),
        step('review', 'Review approvals'),
      ]);
      const attention = [
        { id: 'approval-1', type: 'approval', severity: 'high', title: 'Foundation Week', detail: 'Event requested', due_at: null, href: null },
        { id: 'org_returned-3', type: 'registration_returned', severity: 'medium', title: 'Registration returned: Robotics Club', detail: 'Add the adviser letter', due_at: null, href: '/dashboard/department-head/organizations?status=returned' },
      ];
      vi.mocked(getBriefing).mockResolvedValue(briefing('DEPARTMENT_HEAD', { setup, attention }));
      renderBriefing();

      expect(await screen.findByRole('link', { name: 'Edit and resubmit' })).toHaveAttribute('href', '/dashboard/department-head/organizations?status=returned');
      const queue = screen.getByRole('heading', { name: 'Needs attention' }).closest('section');
      expect(within(queue).getAllByRole('listitem').map((row) => row.textContent)[0]).toContain('Registration returned: Robotics Club');
    });

    it('SBO_OFFICER: work queue, then contact number, fingerprint in person, My tasks', async () => {
      const setup = withProgress([
        step('contact', 'Add your contact number', { href: '/dashboard/profile' }),
        step('fingerprint', 'Enroll your fingerprint', { href: null }),
      ]);
      const attention = [{ id: 'order-1', type: 'order_verification', severity: 'medium', title: 'Order 12', detail: 'Proof submitted', due_at: null, href: null }];
      vi.mocked(getBriefing).mockResolvedValue(briefing('SBO_OFFICER', { setup, attention }));
      renderBriefing();

      expect(await screen.findByRole('heading', { name: 'Your work queue' })).toBeInTheDocument();
      const card = screen.getByRole('heading', { name: 'Getting started' }).closest('section');
      expect(within(card).getAllByRole('listitem').map((row) => row.querySelector('p').textContent)).toEqual(['Add your contact number', 'Enroll your fingerprint', 'Open My tasks']);
      expect(within(card).getByRole('link', { name: 'Add contact number' })).toHaveAttribute('href', '/dashboard/profile');
      expect(within(card).getByRole('link', { name: 'Open My tasks' })).toHaveAttribute('href', '/dashboard/tasks/assigned-tasks');
      expect(screen.getByText(/SBO Officer/)).toBeInTheDocument();

      const where = within(card).getByRole('button', { name: 'Where to go' });
      expect(where).toHaveAttribute('aria-expanded', 'false');
      fireEvent.click(where);
      expect(where).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText(/done in person at the officers' desk/)).toBeInTheDocument();
      expect(card).toHaveTextContent('0 of 2 done');
    });

    it('STUDENT: Next for you lists contact, event, statement of account, and no Tasks pillar or task items', async () => {
      const setup = withProgress([
        step('contact', 'Add your contact number', { href: '/dashboard/profile' }),
        step('fingerprint', 'Enroll your fingerprint', { href: null }),
        step('event', 'Register for an upcoming event', { href: '/dashboard/events/activity-calendar' }),
      ]);
      const attention = [
        { id: 'task-1', type: 'task_overdue', severity: 'high', title: 'Poster draft', detail: 'Overdue', due_at: null, href: null },
        { id: 'event-2', type: 'event_today', severity: 'low', title: 'Orientation', detail: 'Today', due_at: null, href: null },
      ];
      const pillars = {
        elections: { value: 1, unit: 'count', label: 'Open elections', context: 'One is open' },
        tasks: { value: 4, unit: 'count', label: 'My open tasks', context: 'Four open' },
      };
      vi.mocked(getBriefing).mockResolvedValue(briefing('STUDENT', { setup, attention, pillars, summary: { attention_count: 2, headline: 'One overdue task and one event today need you today.' } }));
      renderBriefing();

      const card = (await screen.findByRole('heading', { name: 'Next for you' })).closest('section');
      expect(within(card).getAllByRole('listitem').map((row) => row.querySelector('p').textContent)).toEqual([
        'Add your contact number', 'Register for an upcoming event', 'Check your statement of account',
      ]);
      expect(within(card).getByRole('link', { name: 'Open statement' })).toHaveAttribute('href', '/dashboard/finance/statement-of-account');
      fireEvent.click(within(card).getByRole('button', { name: 'Show all 4 steps' }));
      expect(within(card).getByRole('button', { name: 'Where to go' })).toBeInTheDocument();

      expect(screen.getByText('Open elections')).toBeInTheDocument();
      expect(screen.queryByText('My open tasks')).not.toBeInTheDocument();
      expect(screen.queryByText('Poster draft')).not.toBeInTheDocument();
      expect(screen.getByText('Orientation')).toBeInTheDocument();
      expect(screen.getByText('1 item needs you today.')).toBeInTheDocument();
    });

    it('SAO: the inbox leads with a count per review area, registrations first, and sets the headline', async () => {
      const setup = withProgress([
        step('academic-year', 'Set the current academic year'),
        step('college-heads', 'Every college has a Department Head'),
        step('admins', 'Give every organization an administrator'),
        step('requirements', 'Publish the accreditation requirements'),
        step('venues', 'List the venues organizations can book'),
        step('announcement', 'Publish a university announcement'),
      ]);
      const attention = [
        { id: 'sao_queue-grievances', type: 'grievances_urgent', count: 2, severity: 'high', title: 'Urgent grievances unresolved', detail: '2', due_at: null, href: '/dashboard/super-admin/grievances' },
        { id: 'approval-9', type: 'approval', severity: 'high', title: 'Report', detail: 'x', due_at: null, href: '/dashboard/super-admin/compliance?tab=financial' },
        { id: 'sao_queue-compliance', type: 'compliance_submissions_pending', count: 4, severity: 'medium', title: 'Compliance submissions awaiting review', detail: '4', due_at: null, href: '/dashboard/super-admin/compliance?tab=review' },
        { id: 'sao_queue-registrations', type: 'registrations_pending', count: 3, severity: 'medium', title: 'Registrations awaiting review', detail: '3', due_at: null, href: '/dashboard/super-admin/organizations?status=pending' },
        { id: 'sao_queue-clearance', type: 'clearance_sao_pending', count: 5, severity: 'medium', title: 'SAO clearance lines pending', detail: '5', due_at: null, href: '/dashboard/super-admin/clearances' },
      ];
      vi.mocked(getBriefing).mockResolvedValue(briefing('SUPER_ADMIN', { setup, attention, organizations: [], summary: { attention_count: 5, headline: 'server headline' } }));
      renderBriefing();

      const inbox = (await screen.findByRole('heading', { name: 'Review inbox' })).closest('section');
      expect(within(inbox).getAllByRole('listitem').map((row) => row.textContent)).toEqual([
        '3Registrations awaiting review',
        '4Compliance submissions awaiting review',
        '1Financial reports to approve',
        '2Urgent grievances unresolved',
        '5Clearances awaiting your signature',
      ]);
      expect(within(inbox).getByRole('link', { name: /Registrations awaiting review/ })).toHaveAttribute('href', '/dashboard/super-admin/organizations?status=pending');
      expect(within(inbox).getByRole('link', { name: /Compliance submissions/ })).toHaveAttribute('href', '/dashboard/super-admin/compliance?tab=review');
      expect(screen.getByText('15 items need your attention: 3 registrations, 4 compliance submissions, 1 financial report, 2 urgent grievances, 5 clearances.')).toBeInTheDocument();
      expect(screen.queryByText('server headline')).not.toBeInTheDocument();

      const primary = screen.getByRole('link', { name: 'Review registrations' });
      expect(primary).toHaveAttribute('href', '/dashboard/super-admin/organizations?status=pending');
      expect(primary).toHaveClass('bg-brand-700');

      const setupTitle = screen.getByRole('heading', { name: 'Getting started' });
      expect(inbox.compareDocumentPosition(setupTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const card = setupTitle.closest('section');
      expect(within(card).getAllByRole('listitem').map((row) => row.querySelector('p').textContent)).toEqual([
        'Set the current academic year', 'Every college has a Department Head', 'Publish the accreditation requirements',
      ]);
      expect(within(card).getByRole('link', { name: 'Set the academic year' })).not.toHaveClass('bg-brand-700');
      expect(screen.getByText(/· SAO ·/)).toBeInTheDocument();
    });

    it('SAO: with nothing in the inbox the setup card comes first and holds the one filled button', async () => {
      const setup = withProgress([
        step('academic-year', 'Set the current academic year'),
        step('college-heads', 'Every college has a Department Head'),
        step('requirements', 'Publish the accreditation requirements'),
      ]);
      vi.mocked(getBriefing).mockResolvedValue(briefing('SUPER_ADMIN', { setup, attention: [], organizations: [] }));
      renderBriefing();

      const setupTitle = await screen.findByRole('heading', { name: 'Getting started' });
      const inboxTitle = screen.getByRole('heading', { name: 'Review inbox' });
      expect(setupTitle.compareDocumentPosition(inboxTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.getByText('No reviews are waiting')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Set the academic year' })).toHaveClass('bg-brand-700');
    });

    it('SAO: the financial reports action leads when only a financial report waits', async () => {
      const attention = [{ id: 'approval-9', type: 'approval', severity: 'high', title: 'Report', detail: 'x', due_at: null, href: '/dashboard/super-admin/compliance?tab=financial' }];
      vi.mocked(getBriefing).mockResolvedValue(briefing('SUPER_ADMIN', { attention, organizations: [] }));
      renderBriefing();
      expect(await screen.findByRole('link', { name: 'Review financial reports' })).toHaveAttribute('href', '/dashboard/super-admin/compliance?tab=financial');
      expect(screen.getByText('1 item needs your attention: 1 financial report.')).toBeInTheDocument();
    });

    it('adds the organizations health table only for the SAO', async () => {
      vi.mocked(getBriefing).mockResolvedValue(briefing('SUPER_ADMIN', { organizations: [] }));
      renderBriefing();
      expect(await screen.findByText('No organizations yet')).toBeInTheDocument();
    });
  });
});
