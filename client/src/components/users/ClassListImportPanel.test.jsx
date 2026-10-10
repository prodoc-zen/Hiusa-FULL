import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ClassListImportPanel from './ClassListImportPanel';

const service = vi.hoisted(() => ({ previewClassList: vi.fn(), applyClassList: vi.fn() }));
vi.mock('../../services/userService', () => service);

describe('ClassListImportPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.previewClassList.mockResolvedValue({ hash: 'abc', preview_token: 'token123', rows: [
      { line: 2, school_id: '1234', first_name: 'New', last_name: 'Student', program: 'BSIT', year_level: '1st Year', section: '1-A', status: 'new' },
      { line: 3, school_id: '3456', program: 'BSIT', year_level: '1st Year', section: '1-A', status: 'invalid', reason: 'No email' },
    ] });
    service.applyClassList.mockResolvedValue({ created: 1, updated: 0, unchanged: 0, invalid: 1, duplicate: 0 });
  });

  it('tells the admin that imported students must set their own password at first sign-in', () => {
    render(<ClassListImportPanel />);

    expect(screen.getByText(/Each student must set their own password at first sign-in\./)).toBeInTheDocument();
  });

  it('previews classifications, confirms only valid rows, and displays results', async () => {
    render(<ClassListImportPanel />);
    const file = new File(['school_id,program,year_level,section\n'], 'students.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText('Choose class list'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText('New account: 1')).toBeInTheDocument();
    expect(screen.getByText('Invalid: 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /confirm and apply 1 rows/i }));
    await waitFor(() => expect(service.applyClassList).toHaveBeenCalledWith(file, 'abc', 'token123'));
    expect(await screen.findByRole('status')).toHaveTextContent('1 created');
  });

  it('shows file validation errors from the API', async () => {
    service.previewClassList.mockRejectedValue({ response: { data: { errors: { file: ['Required columns are missing.'] } } } });
    render(<ClassListImportPanel />);
    fireEvent.change(screen.getByLabelText('Choose class list'), { target: { files: [new File(['bad'], 'bad.csv')] } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Required columns are missing.');
  });
});
