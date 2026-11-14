import { filterLabel, matchesFilter } from '../../../utils/filterValues';
import { manilaDate, peso as fmt } from '../../../lib/format';
import HiusaSelect from '../../../components/ui/Select';
import { formatDisplayText } from '../../../utils/displayText.js';
import RichTextEditor from '../../../components/RichText';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Pencil,
  Plus,
  Printer,
  ReceiptText,
  Trash2,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import TableRowActions from '../../../components/TableRowActions';
import {
  getTransactions,
  getTransactionSummary,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  deleteBudget,
  deleteForecast,
  getPersonalReceipts,
  getInvoices,
  getForecasts,
  generateForecast,
  getBudgets,
  createBudget,
  updateBudget,
  generateBudgetAdvice,
  getFinancialReports,
  getFinancialReport,
  getStudentDebts,
  generateFinancialReport,
  downloadFinancialReportPdf,
  submitFinancialReport,
} from '../../../services/financeService';
import { getEvents } from '../../../services/eventService';
import { getAcademicPeriods } from '../../../services/systemAdministrationService';
import { readSelectedPeriod } from '../../../utils/academicPeriodStore';
import { getMyClearances } from '../../../services/clearanceService';
import { humanizeRole } from '../clearances/clearanceLabels';
import { debtBreakdown, debtRowFrom, owedSentence } from './accountDebt';
import { fetchAllPages } from '../../../services/pagination';
import { getCollegeOrganizations } from '../../../services/collegeOrganizationService';
import FeedbackToast from '../../../components/FeedbackToast';
import EngineBadge from '../../../components/ai/EngineBadge';
import RulesDisclosure from '../../../components/ai/RulesDisclosure';
import ConfirmModal from '../../../components/ConfirmModal';
import TableFilterBar from '../../../components/TableFilterBar';
import { getApiErrorMessage } from '../../../utils/apiError';
import { resolveAssetUrl } from '../../../utils/assetUrl';
import FinancialForecastChart from '../../../components/finance/FinancialForecastChart';
import ReceiptDocument, { printReceiptElement } from '../../../components/receipts/ReceiptDocument';
import BudgetDetailDrawer from '../../../components/finance/BudgetDetailDrawer';
import ReportDetailDrawer, { withDraftDefault } from '../../../components/finance/ReportDetailDrawer';
import { Button, DataTable, Drawer, EmptyState, ErrorState, Field, FlowStepper, Input, PageHeader, SkeletonTable, StatusBadge } from '../../../components/ui';
import { financialReportLifecycle } from '../../../lib/lifecycle';
import useRecordParam from '../../../lib/useRecordParam';

const OVERSIGHT_TABS = ['transactions', 'budgets', 'forecasting', 'reports'];

// Opened from the request selector, the budget form is the whole page. Cancel goes back to the request
// types and a saved proposal lands on the budgets.
const REQUEST_SELECTOR_PATH = '/dashboard/approval-requests/new';
const BUDGETS_PATH = '/dashboard/finance/budget-allocation';

// Forecast periods arrive as "2026-09" or as "Q3 2024". Compare them by calendar position so the chart
// and the list run oldest to newest whichever form the server stored.
function forecastOrder(period) {
  const text = String(period ?? '').trim();
  const month = text.match(/^(\d{4})-(\d{2})/);
  if (month) return Number(month[1]) * 12 + Number(month[2]) - 1;
  const quarter = text.match(/^Q([1-4])\s+(\d{4})/i);
  if (quarter) return Number(quarter[2]) * 12 + (Number(quarter[1]) - 1) * 3;
  return Number.POSITIVE_INFINITY;
}

function sortForecasts(forecasts) {
  return [...forecasts].sort((a, b) => forecastOrder(a.forecast_period) - forecastOrder(b.forecast_period)
    || String(a.forecast_period ?? '').localeCompare(String(b.forecast_period ?? '')));
}

// A Department Head sees every college organization's forecasts at once; one chart per organization keeps
// their lines apart.
function groupForecastsByOrganization(forecasts) {
  const groups = new Map();
  forecasts.forEach((forecast) => {
    const key = forecast.organization_id ?? 'own';
    if (!groups.has(key)) {
      const organization = forecast.organization;
      groups.set(key, { key, name: organization ? (organization.acronym ? `${organization.name} (${organization.acronym})` : organization.name) : null, forecasts: [] });
    }
    groups.get(key).forecasts.push(forecast);
  });
  return [...groups.values()];
}

// A forecast built from no ledger months has nothing to report: its zero balance and zero safe spend are
// absent data, not results.
function hasProjection(forecast) {
  const details = forecast.model_details || {};
  if (Number(details.sample_months) === 0 || Number(details.populated_months) === 0) return false;
  return [forecast.predicted_income, forecast.predicted_expense, forecast.predicted_balance, forecast.safe_spending_limit]
    .some((value) => Number(value) !== 0 && value != null);
}

const allocationStatusLabel = {
  within_limit: 'Within limit',
  reduce_allocation: 'Reduced allocation',
  no_funds: 'No funds available',
};

const allocationStatusTone = {
  within_limit: 'success',
  reduce_allocation: 'warning',
  no_funds: 'danger',
};

const deleteLabels = {
  budget: { title: 'Delete this budget?', confirm: 'Delete budget', done: 'Budget deleted.', failed: 'This budget could not be deleted.' },
  forecast: { title: 'Delete this forecast?', confirm: 'Delete forecast', done: 'Forecast deleted.', failed: 'This forecast could not be deleted.' },
  transaction: { title: 'Delete this transaction?', confirm: 'Delete transaction', done: 'Transaction deleted.', failed: 'This transaction could not be deleted.' },
};

const invoiceColumns = [
  { key: 'description', header: 'Description', render: (invoice) => invoice.description },
  { key: 'reference', header: 'Reference', render: (invoice) => invoice.reference || 'Not set' },
  { key: 'due_date', header: 'Due date', render: (invoice) => (invoice.due_date ? formatLedgerDate(invoice.due_date) : 'Not set') },
  { key: 'status', header: 'Status', render: (invoice) => sentence(invoice.status) },
  { key: 'amount_due', header: 'Amount due', align: 'right', render: (invoice) => fmt(invoice.amount_due) },
  { key: 'amount_paid', header: 'Paid', align: 'right', render: (invoice) => <span className={Number(invoice.amount_paid) > 0 ? 'text-success-strong' : 'text-ink'}>{fmt(invoice.amount_paid)}</span> },
  { key: 'remaining_balance', header: 'Balance', align: 'right', render: (invoice) => <span className={`font-semibold ${Number(invoice.remaining_balance) > 0 ? 'text-danger-strong' : 'text-ink'}`}>{fmt(invoice.remaining_balance)}</span> },
];

// The same current period My clearance opens on: the most recent one still incomplete, else the latest.
function currentClearance(clearances) {
  const sorted = [...clearances].sort((a, b) => b.clearance_period_id - a.clearance_period_id);
  return sorted.find((entry) => !entry.is_complete) || sorted[0] || null;
}

const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;

// The balance and the financial clearance come from the server's own rule (GET /student-debts), which also
// counts reserved orders no invoice covers yet; only the held signatures are read from My clearance.
function accountHolds(debt, clearances) {
  const total = Number(debt?.total_debt) || 0;
  const owing = debt ? debt.clearance_status === 'pending_clearance' : false;
  const breakdown = debtBreakdown(debt);
  const reasons = [];
  if (owing) reasons.push(owedSentence(debt, fmt));
  const current = clearances ? currentClearance(clearances) : null;
  const held = current && !current.is_complete ? current.signatures.filter((signature) => signature.status === 'held') : [];
  held.forEach((signature) => reasons.push(`${humanizeRole(signature.required_role)} clearance is on hold${signature.remarks ? `: ${signature.remarks}` : '.'}`));
  return { owing, total, breakdown, reasons };
}

// Sits above the invoice table so the balance and whether the student is cleared show without scrolling,
// on a phone where the table's own Balance column is a swipe away.
function AccountSummary({ debt, clearances }) {
  const { owing, total, breakdown, reasons } = accountHolds(debt, clearances);
  const balanceKnown = Boolean(debt);
  const onHold = reasons.length > 0;
  const unconfirmed = !onHold && !balanceKnown;

  return (
    <div role="region" aria-label="Account summary" className="grid gap-4 rounded-card border border-line bg-surface p-4 sm:grid-cols-2 sm:p-5">
      <div>
        <p className="text-xs font-medium text-ink-muted">Outstanding balance</p>
        {balanceKnown ? (
          <>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${owing ? 'text-danger-strong' : 'text-ink'}`}>{fmt(total)}</p>
            {(breakdown || onHold) && <p className="mt-1 text-xs text-ink-muted">{breakdown || 'Nothing owed'}</p>}
          </>
        ) : (
          <p className="mt-1 text-sm text-ink">Your balance could not be loaded. Open the home page to see what you owe.</p>
        )}
      </div>
      <div>
        <p className="text-xs font-medium text-ink-muted">Clearance</p>
        {/* Cleared is the default, so it is a sentence and not a badge; only a hold or an unknown gets one. */}
        {(unconfirmed || onHold) && (
          <div className="mt-1.5">
            {unconfirmed ? (
              <StatusBadge status="unconfirmed" label="Not confirmed" tone="neutral" />
            ) : (
              <StatusBadge status="held" label="On hold" tone="warning" />
            )}
          </div>
        )}
        {onHold && <ul className="mt-2 space-y-1 text-sm text-ink">{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
        {!onHold && balanceKnown && <p className="mt-1.5 text-sm text-ink">{clearances ? 'Nothing owed and no clearance signature is on hold.' : 'Nothing owed.'}</p>}
        {!clearances && <p className="mt-1 text-xs text-ink-muted">Your clearance signatures could not be checked. Open My clearance to see them.</p>}
      </div>
    </div>
  );
}

function getForecastReliability(forecast) {
  const details = forecast.model_details || {};

  if (typeof details.is_reliable === 'boolean') {
    return { isReliable: details.is_reliable, quality: details.fit_quality || null, reason: details.confidence_note || null };
  }

  const r2Values = [details.income?.r_squared, details.expense?.r_squared]
    .map(Number)
    .filter((value) => Number.isFinite(value));
  const avgR2 = r2Values.length ? r2Values.reduce((sum, value) => sum + value, 0) / r2Values.length : null;
  const sampleMonths = Number(details.sample_months);
  const lowSample = Number.isFinite(sampleMonths) && sampleMonths < 3;
  const weakFit = avgR2 !== null && avgR2 < 0.5;
  const isReliable = !(lowSample || weakFit);

  let reason = null;
  if (!isReliable) {
    if (lowSample && weakFit) {
      reason = `Based on only ${plural(sampleMonths, 'month')} of records, and they follow no clear trend. Treat this projection as directional only.`;
    } else if (lowSample) {
      reason = `Based on only ${plural(sampleMonths, 'month')} of records. Record more months to improve it.`;
    } else {
      reason = 'The monthly records follow no clear trend. Treat this projection as directional only.';
    }
  }

  return { isReliable, quality: details.fit_quality || null, reason };
}

function getClampNotice(forecast) {
  const details = forecast.model_details || {};
  const incomeClamped = details.income_clamped === true
    || (Number.isFinite(Number(details.raw_predicted_income)) && Number(details.raw_predicted_income) < 0);
  const expenseClamped = details.expense_clamped === true
    || (Number.isFinite(Number(details.raw_predicted_expense)) && Number(details.raw_predicted_expense) < 0);

  if (!incomeClamped && !expenseClamped) return null;
  if (incomeClamped && expenseClamped) return 'The raw projected income and expense were both negative and have been clamped to ₱0.00 for display.';
  return incomeClamped
    ? 'The raw projected income was negative and has been clamped to ₱0.00 for display.'
    : 'The raw projected expense was negative and has been clamped to ₱0.00 for display.';
}

const REPORT_STATUS_LABELS = { draft: 'Draft', pending_department_head: 'Pending Department Head', pending_sao: 'Pending SAO', approved: 'Approved', rejected: 'Returned' };

function sentence(value) {
  const text = String(value ?? '').replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatLedgerDate(value) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' });
}

function personName(person, fallback) {
  const name = [person?.first_name, person?.last_name].filter(Boolean).join(' ').trim();
  return name || fallback;
}

function ledgerSource(transaction) {
  return [transaction.event?.title, transaction.budget?.title].filter(Boolean);
}

function ledgerLockNote(transaction) {
  if (transaction.is_system_generated) return `Recorded by ${transaction.system_source_label}. Change it there.`;
  if (transaction.is_locked_by_report && transaction.locking_report_status === 'approved') return `In approved report '${transaction.locking_report_title}'. An approved report is final, so this entry cannot be changed.`;
  if (transaction.is_locked_by_report) return `In submitted report '${transaction.locking_report_title}'. Return the report to change it.`;
  return null;
}

function receiptLabel(transaction) {
  if (transaction.receipt_reference) return transaction.receipt_reference;
  if (transaction.receipt_number) return `Receipt #${transaction.receipt_number}`;
  return null;
}

// A ledger row shows a reference only when it tells the reader something: one the Admin typed in. The
// internal reference of an entry the system posted (MERCH-ORD-2 under "Merchandise order ORD-2") only
// repeats the description.
function ledgerReference(transaction) {
  const reference = receiptLabel(transaction);
  if (!reference || transaction.is_system_generated) return null;
  if (String(transaction.description || '').toLowerCase().includes(reference.toLowerCase())) return null;
  return reference;
}

// Source, payer and recorder in one muted line. A fact that is missing is left out, not announced.
function ledgerMeta(transaction) {
  const payer = personName(transaction.payer, '');
  const recorder = personName(transaction.recorder, '');
  return [
    ...ledgerSource(transaction),
    payer && `Payer: ${payer}`,
    recorder && `Recorded by ${recorder}`,
  ].filter(Boolean);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function reportTable(rows, title) {
  const headers = Object.keys(rows[0] || {});
  const heading = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('');
  const body = rows.map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header])}</td>`).join('')}</tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:Poppins,sans-serif;color:#0f172a;padding:24px}h1{font-size:20px}p{color:#64748B;font-size:12px}table{width:100%;border-collapse:collapse;margin-top:18px;font-size:12px}th,td{border:1px solid #DDE7EF;padding:8px;text-align:left}th{background:#EEF6FB}@media print{body{padding:0}}</style></head><body><h1>${escapeHtml(title)}</h1><p>Generated ${escapeHtml(new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' }))} Philippine time</p><table><thead><tr>${heading}</tr></thead><tbody>${body}</tbody></table></body></html>`;
}

async function downloadExcel(rows, filename, title) {
  if (!rows.length) return false;
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Report');
  const headers = Object.keys(rows[0]);
  sheet.columns = headers.map((header) => ({ header, key: header, width: /details|description/i.test(header) ? 44 : /amount|total/i.test(header) ? 20 : 25 }));
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F2F62' } };
  for (const row of rows) {
    const cells = {};
    for (const header of headers) {
      const value = row[header];
      const amount = Number(value);
      cells[header] = /amount|total/i.test(header) && value !== '' && value != null && Number.isFinite(amount) ? amount : String(value ?? '');
    }
    sheet.addRow(cells);
  }
  headers.forEach((header, index) => {
    if (/amount|total/i.test(header)) sheet.getColumn(index + 1).numFmt = '"₱"#,##0.00';
  });
  workbook.creator = 'HIUSA';
  workbook.subject = title;
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return true;
}

function printReport(rows, title) {
  if (!rows.length) return false;
  const frame = document.createElement('iframe');
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  document.body.appendChild(frame);
  frame.contentDocument.open();
  frame.contentDocument.write(reportTable(rows, title));
  frame.contentDocument.close();
  setTimeout(() => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 1000);
  }, 200);
  return true;
}

function cashAdvanceExportRows(cashAdvances) {
  const released = Number(cashAdvances?.released || 0);
  const repayments = Number(cashAdvances?.repayments || 0);
  if (!released && !repayments) return [];
  return [
    { Section: 'Cash advances', Item: 'Cash advances released', Details: 'Money lent out. Not counted as an expense.', 'Amount (₱)': released.toFixed(2), Date: '' },
    { Section: 'Cash advances', Item: 'Cash advance repayments', Details: 'Money returned. Not counted as income.', 'Amount (₱)': repayments.toFixed(2), Date: '' },
  ];
}

function ledgerExportRows(transactions = [], custody = null) {
  return [
    ...(['verified_collections', 'recorded_remittances'].map((item) => ({
      Section: 'Custody movements',
      Item: item.replaceAll('_', ' '),
      Details: 'Remittances are excluded from ledger income.',
      'Amount (₱)': Number(custody?.[item] || 0).toFixed(2),
      Date: '',
    }))),
    ...transactions.map((transaction) => ({
      Section: transaction.cash_advance ? 'Cash advance entry' : 'Ledger transaction',
      Item: `${transaction.category} (${transaction.type})`,
      Details: transaction.description,
      'Amount (₱)': Number(transaction.amount).toFixed(2),
      Date: String(transaction.transaction_date || '').slice(0, 10),
    })),
  ];
}

function downloadBlobResponse(response, fallbackName) {
  const disposition = response.headers?.['content-disposition'] || '';
  const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || fallbackName;
  const url = URL.createObjectURL(response.data);
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// A new transaction starts on today's date, so the form only needs a description and an amount.
function todayInputValue() {
  const now = new Date();
  const pad = (part) => String(part).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export default function FinancePage({ initialTab = 'transactions', startBudgetProposal = false }) {
  const [showForm, setShowForm] = useState(false);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [transactions, setTransactions] = useState([]);
  const [personalReceipts, setPersonalReceipts] = useState([]);
  const [selectedReceipt, setSelectedReceipt] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [clearances, setClearances] = useState(null);
  const [studentDebt, setStudentDebt] = useState(null);
  const [summary, setSummary] = useState({ total_income: 0, total_expense: 0, net_balance: 0 });
  const [overallSummary, setOverallSummary] = useState({ total_income: 0, total_expense: 0, net_balance: 0 });
  const [forecasts, setForecasts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const loadTicket = useRef(0);
  const ledgerTicket = useRef(0);
  const [txFilters, setTxFilters] = useState({ type: '', event_id: '', from: '', to: '' });
  const [txMeta, setTxMeta] = useState({ current_page: 1, last_page: 1, total: 0, per_page: 10 });
  const [feedback, setFeedback] = useState({ open: false, type: 'success', message: '' });
  const [forecastGenerating, setForecastGenerating] = useState(false);
  const [reports, setReports] = useState([]);
  const [reportFilter, setReportFilter] = useState({ search: '', status: '', event_id: '' });
  const [reportSemesters, setReportSemesters] = useState(null);
  const [generatedReport, setGeneratedReport] = useState(null);
  const [reportGenerating, setReportGenerating] = useState(false);
  const [reportForm, setReportForm] = useState({ document_type: 'financial_report', report_type: 'semester', academic_semester_id: '', event_id: '', period_start: '', period_end: '', treasurer: '', president: '', adviser: '', sbo_adviser: '', letterhead: null, letter_date: '', letter_subject: '', letter_recipient: '', letter_body: '', letter_closing: '' });
  const [reportFiles, setReportFiles] = useState({});
  const [reportSubmitting, setReportSubmitting] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  // The report builder is a long form, so with saved reports on the page it stays closed until asked for.
  const [reportFormOpen, setReportFormOpen] = useState(false);
  const [proposalSent, setProposalSent] = useState(false);
  const [recordId, setRecordId] = useRecordParam();
  const eventParam = searchParams.get('event');
  const eventParamHandled = useRef(null);
  const [reportPdfDownloading, setReportPdfDownloading] = useState(null);
  const [reportExcelDownloading, setReportExcelDownloading] = useState(null);

  const [form, setForm] = useState({ description: '', amount: '', type: 'expense', category: 'Operations', transaction_date: '', budget_id: '', event_id: '', receipt_reference: '' });
  const [editingTransaction, setEditingTransaction] = useState(null);
  const [formError, setFormError] = useState(null);
  const [formSubmitting, setFormSubmitting] = useState(false);

  const [budgets, setBudgets] = useState([]);
  const [events, setEvents] = useState([]);
  const [showBudgetForm, setShowBudgetForm] = useState(false);
  const [budgetForm, setBudgetForm] = useState({ title: '', allocated_amount: '', warning_threshold: '', event_id: '' });
  const [editingBudget, setEditingBudget] = useState(null);
  const [budgetFormError, setBudgetFormError] = useState(null);
  const [budgetFormSubmitting, setBudgetFormSubmitting] = useState(false);
  const [budgetAdviceGenerating, setBudgetAdviceGenerating] = useState(null);
  const [budgetAdviceDetails, setBudgetAdviceDetails] = useState({});
  const [budgetAdviceErrors, setBudgetAdviceErrors] = useState({});
  const [forecastGenError, setForecastGenError] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  let currentUserRole = '';
  try { currentUserRole = JSON.parse(localStorage.getItem('user') ?? '{}')?.role ?? ''; } catch {}
  const canManageLedger = currentUserRole === 'ADMIN';
  const isDepartmentHead = currentUserRole === 'DEPARTMENT_HEAD';
  const [collegeOrganizations, setCollegeOrganizations] = useState([]);
  const [organizationFilter, setOrganizationFilter] = useState('');
  // Officers and department heads review the organization's finances; only the ADMIN changes them.
  const canReadFinance = ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD'].includes(currentUserRole);
  const canViewTransactions = canReadFinance;
  const canViewForecasts = canReadFinance;
  const canViewBudgets = canReadFinance;
  const canGenerateForecast = currentUserRole === 'ADMIN';
  const canDeleteForecast = currentUserRole === 'ADMIN';
  const canViewPersonalReceipts = ['ADMIN', 'SBO_OFFICER', 'STUDENT'].includes(currentUserRole);
  const canViewInvoices = ['ADMIN', 'SBO_OFFICER', 'STUDENT'].includes(currentUserRole);
  const canProposeBudget = currentUserRole === 'ADMIN';
  const canGenerateBudgetAdvice = currentUserRole === 'ADMIN';

  const closeFeedback = useCallback(() => {
    setFeedback((current) => ({ ...current, open: false }));
  }, []);

  const showFeedback = useCallback((type, message) => {
    setFeedback({ open: true, type, message });
  }, []);


  // Only a Department Head oversees several organizations; the server validates the id against their college.
  function ledgerScope(filters, organizationId) {
    const organizationScope = isDepartmentHead && organizationId ? { organization_id: organizationId } : {};
    return { organizationScope, activeFilters: { ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== '')), ...organizationScope } };
  }

  function showTransactions(txRes, sumRes) {
    const txArr = Array.isArray(txRes.data?.data) ? txRes.data.data : (Array.isArray(txRes.data) ? txRes.data : []);
    setTransactions(txArr);
    if (txRes.data?.current_page !== undefined) {
      setTxMeta({
        current_page: txRes.data.current_page,
        last_page: txRes.data.last_page,
        total: txRes.data.total,
        per_page: txRes.data.per_page,
      });
    }
    setSummary(sumRes.data ?? { total_income: 0, total_expense: 0, net_balance: 0 });
  }

  // A search or filter only changes the ledger rows and their totals, so it reads those two and leaves
  // the budgets, forecasts, reports and everything else as they are. A newer ledger read or a full load
  // makes an older answer stale.
  function loadLedger(page = 1, filters = txFilters, searchTerm = appliedSearch) {
    if (!canViewTransactions) return;
    const ticket = ++ledgerTicket.current;
    setLedgerLoading(true);
    setError(null);
    const term = searchTerm.trim();
    const query = { ...ledgerScope(filters, organizationFilter).activeFilters, ...(term ? { search: term } : {}) };
    Promise.all([getTransactions({ page, ...query }), getTransactionSummary(query)])
      .then(([txRes, sumRes]) => {
        if (ticket === ledgerTicket.current) showTransactions(txRes, sumRes);
      })
      .catch(() => {
        if (ticket === ledgerTicket.current) setError('Failed to load financial data.');
      })
      .finally(() => {
        if (ticket === ledgerTicket.current) setLedgerLoading(false);
      });
  }

  function applySearch(term) {
    setAppliedSearch(term);
    loadLedger(1, txFilters, term);
  }

  // Typing applies the search once it pauses, like every other search; Enter still applies it at once.
  useEffect(() => {
    if (search.trim() === appliedSearch.trim()) return undefined;
    const timer = setTimeout(() => applySearch(search), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, appliedSearch, txFilters, organizationFilter]);

  // A refresh after a save reads everything again but leaves what is on screen in place until the new data lands.
  function load(page = 1, filters = txFilters, searchTerm = appliedSearch, organizationId = organizationFilter, { refresh = false } = {}) {
    const ticket = ++loadTicket.current;
    const ledgerAtStart = ++ledgerTicket.current;
    setLedgerLoading(false);
    if (!refresh) setLoading(true);
    setError(null);
    const { organizationScope, activeFilters } = ledgerScope(filters, organizationId);
    // Budgets, forecasts, reports, and the event dropdown source have no server-side
    // filter that narrows them down, and every one of them doubles as either a full
    // catalog view or a dropdown option list elsewhere on this page - so they are
    // fetched in full (across every page) rather than left truncated at page one.
    // The forecast and report lists go second: asking for everything at once opens enough sockets at the
    // same moment that a busy Windows machine refuses some of them with ERR_NO_BUFFER_SPACE.
    const fetchLists = () => Promise.all([
      canViewForecasts ? fetchAllPages((p) => getForecasts(p).then((r) => r.data), organizationScope) : Promise.resolve([]),
      canViewTransactions ? fetchAllPages((p) => getFinancialReports(p).then((r) => r.data), organizationScope) : Promise.resolve([]),
    ]);
    // The ledger totals follow the search and filters, but the Reports tab and the category export are not narrowed by them,
    // so they read their own summary that carries the organization scope and nothing else.
    const emptySummary = { data: { total_income: 0, total_expense: 0, net_balance: 0 } };
    const ledgerSummary = canViewTransactions ? getTransactionSummary({ ...activeFilters, ...(searchTerm.trim() ? { search: searchTerm.trim() } : {}) }) : Promise.resolve(emptySummary);
    const isNarrowed = Object.keys(activeFilters).some((key) => !(key in organizationScope)) || Boolean(searchTerm.trim());
    const allTimeSummary = canViewTransactions && isNarrowed ? getTransactionSummary({ ...organizationScope }) : ledgerSummary;
    Promise.all([
      canViewTransactions ? getTransactions({ page, ...activeFilters, ...(searchTerm.trim() ? { search: searchTerm.trim() } : {}) }) : Promise.resolve({ data: { data: [] } }),
      ledgerSummary,
      allTimeSummary,
      canViewBudgets ? fetchAllPages((p) => getBudgets(p).then((r) => r.data), organizationScope) : Promise.resolve([]),
      canViewBudgets || canManageLedger ? fetchAllPages((p) => getEvents(p).then((r) => r.data)) : Promise.resolve([]),
      canViewPersonalReceipts ? getPersonalReceipts() : Promise.resolve({ data: [] }),
      canViewInvoices ? getInvoices() : Promise.resolve({ data: [] }),
      currentUserRole === 'STUDENT' ? getMyClearances().catch(() => ({ data: null })) : Promise.resolve({ data: null }),
      currentUserRole === 'STUDENT' ? getStudentDebts().catch(() => ({ data: null })) : Promise.resolve({ data: null }),
    ])
      .then(async ([txRes, sumRes, allTimeRes, budgetsList, eventsList, receiptRes, invoiceRes, clearanceRes, debtRes]) => {
        if (ticket !== loadTicket.current) return;
        // What the screen shows first lands as soon as it is read, so a saved budget is on the list
        // without waiting for the slower forecast and report reads.
        if (ledgerAtStart === ledgerTicket.current) showTransactions(txRes, sumRes);
        setOverallSummary(allTimeRes.data ?? { total_income: 0, total_expense: 0, net_balance: 0 });
        setBudgets(budgetsList);
        setEvents(eventsList);
        setPersonalReceipts(Array.isArray(receiptRes.data) ? receiptRes.data : []);
        setInvoices(Array.isArray(invoiceRes.data) ? invoiceRes.data : []);
        setClearances(Array.isArray(clearanceRes.data) ? clearanceRes.data : null);
        setStudentDebt(debtRowFrom(debtRes));
        const [forecasts, reports] = await fetchLists();
        if (ticket !== loadTicket.current) return;
        setForecasts(forecasts);
        setReports(reports);
      })
      .catch(() => {
        if (ticket === loadTicket.current) setError('Failed to load financial data.');
      })
      .finally(() => {
        if (ticket === loadTicket.current) setLoading(false);
      });
  }

  function refreshAfterSave(page) {
    load(page, undefined, undefined, undefined, { refresh: true });
  }

  function askDelete(kind, record) {
    setDeleteError(null);
    setDeleteTarget({ kind, record });
  }

  async function confirmDelete() {
    const { kind, record } = deleteTarget;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      if (kind === 'budget') await deleteBudget(record.id);
      else if (kind === 'forecast') await deleteForecast(record.id);
      else await deleteTransaction(record.id);
      showFeedback('success', deleteLabels[kind].done);
      setDeleteTarget(null);
      refreshAfterSave(kind === 'transaction' && transactions.length === 1 && txMeta.current_page > 1 ? txMeta.current_page - 1 : txMeta.current_page);
    } catch (err) {
      setDeleteError(getApiErrorMessage(err, deleteLabels[kind].failed));
    } finally {
      setDeleteBusy(false);
    }
  }

  function openBudgetForm(budget = null) {
    setEditingBudget(budget);
    setBudgetForm(budget ? {
      title: budget.title || '',
      allocated_amount: budget.allocated_amount ?? '',
      warning_threshold: budget.warning_threshold ?? '',
      event_id: budget.event_id ? String(budget.event_id) : '',
    } : { title: '', allocated_amount: '', warning_threshold: '', event_id: '' });
    setBudgetFormError(null);
    setShowBudgetForm(true);
  }

  function closeBudgetForm() {
    setShowBudgetForm(false);
    setEditingBudget(null);
    if (searchParams.has('event')) {
      const next = new URLSearchParams(searchParams);
      next.delete('event');
      setSearchParams(next, { replace: true });
    }
  }

  async function handleCreateBudget(e) {
    e.preventDefault();
    if (!budgetForm.title.trim() || budgetForm.allocated_amount === '' || budgetForm.warning_threshold === '') {
      const message = 'Complete the required budget fields before submitting.';
      setBudgetFormError(message);
      showFeedback('error', message);
      return;
    }

    if (Number(budgetForm.allocated_amount) <= 0 || Number(budgetForm.warning_threshold) < 0 || Number(budgetForm.warning_threshold) > Number(budgetForm.allocated_amount)) {
      const message = 'The allocation must be greater than zero and the warning threshold cannot exceed it.';
      setBudgetFormError(message);
      showFeedback('error', message);
      return;
    }

    setBudgetFormSubmitting(true);
    setBudgetFormError(null);
    try {
      const payload = {
        title: budgetForm.title,
        allocated_amount: parseFloat(budgetForm.allocated_amount),
        warning_threshold: parseFloat(budgetForm.warning_threshold),
        event_id: budgetForm.event_id || null,
      };
      if (editingBudget) await updateBudget(editingBudget.id, payload);
      else await createBudget(payload);
      const sentFromRequestPage = inlineBudgetForm;
      closeBudgetForm();
      setBudgetForm({ title: '', allocated_amount: '', warning_threshold: '', event_id: '' });
      if (sentFromRequestPage) setProposalSent(true);
      else showFeedback('success', editingBudget ? 'Budget updated and sent back for approval.' : 'Budget proposal submitted for approval.');
      refreshAfterSave(txMeta.current_page);
    } catch (err) {
      const message = getApiErrorMessage(err, 'Failed to save budget.');
      setBudgetFormError(message);
      showFeedback('error', message);
    } finally {
      setBudgetFormSubmitting(false);
    }
  }

  // The initial financial snapshot is refreshed explicitly after every mutation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!isDepartmentHead) return;
    fetchAllPages((p) => getCollegeOrganizations(p).then((r) => r.data)).then(setCollegeOrganizations).catch(() => {});
  }, [isDepartmentHead]);
  useEffect(() => { setActiveTab(initialTab); }, [initialTab]);
  useEffect(() => {
    if (startBudgetProposal && canProposeBudget) {
      setBudgetForm({ title: '', allocated_amount: '', warning_threshold: '', event_id: '' });
      setBudgetFormError(null);
      setShowBudgetForm(true);
    }
  }, [canProposeBudget, startBudgetProposal]);
  // ?event= is how an event page hands its event over: the budget form opens with it selected, or the
  // report builder switches to the event report type. Handled once per value so closing the form sticks.
  useEffect(() => {
    if (!eventParam || eventParamHandled.current === eventParam) return;
    if (activeTab === 'budgets' && canProposeBudget) {
      setEditingBudget(null);
      setBudgetForm({ title: '', allocated_amount: '', warning_threshold: '', event_id: eventParam });
      setBudgetFormError(null);
      setShowBudgetForm(true);
    } else if (activeTab === 'reports' && currentUserRole === 'ADMIN') {
      setReportFormOpen(true);
      setReportForm((current) => ({ ...current, report_type: 'event', event_id: eventParam }));
    } else {
      return;
    }
    eventParamHandled.current = eventParam;
  }, [activeTab, canProposeBudget, currentUserRole, eventParam]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.description || !form.amount || !form.transaction_date) {
      const message = 'Complete the required transaction fields before saving.';
      setFormError(message);
      showFeedback('error', message);
      return;
    }

    if (Number(form.amount) <= 0) {
      const message = 'Transaction amount must be greater than 0.';
      setFormError(message);
      showFeedback('error', message);
      return;
    }

    setFormSubmitting(true);
    setFormError(null);
    try {
      const payload = {
        description: form.description,
        amount: parseFloat(form.amount),
        type: form.type,
        category: form.category,
        transaction_date: form.transaction_date,
        budget_id: form.budget_id || null,
        event_id: form.event_id || null,
        receipt_reference: form.receipt_reference || null,
      };
      if (editingTransaction) {
        await updateTransaction(editingTransaction.id, payload);
      } else {
        await createTransaction(payload);
      }
      setShowForm(false);
      setEditingTransaction(null);
      setForm({ description: '', amount: '', type: 'expense', category: 'Operations', transaction_date: '', budget_id: '', event_id: '', receipt_reference: '' });
      showFeedback('success', `Transaction ${editingTransaction ? 'updated' : 'recorded'} successfully.`);
      refreshAfterSave(editingTransaction ? txMeta.current_page : 1);
    } catch (err) {
      const message = getApiErrorMessage(err, 'Failed to save transaction.');
      setFormError(message);
      showFeedback('error', message);
    } finally {
      setFormSubmitting(false);
    }
  }

  async function handleGenerateBudgetAdvice(budgetId) {
    setBudgetAdviceGenerating(budgetId);
    try {
      const response = await generateBudgetAdvice(budgetId);
      const updatedBudget = response.data?.budget;
      if (updatedBudget) {
        setBudgets((current) => current.map((budget) => (budget.id === updatedBudget.id ? updatedBudget : budget)));
      }
      setBudgetAdviceDetails((current) => ({
        ...current,
        [budgetId]: { engine: response.data?.engine ?? null, advice: response.data?.advice ?? null },
      }));
      setBudgetAdviceErrors((current) => {
        const next = { ...current };
        delete next[budgetId];
        return next;
      });
      showFeedback('success', response.data?.forecast_status === 'used'
        ? `Budget advice generated from this budget's balance and the ${response.data.forecast_period} forecast.`
        : response.data?.forecast_status === 'not_applied'
          ? 'Budget advice generated from this budget\'s balance only. This budget is outside the current semester, so the forecast was not applied.'
          : 'Budget advice generated from this budget\'s balance only. No current forecast was available, so generate a forecast for forecast-based advice.');
    } catch (err) {
      const message = getApiErrorMessage(err, 'Failed to generate budget advice.');
      setBudgetAdviceErrors((current) => ({ ...current, [budgetId]: message }));
      showFeedback('error', message);
    } finally {
      setBudgetAdviceGenerating(null);
    }
  }

  async function handleGenerateForecast() {
    setForecastGenerating(true);
    setForecastGenError(null);
    try {
      await generateForecast({ months: 12 });
      showFeedback('success', 'Forecast generated from the ledger history.');
      refreshAfterSave(txMeta.current_page);
    } catch (err) {
      const message = getApiErrorMessage(err, 'Failed to generate the forecast.');
      setForecastGenError(message);
      showFeedback('error', message);
    } finally {
      setForecastGenerating(false);
    }
  }

  async function handleGenerateReport(event) {
    event.preventDefault();
    if (reportForm.report_type === 'event' && !reportForm.event_id) {
      showFeedback('error', 'Select an event for the event-specific report.');
      return;
    }
    if (reportForm.report_type === 'semester' && !reportForm.academic_semester_id) {
      showFeedback('error', 'Select a semester before generating the report.');
      return;
    }
    if (reportForm.report_type === 'custom' && (!reportForm.period_start || !reportForm.period_end || reportForm.period_end < reportForm.period_start)) {
      showFeedback('error', 'Choose a valid start and end date for the custom period.');
      return;
    }
    if (['treasurer', 'president', 'adviser', 'sbo_adviser'].some((role) => !reportForm[role].trim())) {
      showFeedback('error', 'Enter all four required signatories before generating the report.');
      return;
    }

    setReportGenerating(true);
    try {
      const payload = {
        document_type: reportForm.document_type,
        report_type: reportForm.report_type,
        academic_semester_id: reportForm.report_type === 'semester' ? reportForm.academic_semester_id : null,
        event_id: reportForm.report_type === 'event' ? reportForm.event_id : null,
        period_start: reportForm.report_type === 'custom' ? reportForm.period_start : null,
        period_end: reportForm.report_type === 'custom' ? reportForm.period_end : null,
        signatories: {
          treasurer: reportForm.treasurer,
          president: reportForm.president,
          adviser: reportForm.adviser,
          sbo_adviser: reportForm.sbo_adviser,
        },
        letterhead: reportForm.letterhead,
        letter_date: reportForm.letter_date,
        letter_subject: reportForm.letter_subject,
        letter_recipient: reportForm.letter_recipient,
        letter_body: reportForm.letter_body,
        letter_closing: reportForm.letter_closing,
      };
      const response = await generateFinancialReport(payload);
      setGeneratedReport(response.data);
      setReportFormOpen(true);
      setReports((current) => [response.data.report, ...current.filter((report) => report.id !== response.data.report.id)]);
      showFeedback('success', `${reportForm.document_type === 'income_statement' ? 'Income statement' : 'Financial report'} generated and saved to report history.`);
    } catch (err) {
      showFeedback('error', getApiErrorMessage(err, 'Failed to generate the financial report.'));
    } finally {
      setReportGenerating(false);
    }
  }

  async function handleDownloadReportPdf(report) {
    setReportPdfDownloading(report.id);
    try {
      const response = await downloadFinancialReportPdf(report.id);
      downloadBlobResponse(response, `${report.document_type === 'income_statement' ? 'income-statement' : 'financial-report'}-${report.id}.pdf`);
      showFeedback('success', 'PDF downloaded.');
    } catch (err) {
      showFeedback('error', getApiErrorMessage(err, 'Failed to generate the PDF.'));
    } finally {
      setReportPdfDownloading(null);
    }
  }

  async function handlePreviewReportPdf(report) {
    const preview = window.open('', '_blank');
    if (!preview) {
      showFeedback('error', 'Allow pop-ups to preview this PDF.');
      return;
    }
    setReportPdfDownloading(report.id);
    try {
      const response = await downloadFinancialReportPdf(report.id, true);
      const url = URL.createObjectURL(response.data);
      preview.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      preview.close();
      showFeedback('error', getApiErrorMessage(err, 'Failed to preview the PDF.'));
    } finally {
      setReportPdfDownloading(null);
    }
  }

  async function handleExportSavedReport(report) {
    setReportExcelDownloading(report.id);
    try {
      const response = await getFinancialReport(report.id);
      const detail = response.data;
      const transactions = detail.transactions || [];
      const { totals } = detail;
      const advances = cashAdvanceExportRows(detail.cash_advances);
      const rows = [
        { Section: 'Report', Item: report.title, Details: report.summary_text || '', 'Amount (₱)': '', Date: '' },
        { Section: 'Report', Item: 'Period', Details: `${String(detail.report.period_start || '').slice(0, 10)} to ${String(detail.report.period_end || '').slice(0, 10)}`, 'Amount (₱)': '', Date: '' },
        { Section: 'Report', Item: 'Event', Details: detail.report.event?.title || 'All organization events', 'Amount (₱)': '', Date: '' },
        { Section: 'Report', Item: 'Status', Details: String(detail.report.submission_status || 'draft').replaceAll('_', ' '), 'Amount (₱)': '', Date: '' },
        ...[['Opening balance', totals.opening_balance], ['Income', totals.income], ['Expenses', totals.expense], ['Net activity', totals.balance], ['Closing balance', totals.closing_balance]].map(([item, amount]) => ({
          Section: 'Totals', Item: item, Details: item === 'Closing balance' && advances.length ? 'Opening balance and net activity, less cash advances released, plus cash advance repayments.' : '', 'Amount (₱)': Number(amount).toFixed(2), Date: '',
        })),
        ...advances,
        ...ledgerExportRows(transactions, detail.report.custody_snapshot),
      ];
      await downloadExcel(rows, `hiusa-financial-report-${report.id}.xlsx`, report.title);
      showFeedback('success', 'Excel report exported.');
    } catch (cause) {
      showFeedback('error', getApiErrorMessage(cause, 'Could not export the saved report.'));
    } finally {
      setReportExcelDownloading(null);
    }
  }

  async function handleSubmitReport(report) {
    setReportSubmitting(report.id);
    try {
      const response = await submitFinancialReport(report.id, reportFiles[report.id] || []);
      setReports((current) => current.map((item) => item.id === report.id ? response.data : item));
      showFeedback('success', 'Financial report submitted to the Department Head. SAO review follows Department Head approval.');
    } catch (err) {
      showFeedback('error', getApiErrorMessage(err, 'Failed to submit the financial report.'));
    } finally {
      setReportSubmitting(null);
    }
  }

  async function exportGeneratedReport(format) {
    if (format === 'pdf') {
      handleDownloadReportPdf(generatedReport.report);
      return;
    }
    const rows = [
      {
        Section: 'Financial summary',
        Item: generatedReport?.report?.title,
        Details: generatedReport?.report?.summary_text,
        'Amount (₱)': '',
        Date: '',
      },
      { Section: 'Report', Item: 'Period', Details: `${String(generatedReport?.report?.period_start || '').slice(0, 10)} to ${String(generatedReport?.report?.period_end || '').slice(0, 10)}`, 'Amount (₱)': '', Date: '' },
      { Section: 'Report', Item: 'Event', Details: generatedReport?.report?.event?.title || 'All organization events', 'Amount (₱)': '', Date: '' },
      ...['income', 'expense', 'balance'].map((item) => ({
        Section: 'Income statement',
        Item: item,
        Details: '',
        'Amount (₱)': Number(generatedReport?.totals?.[item] || 0).toFixed(2),
        Date: '',
      })),
      ...cashAdvanceExportRows(generatedReport?.cash_advances),
      ...(generatedReport?.by_category || []).map((row) => ({
        Section: 'Category summary',
        Item: `${row.category} (${row.type})`,
        Details: '',
        'Amount (₱)': Number(row.total || 0).toFixed(2),
        Date: '',
      })),
      ...(generatedReport?.latest_ols_forecast ? [{
        Section: 'OLS forecast',
        Item: generatedReport.latest_ols_forecast.forecast_period,
        Details: `Income ${fmt(generatedReport.latest_ols_forecast.predicted_income)}; expense ${fmt(generatedReport.latest_ols_forecast.predicted_expense)}; balance ${fmt(generatedReport.latest_ols_forecast.predicted_balance)}; safe spending ${fmt(generatedReport.latest_ols_forecast.safe_spending_limit)}`,
        'Amount (₱)': '',
        Date: '',
      }] : []),
      ...(generatedReport?.budget_advisories || []).map((budget) => ({
        Section: 'Budget advisory',
        Item: budget.title,
        Details: `Recommended ${fmt(budget.recommended_allocation)}; safe ceiling ${fmt(budget.safe_spending_limit)}; risk ${budget.overspending_risk || 'not set'}; ${budget.advisory_note || ''}`,
        'Amount (₱)': Number(budget.remaining_amount || 0).toFixed(2),
        Date: String(budget.advice_generated_at || '').slice(0, 10),
      })),
      ...(generatedReport?.audit_logs || []).map((log) => ({
        Section: 'Audit log',
        Item: `${log.module}.${log.action}`,
        Details: `${log.record_type || 'record'} #${log.record_id || ''}`,
        'Amount (₱)': '',
        Date: String(log.created_at || '').slice(0, 10),
      })),
      ...ledgerExportRows(generatedReport?.transactions, generatedReport?.custody),
    ];
    const title = generatedReport?.report?.title || 'Financial Report';
    try {
      const exported = await downloadExcel(rows, `hiusa-${generatedReport?.report?.document_type === 'income_statement' ? 'income-statement' : 'financial-report'}-${generatedReport?.report?.id || 'new'}.xlsx`, title);
      showFeedback(exported ? 'success' : 'info', exported ? 'Excel report exported.' : 'This report has no rows to export.');
    } catch (err) {
      showFeedback('error', getApiErrorMessage(err, 'Could not export this report.'));
    }
  }

  async function handleExport(type, format = 'excel') {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');

    if (type === 'category') {
      const rows = (overallSummary.by_category || []).map((c) => ({
        Category: c.category,
        Type: c.type,
        'Total (₱)': Number(c.total).toFixed(2),
      }));
      const exported = format === 'excel'
        ? await downloadExcel(rows, `hiusa-category-breakdown-${yyyy}-${mm}.xlsx`, 'Category Breakdown')
        : printReport(rows, 'Category Breakdown');
      if (exported) {
        showFeedback('success', format === 'excel' ? 'Excel report exported.' : 'Print-ready report opened. Choose Save as PDF in the print dialog.');
      } else {
        showFeedback('info', 'No category data is available to export yet.');
      }
      return;
    }

    try {
      // /transactions only accepts per_page=10 (any other value 422s), so a full
      // export walks every page at that size instead of asking for a bigger
      // page in one shot. maxPages is raised well past the 50-page default so a
      // semester (or the full log) isn't silently capped at 500 rows.
      const all = await fetchAllPages((p) => getTransactions(p).then((r) => r.data), isDepartmentHead && organizationFilter ? { organization_id: organizationFilter } : {}, { perPage: 10, maxPages: 500 });

      const toRow = (tx) => ({
        Date: tx.transaction_date,
        Description: tx.description,
        Category: tx.category,
        Type: tx.type,
        'Amount (₱)': Number(tx.amount).toFixed(2),
      });

      if (type === 'monthly') {
        const filtered = all.filter((tx) => String(tx.transaction_date).startsWith(`${yyyy}-${mm}`));
        const exported = format === 'excel'
          ? await downloadExcel(filtered.map(toRow), `hiusa-monthly-${yyyy}-${mm}.xlsx`, `Monthly Financial Summary - ${yyyy}-${mm}`)
          : printReport(filtered.map(toRow), `Monthly Financial Summary - ${yyyy}-${mm}`);
        if (exported) {
          showFeedback('success', format === 'excel' ? 'Excel report exported.' : 'Print-ready report opened. Choose Save as PDF in the print dialog.');
        } else {
          showFeedback('info', 'No monthly transactions are available to export yet.');
        }
      } else if (type === 'semester') {
        const cutoff = new Date(today);
        cutoff.setMonth(cutoff.getMonth() - 6);
        const filtered = all.filter((tx) => new Date(tx.transaction_date) >= cutoff);
        const exported = format === 'excel'
          ? await downloadExcel(filtered.map(toRow), `hiusa-semester-${yyyy}.xlsx`, `Semester Financial Report - ${yyyy}`)
          : printReport(filtered.map(toRow), `Semester Financial Report - ${yyyy}`);
        if (exported) {
          showFeedback('success', format === 'excel' ? 'Excel report exported.' : 'Print-ready report opened. Choose Save as PDF in the print dialog.');
        } else {
          showFeedback('info', 'No semester transactions are available to export yet.');
        }
      } else if (type === 'log') {
        const exported = format === 'excel'
          ? await downloadExcel(all.map(toRow), `hiusa-transaction-log-${yyyy}-${mm}-${dd}.xlsx`, 'Full Transaction Log')
          : printReport(all.map(toRow), 'Full Transaction Log');
        if (exported) {
          showFeedback('success', format === 'excel' ? 'Excel report exported.' : 'Print-ready report opened. Choose Save as PDF in the print dialog.');
        } else {
          showFeedback('info', 'No transactions are available to export yet.');
        }
      }
    } catch (err) {
      showFeedback('error', getApiErrorMessage(err, 'Could not fetch the transactions to export. Try again.'));
    }
  }

  function openTransactionForm(tx = null) {
    setEditingTransaction(tx);
    setForm(tx ? {
      description: tx.description || '',
      amount: tx.amount || '',
      type: tx.type || 'expense',
      category: tx.category || 'Operations',
      transaction_date: String(tx.transaction_date || '').slice(0, 10),
      budget_id: tx.budget_id || '',
      event_id: tx.event_id || '',
      receipt_reference: tx.receipt_reference || '',
    } : { description: '', amount: '', type: 'expense', category: 'Operations', transaction_date: todayInputValue(), budget_id: '', event_id: '', receipt_reference: '' });
    setFormError(null);
    setShowForm(true);
  }

  const filtered = transactions;

  const txFrom = (txMeta.current_page - 1) * txMeta.per_page + 1;
  const txTo = Math.min(txMeta.current_page * txMeta.per_page, txMeta.total);
  const activeTransactionFilters = [
    appliedSearch.trim() && `Search: ${appliedSearch.trim()}`,
    txFilters.type && `Type: ${filterLabel(txFilters.type)}`,
    txFilters.event_id && `Event: ${filterLabel(txFilters.event_id, (value) => events.find((event) => String(event.id) === value)?.title || value)}`,
    txFilters.from && `From: ${txFilters.from}`,
    txFilters.to && `To: ${txFilters.to}`,
  ].filter(Boolean);

  const clearTransactionFilters = () => {
    const cleared = { type: '', event_id: '', from: '', to: '' };
    setTxFilters(cleared);
    setSearch('');
    setAppliedSearch('');
    load(1, cleared, '');
  };
  const visibleReports = reports.filter((report) =>
    (!reportFilter.search || String(report.title || '').toLowerCase().includes(reportFilter.search.trim().toLowerCase()))
    && matchesFilter(reportFilter.status, report.submission_status)
    && matchesFilter(reportFilter.event_id, report.event_id));
  const clearReportFilters = () => setReportFilter({ search: '', status: '', event_id: '' });
  const reportFiltersActive = Boolean(reportFilter.search || reportFilter.status || reportFilter.event_id);

  const selectedBudget = activeTab === 'budgets' && recordId ? budgets.find((budget) => String(budget.id) === recordId) : null;
  const selectedReport = activeTab === 'reports' && recordId ? reports.find((report) => String(report.id) === recordId) : null;
  const recordMissing = Boolean(recordId) && !loading && !error && ((activeTab === 'budgets' && !selectedBudget) || (activeTab === 'reports' && !selectedReport));

  // From the request selector the budget form is the page, with nothing of the budget list behind it.
  const inlineBudgetForm = startBudgetProposal && showBudgetForm && !editingBudget;
  const requestFlow = startBudgetProposal && !editingBudget && (showBudgetForm || proposalSent);
  const reportFormVisible = currentUserRole === 'ADMIN' && (reportFormOpen || (!loading && reports.length === 0));
  // The semesters a report can cover are the SAO's own, so they load once the report form is on screen. A semester
  // that has not started has nothing to report; the one picked at the top bar (else the active one) is preselected.
  useEffect(() => {
    if (activeTab !== 'reports' || !reportFormVisible || reportSemesters !== null) return;
    getAcademicPeriods()
      .then((periods) => {
        const reportable = (Array.isArray(periods) ? periods : []).filter((period) => period.status !== 'upcoming');
        const chosen = readSelectedPeriod();
        const preferred = reportable.find((period) => period.id === chosen?.id) || reportable.find((period) => period.status === 'active');
        setReportSemesters(reportable);
        if (preferred) setReportForm((current) => (current.academic_semester_id ? current : { ...current, academic_semester_id: String(preferred.id) }));
      })
      .catch(() => setReportSemesters([]));
  }, [activeTab, reportFormVisible, reportSemesters]);
  const sortedForecasts = sortForecasts(forecasts);

  // A form drawer carries its own filled button, so the header's one is hidden while it is open.
  let headerPrimary = null;
  if (showForm || showBudgetForm || requestFlow) {
    headerPrimary = null;
  } else if (activeTab === 'reports' && currentUserRole === 'ADMIN') {
    headerPrimary = reportFormVisible || loading ? null : <Button leftIcon={FileText} onClick={() => setReportFormOpen(true)}>Prepare a report</Button>;
  } else if (activeTab === 'transactions' && canManageLedger) {
    headerPrimary = <Button leftIcon={Plus} onClick={() => openTransactionForm()}>Record transaction</Button>;
  } else if (activeTab === 'budgets' && canProposeBudget) {
    headerPrimary = <Button leftIcon={Plus} onClick={() => openBudgetForm()}>Propose budget</Button>;
  } else if (activeTab === 'forecasting' && canGenerateForecast) {
    headerPrimary = <Button leftIcon={TrendingUp} disabled={forecastGenerating} onClick={handleGenerateForecast}>{forecastGenerating ? 'Generating...' : 'Generate forecast'}</Button>;
  }

  const missingRecordNotice = (noun) => (
    <p role="status" className="flex flex-wrap items-center gap-3 rounded-control border border-warning/40 bg-warning-tint px-4 py-3 text-sm text-ink">
      That {noun} was not found. It may have been deleted, or it belongs to another organization.
      <Button size="sm" variant="secondary" onClick={() => setRecordId(null)}>Dismiss</Button>
    </p>
  );

  // Cancel on the request page goes back to the request types; in the drawer it just closes.
  const cancelBudgetForm = () => (inlineBudgetForm ? navigate(REQUEST_SELECTOR_PATH) : closeBudgetForm());

  const budgetFormBody = (
    <form id="budget-form" className="space-y-4" onSubmit={handleCreateBudget}>
      <Field label="Title">
        <Input type="text" value={budgetForm.title} onChange={(e) => setBudgetForm({ ...budgetForm, title: e.target.value })} placeholder="e.g. Sports Fest 2026 Budget" />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Allocated amount (₱)">
          <Input type="number" min="0" step="0.01" value={budgetForm.allocated_amount} onChange={(e) => setBudgetForm({ ...budgetForm, allocated_amount: e.target.value })} placeholder="0.00" />
        </Field>
        <Field label="Warning threshold (₱)">
          <Input type="number" min="0" step="0.01" value={budgetForm.warning_threshold} onChange={(e) => setBudgetForm({ ...budgetForm, warning_threshold: e.target.value })} placeholder="0.00" />
        </Field>
      </div>
      <Field label="Linked event" optional>
        <HiusaSelect value={budgetForm.event_id} onChange={(e) => setBudgetForm({ ...budgetForm, event_id: e.target.value })}>
          <option value="">No linked event</option>
          {events.map((ev) => (
            <option key={ev.id} value={ev.id}>{formatDisplayText(ev.title)}</option>
          ))}
        </HiusaSelect>
      </Field>
      {budgetFormError && <p role="alert" className="text-sm font-semibold text-danger-strong">{budgetFormError}</p>}
    </form>
  );

  const budgetFormButtons = (
    <>
      <Button variant="secondary" onClick={cancelBudgetForm}>Cancel</Button>
      <Button
        type="submit"
        form="budget-form"
        loading={budgetFormSubmitting}
        disabled={!budgetForm.title.trim() || budgetForm.allocated_amount === '' || budgetForm.warning_threshold === ''}
      >
        {editingBudget ? 'Resubmit for approval' : 'Submit for approval'}
      </Button>
    </>
  );

  return (
    <div className="space-y-4 sm:space-y-5 pb-8">
      <FeedbackToast feedback={feedback} onClose={closeFeedback} />
      <PageHeader title={requestFlow ? (proposalSent ? 'Budget proposal sent' : 'Propose budget') : undefined} primary={headerPrimary} />

      {isDepartmentHead && OVERSIGHT_TABS.includes(activeTab) && (
        <Field label="Organization" className="max-w-sm">
          <HiusaSelect filter
            id="finance-organization"
            value={organizationFilter}
            onChange={(event) => { setOrganizationFilter(event.target.value); load(1, txFilters, appliedSearch, event.target.value); }}
          >
            <option value="">All organizations</option>
            {collegeOrganizations.map((organization) => <option key={organization.id} value={String(organization.id)}>{organization.name}</option>)}
          </HiusaSelect>
        </Field>
      )}

      {canViewTransactions && !error && !inlineBudgetForm && OVERSIGHT_TABS.includes(activeTab) && activeTab !== 'transactions' && (
        <p className="text-sm text-ink-muted">
          Ledger net balance <strong className="ml-1 font-semibold tabular-nums text-ink" aria-live="polite">{loading ? 'Loading…' : fmt(overallSummary.net_balance)}</strong>
        </p>
      )}

      {activeTab === 'transactions' && canViewTransactions && !loading && !ledgerLoading && !error && (
        <dl className="grid grid-cols-1 divide-y divide-line rounded-card border border-line bg-surface sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="p-4"><dt className="text-xs font-medium text-ink-muted">Income</dt><dd className="mt-1 text-xl font-semibold tabular-nums text-success-strong">{fmt(summary.total_income)}</dd></div>
          <div className="p-4"><dt className="text-xs font-medium text-ink-muted">Expenses</dt><dd className="mt-1 text-xl font-semibold tabular-nums text-ink">{fmt(summary.total_expense)}</dd></div>
          <div className="p-4"><dt className="text-xs font-medium text-ink-muted">Net balance</dt><dd className="mt-1 text-xl font-semibold tabular-nums text-ink">{fmt(summary.net_balance)}</dd></div>
        </dl>
      )}

      {error && <ErrorState title="Financial data did not load" description={error} onRetry={() => load()} />}

      {activeTab === 'transactions' && (
        <section aria-label="Ledger" className="overflow-hidden rounded-card border border-line bg-surface">
          <TableFilterBar
            searchValue={search}
            onSearchChange={(value) => {
              setSearch(value);
              if (!value && appliedSearch) applySearch('');
            }}
            onSearchSubmit={() => applySearch(search)}
            searchPlaceholder="Search transactions..."
            activeFilters={activeTransactionFilters}
            onClear={clearTransactionFilters}
            resultCount={txMeta.total}
            resultLabel={txMeta.total === 1 ? 'transaction' : 'transactions'}
            secondaryClassName="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
          >
            <HiusaSelect filter
              value={txFilters.type}
              onChange={(e) => { const next = { ...txFilters, type: e.target.value }; setTxFilters(next); load(1, next); }}
              aria-label="Filter by transaction type"
            >
              <option value="">All types</option>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
            </HiusaSelect>
            <HiusaSelect filter
              value={txFilters.event_id}
              onChange={(e) => { const next = { ...txFilters, event_id: e.target.value }; setTxFilters(next); load(1, next); }}
              aria-label="Filter by event"
            >
              <option value="">All events</option>
              {events.map((event) => <option key={event.id} value={event.id}>{formatDisplayText(event.title)}</option>)}
            </HiusaSelect>
            <Input
              type="date"
              value={txFilters.from}
              onChange={(e) => { const next = { ...txFilters, from: e.target.value }; setTxFilters(next); load(1, next); }}
              aria-label="Filter from date"
            />
            <Input
              type="date"
              value={txFilters.to}
              onChange={(e) => { const next = { ...txFilters, to: e.target.value }; setTxFilters(next); load(1, next); }}
              aria-label="Filter to date"
            />
          </TableFilterBar>

          {error ? null : loading || ledgerLoading ? (
            <div className="p-4"><SkeletonTable rows={5} columns={5} className="border-0" /></div>
          ) : filtered.length === 0 ? (
            <div className="px-4 sm:px-5">
              {activeTransactionFilters.length > 0 ? (
                <EmptyState kind="filtered" title="No matching transactions" description="Try a different search or clear the filters." onClearFilters={clearTransactionFilters} />
              ) : canManageLedger ? (
                <EmptyState
                  icon={Wallet}
                  title="No transactions recorded yet"
                  description="Verified collections, cash advances, paid student charges and merchandise orders post here by themselves. Choose Record transaction above for anything else."
                />
              ) : (
                <EmptyState
                  kind="restricted"
                  title="No transactions to show yet"
                  description="Only the organization Admin records transactions. Verified collections, cash advances, paid charges and orders post here by themselves."
                />
              )}
            </div>
          ) : (
            <div>
              <ul className="divide-y divide-line md:hidden" aria-label="Transactions">
                {filtered.map((tx) => {
                  const meta = ledgerMeta(tx);
                  const receipt = ledgerReference(tx);
                  const lockNote = ledgerLockNote(tx);
                  return <li key={tx.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><p className="text-sm font-semibold text-ink">{tx.description}</p><p className="mt-1 text-xs text-ink-muted">{formatLedgerDate(tx.transaction_date)} · {tx.category}</p></div>
                      <span className={`shrink-0 text-sm font-semibold tabular-nums ${tx.type === 'income' ? 'text-success-strong' : 'text-ink'}`}>{tx.type === 'income' ? '+' : '−'}{fmt(tx.amount)}</span>
                    </div>
                    {(meta.length > 0 || receipt) && (
                      <div className="mt-2 space-y-1 text-xs text-ink-muted">
                        {meta.length > 0 && <p>{meta.join(' · ')}</p>}
                        {receipt && <p>Reference {receipt}</p>}
                      </div>
                    )}
                    {canManageLedger && lockNote && <p className="mt-3 text-xs text-ink-muted">{lockNote}</p>}
                    {canManageLedger && !lockNote && <TableRowActions subject={tx.description || `Transaction ${tx.id}`} actions={[
                      { label: 'Edit transaction', icon: Pencil, onClick: () => openTransactionForm(tx) },
                      { label: 'Delete transaction', icon: Trash2, danger: true, onClick: () => askDelete('transaction', tx) },
                    ]} />}
                  </li>;
                })}
              </ul>
              <div className="hidden md:block">
              <table className="w-full text-left">
                <caption className="sr-only">Ledger transactions</caption>
                <thead className="bg-subtle text-xs font-semibold text-ink-muted">
                  <tr>
                    <th scope="col" className="px-4 py-2.5">Date</th>
                    <th scope="col" className="px-4 py-2.5">Description</th>
                    <th scope="col" className="hidden 2xl:table-cell px-4 py-2.5">Source</th>
                    <th scope="col" className="hidden 2xl:table-cell px-4 py-2.5">Payer / Recorder</th>
                    <th scope="col" className="px-4 py-2.5">Category</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Amount</th>
                    {canManageLedger && <th scope="col" className="px-4 py-2.5 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft text-sm">
                  {filtered.map((tx) => {
                    const sources = ledgerSource(tx);
                    const meta = ledgerMeta(tx);
                    const receipt = ledgerReference(tx);
                    const payer = personName(tx.payer, '');
                    const recorder = personName(tx.recorder, '');
                    const lockNote = ledgerLockNote(tx);
                    return (
                    <tr key={tx.id} className="transition-colors duration-150 hover:bg-subtle">
                      <td className="whitespace-nowrap px-4 py-2.5 text-ink-muted">{formatLedgerDate(tx.transaction_date)}</td>
                      <td className="px-4 py-2.5">
                        <p className="font-semibold text-ink">{tx.description}</p>
                        {receipt && <p className="mt-0.5 text-xs text-ink-muted">{receipt}</p>}
                        {meta.length > 0 && <p className="mt-0.5 text-xs text-ink-muted 2xl:hidden">{meta.join(' · ')}</p>}
                        {canManageLedger && lockNote && <p className="mt-0.5 text-xs text-ink-muted">{lockNote}</p>}
                      </td>
                      <td className="hidden px-4 py-2.5 2xl:table-cell">
                        {sources.map((source, sourceIndex) => <p key={`${source}-${sourceIndex}`} className="max-w-48 truncate text-ink">{source}</p>)}
                      </td>
                      <td className="hidden px-4 py-2.5 text-xs 2xl:table-cell">
                        {payer && <p className="text-ink">{payer}</p>}
                        {recorder && <p className="mt-0.5 text-ink-muted">Recorded by {recorder}</p>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-ink">{tx.category}</td>
                      <td className={`whitespace-nowrap px-4 py-2.5 text-right tabular-nums ${tx.type === 'income' ? 'text-success-strong' : 'text-ink'}`}>
                        {tx.type === 'income' ? '+' : '-'}{fmt(tx.amount)}
                      </td>
                      {canManageLedger && (
                        <td className="px-4 py-2.5 text-right">
                          {lockNote ? <span className="text-xs text-ink-muted">Locked</span> : (
                            <div className="flex justify-end">
                              <TableRowActions subject={tx.description || `Transaction ${tx.id}`} label="Transaction actions" actions={[
                                { label: 'Edit transaction', icon: Pencil, onClick: () => openTransactionForm(tx) },
                                { label: 'Delete transaction', icon: Trash2, danger: true, onClick: () => askDelete('transaction', tx) },
                              ]} />
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </div>
          )}

          {txMeta.total > txMeta.per_page && (
            <div className="flex items-center justify-between border-t border-line px-4 py-3 sm:px-5">
              <p className="text-xs text-ink-muted">
                Showing <span className="font-semibold tabular-nums text-ink">{txFrom}-{txTo}</span> of <span className="font-semibold tabular-nums text-ink">{txMeta.total}</span>
              </p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Previous transaction page"
                  onClick={() => load(txMeta.current_page - 1)}
                  disabled={txMeta.current_page === 1}
                  className="grid h-10 w-10 place-items-center rounded-control border border-line text-ink-muted transition-colors duration-150 hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="px-2 text-[13px] font-semibold tabular-nums text-ink">
                  {txMeta.current_page} / {txMeta.last_page}
                </span>
                <button
                  type="button"
                  aria-label="Next transaction page"
                  onClick={() => load(txMeta.current_page + 1)}
                  disabled={txMeta.current_page === txMeta.last_page}
                  className="grid h-10 w-10 place-items-center rounded-control border border-line text-ink-muted transition-colors duration-150 hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {inlineBudgetForm && (
        <section aria-label="Budget proposal" className="max-w-2xl space-y-5">
          <p className="text-sm text-ink-muted">The Department Head approves a budget before funds can be tracked against it.</p>
          {budgetFormBody}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{budgetFormButtons}</div>
        </section>
      )}

      {proposalSent && requestFlow && (
        <section aria-label="Budget proposal sent" className="max-w-2xl space-y-3">
          <p className="text-sm text-ink-muted">It is waiting for the Department Head to review it. You can follow it on the budgets page.</p>
          <Button variant="secondary" to={BUDGETS_PATH}>View budgets</Button>
        </section>
      )}

      {activeTab === 'budgets' && !requestFlow && !error && (
        <section aria-label="Budgets" className="overflow-hidden rounded-card border border-line bg-surface">
          {recordMissing && <div className="border-b border-line p-4">{missingRecordNotice('budget')}</div>}

          {loading ? (
            <div className="p-4"><SkeletonTable rows={3} columns={4} className="border-0" /></div>
          ) : budgets.length === 0 ? (
            <div className="px-4 sm:px-5">
              {canProposeBudget ? (
                <EmptyState
                  icon={Wallet}
                  title="No budgets yet"
                  description="A budget sets how much an event or activity may spend, and the ledger tracks spending against it. Choose Propose budget above to send your first one to the Department Head for approval."
                />
              ) : (
                <EmptyState
                  kind="restricted"
                  title="No budgets to show yet"
                  description="Only the organization Admin proposes budgets. They appear here, with their approval stage, once the Admin proposes one."
                />
              )}
            </div>
          ) : (
            <ul className="divide-y divide-line" aria-label="Budgets">
              {budgets.map((b) => {
                const adviceDetail = budgetAdviceDetails[b.id] || b.advice_details;
                const adviceStale = b.advice_stale === true;
                const adviceInputs = adviceDetail?.advice?.inputs;
                // Remaining counts income recorded against the budget, so it can sit above Allocated.
                const aboveAllocated = Number(b.remaining_amount) > Number(b.allocated_amount);
                return (
                <li key={b.id} className="flex flex-col gap-4 p-4 sm:p-5 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => setRecordId(b.id)} className="rounded-control text-left text-sm font-semibold text-ink hover:underline">{formatDisplayText(b.title)}</button>
                      {/* Approved is the default state of a budget, so only the others carry a badge. */}
                      {b.approval_status !== 'approved' && <StatusBadge status={b.approval_status || 'pending'} />}
                    </div>
                    {b.event && <p className="mt-1 text-xs text-ink-muted">{formatDisplayText(b.event.title)}</p>}
                    {b.financial_semester && <p className="mt-1 text-xs text-ink-muted">Semester: {formatDisplayText(b.financial_semester.name)}</p>}
                    <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:flex sm:flex-wrap sm:gap-x-8">
                      <div><dt className="text-ink-muted">Allocated</dt><dd className="mt-0.5 font-semibold tabular-nums text-ink">{fmt(b.allocated_amount)}</dd></div>
                      <div><dt className="text-ink-muted">Remaining</dt><dd className="mt-0.5 font-semibold tabular-nums text-ink">{fmt(b.remaining_amount)}</dd></div>
                    </dl>
                    {aboveAllocated && <p className="mt-1 text-xs text-ink-muted">Remaining includes income recorded against this budget.</p>}
                    {b.overspending_risk && (
                      <p className={`mt-2 text-xs font-medium ${b.overspending_risk === 'high' ? 'text-danger-strong' : b.overspending_risk === 'medium' ? 'text-warning-strong' : 'text-success-strong'}`}>
                        {sentence(b.overspending_risk)} overspending risk
                      </p>
                    )}
                    {adviceStale && (
                      <p className="mt-2 flex max-w-3xl items-start gap-1.5 text-xs font-medium text-warning-strong">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                        The advice from {manilaDate(b.advice_generated_at)} is out of date because this budget&apos;s balance changed.{canGenerateBudgetAdvice && b.submission_status === 'approved' ? ' Use Get advice to refresh it.' : ''}
                      </p>
                    )}
                    {!adviceStale && b.recommended_allocation != null && (
                      <p className="mt-1 text-xs text-ink-muted">
                        Recommended allocation {fmt(b.recommended_allocation)} · Safe spending ceiling {fmt(b.safe_spending_limit)}
                      </p>
                    )}
                    {!adviceStale && b.advice_generated_at && <p className="mt-1 text-xs text-ink-muted">Advice from {manilaDate(b.advice_generated_at)}</p>}
                    {!adviceStale && b.advisory_note && <p className="mt-1 max-w-3xl text-xs text-ink-muted">{b.advisory_note}</p>}
                    {canGenerateBudgetAdvice && budgetAdviceErrors[b.id] && (
                      <div className="mt-2 flex max-w-3xl flex-wrap items-center justify-between gap-3 text-xs font-medium text-danger-strong">
                        <span className="flex items-start gap-1.5"><AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />{budgetAdviceErrors[b.id]}</span>
                        <Button variant="secondary" size="sm" onClick={() => handleGenerateBudgetAdvice(b.id)}>Retry</Button>
                      </div>
                    )}
                    {adviceDetail?.advice && !adviceStale && (
                      <div className="mt-3 max-w-3xl border-t border-line pt-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <EngineBadge engine={adviceDetail.engine} />
                          {adviceDetail.advice.allocation_status && (
                            <StatusBadge tone={allocationStatusTone[adviceDetail.advice.allocation_status] || 'neutral'} label={allocationStatusLabel[adviceDetail.advice.allocation_status] || adviceDetail.advice.allocation_status} />
                          )}
                          {adviceDetail.advice.xai_model && (
                            <span className="text-xs text-ink-muted">Explained by {adviceDetail.advice.xai_model}</span>
                          )}
                          {adviceDetail.advice.xai_status === 'unavailable' && (
                            <span className="text-xs font-medium text-warning-strong">The written explanation is unavailable. The figures and advice are calculated from your ledger; use Get advice to retry.</span>
                          )}
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                          {adviceDetail.advice.reserve_amount != null && (
                            <span className="text-ink-muted">Reserve <strong className="block font-semibold text-ink">{fmt(adviceDetail.advice.reserve_amount)}</strong></span>
                          )}
                          {adviceDetail.advice.expense_to_income_ratio != null && (
                            <span className="text-ink-muted">Expense/income ratio <strong className="block font-semibold text-ink">{(Number(adviceDetail.advice.expense_to_income_ratio) * 100).toFixed(1)}%</strong></span>
                          )}
                        </div>
                        <RulesDisclosure
                          label="How this was calculated"
                          items={[
                            ...(adviceInputs
                              ? [
                                `Budget balance used: ${fmt(adviceInputs.current_available_budget)}.`,
                                adviceInputs.forecast_status === 'used'
                                  ? `Forecast used: ${adviceInputs.forecast_period}, this budget's ${(Number(adviceInputs.budget_share) * 100).toFixed(1)}% share of the approved allocations, which is expected income ${fmt(adviceInputs.predicted_income)} and expenses ${fmt(adviceInputs.predicted_expense)}.`
                                  : adviceInputs.forecast_status === 'not_applied'
                                    ? 'This budget is outside the current semester, so no forecast income or expenses were used.'
                                    : 'No current forecast was available, so no forecast income or expenses were used.',
                              ]
                              : []),
                            ...(adviceDetail.advice.deterministic_advice
                              ? [`Calculated advice before the written rewrite: "${adviceDetail.advice.deterministic_advice}"`]
                              : []),
                            ...(Array.isArray(adviceDetail.advice.rules_applied) ? adviceDetail.advice.rules_applied : []),
                          ]}
                        />
                      </div>
                    )}
                  </div>
                  <TableRowActions subject={formatDisplayText(b.title)} actions={[
                    { label: `View details for ${formatDisplayText(b.title)}`, icon: Eye, onClick: () => setRecordId(b.id) },
                    canGenerateBudgetAdvice && b.submission_status === 'approved' && { label: 'Get advice', disabled: budgetAdviceGenerating === b.id, onClick: () => handleGenerateBudgetAdvice(b.id) },
                    canProposeBudget && b.submission_status !== 'approved' && { label: 'Delete budget', icon: Trash2, danger: true, onClick: () => askDelete('budget', b) },
                  ]} />
                </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {activeTab === 'forecasting' && !error && (
        <section aria-label="Forecast" className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
          <div className="rounded-card border border-line bg-surface p-4 sm:p-5">
            {forecastGenError && (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-sm font-medium text-danger-strong">
                <span className="flex items-start gap-1.5"><AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{forecastGenError}</span>
                {canGenerateForecast && <Button variant="secondary" size="sm" onClick={handleGenerateForecast}>Retry</Button>}
              </div>
            )}
            {loading ? (
              <SkeletonTable rows={3} columns={3} className="border-0" />
            ) : forecasts.length === 0 ? (
              canGenerateForecast ? (
                <EmptyState
                  icon={TrendingUp}
                  title="No forecasts yet"
                  description="A forecast projects income and spending from the months of ledger history you have. Choose Generate forecast above once the ledger covers at least a few months."
                />
              ) : (
                <EmptyState kind="restricted" title="No forecasts to show yet" description="Only the organization Admin generates forecasts. They appear here once one is generated." />
              )
            ) : (
              <div className="space-y-6">
                {groupForecastsByOrganization(sortedForecasts).map((group) => (
                <div key={group.key} className="space-y-4">
                {group.name && <h3 className="text-sm font-semibold text-ink">{formatDisplayText(group.name)}</h3>}
                {/* The chart's axis text is unreadable at phone width, and each forecast below lists the same figures. */}
                {group.forecasts.length > 1 && <div className="hidden sm:block"><FinancialForecastChart forecasts={group.forecasts} className="" /></div>}
                <ul className="divide-y divide-line border-t border-line">
                  {[...group.forecasts].reverse().map((f) => {
                    const reliability = getForecastReliability(f);
                    const clampNotice = getClampNotice(f);
                    const sampleMonths = f.model_details?.sample_months;
                    const populatedMonths = f.model_details?.populated_months;
                    const summaryText = reliability.reason && f.confidence_note ? f.confidence_note.replace(reliability.reason, '').trim() : f.confidence_note;
                    return (
                      <li key={f.id} className="py-4">
                        <p className="text-sm font-semibold text-ink">Forecast for {f.forecast_period}</p>
                        {hasProjection(f) ? (
                          <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                            <div><dt className="text-ink-muted">Income</dt><dd className="mt-0.5 text-sm font-semibold tabular-nums text-success-strong">{fmt(f.predicted_income)}</dd></div>
                            <div><dt className="text-ink-muted">Expenses</dt><dd className="mt-0.5 text-sm font-semibold tabular-nums text-danger-strong">{fmt(f.predicted_expense)}</dd></div>
                            <div><dt className="text-ink-muted">Balance</dt><dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink">{fmt(f.predicted_balance)}</dd></div>
                            {f.model_details?.current_available_budget != null && <div><dt className="text-ink-muted">Left in approved budgets</dt><dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink">{fmt(f.model_details.current_available_budget)}</dd></div>}
                            <div><dt className="text-ink-muted">Safe spend</dt><dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink">{fmt(f.safe_spending_limit)}</dd></div>
                            {f.model_details?.risk && <div><dt className="text-ink-muted">Risk</dt><dd className="mt-0.5 text-sm font-semibold text-ink">{sentence(f.model_details.risk)}</dd></div>}
                          </dl>
                        ) : (
                          <p className="mt-3 text-sm text-ink-muted">Not enough ledger history to project this period. Record income and expenses over a few months, then generate again.</p>
                        )}
                        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ink-muted">
                          {f.model_details?.engine === 'manual'
                            ? <span>Entered manually. Safe spend is 80% of the balance and leaves out approved budgets.</span>
                            : <EngineBadge engine={f.model_details?.engine} />}
                          {Number.isFinite(Number(sampleMonths)) && <span>{sampleMonths} sample month{Number(sampleMonths) === 1 ? '' : 's'}</span>}
                          {Number.isFinite(Number(populatedMonths)) && <span>{populatedMonths} with recorded transactions</span>}
                        </div>
                        {!reliability.isReliable && (
                          <p className="mt-3 flex items-start gap-1.5 text-xs font-medium text-warning-strong">
                            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                            {reliability.reason || 'Weak confidence in this projection. Treat the figures as directional only.'}
                          </p>
                        )}
                        {clampNotice && (
                          <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-danger-strong">
                            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                            {clampNotice}
                          </p>
                        )}
                        {summaryText && <p className="mt-3 text-xs text-ink-muted">{summaryText}</p>}
                        {f.model_details?.explanation_status === 'unavailable' && <p className="mt-2 text-xs font-medium text-warning-strong">The written explanation was unavailable. The forecast figures and risk were calculated normally; generate again to retry the explanation.</p>}
                        {canDeleteForecast && <div className="mt-3 border-t border-line pt-3"><TableRowActions subject={f.summary_text || `Forecast ${f.id}`} actions={[{ label: 'Delete forecast', icon: Trash2, danger: true, onClick: () => askDelete('forecast', f) }]} /></div>}
                      </li>
                    );
                  })}
                </ul>
                </div>
                ))}
              </div>
            )}
          </div>

          <div className="self-start rounded-card border border-line bg-surface p-4 sm:p-5">
            <h2 className="text-base font-semibold text-ink">Summary by category</h2>
            {(overallSummary.by_category || []).length === 0 ? (
              <p className="mt-3 text-sm text-ink-muted">No category data available.</p>
            ) : (
              <table className="mt-3 w-full text-sm">
                <caption className="sr-only">Totals by category</caption>
                <thead>
                  <tr className="border-b border-line text-xs font-semibold text-ink-muted">
                    <th scope="col" className="py-2 text-left">Category</th>
                    <th scope="col" className="py-2 text-left">Type</th>
                    <th scope="col" className="py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(overallSummary.by_category || []).map((cat) => (
                    <tr key={cat.category + cat.type} className="border-b border-line-soft last:border-b-0">
                      <td className="py-2.5 font-normal text-ink">{cat.category}</td>
                      <td className={`py-2.5 text-xs ${cat.type === 'income' ? 'text-success-strong' : 'text-ink-muted'}`}>{sentence(cat.type)}</td>
                      <td className="py-2.5 text-right tabular-nums text-ink">{fmt(cat.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}

      {activeTab === 'reports' && !error && (
        <div className="space-y-6">
          {reportFormVisible && <section aria-labelledby="prepare-report-title" className="rounded-card border border-line bg-surface p-4 sm:p-5">
            <h2 id="prepare-report-title" className="text-base font-semibold text-ink">Prepare a report</h2>
            <form onSubmit={handleGenerateReport} className="mt-4 space-y-5">
              <fieldset>
                <legend className="text-[13px] font-medium text-ink">Document</legend>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  {[
                    { value: 'financial_report', title: 'Financial Report', text: 'Detailed inflow and cash-outflow ledger with opening and closing balances.' },
                    { value: 'income_statement', title: 'Income Statement', text: 'Category totals, net income, and a formal submission letter.' },
                  ].map((option) => (
                    <label key={option.value} className={`min-h-16 cursor-pointer rounded-control border p-3 transition-colors duration-150 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-600 ${reportForm.document_type === option.value ? 'border-brand-600 bg-brand-600/10' : 'border-line bg-surface hover:bg-subtle'}`}>
                      <input type="radio" name="document_type" value={option.value} checked={reportForm.document_type === option.value} onChange={(event) => setReportForm({ ...reportForm, document_type: event.target.value })} className="sr-only" />
                      <span className="block text-sm font-semibold text-ink">{option.title}</span>
                      <span className="mt-1 block text-xs text-ink-muted">{option.text}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Covered period" className="min-w-0">
                  <HiusaSelect className="min-w-0 w-full" value={reportForm.report_type} onChange={(event) => setReportForm({ ...reportForm, report_type: event.target.value })}>
                    <option value="semester">Semester</option>
                    <option value="event">One event</option>
                    <option value="monthly">This month</option>
                    <option value="custom">Custom dates</option>
                  </HiusaSelect>
                </Field>
                {reportForm.report_type === 'semester' ? <Field label="Semester" required className="min-w-0">
                  <HiusaSelect className="min-w-0 w-full" value={reportForm.academic_semester_id} onChange={(event) => setReportForm({ ...reportForm, academic_semester_id: event.target.value })}><option value="">Select semester</option>{(reportSemesters || []).map((semester) => <option key={semester.id} value={semester.id}>AY {semester.academic_year?.label}, {semester.number === 1 ? '1st' : '2nd'} Semester ({String(semester.starts_on).slice(0, 10)} to {String(semester.ends_on).slice(0, 10)})</option>)}</HiusaSelect>
                </Field> : null}
                {reportForm.report_type === 'event' && <Field label="Event" required>
                  <HiusaSelect value={reportForm.event_id} onChange={(event) => setReportForm({ ...reportForm, event_id: event.target.value })}>
                    <option value="">Select event</option>
                    {events.map((event) => <option key={event.id} value={event.id}>{formatDisplayText(event.title)}</option>)}
                  </HiusaSelect>
                </Field>}
                {reportForm.report_type === 'custom' && <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
                  <Field label="Start date" required><Input type="date" value={reportForm.period_start} onChange={(event) => setReportForm({ ...reportForm, period_start: event.target.value })} /></Field>
                  <Field label="End date" required><Input type="date" min={reportForm.period_start || undefined} value={reportForm.period_end} onChange={(event) => setReportForm({ ...reportForm, period_end: event.target.value })} /></Field>
                </div>}
              </div>

              <div className="border-t border-line pt-4">
                <Field label="Letterhead image" optional hint="PNG or JPG, up to 5 MB. The PDF repeats it at the top of every page." className="max-w-xl">
                  <input type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" onChange={(event) => {
                    const file = event.target.files?.[0] || null;
                    if (file && file.size > 5 * 1024 * 1024) {
                      event.target.value = '';
                      showFeedback('error', 'The letterhead image must be 5 MB or smaller.');
                      return;
                    }
                    setReportForm({ ...reportForm, letterhead: file });
                  }} className="block min-h-10 w-full rounded-control border border-line bg-surface px-3 py-1.5 text-sm text-ink file:mr-3 file:rounded-control file:border-0 file:bg-subtle file:px-3 file:py-1 file:text-xs file:font-semibold file:text-ink" />
                </Field>
              </div>

              {reportForm.document_type === 'income_statement' && (
                <div className="grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
                  <Field label="Letter date" optional><Input type="date" value={reportForm.letter_date} onChange={(event) => setReportForm({ ...reportForm, letter_date: event.target.value })} /></Field>
                  <Field label="Subject" optional><Input value={reportForm.letter_subject} onChange={(event) => setReportForm({ ...reportForm, letter_subject: event.target.value })} placeholder="Defaults to Submission of Income Statement" /></Field>
                  <Field label="Recipient" optional className="sm:col-span-2"><Input value={reportForm.letter_recipient} onChange={(event) => setReportForm({ ...reportForm, letter_recipient: event.target.value })} placeholder="Defaults to To whom it may concern" /></Field>
                  <Field label="Letter body" optional className="sm:col-span-2"><RichTextEditor id="income-letter-body" value={reportForm.letter_body} onChange={(letter_body) => setReportForm({ ...reportForm, letter_body })} rows={4} maxLength={2000} placeholder="Leave blank to use a factual period and balance summary." /></Field>
                  <Field label="Closing" optional className="sm:col-span-2"><Input value={reportForm.letter_closing} onChange={(event) => setReportForm({ ...reportForm, letter_closing: event.target.value })} placeholder="Defaults to Thank you." /></Field>
                </div>
              )}

              <div className="grid gap-3 border-t border-line pt-4 sm:grid-cols-2 xl:grid-cols-4">
                {[['treasurer', 'Treasurer'], ['president', 'President'], ['adviser', 'Adviser'], ['sbo_adviser', 'SBO Adviser']].map(([key, label]) => <Field key={key} label={label} required><Input value={reportForm[key]} onChange={(event) => setReportForm({ ...reportForm, [key]: event.target.value })} placeholder={`${label} full name`} /></Field>)}
              </div>

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                {reports.length > 0 && <Button variant="secondary" onClick={() => setReportFormOpen(false)}>Close</Button>}
                <Button type="submit" leftIcon={FileText} loading={reportGenerating} className="w-full sm:w-auto">
                  {reportGenerating ? 'Generating...' : `Generate ${reportForm.document_type === 'income_statement' ? 'income statement' : 'financial report'}`}
                </Button>
              </div>
            </form>

            {generatedReport && (
              <div className="mt-5 border-t border-line pt-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-ink">{formatDisplayText(generatedReport.report.title)}</h3>
                    <p className="mt-1 max-w-3xl text-sm text-ink-muted">{generatedReport.report.summary_text}</p>
                    {generatedReport.ai_summary_status === 'unavailable' && <p className="mt-2 text-xs font-medium text-warning-strong">The written summary was unavailable. This report was saved with calculated totals and a standard summary; generate it again to retry.</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" leftIcon={FileSpreadsheet} onClick={() => exportGeneratedReport('excel')}>Excel</Button>
                    <Button variant="secondary" leftIcon={FileText} disabled={reportPdfDownloading === generatedReport.report.id} onClick={() => exportGeneratedReport('pdf')}>{reportPdfDownloading === generatedReport.report.id ? 'Preparing...' : 'Download PDF'}</Button>
                    <Button variant="secondary" leftIcon={Eye} disabled={reportPdfDownloading === generatedReport.report.id} onClick={() => handlePreviewReportPdf(generatedReport.report)}>Preview / print</Button>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                  <p className="text-ink-muted">Income <strong className="block font-semibold tabular-nums text-success-strong">{fmt(generatedReport.totals.income)}</strong></p>
                  <p className="text-ink-muted">Expenses <strong className="block font-semibold tabular-nums text-danger-strong">{fmt(generatedReport.totals.expense)}</strong></p>
                  <p className="text-ink-muted">{generatedReport.report.document_type === 'income_statement' ? 'Net income' : 'Closing balance'} <strong className="block font-semibold tabular-nums text-ink">{fmt(generatedReport.report.document_type === 'income_statement' ? generatedReport.totals.balance : generatedReport.totals.closing_balance)}</strong></p>
                </div>
                {(generatedReport.cash_advances?.released > 0 || generatedReport.cash_advances?.repayments > 0) && <p className="mt-3 text-xs text-ink-muted">Cash advances released: <strong className="font-semibold">{fmt(generatedReport.cash_advances.released)}</strong> · Cash advance repayments: <strong className="font-semibold">{fmt(generatedReport.cash_advances.repayments)}</strong>. Money lent out and returned is not income or expense.</p>}
                {generatedReport.custody && <p className="mt-3 text-xs text-ink-muted">Verified collections: <strong className="font-semibold">{fmt(generatedReport.custody.verified_collections)}</strong> · Recorded remittances: <strong className="font-semibold">{fmt(generatedReport.custody.recorded_remittances)}</strong>. Remittances do not add ledger income.</p>}
                <p className="mt-3 text-xs text-ink-muted">
                  Includes {(generatedReport.transactions || []).length} ledger entries, {(generatedReport.audit_logs || []).length} audit entries,
                  {' '}{(generatedReport.budget_advisories || []).length} budget advisories, and {generatedReport.latest_ols_forecast ? 'the latest forecast' : 'no available forecast'}.
                </p>
              </div>
            )}
          </section>}

          <section aria-labelledby="quick-exports-title" className="rounded-card border border-line bg-surface p-4 sm:p-5">
            <h2 id="quick-exports-title" className="text-base font-semibold text-ink">Quick exports</h2>
            <ul className="mt-2 divide-y divide-line-soft">
              {[
                { key: 'log', title: 'Full transaction log', desc: 'Complete ledger of every transaction recorded in the semester selected at the top' },
                { key: 'category', title: 'Category breakdown', desc: 'Totals grouped by category and type for the semester selected at the top' },
              ].map((report) => (
                <li key={report.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{report.title}</p>
                    <p className="text-xs text-ink-muted">{report.desc}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" leftIcon={FileSpreadsheet} onClick={() => handleExport(report.key, 'excel')}>Export Excel</Button>
                    <Button variant="secondary" leftIcon={FileText} onClick={() => handleExport(report.key, 'pdf')}>Print / save PDF</Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="saved-reports-title" className="rounded-card border border-line bg-surface">
            <div className="border-b border-line p-4 sm:p-5">
              <h2 id="saved-reports-title" className="text-base font-semibold text-ink">Saved reports</h2>
              {reports.length > 0 && <div className="mt-3 flex flex-wrap items-end gap-3">
                <Input aria-label="Search report history" placeholder="Search reports" value={reportFilter.search} onChange={(event) => setReportFilter({ ...reportFilter, search: event.target.value })} className="min-w-56 flex-1" />
                <HiusaSelect filter aria-label="Filter reports by status" value={reportFilter.status} onChange={(event) => setReportFilter({ ...reportFilter, status: event.target.value })} className="w-52 max-w-full"><option value="">All statuses</option>{Object.entries(REPORT_STATUS_LABELS).map(([status, label]) => <option key={status} value={status}>{label}</option>)}</HiusaSelect>
                <HiusaSelect filter aria-label="Filter reports by event" value={reportFilter.event_id} onChange={(event) => setReportFilter({ ...reportFilter, event_id: event.target.value })} className="w-52 max-w-full"><option value="">All events</option>{events.map((event) => <option key={event.id} value={event.id}>{formatDisplayText(event.title)}</option>)}</HiusaSelect>
                {reportFiltersActive && visibleReports.length > 0 && <button type="button" onClick={clearReportFilters} className="min-h-10 rounded-control text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">Clear filters</button>}
              </div>}
            </div>
            {recordMissing && <div className="border-b border-line p-4">{missingRecordNotice('report')}</div>}
            {reports.length === 0 ? (
              <div className="px-4 sm:px-5">
                {currentUserRole === 'ADMIN' ? (
                  <EmptyState
                    icon={FileText}
                    title="No saved reports yet"
                    description="A financial report or income statement turns your ledger into a document for review. Generate one above; it saves here as a draft, then you submit it to the Department Head."
                  />
                ) : (
                  <EmptyState kind="restricted" title="No saved reports to show yet" description="Only the organization Admin prepares financial reports. They appear here, with their approval stage, once saved." />
                )}
              </div>
            ) : visibleReports.length === 0 ? (
              <div className="px-4 sm:px-5">
                <EmptyState kind="filtered" title="No saved reports match these filters" description="Try a different search or clear the filters." onClearFilters={reportFiltersActive ? clearReportFilters : undefined} />
              </div>
            ) : (
              <ul className="divide-y divide-line" aria-label="Saved reports">
                {visibleReports.map((report) => {
                  const lifecycle = financialReportLifecycle(withDraftDefault(report), currentUserRole);
                  return (
                  <li key={report.id} className="p-4 sm:p-5">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <button type="button" onClick={() => setRecordId(report.id)} className="rounded-control text-left text-sm font-semibold text-ink hover:underline">{formatDisplayText(report.title)}</button>
                      <span className="text-xs tabular-nums text-ink-muted">{String(report.generated_at || '').slice(0, 10)}</span>
                    </div>
                    <p className="mt-1 text-xs text-ink-muted">{report.document_type === 'income_statement' ? 'Income statement' : 'Financial report'}{report.summary_text ? ` · ${report.summary_text}` : ''}</p>
                    <FlowStepper variant="compact" ariaLabel={`Report progress for ${formatDisplayText(report.title)}`} steps={lifecycle.steps} summary={lifecycle.nextAction.title} className="mt-3 max-w-sm" />
                    <p className="mt-1 hidden text-xs text-ink-muted-strong sm:block">{lifecycle.nextAction.title}</p>
                    <div className="mt-3">
                      <TableRowActions subject={formatDisplayText(report.title)} actions={[
                        { label: `View details for ${formatDisplayText(report.title)}`, icon: Eye, onClick: () => setRecordId(report.id) },
                        { label: 'Export Excel', icon: FileSpreadsheet, disabled: reportExcelDownloading === report.id, onClick: () => handleExportSavedReport(report) },
                        { label: 'Download PDF', icon: Download, disabled: reportPdfDownloading === report.id, onClick: () => handleDownloadReportPdf(report) },
                        { label: 'Preview / print', icon: Eye, disabled: reportPdfDownloading === report.id, onClick: () => handlePreviewReportPdf(report) },
                      ]} />
                    </div>
                  </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}

      {activeTab === 'receipts' && !error && (
        <section aria-label="Receipts">
          {loading ? (
            <SkeletonTable rows={3} columns={3} />
          ) : personalReceipts.length === 0 ? (
            currentUserRole === 'STUDENT' ? (
              <EmptyState icon={ReceiptText} title="No receipts yet" description="A receipt appears here after a payment you made is verified by the organization." />
            ) : (
              <EmptyState
                icon={ReceiptText}
                title="No receipts of your own"
                description="This page holds receipts for payments you made as a student. Payments recorded for the organization are in the ledger."
                action={currentUserRole === 'ADMIN' || currentUserRole === 'SBO_OFFICER' ? <Button variant="secondary" to="/dashboard/finance/financial-ledger">Open the ledger</Button> : undefined}
              />
            )
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {personalReceipts.map((receipt) => (
                <li key={receipt.id}>
                  <article className="flex h-full min-w-0 flex-col rounded-card border border-line bg-surface p-4">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold text-ink">{receipt.description}</p>
                      <p className="mt-1 text-xs text-ink-muted">
                        {formatLedgerDate(receipt.transaction_date)} · {formatDisplayText(receipt.event?.title) || formatDisplayText(receipt.budget?.title) || receipt.category}
                      </p>
                      <p className="mt-1 text-xs text-ink-muted">
                        {receiptLabel(receipt) || `Receipt #${receipt.id}`}
                      </p>
                    </div>
                    <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                      <p className="text-sm font-semibold tabular-nums text-ink">{fmt(receipt.amount)}</p>
                      <Button variant="secondary" leftIcon={Eye} onClick={() => setSelectedReceipt(receipt)}>View receipt</Button>
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <Drawer
        open={Boolean(selectedReceipt)}
        title={selectedReceipt ? receiptLabel(selectedReceipt) || `Receipt #${selectedReceipt.id}` : 'Receipt details'}
        onClose={() => setSelectedReceipt(null)}
        width="max-w-3xl"
        footer={selectedReceipt ? (
          <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setSelectedReceipt(null)}>Close</Button>
            {selectedReceipt.receipt_file_url && (
              <a href={resolveAssetUrl(selectedReceipt.receipt_file_url)} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center justify-center gap-2 rounded-control border border-line bg-surface px-4 text-sm font-semibold text-ink transition-colors duration-150 hover:bg-subtle"><Download size={16} aria-hidden="true" /> Open receipt file</a>
            )}
            <Button leftIcon={Printer} onClick={() => printReceiptElement(document.querySelector('[data-finance-receipt] [data-receipt-document]'))}>Print receipt</Button>
          </div>
        ) : null}
      >
        {selectedReceipt && <div data-finance-receipt><ReceiptDocument transaction={selectedReceipt} /></div>}
      </Drawer>

      {activeTab === 'invoices' && !error && (
        <section aria-label="Statement of account" className="space-y-5">
          {currentUserRole === 'STUDENT' && !loading && !error && <AccountSummary debt={studentDebt} clearances={clearances} />}
          <DataTable
            columns={invoiceColumns}
            rows={invoices}
            loading={loading}
            caption="Invoices"
            captionVisible
            stickyHeader={false}
            emptyState={currentUserRole === 'STUDENT' ? (
              <EmptyState icon={FileText} title="No invoices yet" description="Charges from your organization appear here, with what you have paid." />
            ) : (
              <EmptyState
                icon={FileText}
                title="No invoices of your own"
                description="This page lists charges billed to you as a student. Charges you set for members are under Student accounts."
                action={currentUserRole === 'ADMIN' ? <Button variant="secondary" to="/dashboard/finance/student-accounts">Open student accounts</Button> : undefined}
              />
            )}
          />
        </section>
      )}

      {showForm && (
        <Drawer
          open
          title={editingTransaction ? 'Edit transaction' : 'Record transaction'}
          onClose={() => { setShowForm(false); setEditingTransaction(null); }}
          footer={(
            <>
              <Button variant="secondary" onClick={() => { setShowForm(false); setEditingTransaction(null); }}>Cancel</Button>
              <Button type="submit" form="transaction-form" loading={formSubmitting} disabled={!form.description || !form.amount || !form.transaction_date}>
                {editingTransaction ? 'Update transaction' : 'Save transaction'}
              </Button>
            </>
          )}
        >
          <form id="transaction-form" className="space-y-4" onSubmit={handleCreate}>
            <Field label="Description">
              <Input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. Event supplies purchase" />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Amount (₱)">
                <Input type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" />
              </Field>
              <Field label="Type">
                <HiusaSelect value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </HiusaSelect>
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Category">
                <HiusaSelect value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {['Operations', 'Events', 'Elections', 'Merchandise', 'General'].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </HiusaSelect>
              </Field>
              <Field label="Date">
                <Input type="date" value={form.transaction_date} onChange={(e) => setForm({ ...form, transaction_date: e.target.value })} />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Linked budget" optional>
                <HiusaSelect
                  value={form.budget_id}
                  onChange={(e) => {
                    const budgetId = e.target.value;
                    const linkedBudget = budgets.find((budget) => String(budget.id) === String(budgetId));
                    setForm({ ...form, budget_id: budgetId, event_id: linkedBudget?.event_id || form.event_id });
                  }}
                >
                  <option value="">No linked budget</option>
                  {budgets.map((budget) => (
                    <option key={budget.id} value={budget.id} disabled={budget.approval_status !== 'approved'}>
                      {formatDisplayText(budget.title)}{budget.approval_status !== 'approved' ? ` (${budget.approval_status || 'pending'})` : ''}
                    </option>
                  ))}
                </HiusaSelect>
              </Field>
              <Field label="Linked event" optional>
                <HiusaSelect value={form.event_id} onChange={(e) => setForm({ ...form, event_id: e.target.value })}>
                  <option value="">No linked event</option>
                  {events.map((event) => (
                    <option key={event.id} value={event.id}>{formatDisplayText(event.title)}</option>
                  ))}
                </HiusaSelect>
              </Field>
            </div>
            <Field label="Receipt reference" optional>
              <Input type="text" value={form.receipt_reference} onChange={(e) => setForm({ ...form, receipt_reference: e.target.value })} placeholder="GCash reference, OR number, or payment note" />
            </Field>
            {formError && <p role="alert" className="text-sm font-semibold text-danger-strong">{formError}</p>}
          </form>
        </Drawer>
      )}

      {showBudgetForm && !inlineBudgetForm && (
        <Drawer
          open
          title={editingBudget ? 'Edit budget' : 'Propose budget'}
          description={editingBudget ? 'Saving sends this budget back to the Department Head for approval.' : undefined}
          onClose={closeBudgetForm}
          footer={budgetFormButtons}
        >
          {budgetFormBody}
        </Drawer>
      )}

      <BudgetDetailDrawer
        budget={selectedBudget}
        viewerRole={currentUserRole}
        onClose={() => setRecordId(null)}
        onEdit={canProposeBudget ? openBudgetForm : undefined}
      />
      <ReportDetailDrawer
        report={selectedReport}
        viewerRole={currentUserRole}
        onClose={() => setRecordId(null)}
        files={selectedReport ? reportFiles[selectedReport.id] || [] : []}
        onFilesChange={(files) => setReportFiles((current) => ({ ...current, [selectedReport.id]: files }))}
        onSubmit={() => handleSubmitReport(selectedReport)}
        submitting={selectedReport ? reportSubmitting === selectedReport.id : false}
      />

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title={deleteTarget ? deleteLabels[deleteTarget.kind].title : ''}
        message={deleteTarget?.kind === 'forecast' ? 'The forecast is removed for good. Generate a new one from the current ledger whenever you need it. This cannot be undone.' : deleteTarget?.kind === 'budget' ? 'The budget is removed for good. This cannot be undone. An approved budget or one that already has transactions cannot be deleted.' : 'The entry is removed from the ledger and its budget balance is adjusted. This cannot be undone. Entries created by collections, cash advances, invoices or orders must be changed where they came from.'}
        recordName={deleteTarget?.kind === 'forecast' ? `Forecast for ${deleteTarget.record.forecast_period}` : deleteTarget?.kind === 'budget' ? deleteTarget.record.title : (deleteTarget?.record.description || `Transaction ${deleteTarget?.record.id}`)}
        confirmText={deleteTarget ? deleteLabels[deleteTarget.kind].confirm : 'Delete'}
        variant="danger"
        busy={deleteBusy}
        error={deleteError}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
