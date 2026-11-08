import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProcessTracker from './ProcessTracker';

const mocks = vi.hoisted(() => ({ getProcessStatus: vi.fn() }));
vi.mock('../../services/processService', () => mocks);
vi.mock('../../hooks/useRefetchOnReturn', () => ({ useRefetchOnReturn: () => {} }));

const dean = {
  title: 'Setting up your college',
  complete: false,
  steps: [
    { key: 'staff-added', label: 'Office staff added', state: 'done', count: 2 },
    { key: 'records-loaded', label: 'Student records loaded', state: 'current', count: 0, action: { label: 'Load student records', path: '/dashboard/department-head/people' } },
    { key: 'students-allowed', label: 'Students allowed to apply', state: 'todo', count: 0 },
    { key: 'applications-reviewed', label: 'Applications reviewed', state: 'todo', count: 1, total: 3 },
  ],
};

const renderTracker = () => render(<MemoryRouter><ProcessTracker /></MemoryRouter>);

describe('ProcessTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProcessStatus.mockResolvedValue({ data: dean });
  });

  it('shows a loading placeholder, then the steps in order with the current one marked', async () => {
    renderTracker();
    expect(screen.getByRole('status', { name: 'Loading card' })).toBeInTheDocument();

    const list = await screen.findByRole('list', { name: 'Setting up your college' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Done: Office staff added2',
      'Current step: Student records loaded',
      'Upcoming: Students allowed to apply',
      'Upcoming: Applications reviewed1 of 3',
    ]);
    expect(items[1]).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('Step 2 of 4')).toBeInTheDocument();
  });

  it('offers one action for the current step and links to it', async () => {
    renderTracker();

    const link = await screen.findByRole('link', { name: 'Load student records' });
    expect(link).toHaveAttribute('href', '/dashboard/department-head/people');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByText('Next:')).toBeInTheDocument();
  });

  it('says it is waiting when the current step has no action for this person', async () => {
    mocks.getProcessStatus.mockResolvedValue({ data: {
      title: 'Your organization application',
      complete: false,
      steps: [
        { key: 'a', label: 'Allowed to apply', state: 'done' },
        { key: 'b', label: 'Application sent', state: 'done' },
        { key: 'c', label: 'Dean review', state: 'current', note: 'Returned by your Department Head. Update it and send it again.' },
      ],
    } });
    renderTracker();

    expect(await screen.findByText('Waiting on:')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText(/Returned by your Department Head/)).toBeInTheDocument();
  });

  it('leaves a zero total and a zero count out of the step', async () => {
    mocks.getProcessStatus.mockResolvedValue({ data: { title: 'Setting up your college', complete: false, steps: [
      { key: 'a', label: 'Office staff added', state: 'current', count: 0 },
      { key: 'b', label: 'Applications reviewed', state: 'todo', count: 0, total: 0 },
    ] } });
    renderTracker();

    const items = within(await screen.findByRole('list', { name: 'Setting up your college' })).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(['Current step: Office staff added', 'Upcoming: Applications reviewed']);
  });

  it('collapses to one quiet line once every step is done', async () => {
    mocks.getProcessStatus.mockResolvedValue({ data: { ...dean, complete: true, steps: dean.steps.map((step) => ({ ...step, state: 'done' })) } });
    renderTracker();

    expect(await screen.findByText('Setup complete')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('renders nothing when the person has no process to show', async () => {
    mocks.getProcessStatus.mockResolvedValue({ data: { title: null, complete: false, steps: [] } });
    const { container } = renderTracker();

    await waitFor(() => expect(mocks.getProcessStatus).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('reports a failed load with a retry that loads again', async () => {
    mocks.getProcessStatus.mockRejectedValueOnce(new Error('offline'));
    renderTracker();

    expect(await screen.findByRole('alert')).toHaveTextContent('could not load');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('list', { name: 'Setting up your college' })).toBeInTheDocument();
    expect(mocks.getProcessStatus).toHaveBeenCalledTimes(2);
  });

  it('lists each college behind a toggle for the SAO', async () => {
    mocks.getProcessStatus.mockResolvedValue({ data: {
      title: 'Setting up the colleges',
      complete: false,
      steps: [
        { key: 'dean-invited', label: 'Dean invited', state: 'done', count: 2, total: 2 },
        { key: 'dean-active', label: 'Dean active', state: 'current', count: 1, total: 2, action: { label: 'Open colleges', path: '/dashboard/super-admin/colleges' } },
      ],
      colleges: [
        { id: 1, name: 'College of Computing', complete: false, steps: [{ key: 'dean-invited', label: 'Dean invited', state: 'done' }, { key: 'dean-active', label: 'Dean active', state: 'done' }] },
        { id: 2, name: 'College of Arts', complete: false, steps: [{ key: 'dean-invited', label: 'Dean invited', state: 'done' }, { key: 'dean-active', label: 'Dean active', state: 'current', action: { label: 'Invite the Department Head', path: '/dashboard/super-admin/colleges' } }] },
      ],
    } });
    renderTracker();

    const toggle = await screen.findByRole('button', { name: /Show each college/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('College of Arts')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 2')).toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('College of Computing')).toBeInTheDocument();
    expect(screen.getByText('College of Arts')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'College of Arts setup progress' })).toHaveAttribute('aria-valuenow', '1');
    expect(screen.getByRole('link', { name: 'Invite the Department Head' })).toHaveAttribute('href', '/dashboard/super-admin/colleges');
  });
});
