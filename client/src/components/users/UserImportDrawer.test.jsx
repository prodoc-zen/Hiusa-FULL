import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UserImportDrawer from './UserImportDrawer';
import { importUsers } from '../../services/userService';

vi.mock('../../services/userService', () => ({ importUsers: vi.fn() }));
vi.mock('../../lib/notify', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const roster = new File(['school_id,first_name,last_name,email,role\n'], 'roster.csv', { type: 'text/csv' });

function chooseFile() {
  fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [roster] } });
}

describe('UserImportDrawer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('checks the file first and lists every row that needs fixing', async () => {
    vi.mocked(importUsers).mockResolvedValue({
      imported: false,
      summary: { total: 2, ready: 1, invalid: 1 },
      rows: [
        { row: 2, name: 'Ana Reyes', status: 'ready', errors: [] },
        { row: 3, name: 'Ben Cruz', status: 'error', errors: ['The email ana@example.com is also on row 2.'] },
      ],
    });
    render(<UserImportDrawer open onClose={vi.fn()} onImported={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Check file' })).toBeDisabled();
    chooseFile();
    fireEvent.click(screen.getByRole('button', { name: 'Check file' }));

    expect(await screen.findByText(/1 of 2 rows need fixing/)).toBeInTheDocument();
    expect(screen.getByText('Row 3: Ben Cruz')).toBeInTheDocument();
    expect(screen.getByText('The email ana@example.com is also on row 2.')).toBeInTheDocument();
    expect(importUsers).toHaveBeenCalledWith(roster, true);
    expect(screen.queryByRole('button', { name: /^Import/ })).not.toBeInTheDocument();
  });

  it('imports a clean file only after it has been checked', async () => {
    const onImported = vi.fn();
    vi.mocked(importUsers)
      .mockResolvedValueOnce({ imported: false, summary: { total: 2, ready: 2, invalid: 0 }, rows: [] })
      .mockResolvedValueOnce({ imported: true, summary: { total: 2, ready: 2, invalid: 0 }, rows: [] });
    render(<UserImportDrawer open onClose={vi.fn()} onImported={onImported} />);

    chooseFile();
    fireEvent.click(screen.getByRole('button', { name: 'Check file' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Import 2 members' }));

    await vi.waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(importUsers).toHaveBeenLastCalledWith(roster, false);
  });

  it('shows why a file was refused outright', async () => {
    vi.mocked(importUsers).mockRejectedValue({ response: { status: 422, data: { message: 'The first row must name the columns, including school_id, first_name, last_name, email and role.' } } });
    render(<UserImportDrawer open onClose={vi.fn()} onImported={vi.fn()} />);

    chooseFile();
    fireEvent.click(screen.getByRole('button', { name: 'Check file' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The first row must name the columns');
  });
});
