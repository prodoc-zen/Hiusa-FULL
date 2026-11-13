import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ElectionReportsMenu from './ElectionReportsMenu';

const mocks = vi.hoisted(() => ({
  getElectionReport: vi.fn(),
  electionReportPdfUrl: vi.fn((id, type) => `/elections/${id}/reports/${type}?format=pdf`),
  openProtectedFile: vi.fn(),
  workbook: { columns: null, rows: [], name: null, written: false },
}));

vi.mock('../../services/electionService', () => ({
  getElectionReport: mocks.getElectionReport,
  electionReportPdfUrl: mocks.electionReportPdfUrl,
}));
vi.mock('../../utils/openProtectedFile', () => ({ openProtectedFile: mocks.openProtectedFile }));
vi.mock('exceljs', () => ({
  default: {
    Workbook: class {
      addWorksheet(name) {
        mocks.workbook.name = name;
        const sheet = {
          getRow: () => ({}),
          addRow: (row) => mocks.workbook.rows.push(row),
          set columns(value) { mocks.workbook.columns = value; },
        };
        return sheet;
      }

      get xlsx() {
        return { writeBuffer: async () => { mocks.workbook.written = true; return new ArrayBuffer(8); } };
      }
    },
  },
}));

const election = { id: 5, title: 'SBO Election 2026' };
const REPORTS = ['Official candidates', 'Candidacy screening', 'Party lists', 'Voter participation', 'Canvassing of votes', 'Election results', 'Audit trail'];

function open() {
  fireEvent.click(screen.getByRole('button', { name: 'Reports' }));
}

describe('ElectionReportsMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.workbook.rows = [];
    mocks.workbook.columns = null;
    mocks.workbook.written = false;
    URL.createObjectURL = vi.fn(() => 'blob:report');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => vi.restoreAllMocks());

  it.each(['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD'])('shows the Reports button to %s', (role) => {
    render(<ElectionReportsMenu election={election} role={role} />);

    expect(screen.getByRole('button', { name: 'Reports' })).toBeInTheDocument();
  });

  it.each(['STUDENT', undefined])('is hidden for %s', (role) => {
    const { container } = render(<ElectionReportsMenu election={election} role={role} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('lists the seven reports, each with PDF and Excel', () => {
    render(<ElectionReportsMenu election={election} role="ADMIN" />);
    expect(screen.queryByText('Election results')).not.toBeInTheDocument();

    open();

    for (const label of REPORTS) {
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: `${label} as PDF` })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: `${label} as Excel` })).toBeInTheDocument();
    }
  });

  it('opens the PDF through the protected file opener', async () => {
    mocks.openProtectedFile.mockResolvedValue(undefined);
    render(<ElectionReportsMenu election={election} role="ADMIN" />);
    open();

    fireEvent.click(screen.getByRole('button', { name: 'Election results as PDF' }));

    await waitFor(() => expect(mocks.openProtectedFile).toHaveBeenCalledWith('/elections/5/reports/results?format=pdf'));
    expect(mocks.electionReportPdfUrl).toHaveBeenCalledWith(5, 'results');
  });

  it('fetches the rows and builds one sheet named after the election and report', async () => {
    mocks.getElectionReport.mockResolvedValue({
      title: 'Official candidates',
      columns: ['Position', 'Candidate', 'Party list'],
      rows: [['President', 'Alice Alpha', 'Unity'], ['Treasurer', 'Bob Beta', null]],
    });
    const created = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const element = realCreate(tag);
      if (tag === 'a') {
        element.click = vi.fn();
        created.push(element);
      }
      return element;
    });
    render(<ElectionReportsMenu election={election} role="DEPARTMENT_HEAD" />);
    open();

    fireEvent.click(screen.getByRole('button', { name: 'Official candidates as Excel' }));

    await waitFor(() => expect(mocks.workbook.written).toBe(true));
    expect(mocks.getElectionReport).toHaveBeenCalledWith(5, 'candidates');
    expect(mocks.workbook.columns.map((column) => column.header)).toEqual(['Position', 'Candidate', 'Party list']);
    expect(mocks.workbook.rows).toEqual([['President', 'Alice Alpha', 'Unity'], ['Treasurer', 'Bob Beta', '']]);
    await waitFor(() => expect(created[0].download).toBe('SBO Election 2026 - Official candidates.xlsx'));
    expect(created[0].click).toHaveBeenCalled();
  });

  it('says so when a report cannot be loaded', async () => {
    mocks.getElectionReport.mockRejectedValue({ response: { data: { message: 'Election results have not been released yet.' } } });
    render(<ElectionReportsMenu election={election} role="SBO_OFFICER" />);
    open();

    fireEvent.click(screen.getByRole('button', { name: 'Election results as Excel' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Election results have not been released yet.');
    expect(mocks.workbook.written).toBe(false);
  });

  it('closes on Escape', () => {
    render(<ElectionReportsMenu election={election} role="ADMIN" />);
    open();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByText('Election results')).not.toBeInTheDocument();
  });
});
