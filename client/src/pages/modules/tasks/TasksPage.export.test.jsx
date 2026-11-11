import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import TasksPage from './TasksPage';

const mocks = vi.hoisted(() => ({ getTasks: vi.fn(), getUsers: vi.fn(), getEvents: vi.fn(), getAcademicPeriods: vi.fn() }));
vi.mock('../../../services/taskService', () => ({ getTasks: mocks.getTasks, createTask: vi.fn(), previewTaskRecommendation: vi.fn(), updateTaskStatus: vi.fn(), updateTask: vi.fn(), deleteTask: vi.fn() }));
vi.mock('../../../lib/notify', () => ({ default: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock('../../../services/userService', () => ({ getUsers: mocks.getUsers }));
vi.mock('../../../services/eventService', () => ({ getEvents: mocks.getEvents }));
vi.mock('../../../services/systemAdministrationService', () => ({ getAcademicPeriods: mocks.getAcademicPeriods }));

const readBlob = (blob) => new Promise((resolve) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.readAsText(blob);
});

describe('TasksPage export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    mocks.getUsers.mockResolvedValue([]);
    mocks.getEvents.mockResolvedValue({ data: { data: [], total: 0, current_page: 1, last_page: 1, per_page: 10 } });
    mocks.getAcademicPeriods.mockResolvedValue([]);
    const formulaTask = { id: 9, title: '=1+1 QA formula', description: '@SUM(A1)', status: 'pending', priority: 'high', deadline: '2026-10-10' };
    mocks.getTasks.mockResolvedValue({ data: { data: [formulaTask], total: 1, current_page: 1, last_page: 1, per_page: 10 } });
  });

  it('writes a title that starts with = as text, never as a spreadsheet formula', async () => {
    const createObjectURL = vi.fn(() => 'blob:tasks');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    render(<MemoryRouter><TasksPage /></MemoryRouter>);
    await screen.findAllByText(/QA formula/);

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    const csv = await readBlob(createObjectURL.mock.calls[0][0]);
    expect(csv).toContain("'=1+1 QA formula");
    expect(csv).toContain("'@SUM(A1)");
    expect(csv).not.toMatch(/(^|,)"?=1\+1/m);
    vi.unstubAllGlobals();
  });
});
