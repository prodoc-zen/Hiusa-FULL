import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StudentRecordsPanel from './StudentRecordsPanel';

const mocks = vi.hoisted(() => ({
  getStudentRegistry: vi.fn(),
  previewStudentRegistry: vi.fn(),
  applyStudentRegistry: vi.fn(),
  updateStudentRegistryEntry: vi.fn(),
  deleteStudentRegistryEntry: vi.fn(),
}));

const notifyMocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('../../services/studentRegistryService', () => mocks);
vi.mock('../../lib/notify', () => ({ default: notifyMocks }));

const entry = (overrides) => ({
  id: 1, school_id: 2600101, name: 'Hannah Reyes', first_name: 'Hannah', last_name: 'Reyes', college: { id: 1, name: 'College of Computer Studies', code: 'CCS' },
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
    expect(mocks.getStudentRegistry).toHaveBeenCalledWith({ page: 1, per_page: 20, record_type: 'student' });
  });

  it('shows each birth date as a long date, with a dash when a record has none, in the table and the mobile cards', async () => {
    mocks.getStudentRegistry.mockResolvedValue(list([
      entry({ birth_date: '2004-03-05' }),
      entry({ id: 2, school_id: 2600102, name: 'Ben Tan', birth_date: null }),
    ]));
    render(<StudentRecordsPanel />);

    expect(await screen.findByRole('columnheader', { name: 'Birth date' })).toBeInTheDocument();
    expect(screen.getAllByText('March 5, 2004')).toHaveLength(2);
    expect(screen.getAllByText('-').length).toBeGreaterThan(0);
    expect(document.querySelector('[data-view="cards"]')).toHaveTextContent('Birth dateMarch 5, 2004');
  });

  it('adds no Birth date column to a college view', async () => {
    mocks.getStudentRegistry.mockResolvedValue(list([entry()]));
    render(<StudentRecordsPanel collegeId={4} />);

    expect((await screen.findAllByText('Hannah Reyes')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('columnheader', { name: 'Birth date' })).not.toBeInTheDocument();
  });

  it('leaves empty values blank instead of writing None', async () => {
    mocks.getStudentRegistry.mockResolvedValue(list([entry({ program: null, year_level: null, section: null })]));
    render(<StudentRecordsPanel collegeId={4} />);

    expect((await screen.findAllByText('Hannah Reyes')).length).toBeGreaterThan(0);
    expect(screen.queryByText('None')).not.toBeInTheDocument();
  });

  it('clears the search and the account filter from one Clear link', async () => {
    render(<StudentRecordsPanel />);
    await screen.findAllByText('Hannah Reyes');
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Account'), { target: { value: 'claimed' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Clear' }));

    expect(screen.getByLabelText('Account')).toHaveValue('');
    await waitFor(() => expect(mocks.getStudentRegistry).toHaveBeenLastCalledWith({ page: 1, per_page: 20, record_type: 'student' }));
  });

  it('switches to the employee records, which show a position instead of a program', async () => {
    mocks.getStudentRegistry.mockImplementation(({ record_type: type }) => Promise.resolve(type === 'employee'
      ? list([entry({ id: 9, school_id: 7100101, name: 'Marites Dizon', record_type: 'employee', position: 'Department Secretary', program: null, year_level: null, section: null })])
      : list([entry()])));
    render(<StudentRecordsPanel collegeId={4} />);
    await screen.findAllByText('Hannah Reyes');

    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'employee' } });

    expect((await screen.findAllByText('Marites Dizon')).length).toBeGreaterThan(0);
    expect(mocks.getStudentRegistry).toHaveBeenLastCalledWith({ page: 1, per_page: 20, record_type: 'employee', college_id: 4 });
    expect(screen.getByRole('columnheader', { name: 'Position' })).toBeInTheDocument();
    expect(screen.getAllByText('Department Secretary').length).toBeGreaterThan(0);
    expect(screen.getAllByText('ID 7100101').length).toBeGreaterThan(0);
    expect(screen.queryByText('Hannah Reyes')).not.toBeInTheDocument();
  });

  it('says there are no employee records yet and points at the record_type column', async () => {
    mocks.getStudentRegistry.mockResolvedValue(list([]));
    render(<StudentRecordsPanel collegeId={4} />);
    await screen.findByText('No student records yet');

    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'employee' } });

    expect(await screen.findByText('No employee records yet')).toBeInTheDocument();
    expect(screen.getByText(/record_type set to employee/)).toBeInTheDocument();
  });

  it('shows the position of employee rows in the file check', async () => {
    mocks.previewStudentRegistry.mockResolvedValue({
      ...previewResult,
      rows: [{ line: 2, school_id: '7100101', first_name: 'Marites', last_name: 'Dizon', record_type: 'employee', position: 'Department Secretary', program: '', year_level: '', section: '', status: 'new', reason: '' }],
      counts: { created: 1, updated: 0, unchanged: 0, claimed: 0, invalid: 0, duplicate: 0 },
    });
    render(<StudentRecordsPanel collegeId={4} />);
    await screen.findAllByText('Hannah Reyes');

    fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [csv()] } });
    fireEvent.click(screen.getByRole('button', { name: 'Check file' }));

    expect((await screen.findAllByText('Department Secretary')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Line 2, ID 7100101').length).toBeGreaterThan(0);
  });

  it('offers Edit and Remove only on records with no account behind them', async () => {
    render(<StudentRecordsPanel />);
    await screen.findAllByText('Hannah Reyes');

    expect(screen.getAllByRole('button', { name: 'Edit Hannah Reyes' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Remove Hannah Reyes' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Edit Ben Tan' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Ben Tan' })).not.toBeInTheDocument();
  });

  it('removes a record only after the person confirms, then reloads the list', async () => {
    mocks.deleteStudentRegistryEntry.mockResolvedValue(undefined);
    render(<StudentRecordsPanel />);
    await screen.findAllByText('Hannah Reyes');

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove Hannah Reyes' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Remove this record?' });
    expect(within(dialog).getByText(/Hannah Reyes/)).toBeInTheDocument();
    expect(mocks.deleteStudentRegistryEntry).not.toHaveBeenCalled();

    mocks.getStudentRegistry.mockClear();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove record' }));

    await waitFor(() => expect(mocks.deleteStudentRegistryEntry).toHaveBeenCalledWith(1));
    await waitFor(() => expect(mocks.getStudentRegistry).toHaveBeenCalled());
    expect(notifyMocks.success).toHaveBeenCalledWith('Record removed.');
    expect(screen.queryByRole('dialog', { name: 'Remove this record?' })).not.toBeInTheDocument();
  });

  it('shows the reason when the server refuses a removal and keeps the record', async () => {
    mocks.deleteStudentRegistryEntry.mockRejectedValue({ response: { status: 409, data: { message: 'This record is tied to an account, so it cannot be changed here.' } } });
    render(<StudentRecordsPanel />);
    await screen.findAllByText('Hannah Reyes');

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove Hannah Reyes' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Remove this record?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove record' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This record is tied to an account, so it cannot be changed here.');
    expect(notifyMocks.success).not.toHaveBeenCalled();
  });

  it('corrects a name and birth date from a filled form and reloads the list', async () => {
    mocks.updateStudentRegistryEntry.mockResolvedValue({});
    mocks.getStudentRegistry.mockResolvedValue(list([entry({ birth_date: '2007-01-02' })]));
    render(<StudentRecordsPanel />);
    await screen.findAllByText('Hannah Reyes');

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit Hannah Reyes' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Correct this record' });
    expect(within(dialog).getByLabelText('First name')).toHaveValue('Hannah');
    expect(within(dialog).getByLabelText('Birth date')).toHaveValue('2007-01-02');
    expect(within(dialog).getByRole('button', { name: 'Save changes' })).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText('Last name'), { target: { value: 'Reyes-Lim' } });
    fireEvent.change(within(dialog).getByLabelText('Birth date'), { target: { value: '2007-03-04' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mocks.updateStudentRegistryEntry).toHaveBeenCalledWith(1, { first_name: 'Hannah', last_name: 'Reyes-Lim', birth_date: '2007-03-04' }));
    expect(notifyMocks.success).toHaveBeenCalledWith('Record corrected.');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Correct this record' })).not.toBeInTheDocument());
  });

  it('lets a dean fix a name without retyping a birth date they cannot see', async () => {
    mocks.updateStudentRegistryEntry.mockResolvedValue({});
    render(<StudentRecordsPanel collegeId={4} />);
    await screen.findAllByText('Hannah Reyes');

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit Hannah Reyes' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Correct this record' });
    expect(within(dialog).getByLabelText('Birth date')).toHaveValue('');
    expect(within(dialog).getByText('Leave blank to keep the birth date on record.')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('First name'), { target: { value: 'Hanna' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mocks.updateStudentRegistryEntry).toHaveBeenCalledWith(1, { first_name: 'Hanna', last_name: 'Reyes' }));
  });

  it('shows why a correction failed and keeps the form open', async () => {
    mocks.getStudentRegistry.mockResolvedValue(list([entry({ birth_date: '2007-01-02' })]));
    mocks.updateStudentRegistryEntry.mockRejectedValue({ response: { status: 422, data: { message: 'x', errors: { birth_date: ['The birth date field must be a date before today.'] } } } });
    render(<StudentRecordsPanel />);
    await screen.findAllByText('Hannah Reyes');

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit Hannah Reyes' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Correct this record' });
    fireEvent.change(within(dialog).getByLabelText('Birth date'), { target: { value: '2999-01-01' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('before today');
    expect(within(dialog).getByLabelText('Birth date')).toHaveValue('2999-01-01');
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

    await waitFor(() => expect(mocks.getStudentRegistry).toHaveBeenLastCalledWith({ page: 1, per_page: 20, record_type: 'student', q: 'zzz' }));
    expect(await screen.findByText('No results')).toBeInTheDocument();
  });

  it('scopes the list to one college and drops the college column and code', async () => {
    render(<StudentRecordsPanel collegeId={4} />);

    await screen.findAllByText('Hannah Reyes');
    expect(mocks.getStudentRegistry).toHaveBeenCalledWith({ page: 1, per_page: 20, record_type: 'student', college_id: 4 });
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
