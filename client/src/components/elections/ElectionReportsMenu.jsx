import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '../ui';
import { electionReportPdfUrl, getElectionReport } from '../../services/electionService';
import { getApiErrorMessage } from '../../utils/apiError';
import { openProtectedFile } from '../../utils/openProtectedFile';

const REPORTS = [
  { type: 'candidates', label: 'Official candidates' },
  { type: 'screening', label: 'Candidacy screening' },
  { type: 'partylists', label: 'Party lists' },
  { type: 'participation', label: 'Voter participation' },
  { type: 'canvassing', label: 'Canvassing of votes' },
  { type: 'results', label: 'Election results' },
  { type: 'audit', label: 'Audit trail' },
];

const ROLES = ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD'];

const ITEM = 'inline-flex h-8 items-center rounded-md border border-line px-3 text-xs font-medium text-ink hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-60';

// One sheet: the header row from the report's columns, then the rows as the server gave them.
async function downloadWorkbook(report, label, filename) {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(label);
  sheet.columns = report.columns.map((header) => ({ header, key: header, width: 26 }));
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F2F62' } };
  report.rows.forEach((row) => sheet.addRow(row.map((cell) => cell ?? '')));
  workbook.creator = 'HIUSA';
  workbook.subject = report.title || label;
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// The Reports button of the results page: seven reports, each as a PDF or an Excel file. Students never see it.
export default function ElectionReportsMenu({ election, role }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  if (!election || !ROLES.includes(role)) return null;

  async function run(key, task, fallback) {
    setBusy(key);
    setError('');
    try {
      await task();
    } catch (cause) {
      setError(getApiErrorMessage(cause, fallback));
    } finally {
      setBusy('');
    }
  }

  const openPdf = ({ type, label }) => run(`${type}:pdf`, () => openProtectedFile(electionReportPdfUrl(election.id, type)), `Could not open the ${label} report.`);
  const downloadExcel = ({ type, label }) => run(`${type}:xlsx`, async () => {
    const report = await getElectionReport(election.id, type);
    const filename = `${election.title} - ${label}.xlsx`.replace(/[\\/:*?"<>|]/g, '');
    await downloadWorkbook(report, label, filename);
  }, `Could not build the ${label} report.`);

  return (
    <div ref={rootRef} className="relative inline-block">
      <Button variant="secondary" rightIcon={ChevronDown} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((value) => !value)}>
        Reports
      </Button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-surface p-2 shadow-lg">
          <ul>
            {REPORTS.map((report) => (
              <li key={report.type} className="flex items-center justify-between gap-2 px-2 py-1.5">
                <span className="text-sm text-ink">{report.label}</span>
                <span className="flex gap-1.5">
                  <button type="button" className={ITEM} aria-label={`${report.label} as PDF`} disabled={busy !== ''} onClick={() => openPdf(report)}>PDF</button>
                  <button type="button" className={ITEM} aria-label={`${report.label} as Excel`} disabled={busy !== ''} onClick={() => downloadExcel(report)}>Excel</button>
                </span>
              </li>
            ))}
          </ul>
          {error && <p role="alert" className="px-2 pt-2 text-xs text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}
