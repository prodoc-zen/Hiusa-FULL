import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ApprovalDetailDrawer from './ApprovalDetailDrawer';

const mocks = vi.hoisted(() => ({ openProtectedFile: vi.fn(), getApprovalHistory: vi.fn(), historyFails: false }));
vi.mock('../../utils/openProtectedFile', () => ({ openProtectedFile: mocks.openProtectedFile }));
// A rejection is made here, not by the spy, so the spy does not report the handled rejection as unhandled.
vi.mock('../../services/electionService', () => ({
  getApprovalHistory: (id) => {
    const history = mocks.getApprovalHistory(id);
    return mocks.historyFails ? Promise.reject(new Error('offline')) : history;
  },
}));
vi.mock('../../services/financeService', () => ({ downloadFinancialReportPdf: vi.fn() }));

const FILES = [
  { id: 7, requirement: 'Venue Reservation Letter', original_name: 'venue.pdf', open_url: '/events/9/submission/files/7', reviews: [] },
  { id: 8, requirement: 'Request Letter', original_name: 'request.pdf', open_url: '/events/9/submission/files/8', reviews: [] },
];

const request = (overrides = {}, files = FILES) => ({
  id: 25, entity_type: 'event', entity_id: 9, title: 'Acquaintance Party', status: 'pending', required_role: 'DEPARTMENT_HEAD',
  requested_by: 'ADM-1', requested_at: '2026-11-12T09:26:00+08:00', requester: { first_name: 'James', last_name: 'Borgueta', school_id: 'ADM-1' },
  summary: { start_time: '2026-11-16', end_time: '2026-11-16', location: 'AVR', status: 'planning', requirement_files: files },
  ...overrides,
});

function renderDrawer(props = {}) {
  const handlers = { onApprove: vi.fn(), onReject: vi.fn(), onDecide: vi.fn().mockResolvedValue(undefined), onClose: vi.fn() };
  render(
    <MemoryRouter>
      <ApprovalDetailDrawer open request={request()} role="DEPARTMENT_HEAD" canAct {...handlers} {...props} />
    </MemoryRouter>,
  );
  return { ...handlers, drawer: screen.getByRole('dialog') };
}

const rowOf = (drawer, name) => within(drawer).getByText(name).closest('li');

beforeEach(() => {
  mocks.historyFails = false;
  mocks.getApprovalHistory.mockResolvedValue([]);
});

describe('ApprovalDetailDrawer SAO event files', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists each file as a row with its requirement, a status, a file link and a Review action', () => {
    const { drawer } = renderDrawer();
    const section = within(drawer).getByRole('region', { name: 'SAO event files' });

    expect(within(section).getAllByRole('listitem')).toHaveLength(2);
    const row = within(rowOf(drawer, 'Venue Reservation Letter'));
    expect(row.getByText('Not checked')).toBeInTheDocument();
    expect(row.getByRole('button', { name: 'venue.pdf' })).toBeInTheDocument();
    expect(row.getByRole('button', { name: 'Review Venue Reservation Letter' })).toBeInTheDocument();
  });

  it('opens a file through the protected url', () => {
    const { drawer } = renderDrawer();
    fireEvent.click(within(rowOf(drawer, 'Request Letter')).getByRole('button', { name: 'request.pdf' }));
    expect(mocks.openProtectedFile).toHaveBeenCalledWith('/events/9/submission/files/8');
  });

  it('keeps Approve off until every file is accepted, and says why', () => {
    const { drawer, onApprove } = renderDrawer();
    const approve = within(drawer).getByRole('button', { name: 'Approve' });
    expect(approve).toBeDisabled();
    expect(within(drawer).getByText('Accept every file to approve. Return the request to send back a file with a note.')).toBeInTheDocument();

    for (const name of ['Venue Reservation Letter', 'Request Letter']) {
      fireEvent.click(within(rowOf(drawer, name)).getByRole('button', { name: `Review ${name}` }));
      fireEvent.change(within(drawer).getByLabelText(`Review of ${name}`), { target: { value: 'ok' } });
    }
    expect(approve).toBeEnabled();

    fireEvent.click(approve);
    expect(onApprove).toHaveBeenCalledWith(expect.objectContaining({ id: 25 }), [
      { id: 7, status: 'ok' },
      { id: 8, status: 'ok' },
    ]);
  });

  it('requires a note for Needs changes and sends the marked files with the rejection', () => {
    const { drawer, onReject } = renderDrawer();
    fireEvent.click(within(rowOf(drawer, 'Request Letter')).getByRole('button', { name: 'Review Request Letter' }));
    fireEvent.change(within(drawer).getByLabelText('Review of Request Letter'), { target: { value: 'needs_changes' } });

    expect(within(drawer).getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(within(drawer).getByRole('button', { name: 'Reject' })).toBeDisabled();
    fireEvent.change(within(drawer).getByLabelText('Note for the organization'), { target: { value: 'The seal is missing.' } });
    expect(within(drawer).getByRole('button', { name: 'Reject' })).toBeEnabled();

    fireEvent.click(within(drawer).getByRole('button', { name: 'Reject' }));
    expect(onReject).toHaveBeenCalledWith(expect.objectContaining({ id: 25 }), [{ id: 8, status: 'needs_changes', note: 'The seal is missing.' }]);
  });

  it('hands over no files when nothing was marked, so a plain rejection is unchanged', () => {
    const { drawer, onReject } = renderDrawer();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Reject' }));
    expect(onReject).toHaveBeenCalledWith(expect.objectContaining({ id: 25 }), undefined);
  });

  it('starts a file this step already accepted as Accepted', () => {
    const files = [{ ...FILES[0], reviews: [{ stage: 'dean', status: 'ok', note: null }] }, FILES[1]];
    const { drawer } = renderDrawer({ request: request({}, files) });
    expect(within(rowOf(drawer, 'Venue Reservation Letter')).getByText('Accepted')).toBeInTheDocument();
  });

  it('shows the note of an earlier return beside the file, and the file starts unchecked', () => {
    const files = [{ ...FILES[0], reviews: [{ stage: 'dean', status: 'needs_changes', note: 'The permit is expired.' }] }, FILES[1]];
    const { drawer } = renderDrawer({ request: request({}, files) });
    const row = within(rowOf(drawer, 'Venue Reservation Letter'));
    expect(row.getByText('Not checked')).toBeInTheDocument();
    expect(row.getByText(/The permit is expired\./)).toBeInTheDocument();
  });

  it('shows a decided request its marks and notes with no way to change them', () => {
    const files = [{ ...FILES[0], reviews: [{ stage: 'dean', status: 'needs_changes', note: 'The permit is expired.' }] }, { ...FILES[1], reviews: [{ stage: 'dean', status: 'ok', note: null }] }];
    const { drawer } = renderDrawer({ canAct: false, request: request({ status: 'rejected', remarks: 'Fix the permit.' }, files) });

    const flagged = within(rowOf(drawer, 'Venue Reservation Letter'));
    expect(flagged.getByText('Needs changes')).toBeInTheDocument();
    expect(flagged.getByText('Department Head: Needs changes. The permit is expired.')).toBeInTheDocument();
    expect(within(rowOf(drawer, 'Request Letter')).getByText('Accepted')).toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: /^Review / })).not.toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('keeps Approve usable when the event has no files yet', () => {
    const { drawer, onApprove } = renderDrawer({ request: request({}, []) });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Approve' }));
    expect(onApprove).toHaveBeenCalledWith(expect.objectContaining({ id: 25 }), undefined);
  });
});

describe('ApprovalDetailDrawer election letter', () => {
  const election = (url) => ({ id: 30, entity_type: 'election', entity_id: 3, title: 'SBO Election', status: 'pending', required_role: 'DEPARTMENT_HEAD', requested_by: 'ADM-1', requester: { first_name: 'Ana', last_name: 'Admin' }, summary: { status: 'pending_approval', target_status: 'pending_approval', informative_letter_url: url } });

  beforeEach(() => vi.clearAllMocks());

  it('opens the informative letter through the protected url', async () => {
    const { drawer } = renderDrawer({ request: election('/elections/3/informative-letter') });
    await act(async () => {});
    fireEvent.click(within(drawer).getByRole('button', { name: 'Informative letter' }));
    expect(mocks.openProtectedFile).toHaveBeenCalledWith('/elections/3/informative-letter');
  });

  it('shows no letter link when none was uploaded', async () => {
    const { drawer } = renderDrawer({ request: election(null) });
    await act(async () => {});
    expect(within(drawer).queryByRole('button', { name: 'Informative letter' })).not.toBeInTheDocument();
  });
});

describe('ApprovalDetailDrawer Open approval link for the SAO', () => {
  it('carries the organization and the event so Compliance opens that event review', () => {
    const waiting = request({ required_role: 'SUPER_ADMIN', organization_id: 2, entity_id: 8 });
    const { drawer } = renderDrawer({ request: waiting, role: 'SUPER_ADMIN', canAct: true });

    expect(within(drawer).getByRole('link', { name: 'Open approval' })).toHaveAttribute('href', '/dashboard/super-admin/compliance?tab=event-reviews&organization=2&event=8');
  });
});

describe('ApprovalDetailDrawer step tracker', () => {
  it('wraps the steps into a grid that fits the drawer and stays pinned above the scrolling content', () => {
    const { drawer } = renderDrawer();
    const tracker = within(drawer).getByRole('list', { name: 'Event progress' });

    expect(tracker.className).toContain('grid-cols-2');
    expect(tracker.className).not.toContain('md:flex-row');
    expect(tracker.parentElement.className).toContain('sticky');
  });
});

describe('ApprovalDetailDrawer election proposal', () => {
  const proposal = (summary = {}, overrides = {}) => ({
    id: 31, entity_type: 'election', entity_id: 3, title: 'SBO Election', status: 'pending', required_role: 'DEPARTMENT_HEAD', requested_by: 'ADM-1', requested_at: '2026-11-12T09:26:00+08:00',
    requester: { first_name: 'Ana', last_name: 'Admin' },
    summary: {
      status: 'pending_approval', description: 'Yearly election of the student body officers.', organization: 'Student Body Organization', academic_year: '2026-2027', academic_semester: 'First Semester',
      filing_starts_at: '2026-12-01T00:00:00+08:00', filing_ends_at: '2026-12-05T17:00:00+08:00', screening_starts_at: '2026-12-06T08:00:00+08:00', screening_ends_at: '2026-12-08T17:00:00+08:00',
      campaign_starts_at: '2026-12-09T08:00:00+08:00', campaign_ends_at: '2026-12-14T17:00:00+08:00', start_time: '2026-12-15T08:00:00+08:00', end_time: '2026-12-16T17:00:00+08:00', results_publish_at: '2026-12-18T09:00:00+08:00',
      min_units: 12, min_gpa: '2.50', rules: 'Candidates must be in good standing.\nNo campaigning inside the exam hall.', tie_break_rule: 'The older candidate by date of enrollment wins.',
      positions: [
        { title: 'President', description: 'Leads the council.', is_executive: true, max_winners: 1, vote_limit: 1, eligible_year_levels: [2, 3], other_qualifications: 'No pending case', is_active: true },
        { title: 'Senator', is_executive: false, max_winners: 3, vote_limit: 2, eligible_year_levels: [], other_qualifications: null, is_active: true },
      ],
      ...summary,
    },
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.historyFails = false;
    mocks.getApprovalHistory.mockResolvedValue([]);
  });

  // The history request settles after the first render; wait for it so no update lands outside the test.
  async function openDrawer(props) {
    const rendered = renderDrawer(props);
    await act(async () => {});
    return rendered;
  }

  it('shows the whole proposal: description, organization, year, the dates in order, positions, requirements, rules and tie-break rule', async () => {
    const { drawer } = await openDrawer({ request: proposal() });
    const section = within(drawer).getByRole('region', { name: 'Election proposal' });

    expect(within(section).getByText('Yearly election of the student body officers.')).toBeInTheDocument();
    expect(within(section).getByText('Student Body Organization')).toBeInTheDocument();
    expect(within(section).getByText('2026-2027')).toBeInTheDocument();

    const schedule = within(section).getByRole('list', { name: 'Schedule' });
    expect(within(schedule).getAllByRole('listitem').map((item) => item.firstChild.textContent)).toEqual(['Filing', 'Screening', 'Campaign', 'Voting', 'Results published']);
    expect(within(section).getByText('Dec 15, 2026, 8:00 AM to Dec 16, 2026, 5:00 PM')).toBeInTheDocument();

    const [president, senator] = within(within(section).getByRole('list', { name: 'Positions' })).getAllByRole('listitem');
    expect(president).toHaveTextContent('President');
    expect(president).toHaveTextContent('1 seat');
    expect(president).toHaveTextContent('Executive');
    expect(president).toHaveTextContent('1 choice allowed');
    expect(president).toHaveTextContent('Year 2, 3');
    expect(president).toHaveTextContent('No pending case');
    expect(senator).toHaveTextContent('3 seats');
    expect(senator).toHaveTextContent('Not executive');
    expect(senator).toHaveTextContent('2 choices allowed');
    expect(senator).toHaveTextContent('All year levels');

    expect(within(section).getByText('Minimum units: 12')).toBeInTheDocument();
    expect(within(section).getByText('Minimum GPA: 2.50')).toBeInTheDocument();
    const rules = within(section).getByRole('region', { name: 'Official rules' });
    expect(rules).toHaveTextContent('Candidates must be in good standing.');
    expect(rules.className).toMatch(/overflow-y-auto/);
    expect(within(section).getByText('The older candidate by date of enrollment wins.')).toBeInTheDocument();
    await waitFor(() => expect(mocks.getApprovalHistory).toHaveBeenCalledWith(3));
  });

  it('lists the decision history as a short list', async () => {
    mocks.getApprovalHistory.mockResolvedValue([
      { action: 'submitted', actor_name: 'Ana Admin', actor_role: 'ADMIN', remarks: null, at: '2026-11-10T09:00:00+08:00' },
      { action: 'returned', actor_name: 'Dean Cruz', actor_role: 'DEPARTMENT_HEAD', remarks: 'Move voting later.', at: '2026-11-11T09:00:00+08:00' },
      { action: 'resubmitted', actor_name: 'Ana Admin', actor_role: 'ADMIN', remarks: null, at: '2026-11-12T09:00:00+08:00' },
    ]);
    const { drawer } = await openDrawer({ request: proposal() });
    const history = await within(drawer).findByRole('list', { name: 'Decision history' });
    const items = within(history).getAllByRole('listitem');

    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Submitted by Ana Admin');
    expect(items[1]).toHaveTextContent('Asked for changes by Dean Cruz');
    expect(items[1]).toHaveTextContent('Move voting later.');
    expect(items[2]).toHaveTextContent('Resubmitted by Ana Admin');
  });

  it('keeps the drawer usable when the history cannot be loaded', async () => {
    mocks.historyFails = true;
    const { drawer } = await openDrawer({ request: proposal() });
    await waitFor(() => expect(mocks.getApprovalHistory).toHaveBeenCalled());
    expect(within(drawer).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(within(drawer).queryByRole('list', { name: 'Decision history' })).not.toBeInTheDocument();
  });

  it('offers Approve, Ask for changes and Reject for good, and no plain Reject', async () => {
    const { drawer } = await openDrawer({ request: proposal() });
    for (const name of ['Approve', 'Ask for changes', 'Reject for good']) {
      expect(within(drawer).getByRole('button', { name })).toBeInTheDocument();
    }
    expect(within(drawer).queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });

  it('approves with the remarks left empty, or with the ones typed', async () => {
    const { drawer, onDecide } = await openDrawer({ request: proposal() });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Approve' }));
    expect(onDecide).toHaveBeenCalledWith(expect.objectContaining({ id: 31 }), { status: 'approved', remarks: null });
    await waitFor(() => expect(within(drawer).getByRole('button', { name: 'Approve' })).toBeEnabled());

    fireEvent.change(within(drawer).getByLabelText('Remarks for the Admin'), { target: { value: ' Good to go ' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Approve' }));
    expect(onDecide).toHaveBeenLastCalledWith(expect.objectContaining({ id: 31 }), { status: 'approved', remarks: 'Good to go' });
  });

  it('needs remarks before asking for changes, then sends a rejection that is not final', async () => {
    const { drawer, onDecide } = await openDrawer({ request: proposal() });
    const ask = within(drawer).getByRole('button', { name: 'Ask for changes' });
    expect(ask).toBeDisabled();
    fireEvent.change(within(drawer).getByLabelText('Remarks for the Admin'), { target: { value: 'Move voting later.' } });
    expect(ask).toBeEnabled();
    fireEvent.click(ask);
    expect(onDecide).toHaveBeenCalledWith(expect.objectContaining({ id: 31 }), { status: 'rejected', remarks: 'Move voting later.' });
    expect(onDecide.mock.calls[0][1]).not.toHaveProperty('final');
  });

  it('needs a reason and a confirmation before rejecting for good, and says it cannot be resubmitted', async () => {
    const { drawer, onDecide } = await openDrawer({ request: proposal() });
    const reject = within(drawer).getByRole('button', { name: 'Reject for good' });
    expect(reject).toBeDisabled();
    fireEvent.change(within(drawer).getByLabelText('Remarks for the Admin'), { target: { value: 'Outside the semester.' } });
    fireEvent.click(reject);

    const confirm = await screen.findByRole('dialog', { name: 'Reject election for good' });
    expect(confirm).toHaveTextContent(/cannot be resubmitted/i);
    expect(onDecide).not.toHaveBeenCalled();

    fireEvent.click(within(confirm).getByRole('button', { name: 'Reject for good' }));
    expect(onDecide).toHaveBeenCalledWith(expect.objectContaining({ id: 31 }), { status: 'rejected', remarks: 'Outside the semester.', final: true });
  });

  it('sends nothing when the confirmation is cancelled', async () => {
    const { drawer, onDecide } = await openDrawer({ request: proposal() });
    fireEvent.change(within(drawer).getByLabelText('Remarks for the Admin'), { target: { value: 'Outside the semester.' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Reject for good' }));
    const confirm = await screen.findByRole('dialog', { name: 'Reject election for good' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(onDecide).not.toHaveBeenCalled();
  });

  it('shows the message when the decision fails', async () => {
    const { drawer, onDecide } = await openDrawer({ request: proposal() });
    onDecide.mockRejectedValue({ response: { status: 409, data: { message: 'This request was already decided.' } } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Approve' }));
    expect(await within(drawer).findByRole('alert')).toHaveTextContent('This request was already decided.');
  });

  it('shows no decision form to someone who cannot decide', async () => {
    const { drawer } = await openDrawer({ request: proposal(), canAct: false });
    expect(within(drawer).queryByLabelText('Remarks for the Admin')).not.toBeInTheDocument();
    for (const name of ['Approve', 'Ask for changes', 'Reject for good']) {
      expect(within(drawer).queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(within(drawer).getByRole('region', { name: 'Election proposal' })).toBeInTheDocument();
  });

  it('still shows the voting window and positions of an election where the Admin adds the candidates', async () => {
    const { drawer } = await openDrawer({ request: proposal({ filing_starts_at: null, filing_ends_at: null, screening_starts_at: null, screening_ends_at: null, campaign_starts_at: null, campaign_ends_at: null, results_publish_at: null, rules: null, tie_break_rule: null, min_units: null, min_gpa: null }) });
    const schedule = within(drawer).getByRole('list', { name: 'Schedule' });
    expect(within(schedule).getAllByRole('listitem')).toHaveLength(1);
    expect(within(schedule).getByText('Voting')).toBeInTheDocument();
    expect(within(drawer).queryByRole('region', { name: 'Official rules' })).not.toBeInTheDocument();
  });
});

describe('ApprovalDetailDrawer event approval is unchanged', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps two clicks: Approve and Reject, with no proposal, remarks form or history request', () => {
    const { drawer, onApprove, onReject, onDecide } = renderDrawer({ request: request({}, []) });
    expect(within(drawer).queryByRole('region', { name: 'Election proposal' })).not.toBeInTheDocument();
    expect(within(drawer).queryByLabelText('Remarks for the Admin')).not.toBeInTheDocument();
    for (const name of ['Ask for changes', 'Reject for good']) {
      expect(within(drawer).queryByRole('button', { name })).not.toBeInTheDocument();
    }
    fireEvent.click(within(drawer).getByRole('button', { name: 'Approve' }));
    fireEvent.click(within(drawer).getByRole('button', { name: 'Reject' }));
    expect(onApprove).toHaveBeenCalledWith(expect.objectContaining({ id: 25 }), undefined);
    expect(onReject).toHaveBeenCalledWith(expect.objectContaining({ id: 25 }), undefined);
    expect(onDecide).not.toHaveBeenCalled();
    expect(mocks.getApprovalHistory).not.toHaveBeenCalled();
  });
});
