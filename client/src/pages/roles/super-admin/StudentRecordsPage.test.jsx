import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StudentRecordsPage from './StudentRecordsPage';

const mocks = vi.hoisted(() => ({
  getStudentRegistry: vi.fn(),
  previewStudentRegistry: vi.fn(),
  applyStudentRegistry: vi.fn(),
}));

vi.mock('../../../services/studentRegistryService', () => mocks);

describe('StudentRecordsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'SUPER_ADMIN' }));
    mocks.getStudentRegistry.mockResolvedValue({ data: [], total: 0, summary: { total: 0, claimed: 0 } });
  });

  it('has one upload card and one records table under a Student records heading', async () => {
    render(<MemoryRouter initialEntries={['/dashboard/super-admin/student-records']}><StudentRecordsPage /></MemoryRouter>);

    expect(screen.getByRole('heading', { level: 1, name: 'Student records' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Upload school records' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Student records' })).toBeInTheDocument();
    expect(await screen.findByText('No student records yet')).toBeInTheDocument();
  });
});
