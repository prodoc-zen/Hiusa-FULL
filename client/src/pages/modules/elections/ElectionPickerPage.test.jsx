import { findRowAction } from '../../../test/rowActions';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ElectionPickerPage from './ElectionPickerPage';
import { PERIOD_KEY } from '../../../utils/academicPeriodStore';
import { isoToLocalDateTimeInput } from '../../../utils/dateTime';

const electionMocks = vi.hoisted(() => ({
  getElections: vi.fn(),
  createElection: vi.fn(),
  updateElection: vi.fn(),
  deleteElection: vi.fn(),
  submitElection: vi.fn(),
  getElectionPositions: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../services/electionService', () => electionMocks);
const openMocks = vi.hoisted(() => ({ openProtectedFile: vi.fn() }));
vi.mock('../../../utils/openProtectedFile', () => openMocks);
const periodMocks = vi.hoisted(() => ({
  getAcademicPeriods: vi.fn().mockResolvedValue([
    { id: 1, number: 1, status: 'completed', academic_year: { label: '2026-2027' } },
    { id: 2, number: 2, status: 'active', academic_year: { label: '2026-2027' } },
  ]),
}));
vi.mock('../../../services/systemAdministrationService', () => periodMocks);

const upcoming = {
  id: 7,
  title: 'HIUSA General Election 2026',
  status: 'upcoming',
  start_time: '2026-10-01T08:00:00Z',
  end_time: '2026-10-02T08:00:00Z',
  positions_count: 4,
  candidates_count: 10,
  votes_count: 0,
};

// The table and the phone list both render, so the table row (first in the DOM) stands in for the card.
async function rowFor(title) {
  return (await screen.findAllByText(title))[0].closest('tr');
}

describe('ElectionPickerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openMocks.openProtectedFile.mockResolvedValue();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    electionMocks.getElections.mockResolvedValue([upcoming]);
  });

  it('requires an explicit election selection and exposes election artwork controls', async () => {
    const onSelect = vi.fn();
    render(<ElectionPickerPage onSelect={onSelect} />);

    expect(screen.queryByRole('heading', { name: 'Election Workspace' })).not.toBeInTheDocument();
    await screen.findAllByText('HIUSA General Election 2026');
    fireEvent.click(screen.getAllByRole('button', { name: 'HIUSA General Election 2026' })[0]);
    expect(onSelect).toHaveBeenCalledWith(7);

    fireEvent.click(screen.getByRole('button', { name: 'Create election' }));
    await waitFor(() => expect(screen.getByText('Election artwork')).toBeInTheDocument());
    expect(screen.getByLabelText('Election title')).toBeRequired();
    expect(screen.getByLabelText(/Election artwork/)).toHaveAttribute('type', 'file');
    expect(screen.getByLabelText(/Informative letter/)).toBeRequired();
    expect(screen.getAllByText('(optional)').length).toBeGreaterThan(0);
  });

  it('has no academic period picker of its own and lists the semester the top bar is on', async () => {
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    await screen.findAllByText('HIUSA General Election 2026');
    expect(screen.queryByLabelText('Academic period')).not.toBeInTheDocument();
    expect(screen.queryByText('Active period')).not.toBeInTheDocument();
    expect(periodMocks.getAcademicPeriods).not.toHaveBeenCalled();
    expect(electionMocks.getElections).toHaveBeenCalledWith({});
  });

  it('lists the closed semester a student chose in the top bar, and only for a student', async () => {
    localStorage.setItem(PERIOD_KEY, JSON.stringify({ id: 1, number: 1, status: 'completed', academic_year: { label: '2025-2026' } }));
    localStorage.setItem('user', JSON.stringify({ role: 'STUDENT' }));
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    await waitFor(() => expect(electionMocks.getElections).toHaveBeenCalledWith({ academic_semester_id: 1 }));

    electionMocks.getElections.mockClear();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    await waitFor(() => expect(electionMocks.getElections).toHaveBeenCalledWith({}));
    localStorage.removeItem(PERIOD_KEY);
  });

  it('opens the creation form when launched from the approval-request selector', async () => {
    render(<ElectionPickerPage onSelect={vi.fn()} startCreate />);

    expect(await screen.findByRole('heading', { name: 'Create election' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit for approval' })).toBeInTheDocument();
    // The list's Create election button is gone, so the form has the only filled button.
    expect(screen.queryByRole('button', { name: 'Create election' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('shows each election its stage and next action, and keeps Finalize ballot for the workspace', async () => {
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    const row = await rowFor('HIUSA General Election 2026');
    expect(within(row).getByText('Next: Build the ballot')).toBeInTheDocument();
    expect(within(row).getByText('Upcoming')).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /Finalize ballot/ })).not.toBeInTheDocument();
  });

  it('marks a returned election with the reason and an edit and resubmit action', async () => {
    electionMocks.getElections.mockResolvedValue([{ ...upcoming, status: 'pending_approval', approval_status: 'rejected', approval_remarks: 'Add the voting room.' }]);
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    const row = await rowFor('HIUSA General Election 2026');
    expect(within(row).getByText('Returned')).toBeInTheDocument();
    expect(within(row).getByText('Reason: Add the voting room.')).toBeInTheDocument();
    expect(within(row).getByText('Next: Returned: edit and resubmit')).toBeInTheDocument();
    expect(await findRowAction(/Edit and resubmit/)).toBeInTheDocument();
    expect(within(row).queryByText('Pending approval')).not.toBeInTheDocument();
  });

  it('opens the submitted informative letter after a rejection', async () => {
    electionMocks.getElections.mockResolvedValue([{ ...upcoming, status: 'pending_approval', approval_status: 'rejected', approval_remarks: 'Revise the letter.', has_informative_letter: true }]);
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    fireEvent.click(await findRowAction('View informative letter'));
    await waitFor(() => expect(openMocks.openProtectedFile).toHaveBeenCalledWith('/elections/7/informative-letter'));
  });

  it('keeps a pending election that has no approval fields as pending approval', async () => {
    electionMocks.getElections.mockResolvedValue([{ ...upcoming, status: 'pending_approval' }]);
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    const row = await rowFor('HIUSA General Election 2026');
    expect(within(row).getByText('Pending approval')).toBeInTheDocument();
    expect(within(row).getByText('Next: Awaiting Department Head review')).toBeInTheDocument();
  });

  it('opens the edit form for the election named in an edit link and reports when it closes', async () => {
    const onEditClosed = vi.fn();
    render(<ElectionPickerPage onSelect={vi.fn()} editElectionId="7" onEditClosed={onEditClosed} />);
    expect(await screen.findByRole('heading', { name: 'Edit election' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onEditClosed).toHaveBeenCalledWith(null);
  });

  it('resubmits through the edit form and hands the updated election back', async () => {
    electionMocks.getElections.mockResolvedValue([{ ...upcoming, status: 'pending_approval', approval_status: 'rejected' }]);
    electionMocks.updateElection.mockResolvedValue({ id: 7, title: upcoming.title, status: 'pending_approval' });
    const onEditClosed = vi.fn();
    render(<ElectionPickerPage onSelect={vi.fn()} editElectionId="7" onEditClosed={onEditClosed} />);
    await screen.findByRole('heading', { name: 'Edit election' });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(electionMocks.updateElection).toHaveBeenCalled());
    await waitFor(() => expect(onEditClosed).toHaveBeenCalledWith(expect.objectContaining({ id: 7 })));
  });
});

describe('ElectionPickerPage editing an approved election', () => {
  const approved = { ...upcoming, approved_at: '2026-09-20T08:00:00Z', finalized_at: '2026-09-21T08:00:00Z', approval_status: 'approved' };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
  });

  it('says before saving that a new schedule needs approval and a new finalize', async () => {
    electionMocks.getElections.mockResolvedValue([approved]);
    render(<ElectionPickerPage onSelect={vi.fn()} editElectionId="7" onEditClosed={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Edit election' });
    expect(screen.getByText(/Changing the schedule sends this election back for approval and un-finalizes the ballot/)).toBeInTheDocument();
  });

  it('says it again after saving when the election went back to approval', async () => {
    electionMocks.getElections.mockResolvedValue([approved]);
    electionMocks.updateElection.mockResolvedValue({ id: 7, title: upcoming.title, status: 'pending_approval', approved_at: null, finalized_at: null });
    render(<ElectionPickerPage onSelect={vi.fn()} editElectionId="7" onEditClosed={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Edit election' });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Election updated and sent back for approval. Finalize the ballot again once it is approved.')).toBeInTheDocument();
  });

  it('adds no warning for an election that is not approved yet', async () => {
    electionMocks.getElections.mockResolvedValue([upcoming]);
    render(<ElectionPickerPage onSelect={vi.fn()} editElectionId="7" onEditClosed={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Edit election' });
    expect(screen.queryByText(/Changing the schedule/)).not.toBeInTheDocument();
  });
});

describe('ElectionPickerPage empty states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electionMocks.getElections.mockResolvedValue([]);
  });

  it('gives the Admin a first action to create the first election, and only one create button', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    expect(await screen.findByText(/Submit an election for Department Head approval/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Create (your first )?election/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Create your first election' }));
    expect(await screen.findByRole('heading', { name: 'Create election' })).toBeInTheDocument();
  });

  it('tells an Officer who can create elections', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'SBO_OFFICER' }));
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    expect(await screen.findByText('No elections yet')).toBeInTheDocument();
    expect(screen.getByText(/Only the Admin creates elections/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Create/ })).not.toBeInTheDocument();
  });

  it('tells a student that voting appears when the Admin opens an election', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'STUDENT' }));
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    expect(await screen.findByText('No election is currently open')).toBeInTheDocument();
  });

  it('offers to clear the filters when a search matches nothing', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    electionMocks.getElections.mockResolvedValue([upcoming]);
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    await screen.findAllByText('HIUSA General Election 2026');
    fireEvent.change(screen.getByLabelText('Search elections'), { target: { value: 'zzz' } });
    expect(await screen.findByText('No elections match')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect((await screen.findAllByText('HIUSA General Election 2026')).length).toBeGreaterThan(0);
  });
});

describe('ElectionPickerPage by screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
  });

  it('is a plain chooser on the candidates screen, with no create button', async () => {
    electionMocks.getElections.mockResolvedValue([upcoming]);
    render(<ElectionPickerPage onSelect={vi.fn()} mode="candidates" />);
    expect(await screen.findByRole('heading', { name: 'Choose an election' })).toBeInTheDocument();
    expect(screen.getByText('Pick the election whose candidates you want to manage.')).toBeInTheDocument();
    await screen.findAllByText('HIUSA General Election 2026');
    expect(screen.queryByRole('button', { name: /Create/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Next:/)).not.toBeInTheDocument();
  });

  it('lists only elections with results on the results screen', async () => {
    const closed = { ...upcoming, id: 8, title: 'Closed Election', status: 'closed', votes_count: 12 };
    electionMocks.getElections.mockResolvedValue([upcoming, closed]);
    render(<ElectionPickerPage onSelect={vi.fn()} mode="results" />);
    expect(await screen.findByRole('heading', { name: 'Election results' })).toBeInTheDocument();
    expect((await screen.findAllByText('Closed Election')).length).toBeGreaterThan(0);
    expect(screen.queryByText('HIUSA General Election 2026')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Create/ })).not.toBeInTheDocument();
  });

  it('says there are no results yet instead of offering to create an election', async () => {
    electionMocks.getElections.mockResolvedValue([upcoming]);
    render(<ElectionPickerPage onSelect={vi.fn()} mode="results" />);
    expect(await screen.findByText('No results yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Create/ })).not.toBeInTheDocument();
  });

  it('shows no hours countdown and calls an open election Open', async () => {
    const soon = new Date(Date.now() + 168 * 3_600_000).toISOString();
    electionMocks.getElections.mockResolvedValue([{ ...upcoming, status: 'active', finalized_at: '2026-10-01T00:00:00Z', end_time: soon }]);
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    const row = await rowFor('HIUSA General Election 2026');
    expect(within(row).getByText('Open')).toBeInTheDocument();
    expect(within(row).queryByText(/hours? remaining/)).not.toBeInTheDocument();
  });

  it('uses a styled file chooser that names the chosen file', async () => {
    render(<ElectionPickerPage onSelect={vi.fn()} startCreate />);
    const letter = await screen.findByLabelText(/Informative letter/);
    expect(screen.getAllByText('No file selected').length).toBe(2);
    fireEvent.change(letter, { target: { files: [new File(['x'], 'letter.pdf', { type: 'application/pdf' })] } });
    expect(await screen.findByText('letter.pdf')).toBeInTheDocument();
    expect(screen.queryByText(/PIO/)).not.toBeInTheDocument();
  });
});

describe('ElectionPickerPage delete rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
  });

  it('offers Delete for an upcoming election without votes and deletes it without a confirmation flag', async () => {
    electionMocks.getElections.mockResolvedValue([upcoming]);
    electionMocks.deleteElection.mockResolvedValue({});
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    const row = await rowFor('HIUSA General Election 2026');

    expect(within(row).getByRole('button', { name: /^Actions for/ })).toBeInTheDocument();
    fireEvent.click(await findRowAction(/Delete/));
    const dialog = await screen.findByRole('dialog', { name: 'Delete election' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(electionMocks.deleteElection).toHaveBeenCalledWith(7));
  });

  it('offers Open voting on a finalized election only once its start time has passed', async () => {
    const finalized = { ...upcoming, approved_at: '2026-09-01T00:00:00Z', finalized_at: '2026-09-02T00:00:00Z' };
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString();
    electionMocks.getElections.mockResolvedValue([{ ...finalized, start_time: future, end_time: new Date(Date.now() + 6 * 86_400_000).toISOString() }]);
    const waiting = render(<ElectionPickerPage onSelect={vi.fn()} />);
    const row = await rowFor('HIUSA General Election 2026');
    expect(within(row).getByText(/^Next: Ballot locked: voting opens on /)).toBeInTheDocument();
    expect(await findRowAction(/Edit/)).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Open voting/ })).not.toBeInTheDocument();
    waiting.unmount();

    electionMocks.getElections.mockResolvedValue([finalized]);
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    await rowFor('HIUSA General Election 2026');
    expect(await findRowAction(/Open voting/)).toBeInTheDocument();
  });

  it('hides Delete for an open election and offers Close instead', async () => {
    electionMocks.getElections.mockResolvedValue([{ ...upcoming, status: 'active', approved_at: '2026-09-01T00:00:00Z', finalized_at: '2026-09-02T00:00:00Z' }]);
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    const row = await rowFor('HIUSA General Election 2026');

    expect(within(row).queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
    expect(await findRowAction(/Close/)).toBeInTheDocument();
  });

  it('asks before closing an open election and only closes it on confirm', async () => {
    const open = { ...upcoming, status: 'active', approved_at: '2026-09-01T00:00:00Z', finalized_at: '2026-09-02T00:00:00Z' };
    electionMocks.getElections.mockResolvedValue([open]);
    electionMocks.updateElection.mockResolvedValue({ ...open, status: 'closed' });
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    await rowFor('HIUSA General Election 2026');

    fireEvent.click(await findRowAction(/Close/));
    const dialog = await screen.findByRole('dialog', { name: 'Close election' });
    expect(within(dialog).getByText(/Closing ends voting and cannot be undone/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Winners become upcoming officers; their access starts on the officer start date and the outgoing officers keep access until the school year ends/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/lose their officer access/)).not.toBeInTheDocument();
    expect(electionMocks.updateElection).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Close election' })).not.toBeInTheDocument());
    expect(electionMocks.updateElection).not.toHaveBeenCalled();

    fireEvent.click(await findRowAction(/Close/));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Close election' })).getByRole('button', { name: 'Close election' }));
    await waitFor(() => expect(electionMocks.updateElection).toHaveBeenCalledWith(7, { status: 'closed' }));
  });

  it('counts ballots cast, not individual selections, under the name Ballots', async () => {
    electionMocks.getElections.mockResolvedValue([{ ...upcoming, status: 'active', votes_count: 18, voters_count: 9 }]);
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    const row = await rowFor('HIUSA General Election 2026');
    const table = row.closest('table');

    expect(within(table).getByRole('columnheader', { name: 'Ballots' })).toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: 'Votes' })).not.toBeInTheDocument();
    expect(within(row).getByText('9')).toBeInTheDocument();
    expect(within(row).queryByText('18')).not.toBeInTheDocument();
  });

  it('hides Delete for a closed election and for any election that has votes', async () => {
    electionMocks.getElections.mockResolvedValue([{ ...upcoming, status: 'closed' }]);
    const closed = render(<ElectionPickerPage onSelect={vi.fn()} />);
    const closedRow = await rowFor('HIUSA General Election 2026');
    expect(within(closedRow).queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
    closed.unmount();

    electionMocks.getElections.mockResolvedValue([{ ...upcoming, votes_count: 3 }]);
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    const votedRow = await rowFor('HIUSA General Election 2026');
    expect(within(votedRow).queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
  });
});

// The catalog spells the Vice President titles with an en dash.
const EN_DASH = String.fromCharCode(0x2013);
const VICE_INTERNAL = `Vice President ${EN_DASH} Internal`;
const VICE_EXTERNAL = `Vice President ${EN_DASH} External`;
const CATALOG = ['President', VICE_INTERNAL, VICE_EXTERNAL, 'Secretary', 'Treasurer', 'Auditor', 'Public Information Officer'];

// Optional fields carry an "(optional)" suffix in their label, so match by substring. The first match in the page is the election level field.
const byLabel = (label) => screen.getAllByLabelText(label, { exact: false })[0];
const setValue = (label, value) => fireEvent.change(byLabel(label), { target: { value } });
const iso = (local) => new Date(local).toISOString();

const SCHEDULE_VALUES = {
  'Filing opens': '2026-11-01T08:00',
  'Filing closes': '2026-11-05T17:00',
  'Screening starts': '2026-11-06T08:00',
  'Screening ends': '2026-11-08T17:00',
  'Campaign starts': '2026-11-09T08:00',
  'Campaign ends': '2026-11-12T17:00',
  'Voting starts': '2026-11-13T08:00',
  'Voting ends': '2026-11-14T17:00',
  'Results published': '2026-11-15T09:00',
};

function fillSchedule(overrides = {}) {
  Object.entries({ ...SCHEDULE_VALUES, ...overrides }).forEach(([label, value]) => setValue(label, value));
}

function fillFullForm() {
  setValue('Election title', 'HIUSA General Elections 2026');
  setValue('Voting room', 'Online ballot');
  setValue('Description', 'Yearly officer election.');
  fillSchedule();
  setValue('Official rules', 'Only enrolled members may vote.');
  setValue('Tie-break rule', 'Coin toss witnessed by the adviser.');
  setValue('Position 1 title', 'President');
}

describe('ElectionPickerPage create form: students file their own candidacy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    electionMocks.getElections.mockResolvedValue([]);
    electionMocks.createElection.mockResolvedValue({ id: 31, title: 'HIUSA General Elections 2026', status: 'pending_approval' });
  });

  it('opens with the switch ON and the full form', async () => {
    render(<ElectionPickerPage onSelect={vi.fn()} startCreate />);
    const toggle = await screen.findByRole('switch', { name: 'Students file their own candidacy' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(toggle).not.toBeDisabled();

    const order = ['Description', 'Filing opens', 'Filing closes', 'Screening starts', 'Screening ends', 'Campaign starts', 'Campaign ends', 'Voting starts', 'Voting ends', 'Results published', 'Minimum enrolled units', 'Minimum GPA', 'Official rules', 'Tie-break rule'];
    const nodes = order.map((label) => byLabel(label));
    for (let i = 1; i < nodes.length; i += 1) {
      expect(nodes[i - 1].compareDocumentPosition(nodes[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // The switch comes first, before the artwork and the title.
    expect(toggle.compareDocumentPosition(screen.getByLabelText('Election title')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByLabelText('Minimum enrolled units')).toHaveValue(10);
    expect(screen.getByLabelText('Official rules').tagName).toBe('TEXTAREA');
    expect(screen.getByText('How the Department Head decides a tie that remains after the runoff')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit for approval' })).toBeInTheDocument();
  });

  it("shows exactly today's form when the switch is OFF", async () => {
    render(<ElectionPickerPage onSelect={vi.fn()} startCreate />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Students file their own candidacy' }));
    expect(screen.getByRole('switch', { name: 'Students file their own candidacy' })).toHaveAttribute('aria-checked', 'false');

    expect(screen.getByLabelText(/Election artwork/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Informative letter/)).toBeRequired();
    expect(screen.getByLabelText('Election title')).toBeRequired();
    expect(screen.getByLabelText(/Voting room/)).toBeInTheDocument();
    expect(screen.getByLabelText('Voting starts')).toBeRequired();
    expect(screen.getByLabelText('Voting ends')).toBeRequired();
    expect(screen.getByLabelText('Position 1 title')).toBeInTheDocument();
    expect(screen.getByLabelText('Position 1 maximum winners')).toBeInTheDocument();
    ['Add position', 'Add executive positions', 'Cancel', 'Submit for approval'].forEach((name) => expect(screen.getByRole('button', { name })).toBeInTheDocument());

    ['Description', 'Filing opens', 'Filing closes', 'Screening starts', 'Campaign starts', 'Results published', 'Minimum enrolled units', 'Minimum GPA', 'Official rules', 'Tie-break rule', 'Position 1 seats', 'Position 1 description'].forEach((label) => expect(screen.queryByLabelText(label)).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
    expect(screen.queryByText('Schedule')).not.toBeInTheDocument();
  });

  it('submits the legacy form with the short payload and no filing keys', async () => {
    render(<ElectionPickerPage onSelect={vi.fn()} startCreate />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Students file their own candidacy' }));
    setValue('Election title', 'Demo Representative');
    setValue('Voting starts', '2026-11-13T08:00');
    setValue('Voting ends', '2026-11-14T17:00');
    setValue('Position 1 title', 'Representative');
    // jsdom cannot attach a file to the required letter input, so submit the form directly.
    fireEvent.submit(document.getElementById('create-election-form'));
    await waitFor(() => expect(electionMocks.createElection).toHaveBeenCalled());
    const payload = electionMocks.createElection.mock.calls[0][0];
    expect(payload).toMatchObject({ title: 'Demo Representative', room: '', start_time: iso('2026-11-13T08:00'), end_time: iso('2026-11-14T17:00'), positions: [{ title: 'Representative', max_winners: 1 }] });
    expect(payload.positions[0]).not.toHaveProperty('is_executive');
    ['draft', 'filing_starts_at', 'rules', 'tie_break_rule', 'min_units', 'description'].forEach((key) => expect(payload).not.toHaveProperty(key));
    expect(electionMocks.submitElection).not.toHaveBeenCalled();
  });

  it('says when a date in the schedule is out of order', async () => {
    render(<ElectionPickerPage onSelect={vi.fn()} startCreate />);
    await screen.findByLabelText('Filing opens');
    fillSchedule({ 'Filing closes': '2026-10-30T08:00', 'Screening ends': '2026-11-05T08:00', 'Voting ends': '2026-11-13T08:00', 'Results published': '2026-11-13T07:00' });
    expect(screen.getByText('Filing closes must be at or after filing opens.')).toBeInTheDocument();
    expect(screen.getByText('Screening ends must be at or after screening starts.')).toBeInTheDocument();
    expect(screen.getByText('Voting end time must be after the start time.')).toBeInTheDocument();
    expect(screen.getByText('Results published must be at or after voting ends.')).toBeInTheDocument();
    expect(screen.queryByText('Screening starts must be at or after filing closes.')).not.toBeInTheDocument();

    // A date equal to the one before it is allowed, except for the voting end.
    fillSchedule({ 'Filing closes': '2026-11-01T08:00', 'Screening ends': '2026-11-06T08:00', 'Voting ends': '2026-11-13T09:00', 'Results published': '2026-11-13T09:00' });
    expect(screen.queryByText(/must be at or after/)).not.toBeInTheDocument();
    expect(screen.queryByText('Voting end time must be after the start time.')).not.toBeInTheDocument();
  });

  it('refuses a submit that has no schedule, rules or tie-break rule and sends nothing', async () => {
    render(<ElectionPickerPage onSelect={vi.fn()} startCreate />);
    setValue('Election title', 'HIUSA General Elections 2026');
    setValue('Position 1 title', 'President');
    fireEvent.click(screen.getByRole('button', { name: 'Submit for approval' }));
    expect(await screen.findByText('Set every date in the schedule.')).toBeInTheDocument();
    expect(screen.getByText('Enter the official rules.')).toBeInTheDocument();
    expect(screen.getByText('Enter the tie-break rule.')).toBeInTheDocument();
    expect(electionMocks.createElection).not.toHaveBeenCalled();
  });

  it('refuses a submit with no position, and with a repeated one', async () => {
    render(<ElectionPickerPage onSelect={vi.fn()} startCreate />);
    fillFullForm();
    setValue('Position 1 title', '');
    fireEvent.click(screen.getByRole('button', { name: 'Submit for approval' }));
    expect(await screen.findByText('Add at least one election position.')).toBeInTheDocument();
    expect(electionMocks.createElection).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Add position' }));
    setValue('Position 1 title', 'President');
    setValue('Position 2 title', 'president');
    fireEvent.click(screen.getByRole('button', { name: 'Submit for approval' }));
    expect(await screen.findByText('Election position titles must be unique.')).toBeInTheDocument();
    expect(electionMocks.createElection).not.toHaveBeenCalled();
  });

  it('saves a draft with only a title and marks it as a draft', async () => {
    render(<ElectionPickerPage onSelect={vi.fn()} startCreate />);
    setValue('Election title', 'Half done');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(electionMocks.createElection).toHaveBeenCalledTimes(1));
    const payload = electionMocks.createElection.mock.calls[0][0];
    expect(payload.draft).toBe(true);
    expect(payload.title).toBe('Half done');
    ['start_time', 'end_time', 'filing_starts_at', 'rules', 'tie_break_rule', 'positions'].forEach((key) => expect(payload).not.toHaveProperty(key));
    expect(electionMocks.submitElection).not.toHaveBeenCalled();
    expect(await screen.findByText('Draft saved.')).toBeInTheDocument();
  });

  it('keeps Save draft and Submit unusable without a title', async () => {
    render(<ElectionPickerPage onSelect={vi.fn()} startCreate />);
    expect(await screen.findByRole('button', { name: 'Save draft' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Submit for approval' })).toBeDisabled();
  });

  it('submits the full payload for approval', async () => {
    render(<ElectionPickerPage onSelect={vi.fn()} startCreate />);
    await screen.findByLabelText('Filing opens');
    fillFullForm();
    setValue('Minimum GPA', '2.5');
    setValue('Position 1 description', 'Leads the council.');
    fireEvent.click(screen.getByLabelText('Position 1 executive'));
    setValue('Position 1 seats', '2');
    setValue('Position 1 voter may choose up to', '1');
    fireEvent.click(screen.getByLabelText('Position 1 2nd year'));
    fireEvent.click(screen.getByLabelText('Position 1 3rd year'));
    setValue('Position 1 other qualifications', 'No pending disciplinary case.');
    fireEvent.click(screen.getByRole('button', { name: 'Submit for approval' }));

    await waitFor(() => expect(electionMocks.createElection).toHaveBeenCalledTimes(1));
    const payload = electionMocks.createElection.mock.calls[0][0];
    expect(payload).toMatchObject({
      title: 'HIUSA General Elections 2026',
      room: 'Online ballot',
      description: 'Yearly officer election.',
      filing_starts_at: iso('2026-11-01T08:00'),
      filing_ends_at: iso('2026-11-05T17:00'),
      screening_starts_at: iso('2026-11-06T08:00'),
      screening_ends_at: iso('2026-11-08T17:00'),
      campaign_starts_at: iso('2026-11-09T08:00'),
      campaign_ends_at: iso('2026-11-12T17:00'),
      start_time: iso('2026-11-13T08:00'),
      end_time: iso('2026-11-14T17:00'),
      results_publish_at: iso('2026-11-15T09:00'),
      rules: 'Only enrolled members may vote.',
      tie_break_rule: 'Coin toss witnessed by the adviser.',
      min_units: 10,
      min_gpa: 2.5,
      positions: [{
        title: 'President', max_winners: 2, description: 'Leads the council.', is_executive: true, vote_limit: 1, eligible_year_levels: [2, 3], other_qualifications: 'No pending disciplinary case.', is_active: true,
      }],
    });
    expect(payload.draft).toBeFalsy();
    expect(electionMocks.submitElection).not.toHaveBeenCalled();
    expect(await screen.findByText('Election submitted for approval.')).toBeInTheDocument();
  });

  it('defaults the voter limit to the seats and never lets it pass them', async () => {
    render(<ElectionPickerPage onSelect={vi.fn()} startCreate />);
    await screen.findByLabelText('Position 1 title');
    expect(screen.getByLabelText('Position 1 voter may choose up to')).toHaveValue(1);

    setValue('Position 1 seats', '3');
    expect(screen.getByLabelText('Position 1 voter may choose up to')).toHaveValue(3);
    expect(screen.getByLabelText('Position 1 voter may choose up to')).toHaveAttribute('max', '3');

    setValue('Position 1 voter may choose up to', '9');
    expect(screen.getByLabelText('Position 1 voter may choose up to')).toHaveValue(3);

    setValue('Position 1 voter may choose up to', '2');
    setValue('Position 1 seats', '1');
    expect(screen.getByLabelText('Position 1 voter may choose up to')).toHaveValue(1);

    fillFullForm();
    setValue('Position 1 seats', '4');
    setValue('Position 1 voter may choose up to', '2');
    setValue('Position 1 seats', '3');
    fireEvent.click(screen.getByRole('button', { name: 'Submit for approval' }));
    await waitFor(() => expect(electionMocks.createElection).toHaveBeenCalled());
    expect(electionMocks.createElection.mock.calls[0][0].positions[0]).toMatchObject({ max_winners: 3, vote_limit: 2 });
  });

  it('adds the catalog executive positions, marked executive, and says so', async () => {
    render(<ElectionPickerPage onSelect={vi.fn()} startCreate />);
    await screen.findByLabelText('Position 1 title');
    fireEvent.click(screen.getByRole('button', { name: 'Add executive positions' }));
    CATALOG.forEach((title, index) => {
      expect(screen.getByLabelText(`Position ${index + 1} title`)).toHaveValue(title);
      expect(screen.getByLabelText(`Position ${index + 1} executive`)).toBeChecked();
    });
    expect(screen.queryByLabelText('Position 8 title')).not.toBeInTheDocument();
    expect(screen.queryByText(/Business Manager/)).not.toBeInTheDocument();
    expect(screen.getByText(`Adds ${CATALOG.slice(0, -1).join(', ')} and ${CATALOG.at(-1)}.`)).toBeInTheDocument();

    // A second press adds nothing twice.
    fireEvent.click(screen.getByRole('button', { name: 'Add executive positions' }));
    expect(screen.queryByLabelText('Position 8 title')).not.toBeInTheDocument();
  });

  it('inserts the same catalog titles on the OFF form', async () => {
    render(<ElectionPickerPage onSelect={vi.fn()} startCreate />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Students file their own candidacy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add executive positions' }));
    CATALOG.forEach((title, index) => expect(screen.getByLabelText(`Position ${index + 1} title`)).toHaveValue(title));
    expect(screen.queryByLabelText('Position 1 executive')).not.toBeInTheDocument();
  });

  it('gives each position its extra fields only when the switch is ON', async () => {
    render(<ElectionPickerPage onSelect={vi.fn()} startCreate />);
    await screen.findByLabelText('Position 1 title');
    ['Position 1 description', 'Position 1 executive', 'Position 1 seats', 'Position 1 voter may choose up to', 'Position 1 1st year', 'Position 1 2nd year', 'Position 1 3rd year', 'Position 1 4th year', 'Position 1 other qualifications', 'Position 1 active'].forEach((label) => expect(screen.getByLabelText(label)).toBeInTheDocument());
    expect(screen.getByLabelText('Position 1 active')).toBeChecked();
    expect(screen.getByLabelText('Position 1 executive')).not.toBeChecked();
    expect(screen.getByText('Fourth year students cannot run')).toBeInTheDocument();
  });
});

describe('ElectionPickerPage editing a filing election', () => {
  const draft = {
    id: 12, title: 'Half done', status: 'pending_approval', submitted_at: null, declined_at: null, filing_starts_at: null,
    start_time: null, end_time: null, positions_count: 0, candidates_count: 0, votes_count: 0,
  };
  const submitted = {
    ...draft, id: 13, title: 'Filing election', submitted_at: '2026-11-01T00:00:00Z', filing_starts_at: '2026-11-02T00:00:00Z', start_time: '2026-11-20T00:00:00Z', end_time: '2026-11-21T00:00:00Z',
    filing_ends_at: '2026-11-04T00:00:00Z', screening_starts_at: '2026-11-05T00:00:00Z', screening_ends_at: '2026-11-07T00:00:00Z', campaign_starts_at: '2026-11-08T00:00:00Z', campaign_ends_at: '2026-11-19T00:00:00Z', results_publish_at: '2026-11-22T00:00:00Z',
    rules: 'Rules text', tie_break_rule: 'Coin toss', min_units: 12, min_gpa: '2.50', description: 'About it',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
  });

  it('reads the switch from the filing dates and locks it once the election exists', async () => {
    electionMocks.getElections.mockResolvedValue([submitted]);
    render(<ElectionPickerPage onSelect={vi.fn()} editElectionId="13" onEditClosed={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Edit election' });
    const toggle = screen.getByRole('switch', { name: 'Students file their own candidacy' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(toggle).toBeDisabled();
    expect(screen.getByLabelText('Official rules')).toHaveValue('Rules text');
    expect(screen.getByLabelText('Tie-break rule')).toHaveValue('Coin toss');
    expect(screen.getByLabelText('Minimum enrolled units')).toHaveValue(12);
    expect(byLabel('Minimum GPA')).toHaveValue(2.5);
    expect(byLabel('Description')).toHaveValue('About it');
    expect(screen.getByLabelText('Filing opens')).toHaveValue(isoToLocalDateTimeInput('2026-11-02T00:00:00Z'));
    // A submitted election is saved, not saved as a draft or submitted again here.
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
  });

  it('lets a draft that was never submitted change kind and still locks it after submission', async () => {
    electionMocks.getElections.mockResolvedValue([draft]);
    render(<ElectionPickerPage onSelect={vi.fn()} editElectionId="12" onEditClosed={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Edit election' });
    const toggle = screen.getByRole('switch', { name: 'Students file their own candidacy' });
    expect(toggle).toBeEnabled();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByLabelText('Official rules')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Voting starts')).toBeInTheDocument();
  });

  it('turns a draft into the short form and submits it with its dates and positions', async () => {
    electionMocks.getElections.mockResolvedValue([draft]);
    electionMocks.getElectionPositions.mockResolvedValue([{ id: 1, title: 'Representative', max_winners: 2 }]);
    electionMocks.updateElection.mockResolvedValue({ ...draft });
    electionMocks.submitElection.mockResolvedValue({ ...draft, submitted_at: '2026-11-13T00:00:00Z' });
    render(<ElectionPickerPage onSelect={vi.fn()} editElectionId="12" onEditClosed={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Edit election' });
    await waitFor(() => expect(electionMocks.getElectionPositions).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('switch', { name: 'Students file their own candidacy' }));
    expect(await screen.findByLabelText('Position 1 title')).toHaveValue('Representative');
    setValue('Voting starts', '2026-12-04T08:00');
    setValue('Voting ends', '2026-12-04T17:00');
    // jsdom cannot attach a file to the required letter input, so submit the form directly.
    fireEvent.submit(document.getElementById('edit-election-form'));
    await waitFor(() => expect(electionMocks.submitElection).toHaveBeenCalledWith(12));
    const payload = electionMocks.updateElection.mock.calls[0][1];
    expect(payload).toMatchObject({ filing_starts_at: '', start_time: iso('2026-12-04T08:00'), end_time: iso('2026-12-04T17:00'), positions: [{ title: 'Representative', max_winners: 2 }] });
  });

  it('does not submit a draft switched to the short form before its positions were read', async () => {
    electionMocks.getElections.mockResolvedValue([draft]);
    electionMocks.getElectionPositions.mockRejectedValue(new Error('offline'));
    render(<ElectionPickerPage onSelect={vi.fn()} editElectionId="12" onEditClosed={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Edit election' });
    await waitFor(() => expect(electionMocks.getElectionPositions).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('switch', { name: 'Students file their own candidacy' }));
    setValue('Voting starts', '2026-12-04T08:00');
    setValue('Voting ends', '2026-12-04T17:00');
    expect(screen.getByRole('button', { name: 'Submit for approval' })).toBeDisabled();
    // Nothing is sent, so the draft keeps every position it has on the server.
    fireEvent.submit(document.getElementById('edit-election-form'));
    expect(electionMocks.updateElection).not.toHaveBeenCalled();
    expect(electionMocks.submitElection).not.toHaveBeenCalled();
  });

  it('shows the positions a draft already has instead of an empty section', async () => {
    electionMocks.getElections.mockResolvedValue([draft]);
    electionMocks.getElectionPositions.mockResolvedValue([
      { id: 1, title: 'President', max_winners: 1, is_executive: true, vote_limit: null, eligible_year_levels: [1, 2], is_active: true },
      { id: 2, title: 'Representative', max_winners: 3, vote_limit: 2 },
    ]);
    render(<ElectionPickerPage onSelect={vi.fn()} editElectionId="12" onEditClosed={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Edit election' });
    expect(await screen.findByLabelText('Position 1 title')).toHaveValue('President');
    expect(screen.getByLabelText('Position 2 title')).toHaveValue('Representative');
    expect(screen.getByLabelText('Position 1 executive')).toBeChecked();
    expect(electionMocks.getElectionPositions).toHaveBeenCalledWith(12);
  });

  it('submits a draft with the positions it already has without typing them again', async () => {
    electionMocks.getElections.mockResolvedValue([draft]);
    electionMocks.getElectionPositions.mockResolvedValue([{ id: 1, title: 'President', max_winners: 1 }]);
    electionMocks.updateElection.mockResolvedValue({ ...draft });
    electionMocks.submitElection.mockResolvedValue({ ...draft, submitted_at: '2026-11-13T00:00:00Z' });
    render(<ElectionPickerPage onSelect={vi.fn()} editElectionId="12" onEditClosed={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Edit election' });
    await screen.findByLabelText('Position 1 title');
    setValue('Election title', 'HIUSA General Elections 2026');
    fillSchedule();
    setValue('Official rules', 'Only enrolled members may vote.');
    setValue('Tie-break rule', 'Coin toss witnessed by the adviser.');
    fireEvent.click(screen.getByRole('button', { name: 'Submit for approval' }));
    await waitFor(() => expect(electionMocks.submitElection).toHaveBeenCalledWith(12));
    expect(electionMocks.updateElection.mock.calls[0][1].positions).toEqual([expect.objectContaining({ title: 'President' })]);
  });

  it('shows the positions of a returned election and saves them with the rest', async () => {
    const returned = { ...submitted, id: 14, title: 'Returned election', approval_status: 'rejected', approval_remarks: 'Fix the dates.', approved_at: null };
    electionMocks.getElections.mockResolvedValue([returned]);
    electionMocks.getElectionPositions.mockResolvedValue([{ id: 1, title: 'President', max_winners: 1 }]);
    electionMocks.updateElection.mockResolvedValue({ ...returned });
    render(<ElectionPickerPage onSelect={vi.fn()} editElectionId="14" onEditClosed={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Edit election' });
    expect(await screen.findByLabelText('Position 1 title')).toHaveValue('President');
    setValue('Position 1 title', 'Chairperson');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(electionMocks.updateElection).toHaveBeenCalledWith(14, expect.objectContaining({ positions: [expect.objectContaining({ title: 'Chairperson' })] })));
  });

  it('never offers Close for an election the schedule runs', async () => {
    electionMocks.getElections.mockResolvedValue([{ ...submitted, id: 15, title: 'Running filing election', status: 'active', approved_at: '2026-11-01T00:00:00Z' }]);
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    await rowFor('Running filing election');
    fireEvent.click((await screen.findAllByRole('button', { name: /^Actions for / }))[0]);
    expect(await screen.findByRole('menuitem', { name: /Edit/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Close/ })).not.toBeInTheDocument();
  });

  it('reads the switch OFF for an election with no filing dates and a recorded submission', async () => {
    electionMocks.getElections.mockResolvedValue([{ ...upcoming, submitted_at: '2026-09-01T00:00:00Z', filing_starts_at: null }]);
    render(<ElectionPickerPage onSelect={vi.fn()} editElectionId="7" onEditClosed={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Edit election' });
    const toggle = screen.getByRole('switch', { name: 'Students file their own candidacy' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toBeDisabled();
    expect(screen.queryByLabelText('Official rules')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Voting starts')).toBeInTheDocument();
  });

  it('saves a submitted filing election through updateElection only', async () => {
    electionMocks.getElections.mockResolvedValue([submitted]);
    electionMocks.getElectionPositions.mockResolvedValue([{ id: 1, title: 'President', max_winners: 1 }]);
    electionMocks.updateElection.mockResolvedValue({ ...submitted, rules: 'New rules' });
    const onEditClosed = vi.fn();
    render(<ElectionPickerPage onSelect={vi.fn()} editElectionId="13" onEditClosed={onEditClosed} />);
    await screen.findByRole('heading', { name: 'Edit election' });
    await screen.findByLabelText('Position 1 title');
    setValue('Official rules', 'New rules');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(electionMocks.updateElection).toHaveBeenCalledWith(13, expect.objectContaining({ rules: 'New rules', tie_break_rule: 'Coin toss', min_units: 12 })));
    expect(electionMocks.updateElection.mock.calls[0][1]).not.toHaveProperty('draft');
    // Not yet approved, so its ballot is edited with the form and sent back as it was read.
    expect(electionMocks.updateElection.mock.calls[0][1].positions).toEqual([expect.objectContaining({ title: 'President', max_winners: 1 })]);
    expect(electionMocks.submitElection).not.toHaveBeenCalled();
    await waitFor(() => expect(onEditClosed).toHaveBeenCalled());
  });

  it('opens a draft as a filing election even with nothing but a title, and keeps it a draft on Save draft', async () => {
    electionMocks.getElections.mockResolvedValue([draft]);
    electionMocks.updateElection.mockResolvedValue({ ...draft });
    render(<ElectionPickerPage onSelect={vi.fn()} editElectionId="12" onEditClosed={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Edit election' });
    expect(screen.getByRole('switch', { name: 'Students file their own candidacy' })).toHaveAttribute('aria-checked', 'true');
    setValue('Election title', 'Half done, more');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(electionMocks.updateElection).toHaveBeenCalledWith(12, expect.objectContaining({ title: 'Half done, more', draft: true })));
    expect(electionMocks.submitElection).not.toHaveBeenCalled();
  });

  it('submits a draft by saving it and then submitting it for approval', async () => {
    electionMocks.getElections.mockResolvedValue([draft]);
    electionMocks.updateElection.mockResolvedValue({ ...draft });
    electionMocks.submitElection.mockResolvedValue({ ...draft, submitted_at: '2026-11-13T00:00:00Z' });
    const onEditClosed = vi.fn();
    render(<ElectionPickerPage onSelect={vi.fn()} editElectionId="12" onEditClosed={onEditClosed} />);
    await screen.findByRole('heading', { name: 'Edit election' });
    fillFullForm();
    fireEvent.click(screen.getByRole('button', { name: 'Submit for approval' }));
    await waitFor(() => expect(electionMocks.submitElection).toHaveBeenCalledWith(12));
    expect(electionMocks.updateElection).toHaveBeenCalledWith(12, expect.objectContaining({ rules: 'Only enrolled members may vote.', positions: [expect.objectContaining({ title: 'President' })] }));
    expect(electionMocks.updateElection.mock.calls[0][1].draft).toBeFalsy();
    expect(electionMocks.updateElection.mock.invocationCallOrder[0]).toBeLessThan(electionMocks.submitElection.mock.invocationCallOrder[0]);
    await waitFor(() => expect(onEditClosed).toHaveBeenCalledWith(expect.objectContaining({ id: 12, submitted_at: '2026-11-13T00:00:00Z' })));
  });

  it('does not submit a draft that fails validation', async () => {
    electionMocks.getElections.mockResolvedValue([draft]);
    render(<ElectionPickerPage onSelect={vi.fn()} editElectionId="12" onEditClosed={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Edit election' });
    fireEvent.click(screen.getByRole('button', { name: 'Submit for approval' }));
    expect(await screen.findByText('Enter the official rules.')).toBeInTheDocument();
    expect(electionMocks.updateElection).not.toHaveBeenCalled();
    expect(electionMocks.submitElection).not.toHaveBeenCalled();
  });

  it('labels a draft in the list and offers to finish it', async () => {
    electionMocks.getElections.mockResolvedValue([draft]);
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    const row = await rowFor('Half done');
    expect(within(row).getByText('Draft')).toBeInTheDocument();
    expect(within(row).queryByText('Pending approval')).not.toBeInTheDocument();
    expect(await findRowAction(/Edit/)).toBeInTheDocument();
  });
});

describe('ElectionPickerPage a rejected election', () => {
  const declined = {
    ...upcoming, status: 'pending_approval', approval_status: 'rejected', approval_remarks: 'The schedule clashes with finals.', declined_at: '2026-11-10T00:00:00Z', submitted_at: '2026-11-01T00:00:00Z', filing_starts_at: '2026-11-02T00:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    electionMocks.getElections.mockResolvedValue([declined]);
  });

  it('shows the Department Head decision and the remarks instead of a form', async () => {
    render(<ElectionPickerPage onSelect={vi.fn()} editElectionId="7" onEditClosed={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Edit election' });
    expect(screen.getByText('The Department Head rejected this election')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByText('The schedule clashes with finals.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Election title')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit for approval' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('lists it as Rejected with the reason and no edit action', async () => {
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    const row = await rowFor('HIUSA General Election 2026');
    expect(within(row).getByText('Rejected')).toBeInTheDocument();
    expect(within(row).queryByText('Returned')).not.toBeInTheDocument();
    expect(within(row).getByText('Reason: The schedule clashes with finals.')).toBeInTheDocument();
    expect(within(row).queryByText(/^Next:/)).not.toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: /^Actions for/ }));
    expect(screen.queryByRole('menuitem', { name: /Edit/ })).not.toBeInTheDocument();
  });
});
