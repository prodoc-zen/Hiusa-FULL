import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OfficerTransitionPage from './OfficerTransitionPage';

const { service, file } = vi.hoisted(() => ({
  service: {
    getOfficers: vi.fn(),
    getHandover: vi.fn(),
    prepareHandover: vi.fn(),
    acknowledgeHandover: vi.fn(),
    getRenewalTracker: vi.fn(),
  },
  file: { openProtectedFile: vi.fn() },
}));

vi.mock('../../../services/officerTransitionService', () => service);
vi.mock('../../../utils/openProtectedFile', () => file);

const officers = [
  {
    id: 1, school_id: 301, name: 'Ana Reyes', position_title: 'President', is_executive: true, role: 'ADMIN', organization: 'Code Guild',
    academic_year: '2027-2028', term_starts_on: '2027-06-15', term_ends_on: null, status: 'upcoming', kind: 'incoming', flag: null,
    election: { id: 9, title: 'SBO Election 2027' },
  },
  {
    id: 2, school_id: 302, name: 'Luis Cruz', position_title: 'Treasurer', is_executive: false, role: 'SBO_OFFICER', organization: 'Code Guild',
    academic_year: '2027-2028', term_starts_on: '2027-06-15', term_ends_on: null, status: 'upcoming', kind: 'incoming', flag: 'missing_deadline',
    election: { id: 9, title: 'SBO Election 2027' },
  },
  {
    id: 3, school_id: 303, name: 'Mara Dizon', position_title: 'Secretary', is_executive: true, role: 'SBO_OFFICER', organization: 'Code Guild',
    academic_year: '2027-2028', term_starts_on: '2026-11-01', term_ends_on: null, status: 'active', kind: 'incoming', flag: 'start_passed',
    election: { id: 9, title: 'SBO Election 2027' },
  },
  {
    id: 4, school_id: 304, name: 'Old President', position_title: 'President', is_executive: true, role: 'ADMIN', organization: 'Code Guild',
    academic_year: '2026-2027', term_starts_on: '2026-06-15', term_ends_on: '2027-05-31', status: 'active', kind: 'outgoing', flag: null,
    election: { id: 4, title: 'SBO Election 2026' },
  },
];

const item = (overrides) => ({
  id: 1, category: 'finance', label: 'Finance', reference_url: '/dashboard/finance', remarks: null, attachment_open_url: null, attachment_name: null,
  status: 'pending', prepared_by: null, prepared_at: null, acknowledged_by: null, acknowledged_at: null, ...overrides,
});

const handover = (mySide, items) => ({ my_side: mySide, items });

const defaultItems = [
  item({ id: 1, category: 'finance', label: 'Finance' }),
  item({ id: 2, category: 'events', label: 'Events', reference_url: '/dashboard/events', status: 'prepared', remarks: 'Two events pending.', prepared_by: 'Old President', prepared_at: '2027-05-20T02:00:00Z', attachment_open_url: '/officer-transition/handover/2/attachment', attachment_name: 'events.pdf' }),
  item({ id: 3, category: 'tasks', label: 'Tasks', reference_url: '/dashboard/tasks', status: 'acknowledged', remarks: 'All tasks closed.', prepared_by: 'Old President', prepared_at: '2027-05-20T02:00:00Z', acknowledged_by: 'Ana Reyes', acknowledged_at: '2027-06-16T03:00:00Z' }),
  item({ id: 4, category: 'organization', label: 'Organization', reference_url: '/dashboard/records' }),
  item({ id: 5, category: 'election', label: 'Election', reference_url: '/dashboard/elections/election-results' }),
  item({ id: 6, category: 'compliance', label: 'Compliance', reference_url: '/dashboard/compliance' }),
];

const tracker = {
  deadline_at: '2027-07-15T00:00:00Z',
  requirements: [
    { id: 1, name: 'Constitution', description: 'Signed copy', deadline_at: '2027-07-15T00:00:00Z', status: 'pending', submitted_at: null, overdue: false },
    { id: 2, name: 'Officer list', description: null, deadline_at: '2027-07-01T00:00:00Z', status: 'pending', submitted_at: null, overdue: true },
    { id: 3, name: 'Adviser letter', description: null, deadline_at: '2027-07-15T00:00:00Z', status: 'approved', submitted_at: '2027-06-20T01:00:00Z', overdue: false },
  ],
  progress: { done: 1, total: 3 },
  assigned_officers: [{ name: 'Ana Reyes', position_title: 'President', status: 'upcoming' }],
  last_updated: '2027-06-20T01:00:00Z',
};

function renderPage(role = 'ADMIN') {
  return render(<MemoryRouter><OfficerTransitionPage role={role} /></MemoryRouter>);
}

const openTab = (name) => fireEvent.click(screen.getByRole('tab', { name }));

describe('OfficerTransitionPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.getOfficers.mockResolvedValue({ data: officers, current_page: 1, last_page: 1, total: officers.length });
    service.getHandover.mockResolvedValue(handover(null, defaultItems));
    service.getRenewalTracker.mockResolvedValue(tracker);
    service.prepareHandover.mockResolvedValue({ success: true });
    service.acknowledgeHandover.mockResolvedValue({ success: true });
  });

  it('shows one heading and the three tabs', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Officer transition' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Officers', 'Handover', 'Renewal']);
    expect(screen.getByRole('tab', { name: 'Officers' })).toHaveAttribute('aria-selected', 'true');
    await screen.findAllByText('Ana Reyes');
  });

  it('lists officers with executive type, term dates, status and election', async () => {
    renderPage();
    await screen.findAllByText('Ana Reyes');
    const table = within(screen.getByRole('table'));
    ['Name', 'School ID', 'Position', 'Type', 'Academic year', 'Term start', 'Term end', 'Status', 'Election']
      .forEach((header) => expect(table.getByRole('columnheader', { name: header })).toBeInTheDocument());
    const row = table.getByText('Ana Reyes').closest('tr');
    expect(within(row).getByText('301')).toBeInTheDocument();
    expect(within(row).getByText('President')).toBeInTheDocument();
    expect(within(row).getByText('Executive')).toBeInTheDocument();
    expect(within(row).getByText('Upcoming')).toBeInTheDocument();
    expect(within(row).getByText('Jun 15, 2027')).toBeInTheDocument();
    expect(within(row).getByText('SBO Election 2027')).toBeInTheDocument();
    const second = table.getByText('Luis Cruz').closest('tr');
    expect(within(second).getByText('Non-executive')).toBeInTheDocument();
  });

  it('names an outgoing officer as Former once the term ended and tells overlapping years apart by the academic year', async () => {
    service.getOfficers.mockResolvedValue({ data: [officers[0], officers[3], { ...officers[3], id: 5, name: 'Past Officer', status: 'ended' }], last_page: 1 });
    renderPage();
    await screen.findAllByText('Ana Reyes');
    const table = within(screen.getByRole('table'));
    expect(table.getByText('2027-2028')).toBeInTheDocument();
    expect(within(table.getByText('Old President').closest('tr')).getByText('2026-2027')).toBeInTheDocument();
    expect(within(table.getByText('Past Officer').closest('tr')).getByText('Former')).toBeInTheDocument();
    expect(within(table.getByText('Old President').closest('tr')).getByText('Active')).toBeInTheDocument();
  });

  it('sends the filters as request params and clears the empty ones', async () => {
    renderPage();
    await screen.findAllByText('Ana Reyes');
    expect(service.getOfficers).toHaveBeenLastCalledWith({});

    fireEvent.change(screen.getByLabelText('Academic year'), { target: { value: '2027-2028' } });
    await waitFor(() => expect(service.getOfficers).toHaveBeenLastCalledWith({ academic_year: '2027-2028' }));

    fireEvent.change(screen.getByLabelText('Position'), { target: { value: 'Treasurer' } });
    await waitFor(() => expect(service.getOfficers).toHaveBeenLastCalledWith({ academic_year: '2027-2028', position: 'Treasurer' }));

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'upcoming' } });
    await waitFor(() => expect(service.getOfficers).toHaveBeenLastCalledWith({ academic_year: '2027-2028', position: 'Treasurer', status: 'upcoming' }));

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(service.getOfficers).toHaveBeenLastCalledWith({}));
  });

  it('says why a flagged row is flagged in one plain line under the status', async () => {
    renderPage();
    await screen.findAllByText('Ana Reyes');
    const table = within(screen.getByRole('table'));
    expect(within(table.getByText('Luis Cruz').closest('tr')).getByText('No renewal deadline in Compliance yet')).toBeInTheDocument();
    expect(within(table.getByText('Mara Dizon').closest('tr')).getByText('Start date had already passed when the results became final')).toBeInTheDocument();
    expect(within(table.getByText('Ana Reyes').closest('tr')).queryByText(/No renewal deadline|Start date had already/)).not.toBeInTheDocument();
  });

  it('says so when the officers did not load and when there are none', async () => {
    service.getOfficers.mockRejectedValueOnce(new Error('down'));
    renderPage();
    expect(await screen.findByText('Officers did not load.')).toBeInTheDocument();
  });

  it('lists the six handover items with status, an Open records link, remarks and the attachment', async () => {
    renderPage();
    openTab('Handover');
    const list = await screen.findByRole('list', { name: 'Handover items' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => within(row).getByRole('heading', { level: 3 }).textContent)).toEqual(['Finance', 'Events', 'Tasks', 'Organization', 'Election', 'Compliance']);
    expect(within(rows[0]).getByText('Pending')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Prepared')).toBeInTheDocument();
    expect(within(rows[1]).getByRole('link', { name: 'Open records' })).toHaveAttribute('href', '/dashboard/events');
    expect(within(rows[1]).getByText('Two events pending.')).toBeInTheDocument();
    fireEvent.click(within(rows[1]).getByRole('button', { name: /events\.pdf/ }));
    await waitFor(() => expect(file.openProtectedFile).toHaveBeenCalledWith('/officer-transition/handover/2/attachment'));
  });

  it('offers Prepare only to an outgoing officer and sends remarks, the reference and the file', async () => {
    service.getHandover.mockResolvedValue(handover('outgoing', defaultItems));
    renderPage('ADMIN');
    openTab('Handover');
    const list = await screen.findByRole('list', { name: 'Handover items' });
    expect(within(list).queryByRole('button', { name: 'Acknowledge receipt' })).not.toBeInTheDocument();
    const rows = within(list).getAllByRole('listitem');
    expect(within(rows[2]).queryByRole('button', { name: 'Prepare' })).not.toBeInTheDocument();

    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Prepare' }));
    const dialog = await screen.findByRole('dialog');
    const save = within(dialog).getByRole('button', { name: 'Save as prepared' });
    const attachment = new File(['x'], 'ledger.pdf', { type: 'application/pdf' });
    fireEvent.change(within(dialog).getByLabelText('Remarks'), { target: { value: 'Ledger is balanced.' } });
    fireEvent.change(within(dialog).getByLabelText(/Attachment/), { target: { files: [attachment] } });
    fireEvent.click(save);

    await waitFor(() => expect(service.prepareHandover).toHaveBeenCalledWith(1, { remarks: 'Ledger is balanced.', reference_url: '/dashboard/finance', attachmentFile: attachment }));
    await waitFor(() => expect(service.getHandover).toHaveBeenCalledTimes(2));
  });

  it('keeps the dialog open and shows the message when preparing fails', async () => {
    service.getHandover.mockResolvedValue(handover('outgoing', defaultItems));
    service.prepareHandover.mockRejectedValue({ response: { data: { message: 'Only an outgoing officer can prepare this.' } } });
    renderPage();
    openTab('Handover');
    const list = await screen.findByRole('list', { name: 'Handover items' });
    fireEvent.click(within(within(list).getAllByRole('listitem')[0]).getByRole('button', { name: 'Prepare' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save as prepared' }));
    expect(await within(dialog).findByText('Only an outgoing officer can prepare this.')).toBeInTheDocument();
  });

  it('offers Acknowledge receipt only to an incoming officer, on a prepared item, behind the confirm', async () => {
    service.getHandover.mockResolvedValue(handover('incoming', defaultItems));
    renderPage('ADMIN');
    openTab('Handover');
    const list = await screen.findByRole('list', { name: 'Handover items' });
    expect(within(list).queryByRole('button', { name: 'Prepare' })).not.toBeInTheDocument();
    expect(within(list).getAllByRole('button', { name: 'Acknowledge receipt' })).toHaveLength(1);
    const rows = within(list).getAllByRole('listitem');
    expect(within(rows[0]).queryByRole('button', { name: 'Acknowledge receipt' })).not.toBeInTheDocument();

    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Acknowledge receipt' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('This confirms you received it. It does not certify that the information is correct or audited.')).toBeInTheDocument();
    expect(service.acknowledgeHandover).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Acknowledge receipt' }));
    await waitFor(() => expect(service.acknowledgeHandover).toHaveBeenCalledWith(2));
    await waitFor(() => expect(service.getHandover).toHaveBeenCalledTimes(2));
  });

  it('shows an acknowledged item read only with who and when', async () => {
    service.getHandover.mockResolvedValue(handover('incoming', defaultItems));
    renderPage();
    openTab('Handover');
    const list = await screen.findByRole('list', { name: 'Handover items' });
    const row = within(list).getAllByRole('listitem')[2];
    expect(within(row).getByText('Acknowledged')).toBeInTheDocument();
    expect(within(row).getByText(/Acknowledged by Ana Reyes on Jun 16, 2027/)).toBeInTheDocument();
    expect(within(row).queryByRole('button')).not.toBeInTheDocument();
  });

  it.each(['DEPARTMENT_HEAD', 'SUPER_ADMIN', 'SBO_OFFICER'])('shows the handover to %s without Prepare or Acknowledge when no side is theirs', async (role) => {
    service.getHandover.mockResolvedValue(handover(null, defaultItems));
    renderPage(role);
    openTab('Handover');
    await screen.findByRole('list', { name: 'Handover items' });
    expect(screen.queryByRole('button', { name: 'Prepare' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Acknowledge receipt' })).not.toBeInTheDocument();
  });

  it('never shows Prepare or Acknowledge to the Department Head even if a side came back', async () => {
    service.getHandover.mockResolvedValue(handover('outgoing', defaultItems));
    renderPage('DEPARTMENT_HEAD');
    openTab('Handover');
    await screen.findByRole('list', { name: 'Handover items' });
    expect(screen.queryByRole('button', { name: 'Prepare' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Acknowledge receipt' })).not.toBeInTheDocument();
  });

  it('says no transition is under way when there are no items', async () => {
    service.getHandover.mockResolvedValue(handover(null, []));
    renderPage();
    openTab('Handover');
    expect(await screen.findByText('No transition is under way.')).toBeInTheDocument();
  });

  it('shows the renewal deadline read only with the progress line and the requirements', async () => {
    renderPage();
    openTab('Renewal');
    expect(await screen.findByText('1 of 3 requirements submitted')).toBeInTheDocument();
    expect(screen.getByText('Official renewal deadline').parentElement).toHaveTextContent(/Jul 15, 2027/);
    expect(screen.getByRole('link', { name: 'Set in Compliance' })).toHaveAttribute('href', '/dashboard/compliance');
    const list = screen.getByRole('list', { name: 'Renewal requirements' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('Constitution')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Pending')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Overdue')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Approved')).toBeInTheDocument();
    rows.forEach((row) => expect(within(row).getByRole('link', { name: 'Open in Compliance' })).toHaveAttribute('href', '/dashboard/compliance'));
    expect(screen.getByText('Ana Reyes')).toBeInTheDocument();
  });

  it('has no input of any kind for the deadline', async () => {
    renderPage();
    openTab('Renewal');
    await screen.findByText('1 of 3 requirements submitted');
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(document.querySelector('input, textarea, select')).toBeNull();
    expect(screen.queryByLabelText(/deadline/i)).not.toBeInTheDocument();
  });

  it('says there is no deadline yet when Compliance has none', async () => {
    service.getRenewalTracker.mockResolvedValue({ ...tracker, deadline_at: null, requirements: [], progress: { done: 0, total: 0 }, assigned_officers: [] });
    renderPage();
    openTab('Renewal');
    expect(await screen.findByText('No renewal deadline in Compliance yet')).toBeInTheDocument();
    expect(screen.getByText('0 of 0 requirements submitted')).toBeInTheDocument();
  });

  it('points the Department Head and the SAO at their own Compliance page', async () => {
    renderPage('DEPARTMENT_HEAD');
    openTab('Renewal');
    expect(await screen.findByRole('link', { name: 'Set in Compliance' })).toHaveAttribute('href', '/dashboard/department-head/compliance');
  });
});
