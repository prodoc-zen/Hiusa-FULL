import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StudentRecordsPanel from './StudentRecordsPanel';

const mocks = vi.hoisted(() => ({
  getStudentRegistry: vi.fn(),
  previewStudentRegistry: vi.fn(),
  applyStudentRegistry: vi.fn(),
}));

vi.mock('../../services/studentRegistryService', () => mocks);

const entry = (overrides) => ({
  id: 1, school_id: 2600101, name: 'Hannah Reyes', college: { id: 1, name: 'College of Computer Studies', code: 'CCS' },
  program: 'BS Information Technology', year_level: '1st Year', section: 'A', claimed: false, claimed_at: null, ...overrides,
});

const list = (rows, summary = { total: rows.length, claimed: rows.filter((row) => row.claimed).length }) => ({ data: rows, total: rows.length, summary });

const previewResult = {
  hash: 'h'.repeat(64),
  preview_token: 'token',
  counts: { created: 1, updated: 0, unchanged: 0, claimed: 0, invalid: 1, duplicate: 0 },
  truncated: false,
  rows: [
    { line: 2, school_id: '2600102', first_name: 'Ben', last_name: 'Tan', program: 'BS IT', year_level: '2nd Year', section: '', college_code: 'CCS', status: 'new', reason: '' },
    { line: 3, school_id: 'abc', first_name: 'Cy', last_name: 'Uy', program: 'BS IT', year_level: '1', section: '', college_code: 'CCS', status: 'invalid', reason: 'School ID must contain 1 to 8 digits.' },
  ],
};

const csv = () => new File(['x'], 'records.csv', { type: 'text/csv' });

describe('StudentRecordsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getStudentRegistry.mockResolvedValue(list([entry(), entry({ id: 2, school_id: 2600102, name: 'Ben Tan', claimed: true })]));
    mocks.previewStudentRegistry.mockResolvedValue(previewResult);
    mocks.applyStudentRegistry.mockResolvedValue({ created: 1, updated: 0, unchanged: 0, claimed: 0, invalid: 1, duplicate: 0 });
  });

  it('shows who has signed up and who has not, with the school ID as small secondary text', async () => {
    render(<StudentRecordsPanel />);

    expect((await screen.findAllByText('Hannah Reyes')).length).toBeGreaterThan(0);
    expect(screen.getByText('1 of 2 have signed up.')).toBeInTheDocument();
    expect(screen.getAllByText('Signed up').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Not yet').length).toBeGreaterThan(0);
    expect(screen.getAllByText('ID 2600101').length).toBeGreaterThan(0);
    expect(mocks.getStudentRegistry).toHaveBeenCalledWith({ page: 1, per_page: 20 });
  });

  it('shows a loading state first', () => {
    mocks.getStudentRegistry.mockReturnValue(new Promise(() => {}));
    render(<StudentRecordsPanel />);

    expect(screen.getByRole('status', { name: 'Loading table' })).toBeInTheDocument();
  });

  it('shows an error with a retry that loads again', async () => {
    mocks.getStudentRegistry.mockRejectedValueOnce(Object.assign(new Error('x'), { response: { status: 500, data: {} } }));
    render(<StudentRecordsPanel />);

    expect(await screen.findByText('The student records could not be loaded.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect((await screen.findAllByText('Hannah Reyes')).length).toBeGreaterThan(0);
  });

  it('shows an empty state that points at the upload', async () => {
    mocks.getStudentRegistry.mockResolvedValue(list([]));
    render(<StudentRecordsPanel />);

    expect(await screen.findByText('No student records yet')).toBeInTheDocument();
    expect(screen.getByText('No records loaded yet.')).toBeInTheDocument();
  });

  it('searches by name after a short pause and shows the filtered empty state', async () => {
    render(<StudentRecordsPanel />);
    await screen.findAllByText('Hannah Reyes');

    mocks.getStudentRegistry.mockResolvedValue(list([], { total: 2, claimed: 1 }));
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'zzz' } });

    await waitFor(() => expect(mocks.getStudentRegistry).toHaveBeenLastCalledWith({ page: 1, per_page: 20, q: 'zzz' }));
    expect(await screen.findByText('No results')).toBeInTheDocument();
  });

  it('scopes the list to one college and drops the college column and code', async () => {
    render(<StudentRecordsPanel collegeId={4} />);

    await screen.findAllByText('Hannah Reyes');
    expect(mocks.getStudentRegistry).toHaveBeenCalledWith({ page: 1, per_page: 20, college_id: 4 });
    expect(screen.queryByRole('columnheader', { name: 'College' })).not.toBeInTheDocument();
    expect(screen.getByText(/birth_date, program, year_level/)).toBeInTheDocument();
    expect(screen.queryByText(/college_code/)).not.toBeInTheDocument();
  });

  it('checks a file first, then saves it only after the person confirms', async () => {
    render(<StudentRecordsPanel />);
    await screen.findAllByText('Hannah Reyes');

    const checkButton = screen.getByRole('button', { name: 'Check file' });
    expect(checkButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [csv()] } });
    fireEvent.click(checkButton);

    expect(await screen.findByText('1 new, 0 to update, 0 left as they are, 1 need fixing.')).toBeInTheDocument();
    expect(screen.getAllByText('School ID must contain 1 to 8 digits.').length).toBeGreaterThan(0);
    expect(mocks.applyStudentRegistry).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Save 1 record' }));

    expect(await screen.findByText('Saved: 1 added, 0 updated. 1 rows were skipped.')).toBeInTheDocument();
    expect(mocks.applyStudentRegistry).toHaveBeenCalledWith(expect.any(File), previewResult.hash, 'token');
    await waitFor(() => expect(mocks.getStudentRegistry).toHaveBeenCalledTimes(2));
  });

  it('shows the server reason when a file cannot be read', async () => {
    mocks.previewStudentRegistry.mockRejectedValue(Object.assign(new Error('x'), { response: { status: 422, data: { errors: { file: ['Columns must be: school_id, first_name.'] } } } }));
    render(<StudentRecordsPanel />);
    await screen.findAllByText('Hannah Reyes');

    fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [csv()] } });
    fireEvent.click(screen.getByRole('button', { name: 'Check file' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Columns must be: school_id, first_name.');
  });

  it('does not offer to save a file with nothing to save', async () => {
    mocks.previewStudentRegistry.mockResolvedValue({ ...previewResult, counts: { created: 0, updated: 0, unchanged: 2, claimed: 0, invalid: 0, duplicate: 0 } });
    render(<StudentRecordsPanel />);
    await screen.findAllByText('Hannah Reyes');

    fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [csv()] } });
    fireEvent.click(screen.getByRole('button', { name: 'Check file' }));

    expect(await screen.findByRole('button', { name: 'Nothing to save' })).toBeDisabled();
  });
});
