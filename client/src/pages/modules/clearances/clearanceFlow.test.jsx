import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StudentClearancePage from './StudentClearancePage';
import SignatoryClearancesPage from './SignatoryClearancesPage';
import SaoClearancesPage from './SaoClearancesPage';
import { clearanceStageText } from './clearanceLabels';

const mocks = vi.hoisted(() => ({
  getMyClearances: vi.fn(),
  getClearancePeriods: vi.fn(),
  getClearanceSignatures: vi.fn(),
  getClearancePeriodStudents: vi.fn(),
  updateClearanceSignature: vi.fn(),
  deleteClearancePeriod: vi.fn(),
  createClearancePeriod: vi.fn(),
  notifyError: vi.fn(),
}));

vi.mock('../../../services/clearanceService', () => ({
  getMyClearances: mocks.getMyClearances,
  getClearancePeriods: mocks.getClearancePeriods,
  getClearanceSignatures: mocks.getClearanceSignatures,
  getClearancePeriodStudents: mocks.getClearancePeriodStudents,
  updateClearanceSignature: mocks.updateClearanceSignature,
  deleteClearancePeriod: mocks.deleteClearancePeriod,
  createClearancePeriod: mocks.createClearancePeriod,
}));
vi.mock('../../../lib/notify', () => ({ default: { success: vi.fn(), error: mocks.notifyError } }));

function page(data, extra = {}) {
  return { data: { data, total: data.length, current_page: 1, last_page: 1, per_page: 20, ...extra } };
}

function renderAt(entry, element) {
  return render(<MemoryRouter initialEntries={[entry]}>{element}</MemoryRouter>);
}

const PERIOD = {
  clearance_period_id: 1,
  academic_year: '2026-2027',
  title: 'Second Semester Clearance',
  deadline_at: null,
  is_complete: false,
  signatures: [
    { id: 1, required_role: 'adviser', status: 'cleared', remarks: null },
    { id: 2, required_role: 'organization_treasurer', status: 'held', remarks: 'Unpaid organization dues.' },
    { id: 3, required_role: 'sao', status: 'pending', remarks: null },
  ],
};

const SIGNATURE = {
  id: 11,
  status: 'pending',
  remarks: null,
  required_role: 'organization_treasurer',
  student_id: 501,
  student: { first_name: 'Maria', last_name: 'Santos' },
  clearancePeriod: { id: 1, title: 'Second Semester Clearance', academic_year: '2026-2027' },
};

describe('clearance stage text', () => {
  it('says what a single signature is waiting on', () => {
    expect(clearanceStageText({ signatures: [{ required_role: 'organization_treasurer', status: 'pending' }] })).toBe('Waiting for Organization Treasurer signature');
    expect(clearanceStageText({ signatures: [{ required_role: 'sao', status: 'pending' }] })).toBe('Waiting for SAO signature');
    expect(clearanceStageText({ signatures: [{ required_role: 'sao', status: 'held', remarks: 'Missing form.' }] })).toBe('On hold: Missing form.');
    expect(clearanceStageText({ signatures: [{ required_role: 'sao', status: 'held', remarks: null }] })).toBe('On hold by SAO');
    expect(clearanceStageText({ signatures: [{ required_role: 'sao', status: 'cleared' }] })).toBe('Cleared');
  });
});

describe('StudentClearancePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMyClearances.mockResolvedValue({ data: [PERIOD] });
  });

  it('shows one step per signatory with the held one blocked and its remarks in the callout', async () => {
    renderAt('/dashboard/my-clearance', <StudentClearancePage />);
    const stepper = await screen.findByRole('list', { name: 'Clearance signatures' });
    const steps = within(stepper).getAllByRole('listitem');
    expect(steps).toHaveLength(3);
    expect(within(steps[0]).getByText('Done:')).toBeInTheDocument();
    expect(within(steps[1]).getByText('Blocked:')).toBeInTheDocument();
    expect(within(steps[2]).getByText('Upcoming:')).toBeInTheDocument();
    expect(screen.getByText('On hold: Unpaid organization dues.')).toBeInTheDocument();
  });

  it('shows who the student is waiting on when nothing is held', async () => {
    mocks.getMyClearances.mockResolvedValue({ data: [{ ...PERIOD, signatures: [{ id: 3, required_role: 'sao', status: 'pending', remarks: null }] }] });
    renderAt('/dashboard/my-clearance', <StudentClearancePage />);
    expect(await screen.findByText('Waiting for SAO signature')).toBeInTheDocument();
  });

  it('drops the callout for a complete clearance, leaving the celebration', async () => {
    mocks.getMyClearances.mockResolvedValue({ data: [{ ...PERIOD, is_complete: true, signatures: [{ id: 3, required_role: 'sao', status: 'cleared', remarks: null }] }] });
    renderAt('/dashboard/my-clearance', <StudentClearancePage />);
    expect(await screen.findByText('Your clearance is complete!')).toBeInTheDocument();
    expect(screen.queryByText('You are cleared')).not.toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Clearance signatures' })).getByText('Done:')).toBeInTheDocument();
  });

  it('prints the same stage sentence the signing page prints for that signature', async () => {
    mocks.getMyClearances.mockResolvedValue({ data: [{ ...PERIOD, signatures: [{ id: 2, required_role: 'organization_treasurer', status: 'held', remarks: 'Unpaid organization dues.' }] }] });
    const student = renderAt('/dashboard/my-clearance', <StudentClearancePage />);
    expect(await screen.findByText('On hold: Unpaid organization dues.')).toBeInTheDocument();
    student.unmount();

    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    mocks.getClearancePeriods.mockResolvedValue(page([]));
    mocks.getClearanceSignatures.mockResolvedValue(page([{ ...SIGNATURE, status: 'held', remarks: 'Unpaid organization dues.' }]));
    renderAt('/dashboard/clearances', <SignatoryClearancesPage />);
    expect((await screen.findAllByText('On hold: Unpaid organization dues.')).length).toBeGreaterThan(0);
  });

  it('names who opens a period when there is none, under one h1', async () => {
    mocks.getMyClearances.mockResolvedValue({ data: [] });
    renderAt('/dashboard/my-clearance', <StudentClearancePage />);
    expect(await screen.findByText('No clearance period yet')).toBeInTheDocument();
    expect(screen.getByText(/The Student Affairs Office opens a clearance period each semester/)).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('keeps the header while loading and after an error', async () => {
    mocks.getMyClearances.mockRejectedValue(new Error('down'));
    renderAt('/dashboard/my-clearance', <StudentClearancePage />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(await screen.findByText('Failed to load your clearance.')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});

describe('SignatoryClearancesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    mocks.getClearancePeriods.mockResolvedValue(page([{ id: 1, title: 'Second Semester Clearance' }]));
    mocks.getClearanceSignatures.mockResolvedValue(page([SIGNATURE]));
  });

  it('shows the stage on each signing row', async () => {
    renderAt('/dashboard/clearances', <SignatoryClearancesPage />);
    expect((await screen.findAllByText('Waiting for Organization Treasurer signature')).length).toBeGreaterThan(0);
  });

  it('opens the signature from ?record= with a stepper and a sign callout for the Admin', async () => {
    renderAt('/dashboard/clearances?record=11', <SignatoryClearancesPage />);
    const drawer = await screen.findByRole('dialog', { name: 'Maria Santos' });
    expect(within(drawer).getByRole('list', { name: 'Clearance signature' })).toBeInTheDocument();
    expect(within(drawer).getByText('Sign this clearance')).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: 'Hold' })).toBeInTheDocument();
  });

  it('shows the Officer the same sign callout as the Admin', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'SBO_OFFICER' }));
    renderAt('/dashboard/clearances?record=11', <SignatoryClearancesPage />);
    const drawer = await screen.findByRole('dialog', { name: 'Maria Santos' });
    expect(within(drawer).getByText('Sign this clearance')).toBeInTheDocument();
  });

  it('keeps the drawer on the signature after it is cleared and leaves the filtered list', async () => {
    mocks.updateClearanceSignature.mockResolvedValue({ data: { ...SIGNATURE, status: 'cleared' } });
    renderAt('/dashboard/clearances?record=11', <SignatoryClearancesPage />);
    const drawer = await screen.findByRole('dialog', { name: 'Maria Santos' });
    mocks.getClearanceSignatures.mockResolvedValue(page([]));
    fireEvent.click(within(drawer).getByRole('button', { name: 'Clear' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm clear' }));
    await waitFor(() => expect(mocks.updateClearanceSignature).toHaveBeenCalledWith(11, { status: 'cleared', remarks: undefined }));
    expect(screen.getByRole('dialog', { name: 'Maria Santos' })).toBeInTheDocument();
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it('walks to a later page to find the signature named by ?record=', async () => {
    mocks.getClearanceSignatures.mockImplementation(({ page: requested }) => Promise.resolve(requested === 2
      ? page([SIGNATURE], { current_page: 2, last_page: 2, total: 21 })
      : page([{ ...SIGNATURE, id: 1 }], { current_page: 1, last_page: 2, total: 21 })));
    renderAt('/dashboard/clearances?record=11', <SignatoryClearancesPage />);
    expect(await screen.findByRole('dialog', { name: 'Maria Santos' })).toBeInTheDocument();
  });

  it('says so when ?record= names a signature that is not in the queue', async () => {
    renderAt('/dashboard/clearances?record=900', <SignatoryClearancesPage />);
    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalledWith('That signature is not in your signing queue.'));
  });

  it('names who opens a period on the first-run state and offers to clear filters on the filtered one', async () => {
    mocks.getClearanceSignatures.mockResolvedValue(page([]));
    renderAt('/dashboard/clearances', <SignatoryClearancesPage />);
    expect(await screen.findByText('Nothing waiting on your signature')).toBeInTheDocument();
    expect(screen.getByText(/The SAO opens a clearance period each semester/)).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by status' }), { target: { value: 'held' } });
    expect(await screen.findByText('No signatures match these filters')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText('Nothing waiting on your signature')).toBeInTheDocument();
  });

  it('renders exactly one h1', async () => {
    renderAt('/dashboard/clearances', <SignatoryClearancesPage />);
    await screen.findAllByText('Maria Santos');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});

describe('SaoClearancesPage', () => {
  const STUDENT = {
    student_id: 501,
    student_name: 'Maria Santos',
    is_complete: false,
    signatures: [
      { id: 1, required_role: 'adviser', status: 'cleared' },
      { id: 2, required_role: 'sao', status: 'pending' },
    ],
  };
  const PERIOD_ROW = { id: 1, title: 'Second Semester Clearance', academic_year: '2026-2027', deadline_at: null, required_roles: ['sao', 'adviser'] };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClearancePeriods.mockResolvedValue(page([PERIOD_ROW]));
    mocks.getClearancePeriodStudents.mockResolvedValue(page([STUDENT]));
  });

  it('opens the period roster from ?record= with the stage of each student', async () => {
    renderAt('/dashboard/super-admin/clearances?record=1', <SaoClearancesPage />);
    const drawer = await screen.findByRole('dialog', { name: 'Second Semester Clearance' });
    expect(await within(drawer).findByText('Maria Santos')).toBeInTheDocument();
    expect(within(drawer).getByText('Waiting for SAO signature')).toBeInTheDocument();
    expect(within(drawer).getByRole('progressbar', { name: 'Clearance progress for Maria Santos' })).toBeInTheDocument();
  });

  it('shows a held student as blocked with the signatory named', async () => {
    mocks.getClearancePeriodStudents.mockResolvedValue(page([{ ...STUDENT, signatures: [{ id: 1, required_role: 'adviser', status: 'held' }, { id: 2, required_role: 'sao', status: 'pending' }] }]));
    renderAt('/dashboard/super-admin/clearances?record=1', <SaoClearancesPage />);
    const drawer = await screen.findByRole('dialog', { name: 'Second Semester Clearance' });
    expect(await within(drawer).findByText('On hold by Adviser')).toBeInTheDocument();
  });

  it('says so when ?record= names a period that is gone', async () => {
    renderAt('/dashboard/super-admin/clearances?record=77', <SaoClearancesPage />);
    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalledWith('That clearance period no longer exists.'));
  });

  it('opens the roster from the View students button and keeps one New clearance period button', async () => {
    renderAt('/dashboard/super-admin/clearances', <SaoClearancesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'View students' }));
    expect(await screen.findByRole('dialog', { name: 'Second Semester Clearance' })).toBeInTheDocument();
  });

  it('puts the one New clearance period button in the empty state, not the header', async () => {
    mocks.getClearancePeriods.mockResolvedValue(page([]));
    renderAt('/dashboard/super-admin/clearances', <SaoClearancesPage />);
    expect(await screen.findByText('No clearance periods yet')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'New clearance period' })).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('has the New clearance period button in the header once a period exists', async () => {
    renderAt('/dashboard/super-admin/clearances', <SaoClearancesPage />);
    await screen.findByText('Second Semester Clearance');
    expect(screen.getAllByRole('button', { name: 'New clearance period' })).toHaveLength(1);
  });
});
