import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import TasksPage from './TasksPage';

const mocks = vi.hoisted(() => ({ getTasks: vi.fn(), createTask: vi.fn(), previewTaskRecommendation: vi.fn(), updateTaskStatus: vi.fn(), updateTask: vi.fn(), deleteTask: vi.fn(), getUsers: vi.fn(), getEvents: vi.fn(), getAcademicPeriods: vi.fn() }));
vi.mock('../../../services/taskService', () => ({ getTasks: mocks.getTasks, createTask: mocks.createTask, previewTaskRecommendation: mocks.previewTaskRecommendation, updateTaskStatus: mocks.updateTaskStatus, updateTask: mocks.updateTask, deleteTask: mocks.deleteTask }));
vi.mock('../../../services/userService', () => ({ getUsers: mocks.getUsers }));
vi.mock('../../../services/eventService', () => ({ getEvents: mocks.getEvents }));
vi.mock('../../../services/systemAdministrationService', () => ({ getAcademicPeriods: mocks.getAcademicPeriods }));

const officer = { school_id: 'OFF-1', role: 'SBO_OFFICER', first_name: 'aNA', last_name: 'rEYES', position_title: 'sEcReTaRy' };
const tasks = [
  { id: 1, title: 'mONTHLY rECORDS', event_id: null, status: 'pending', priority: 'high', assigned_to: 'OFF-1', assignee: officer, deadline: '2026-10-10' },
  { id: 2, title: 'eVENT bRIEF', event_id: 7, status: 'completed', priority: 'low', assigned_to: 'OFF-1', assignee: officer, deadline: '2026-10-11' },
];
const envelope = (data, total = data.length) => ({ data: { data, total, current_page: 1, last_page: 1, per_page: 10 } });
const card = (label) => within(screen.getByText(label, { selector: 'p' }).closest('article'));

describe('TasksPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    mocks.getUsers.mockResolvedValue([officer]);
    mocks.getEvents.mockResolvedValue(envelope([{ id: 7, title: 'aNNUAL eVENT' }]));
    mocks.getAcademicPeriods.mockResolvedValue([]);
    mocks.getTasks.mockImplementation((params = {}) => Promise.resolve(envelope(tasks.filter((task) =>
      (!params.status || task.status === params.status)
      && (!params.task_kind || (params.task_kind === 'standalone' ? !task.event_id : Boolean(task.event_id)))
      && (!params.priority || task.priority === params.priority)
      && (!params.assigned_to || task.assigned_to === params.assigned_to)
      && (!params.event_id || String(task.event_id) === params.event_id)
      && (!params.deadline_from || task.deadline === params.deadline_from)
    ))));
  });

  it('includes both task types in officer assignments and formats their titles', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'SBO_OFFICER' }));
    render(<MemoryRouter><TasksPage /></MemoryRouter>);
    expect((await screen.findAllByText('Monthly Records')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Event Brief').length).toBeGreaterThan(0);
    expect(card('Total Tasks').getByText('2')).toBeInTheDocument();
    expect(card('Standalone').getByText('1')).toBeInTheDocument();
    expect(card('Event-Related').getByText('1')).toBeInTheDocument();
    expect(mocks.getUsers).not.toHaveBeenCalled();
  });

  it('uses server totals for summaries even when only one record is returned', async () => {
    mocks.getTasks.mockImplementation((params) => Promise.resolve(envelope([tasks[0]], params.per_page === 1
      ? ({ pending: 90, in_progress: 20, completed: 10, overdue: 3 }[params.status] ?? (params.task_kind === 'standalone' ? 100 : 23))
      : 123)));
    render(<MemoryRouter><TasksPage /></MemoryRouter>);
    await waitFor(() => expect(card('Total Tasks').getByText('123')).toBeInTheDocument());
    expect(card('Standalone').getByText('100')).toBeInTheDocument();
    expect(card('Event-Related').getByText('23')).toBeInTheDocument();
    expect(card('Pending').getByText('90')).toBeInTheDocument();
  });

  it('applies type and status filters to summaries as well as the board', async () => {
    render(<MemoryRouter><TasksPage /></MemoryRouter>);
    await screen.findAllByText('Monthly Records');
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    fireEvent.change(screen.getByLabelText('Filter tasks by type'), { target: { value: 'standalone' } });
    await waitFor(() => expect(card('Total Tasks').getByText('1')).toBeInTheDocument());
    expect(card('Event-Related').getByText('0')).toBeInTheDocument();
    expect(card('Completed').getByText('0')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filter tasks by status'), { target: { value: 'completed' } });
    await waitFor(() => expect(card('Total Tasks').getByText('0')).toBeInTheDocument());
    expect(card('Pending').getByText('0')).toBeInTheDocument();
    expect(await screen.findByText('No tasks found.')).toBeInTheDocument();
  });

  it('sends all selected filters to the count requests', async () => {
    mocks.getAcademicPeriods.mockResolvedValue([{ id: 8, status: 'active', number: 1, academic_year: { label: '2026-2027' } }]);
    render(<MemoryRouter><TasksPage /></MemoryRouter>);
    await screen.findAllByText('Monthly Records');
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    for (const [label, value] of [['assignee', 'OFF-1'], ['event', '7'], ['priority', 'high'], ['deadline', '2026-10-10']]) {
      fireEvent.change(screen.getByLabelText(`Filter tasks by ${label}`), { target: { value } });
    }
    fireEvent.change(screen.getByLabelText('Academic period'), { target: { value: '8' } });
    await waitFor(() => expect(mocks.getTasks).toHaveBeenCalledWith({ assigned_to: 'OFF-1', event_id: '7', priority: 'high', deadline_from: '2026-10-10', deadline_to: '2026-10-10', academic_semester_id: '8', status: 'pending', per_page: 1 }));
  });

  it('requires a final officer choice after recommendation and preserves entered text when saving', async () => {
    mocks.previewTaskRecommendation.mockResolvedValue({ data: { delegation: { rankings: [{ officer_id: 'OFF-1', name: 'aNA rEYES', position_title: 'sEcReTaRy', rank: 1, final_score: 95 }] } } });
    mocks.createTask.mockResolvedValue({ data: { id: 3, title: 'mIXED cASE tASK', assignee: officer } });
    render(<MemoryRouter><TasksPage initialTab="create" /></MemoryRouter>);
    await waitFor(() => expect(screen.queryByText('Officer positions must be configured first.')).not.toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Task Title *'), { target: { value: 'mIXED cASE tASK' } });
    fireEvent.change(screen.getByLabelText('Deadline *'), { target: { value: '2026-10-10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review officer recommendation' }));
    const choice = await screen.findByRole('button', { name: /Ana Reyes.*Secretary.*Recommended/ });
    expect(screen.getByRole('button', { name: 'Create Task' })).toBeDisabled();
    expect(mocks.createTask).not.toHaveBeenCalled();
    fireEvent.click(choice);
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));
    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'mIXED cASE tASK', assigned_to: 'OFF-1', task_kind: 'standalone', event_id: null, deadline: '2026-10-10' })));
  });

  describe('editing and deleting', () => {
    const renderBoard = async () => {
      render(<MemoryRouter><TasksPage /></MemoryRouter>);
      await screen.findAllByText('Monthly Records');
    };

    it('edits a task through the edit modal and reloads the board', async () => {
      mocks.updateTask.mockResolvedValue({ data: { id: 1 } });
      await renderBoard();
      fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
      const dialog = await screen.findByRole('dialog', { name: 'Edit task' });
      fireEvent.change(within(dialog).getByLabelText(/Task title/), { target: { value: 'Quarterly records' } });
      fireEvent.change(within(dialog).getByLabelText(/Priority/), { target: { value: 'critical' } });
      fireEvent.change(within(dialog).getByLabelText(/Deadline/), { target: { value: '2026-11-01' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

      await waitFor(() => expect(mocks.updateTask).toHaveBeenCalledWith(1, expect.objectContaining({ title: 'Quarterly records', priority: 'critical', deadline: '2026-11-01', task_kind: 'standalone', event_id: null })));
      expect(mocks.updateTask.mock.calls[0][1]).not.toHaveProperty('assigned_to');
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit task' })).not.toBeInTheDocument());
    });

    it('shows the server message when the edit is rejected', async () => {
      mocks.updateTask.mockRejectedValue({ response: { status: 422, data: { message: 'Tasks can only be assigned to active SBO Officers with an assigned position.' } } });
      await renderBoard();
      fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
      const dialog = await screen.findByRole('dialog', { name: 'Edit task' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('Tasks can only be assigned to active SBO Officers with an assigned position.');
    });

    it('deletes a task after confirmation and reloads the board', async () => {
      mocks.deleteTask.mockResolvedValue({ data: { message: 'Task deleted successfully.' } });
      await renderBoard();
      const loads = mocks.getTasks.mock.calls.length;
      fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
      const dialog = await screen.findByRole('dialog', { name: 'Delete this task?' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete task' }));

      await waitFor(() => expect(mocks.deleteTask).toHaveBeenCalledWith(1));
      await waitFor(() => expect(mocks.getTasks.mock.calls.length).toBeGreaterThan(loads));
    });

    it('shows the server message when the delete is refused', async () => {
      mocks.deleteTask.mockRejectedValue({ response: { status: 403, data: { message: 'You are not authorized to delete this task.' } } });
      await renderBoard();
      fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
      const dialog = await screen.findByRole('dialog', { name: 'Delete this task?' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete task' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('You are not authorized to delete this task.');
    });

    it('flags the empty title next to its field and focuses it', async () => {
      await renderBoard();
      fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
      const dialog = await screen.findByRole('dialog', { name: 'Edit task' });
      const title = within(dialog).getByLabelText(/Task title/);
      fireEvent.change(title, { target: { value: '' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

      expect(await within(dialog).findByText('Enter a task title.')).toBeInTheDocument();
      expect(title).toHaveAttribute('aria-invalid', 'true');
      await waitFor(() => expect(title).toHaveFocus());
      expect(mocks.updateTask).not.toHaveBeenCalled();
    });

    it('hides edit and delete from officers', async () => {
      localStorage.setItem('user', JSON.stringify({ role: 'SBO_OFFICER' }));
      await renderBoard();
      expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    });
  });

  it('reports summary failures', async () => {
    mocks.getTasks.mockImplementation((params) => params.per_page === 1 ? Promise.reject(new Error('Unavailable')) : Promise.resolve(envelope([])));
    render(<MemoryRouter><TasksPage /></MemoryRouter>);
    expect(await screen.findByText('Failed to load task summaries.')).toBeInTheDocument();
  });
});
