import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StudentGrievancesPage from './StudentGrievancesPage';
import OrganizationGrievancesPage from './OrganizationGrievancesPage';
import SaoGrievancesPage from './SaoGrievancesPage';
import { grievanceStageText } from './grievanceLabels';

const mocks = vi.hoisted(() => ({
  getGrievances: vi.fn(),
  getGrievance: vi.fn(),
  createGrievance: vi.fn(),
  deleteGrievance: vi.fn(),
  updateGrievanceStatus: vi.fn(),
  notifyError: vi.fn(),
}));

vi.mock('../../../services/grievanceService', () => ({
  getGrievances: mocks.getGrievances,
  getGrievance: mocks.getGrievance,
  createGrievance: mocks.createGrievance,
  deleteGrievance: mocks.deleteGrievance,
  updateGrievanceStatus: mocks.updateGrievanceStatus,
}));

vi.mock('../../../lib/notify', () => ({ default: { success: vi.fn(), error: mocks.notifyError } }));

const BASE = {
  description: 'Detail.',
  urgency: 'Low',
  category: 'General',
  classification_engine: 'php-fallback',
  created_at: new Date().toISOString(),
  submitted_by: 9,
  submitter: { first_name: 'Ana', last_name: 'Cruz' },
  is_anonymous: false,
  remarks: null,
};
const TO_ORG = { ...BASE, id: 1, title: 'Broken lock', organization_id: 4, status: 'submitted' };
const TO_SAO = { ...BASE, id: 2, title: 'Noisy lab', organization_id: null, status: 'submitted' };

function envelope(data) {
  return { data: { data, current_page: 1, last_page: 1, per_page: 20, total: data.length } };
}

function renderAt(entry, element) {
  return render(<MemoryRouter initialEntries={[entry]}>{element}</MemoryRouter>);
}

describe('grievance stage text', () => {
  it('names who is reviewing, for each status and recipient', () => {
    expect(grievanceStageText(TO_ORG)).toBe('Waiting for Admin to review');
    expect(grievanceStageText(TO_SAO)).toBe('Waiting for SAO to review');
    expect(grievanceStageText({ ...TO_ORG, status: 'under_review' })).toBe('Under review by Admin');
    expect(grievanceStageText({ ...TO_SAO, status: 'under_review' })).toBe('Under review by SAO');
    expect(grievanceStageText({ ...TO_ORG, status: 'resolved' })).toBe('Resolved');
    expect(grievanceStageText({ ...TO_ORG, status: 'dismissed' })).toBe('Dismissed');
  });
});

describe('grievance lists and details', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getGrievances.mockResolvedValue(envelope([TO_SAO]));
  });

  it('prints the same stage sentence on the student row and the SAO row', async () => {
    const student = renderAt('/dashboard/my-grievances', <StudentGrievancesPage />);
    fireEvent.click(screen.getByRole('tab', { name: /My grievances/ }));
    expect(await screen.findByText('Waiting for SAO to review')).toBeInTheDocument();
    student.unmount();

    renderAt('/dashboard/super-admin/grievances', <SaoGrievancesPage />);
    const row = (await screen.findAllByText('Noisy Lab')).map((node) => node.closest('tr')).find(Boolean);
    expect(within(row).getByText('Waiting for SAO to review')).toBeInTheDocument();
  });

  it('shows the student one step per stage with the current one marked', async () => {
    renderAt('/dashboard/my-grievances', <StudentGrievancesPage />);
    fireEvent.click(screen.getByRole('tab', { name: /My grievances/ }));
    const stepper = await screen.findByRole('list', { name: 'Progress of Noisy Lab' });
    expect(within(stepper).getAllByRole('listitem')).toHaveLength(3);
    expect(within(stepper).getByText('Under review')).toBeInTheDocument();
  });

  it('opens the student on their own list with the named grievance when ?record= is set', async () => {
    mocks.getGrievances.mockResolvedValue(envelope([TO_ORG, TO_SAO]));
    renderAt('/dashboard/my-grievances?record=2', <StudentGrievancesPage />);
    expect(await screen.findByRole('tab', { selected: true })).toHaveTextContent('My grievances');
    await waitFor(() => expect(document.getElementById('grievance-2')).not.toBeNull());
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it('says so when ?record= names a grievance the student does not have', async () => {
    renderAt('/dashboard/my-grievances?record=99', <StudentGrievancesPage />);
    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalledWith('That grievance is not in your list.'));
  });

  it('gives the student a first-run state with the button to file one', async () => {
    mocks.getGrievances.mockResolvedValue({ data: { data: [] } });
    renderAt('/dashboard/my-grievances', <StudentGrievancesPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'My grievances' }));
    expect(await screen.findByText('No grievances filed')).toBeInTheDocument();
    expect(screen.getByText(/If something went wrong, file one here/)).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: 'File a grievance' });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    expect(await screen.findByRole('button', { name: 'File this grievance' })).toBeInTheDocument();
  });

  it('puts the one primary File a grievance button in the header once there are rows', async () => {
    renderAt('/dashboard/my-grievances', <StudentGrievancesPage />);
    fireEvent.click(screen.getByRole('tab', { name: /My grievances/ }));
    await screen.findByText('Noisy Lab');
    expect(screen.getAllByRole('button', { name: 'File a grievance' })).toHaveLength(1);
  });

  it('opens the Admin drawer from ?record= by fetching the one grievance, with the stage and an action callout', async () => {
    mocks.getGrievances.mockResolvedValue(envelope([]));
    mocks.getGrievance.mockResolvedValue({ data: TO_ORG });
    renderAt('/dashboard/grievances?record=1', <OrganizationGrievancesPage />);
    const drawer = await screen.findByRole('dialog', { name: 'Broken Lock' });
    expect(mocks.getGrievance).toHaveBeenCalledWith('1');
    expect(within(drawer).getByRole('list', { name: 'Grievance progress' })).toBeInTheDocument();
    expect(within(drawer).getByText('Review this grievance')).toBeInTheDocument();
    expect(within(drawer).getByText('Owner: Admin')).toBeInTheDocument();
  });

  it('shows the SAO the turn of the Admin on an organization grievance it can still decide', async () => {
    mocks.getGrievances.mockResolvedValue(envelope([]));
    mocks.getGrievance.mockResolvedValue({ data: { ...TO_ORG, status: 'under_review' } });
    renderAt('/dashboard/super-admin/grievances?record=1', <SaoGrievancesPage />);
    const drawer = await screen.findByRole('dialog', { name: 'Broken Lock' });
    expect(within(drawer).getByText('Decide: resolve or dismiss')).toBeInTheDocument();
  });

  it('shows a closed grievance as done with no pending action', async () => {
    mocks.getGrievances.mockResolvedValue(envelope([]));
    mocks.getGrievance.mockResolvedValue({ data: { ...TO_SAO, status: 'resolved', remarks: 'Fixed.' } });
    renderAt('/dashboard/super-admin/grievances?record=2', <SaoGrievancesPage />);
    const drawer = await screen.findByRole('dialog', { name: 'Noisy Lab' });
    expect(within(drawer).getAllByText('Resolved').length).toBeGreaterThan(0);
    expect(within(drawer).getByText('This grievance is closed and cannot be reopened.')).toBeInTheDocument();
  });

  it('closes the drawer and says so when ?record= names a grievance that cannot be fetched', async () => {
    mocks.getGrievances.mockResolvedValue(envelope([]));
    mocks.getGrievance.mockRejectedValue({ response: { status: 404 } });
    renderAt('/dashboard/grievances?record=77', <OrganizationGrievancesPage />);
    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalledWith('That grievance is not available to you.'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('tells an organization admin who sends grievances, and offers a way out of a filtered empty list', async () => {
    mocks.getGrievances.mockResolvedValue(envelope([]));
    renderAt('/dashboard/grievances', <OrganizationGrievancesPage />);
    expect(await screen.findByText('Nothing to review')).toBeInTheDocument();
    expect(screen.getByText(/Students of your organization file confidential grievances/)).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by status' }), { target: { value: 'resolved' } });
    expect(await screen.findByText('No grievances match these filters')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);
    expect(await screen.findByText('Nothing to review')).toBeInTheDocument();
  });

  it.each([
    ['student', '/dashboard/my-grievances', <StudentGrievancesPage key="s" />],
    ['organization', '/dashboard/grievances', <OrganizationGrievancesPage key="o" />],
    ['SAO', '/dashboard/super-admin/grievances', <SaoGrievancesPage key="a" />],
  ])('renders exactly one h1 on the %s page', async (_name, entry, element) => {
    mocks.getGrievances.mockResolvedValue(envelope([]));
    renderAt(entry, element);
    await screen.findAllByRole('heading', { level: 1 });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});
