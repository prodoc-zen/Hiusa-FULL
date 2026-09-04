import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Coins,
  Download,
  FileSpreadsheet,
  FileText,
  Pencil,
  Plus,
  Search,
  Sparkles,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react';
import {
  getTransactions,
  getTransactionSummary,
  createTransaction,
  updateTransaction,
  getPersonalReceipts,
  getInvoices,
  getAuditLogs,
  getForecasts,
  generateForecast,
  getBudgets,
  createBudget,
  generateBudgetAdvice,
  getFinancialReports,
  generateFinancialReport,
} from '../../../services/financeService';
import { getEvents } from '../../../services/eventService';
import { fetchAllPages } from '../../../services/pagination';
import FeedbackToast from '../../../components/FeedbackToast';
import EngineBadge from '../../../components/ai/EngineBadge';
import RulesDisclosure from '../../../components/ai/RulesDisclosure';
import { getApiErrorMessage } from '../../../utils/apiError';

const budgetStatusBadge = {
  pending: 'bg-amber-50 text-amber-700',
  approved: 'bg-emerald-50 text-emerald-700',
  rejected: 'bg-red-50 text-red-700',
};

const allocationStatusLabel = {
  within_limit: 'Within limit',
  reduce_allocation: 'Reduced allocation',
  no_funds: 'No funds available',
};

const allocationStatusTone = {
  within_limit: 'bg-emerald-50 text-emerald-700',
  reduce_allocation: 'bg-amber-50 text-amber-700',
  no_funds: 'bg-red-50 text-red-700',
};

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
      reason = `Based on only ${sampleMonths} month(s) of data with a weak statistical fit (avg R² ${avgR2.toFixed(2)}). Treat this projection as directional only.`;
    } else if (lowSample) {
      reason = `Based on only ${sampleMonths} month(s) of transaction history. Record more months to improve accuracy.`;
    } else {
      reason = `The trend line explains only ${(avgR2 * 100).toFixed(0)}% of month-to-month variance (R² ${avgR2.toFixed(2)}). Treat this projection as directional only.`;
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

function fmt(n) {
  return `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function ForecastLineGraph({ forecasts }) {
  const points = forecasts.map((forecast) => ({ label: String(forecast.forecast_period || '').slice(0, 7), income: Number(forecast.predicted_income || 0), expense: Number(forecast.predicted_expense || 0), balance: Number(forecast.predicted_balance || 0) }));
  if (!points.length) return null;
  const width = 760; const height = 280; const pad = { top: 18, right: 20, bottom: 42, left: 70 }; const values = points.flatMap((point) => [point.income, point.expense, point.balance]); const min = Math.min(0, ...values); const max = Math.max(1, ...values); const range = max - min || 1;
  const x = (index) => pad.left + (points.length === 1 ? (width - pad.left - pad.right) / 2 : index * (width - pad.left - pad.right) / (points.length - 1)); const y = (value) => pad.top + (max - value) * (height - pad.top - pad.bottom) / range;
  const path = (key) => points.map((point, index) => `${index ? 'L' : 'M'} ${x(index)} ${y(point[key])}`).join(' '); const series = [{ key: 'income', label: 'Predicted income', color: '#16A34A' }, { key: 'expense', label: 'Predicted expenses', color: '#DC2626' }, { key: 'balance', label: 'Projected balance', color: '#0B8ED0' }];
  return <div className="mt-5" aria-label="Forecast line graph"><div className="mb-3 flex flex-wrap gap-4 text-xs font-semibold text-slate-600">{series.map((item) => <span key={item.key} className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />{item.label}</span>)}</div><svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="Line graph comparing predicted income, expenses, and balance by forecast period"><title>Financial forecast line graph</title>{[0, .25, .5, .75, 1].map((step) => { const value = max - range * step; const lineY = y(value); return <g key={step}><line x1={pad.left} x2={width - pad.right} y1={lineY} y2={lineY} stroke="#DDE7EF" /><text x={pad.left - 8} y={lineY + 4} textAnchor="end" className="fill-slate-400 text-[10px]">{fmt(value)}</text></g>; })}{series.map((item) => <path key={item.key} d={path(item.key)} fill="none" stroke={item.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />)}{points.map((point,index) => <g key={point.label || index}>{series.map((item) => <circle key={item.key} cx={x(index)} cy={y(point[item.key])} r="4" fill={item.color}><title>{`${point.label}: ${item.label} ${fmt(point[item.key])}`}</title></circle>)}<text x={x(index)} y={height - 16} textAnchor="middle" className="fill-slate-500 text-[10px]">{point.label}</text></g>)}</svg><div className="sr-only"><table><caption>Financial forecast data</caption><thead><tr><th>Period</th><th>Income</th><th>Expenses</th><th>Balance</th></tr></thead><tbody>{points.map((point) => <tr key={point.label}><td>{point.label}</td><td>{fmt(point.income)}</td><td>{fmt(point.expense)}</td><td>{fmt(point.balance)}</td></tr>)}</tbody></table></div></div>;
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
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:Arial,sans-serif;color:#0f172a;padding:24px}h1{font-size:20px}p{color:#475569;font-size:12px}table{width:100%;border-collapse:collapse;margin-top:18px;font-size:12px}th,td{border:1px solid #cbd5e1;padding:8px;text-align:left}th{background:#eaf4f8}@media print{body{padding:0}}</style></head><body><h1>${escapeHtml(title)}</h1><p>Generated ${escapeHtml(new Date().toLocaleString())}</p><table><thead><tr>${heading}</tr></thead><tbody>${body}</tbody></table></body></html>`;
}

function downloadExcel(rows, filename, title) {
  if (!rows.length) return false;
  const blob = new Blob([reportTable(rows, title)], { type: 'application/vnd.ms-excel;charset=utf-8;' });
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

export default function FinancePage({ initialTab = 'transactions' }) {
  const [showForm, setShowForm] = useState(false);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [transactions, setTransactions] = useState([]);
  const [personalReceipts, setPersonalReceipts] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [summary, setSummary] = useState({ total_income: 0, total_expense: 0, net_balance: 0 });
  const [forecasts, setForecasts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [txFilters, setTxFilters] = useState({ type: '', event_id: '', from: '', to: '' });
  const [txMeta, setTxMeta] = useState({ current_page: 1, last_page: 1, total: 0, per_page: 10 });
  const [feedback, setFeedback] = useState({ open: false, type: 'success', message: '' });
  const [forecastGenerating, setForecastGenerating] = useState(false);
  const [reports, setReports] = useState([]);
  const [generatedReport, setGeneratedReport] = useState(null);
  const [reportGenerating, setReportGenerating] = useState(false);
  const [reportForm, setReportForm] = useState({ report_type: 'monthly', event_id: '', period_start: '', period_end: '' });

  const [form, setForm] = useState({ description: '', amount: '', type: 'expense', category: 'Operations', transaction_date: '', budget_id: '', event_id: '', receipt_reference: '' });
  const [editingTransaction, setEditingTransaction] = useState(null);
  const [formError, setFormError] = useState(null);
  const [formSubmitting, setFormSubmitting] = useState(false);

  const [budgets, setBudgets] = useState([]);
  const [events, setEvents] = useState([]);
  const [showBudgetForm, setShowBudgetForm] = useState(false);
  const [budgetForm, setBudgetForm] = useState({ title: '', allocated_amount: '', warning_threshold: '', event_id: '' });
  const [budgetFormError, setBudgetFormError] = useState(null);
  const [budgetFormSubmitting, setBudgetFormSubmitting] = useState(false);
  const [budgetAdviceGenerating, setBudgetAdviceGenerating] = useState(null);
  const [budgetAdviceDetails, setBudgetAdviceDetails] = useState({});
  const [budgetAdviceErrors, setBudgetAdviceErrors] = useState({});
  const [forecastGenError, setForecastGenError] = useState(null);
  let currentUserRole = '';
  try { currentUserRole = JSON.parse(localStorage.getItem('user') ?? '{}')?.role ?? ''; } catch {}
  const canManageLedger = currentUserRole === 'ADMIN';
  const canViewTransactions = ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD'].includes(currentUserRole);
  const canViewForecasts = ['ADMIN', 'SBO_OFFICER'].includes(currentUserRole);
  const canViewBudgets = ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD'].includes(currentUserRole);
  const canProposeBudget = canViewBudgets;

  const closeFeedback = useCallback(() => {
    setFeedback((current) => ({ ...current, open: false }));
  }, []);

  const showFeedback = useCallback((type, message) => {
    setFeedback({ open: true, type, message });
  }, []);


  function load(page = 1, filters = txFilters, searchTerm = search) {
    setLoading(true);
    setError(null);
    const activeFilters = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ''));
    // Budgets, forecasts, reports, and the event dropdown source have no server-side
    // filter that narrows them down, and every one of them doubles as either a full
    // catalog view or a <select> option list elsewhere on this page - so they are
    // fetched in full (across every page) rather than left truncated at page one.
    Promise.all([
      canViewTransactions ? getTransactions({ page, ...activeFilters, ...(searchTerm.trim() ? { search: searchTerm.trim() } : {}) }) : Promise.resolve({ data: { data: [] } }),
      canViewTransactions ? getTransactionSummary(activeFilters) : Promise.resolve({ data: { total_income: 0, total_expense: 0, net_balance: 0 } }),
      canViewForecasts ? fetchAllPages((p) => getForecasts(p).then((r) => r.data)) : Promise.resolve([]),
      canViewBudgets ? fetchAllPages((p) => getBudgets(p).then((r) => r.data)) : Promise.resolve([]),
      canViewBudgets || canManageLedger ? fetchAllPages((p) => getEvents(p).then((r) => r.data)) : Promise.resolve([]),
      getPersonalReceipts(),
      getInvoices(),
      currentUserRole === 'ADMIN' ? getAuditLogs() : Promise.resolve({ data: { data: [] } }),
      canViewTransactions ? fetchAllPages((p) => getFinancialReports(p).then((r) => r.data)) : Promise.resolve([]),
    ])
      .then(([txRes, sumRes, forecasts, budgetsList, eventsList, receiptRes, invoiceRes, auditRes, reports]) => {
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
        setForecasts(forecasts);
        setBudgets(budgetsList);
        setEvents(eventsList);
        setPersonalReceipts(Array.isArray(receiptRes.data) ? receiptRes.data : []);
        setInvoices(Array.isArray(invoiceRes.data) ? invoiceRes.data : []);
        setAuditLogs(Array.isArray(auditRes.data?.data) ? auditRes.data.data : []);
        setReports(reports);
      })
      .catch(() => setError('Failed to load financial data.'))
      .finally(() => setLoading(false));
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
      await createBudget({
        title: budgetForm.title,
        allocated_amount: parseFloat(budgetForm.allocated_amount),
        warning_threshold: parseFloat(budgetForm.warning_threshold),
        event_id: budgetForm.event_id || null,
      });
      setShowBudgetForm(false);
      setBudgetForm({ title: '', allocated_amount: '', warning_threshold: '', event_id: '' });
      showFeedback('success', 'Budget proposal submitted for approval.');
      load(txMeta.current_page);
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
  useEffect(() => { setActiveTab(initialTab); }, [initialTab]);

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
      load(editingTransaction ? txMeta.current_page : 1);
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
      showFeedback('success', 'Budget advice generated from the latest forecast and available funds.');
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
      showFeedback('success', 'OLS forecast generated from the available transaction history.');
      load(txMeta.current_page);
    } catch (err) {
      const message = err?.response?.status === 422
        ? 'At least two different calendar months of recorded transactions are needed to generate a forecast. Record transactions in another month, then try again.'
        : getApiErrorMessage(err, 'Failed to generate the forecast.');
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
    if (reportForm.report_type === 'custom' && (!reportForm.period_start || !reportForm.period_end)) {
      showFeedback('error', 'Select the start and end dates for the custom report.');
      return;
    }

    setReportGenerating(true);
    try {
      const payload = {
        report_type: reportForm.report_type,
        event_id: reportForm.report_type === 'event' ? reportForm.event_id : null,
        period_start: reportForm.report_type === 'custom' ? reportForm.period_start : null,
        period_end: reportForm.report_type === 'custom' ? reportForm.period_end : null,
      };
      const response = await generateFinancialReport(payload);
      setGeneratedReport(response.data);
      setReports((current) => [response.data.report, ...current.filter((report) => report.id !== response.data.report.id)]);
      showFeedback('success', 'Financial report generated and saved to report history.');
    } catch (err) {
      showFeedback('error', getApiErrorMessage(err, 'Failed to generate the financial report.'));
    } finally {
      setReportGenerating(false);
    }
  }

  function exportGeneratedReport(format) {
    const rows = [
      {
        Section: 'AI financial summary',
        Item: generatedReport?.report?.title,
        Details: generatedReport?.report?.summary_text,
        'Amount (PHP)': '',
        Date: '',
      },
      ...['income', 'expense', 'balance'].map((item) => ({
        Section: 'Income statement',
        Item: item,
        Details: '',
        'Amount (PHP)': Number(generatedReport?.totals?.[item] || 0).toFixed(2),
        Date: '',
      })),
      ...(generatedReport?.by_category || []).map((row) => ({
        Section: 'Category summary',
        Item: `${row.category} (${row.type})`,
        Details: '',
        'Amount (PHP)': Number(row.total || 0).toFixed(2),
        Date: '',
      })),
      ...(generatedReport?.latest_ols_forecast ? [{
        Section: 'OLS forecast',
        Item: generatedReport.latest_ols_forecast.forecast_period,
        Details: `Income ${fmt(generatedReport.latest_ols_forecast.predicted_income)}; expense ${fmt(generatedReport.latest_ols_forecast.predicted_expense)}; balance ${fmt(generatedReport.latest_ols_forecast.predicted_balance)}; safe spending ${fmt(generatedReport.latest_ols_forecast.safe_spending_limit)}`,
        'Amount (PHP)': '',
        Date: '',
      }] : []),
      ...(generatedReport?.budget_advisories || []).map((budget) => ({
        Section: 'Budget advisory',
        Item: budget.title,
        Details: `Recommended ${fmt(budget.recommended_allocation)}; safe ceiling ${fmt(budget.safe_spending_limit)}; risk ${budget.overspending_risk || 'not set'}; ${budget.advisory_note || ''}`,
        'Amount (PHP)': Number(budget.remaining_amount || 0).toFixed(2),
        Date: String(budget.advice_generated_at || '').slice(0, 10),
      })),
      ...(generatedReport?.audit_logs || []).map((log) => ({
        Section: 'Audit log',
        Item: `${log.module}.${log.action}`,
        Details: `${log.record_type || 'record'} #${log.record_id || ''}`,
        'Amount (PHP)': '',
        Date: String(log.created_at || '').slice(0, 10),
      })),
      ...(generatedReport?.transactions || []).map((transaction) => ({
        Section: 'Ledger transaction',
        Item: `${transaction.category} (${transaction.type})`,
        Details: transaction.description,
        'Amount (PHP)': Number(transaction.amount).toFixed(2),
        Date: String(transaction.transaction_date || '').slice(0, 10),
      })),
    ];
    const title = generatedReport?.report?.title || 'Financial Report';
    const exported = format === 'excel'
      ? downloadExcel(rows, `hiusa-financial-report-${generatedReport?.report?.id || 'new'}.xls`, title)
      : printReport(rows, title);
    showFeedback(exported ? 'success' : 'info', exported
      ? (format === 'excel' ? 'Excel report exported.' : 'Print-ready report opened. Choose Save as PDF in the print dialog.')
      : 'This report has no rows to export.');
  }

  async function handleExport(type, format = 'excel') {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');

    if (type === 'category') {
      const rows = (summary.by_category || []).map((c) => ({
        Category: c.category,
        Type: c.type,
        'Total (₱)': Number(c.total).toFixed(2),
      }));
      const exported = format === 'excel'
        ? downloadExcel(rows, `hiusa-category-breakdown-${yyyy}-${mm}.xls`, 'Category Breakdown')
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
      const all = await fetchAllPages((p) => getTransactions(p).then((r) => r.data), {}, { perPage: 10, maxPages: 500 });

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
          ? downloadExcel(filtered.map(toRow), `hiusa-monthly-${yyyy}-${mm}.xls`, `Monthly Financial Summary - ${yyyy}-${mm}`)
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
          ? downloadExcel(filtered.map(toRow), `hiusa-semester-${yyyy}.xls`, `Semester Financial Report - ${yyyy}`)
          : printReport(filtered.map(toRow), `Semester Financial Report - ${yyyy}`);
        if (exported) {
          showFeedback('success', format === 'excel' ? 'Excel report exported.' : 'Print-ready report opened. Choose Save as PDF in the print dialog.');
        } else {
          showFeedback('info', 'No semester transactions are available to export yet.');
        }
      } else if (type === 'log') {
        const exported = format === 'excel'
          ? downloadExcel(all.map(toRow), `hiusa-transaction-log-${yyyy}-${mm}-${dd}.xls`, 'Full Transaction Log')
          : printReport(all.map(toRow), 'Full Transaction Log');
        if (exported) {
          showFeedback('success', format === 'excel' ? 'Excel report exported.' : 'Print-ready report opened. Choose Save as PDF in the print dialog.');
        } else {
          showFeedback('info', 'No transactions are available to export yet.');
        }
      }
    } catch (err) {
      showFeedback('error', getApiErrorMessage(err, 'Failed to fetch transactions for export. Please try again.'));
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
    } : { description: '', amount: '', type: 'expense', category: 'Operations', transaction_date: '', budget_id: '', event_id: '', receipt_reference: '' });
    setFormError(null);
    setShowForm(true);
  }

  const filtered = transactions;

  const txFrom = (txMeta.current_page - 1) * txMeta.per_page + 1;
  const txTo = Math.min(txMeta.current_page * txMeta.per_page, txMeta.total);

  return (
    <div className="space-y-6">
      <FeedbackToast feedback={feedback} onClose={closeFeedback} />

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: 'Total Income', value: fmt(summary.total_income), helper: 'Recorded income', icon: ArrowUpRight, up: true },
          { label: 'Total Expenses', value: fmt(summary.total_expense), helper: 'Recorded expenses', icon: ArrowDownRight, up: false },
          { label: 'Net Balance', value: fmt(summary.net_balance), helper: 'Income minus expenses', icon: Coins, up: summary.net_balance >= 0 },
          { label: 'Transactions', value: txMeta.total || transactions.length, helper: 'All records', icon: Wallet, up: true },
        ].map((card) => (
          <article key={card.label} className="group rounded-xl border border-[#DDE7EF] bg-white p-3 sm:p-5 shadow-sm transition-all hover:shadow-md hover:border-[#0B8ED0]/20">
            <div className="mb-3 flex items-center justify-between">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-emerald-50 text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white transition">
                <card.icon size={19} />
              </div>
              <span className={`flex items-center gap-1 text-[11px] font-bold ${card.up ? 'text-emerald-600' : 'text-red-500'}`}>
                <TrendingUp size={12} className={card.up ? '' : 'rotate-180'} />
              </span>
            </div>
            <p className="text-sm font-semibold text-slate-500">{card.label}</p>
            <p className="mt-1 text-2xl font-black text-[#0F172A]">{card.value}</p>
            <p className="mt-1 text-xs font-medium text-slate-400">{card.helper}</p>
          </article>
        ))}
      </section>

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 p-5 text-center">
          <p className="text-sm font-semibold text-red-700">{error}</p>
          <button onClick={() => load()} className="mt-2 text-sm font-bold text-red-600 underline">Try again</button>
        </div>
      )}

      {activeTab === 'transactions' && (
        <section className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-[#DDE7EF] p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-[#0F172A]">Transactions</h2>
              <p className="text-sm font-medium text-slate-500">Record and view all financial transactions</p>
            </div>
            <div className="flex w-full gap-2 sm:w-auto">
              <div className="flex h-10 flex-1 items-center gap-2 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-3 sm:flex-none">
                <Search size={15} className="text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') load(1, txFilters, search); }}
                  type="text"
                  placeholder="Search transactions..."
                  className="w-full bg-transparent text-[13px] outline-none placeholder:text-slate-400 sm:w-[160px]"
                />
              </div>
              {canManageLedger && (
                <button onClick={() => openTransactionForm()} className="flex h-10 items-center gap-2 rounded-lg bg-[#0B8ED0] px-4 text-[13px] font-bold text-white hover:bg-[#0878B7] transition">
                  <Plus size={16} />
                  <span className="hidden sm:inline">Record Transaction</span>
                </button>
              )}
            </div>
          </div>

          <div className="grid gap-2 border-b border-[#DDE7EF] bg-[#F8FBFD] p-4 sm:grid-cols-2 xl:grid-cols-[150px_minmax(180px,1fr)_160px_160px_auto]">
            <select
              value={txFilters.type}
              onChange={(e) => setTxFilters({ ...txFilters, type: e.target.value })}
              className="h-10 rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm outline-none focus:border-[#0B8ED0]"
              aria-label="Filter by transaction type"
            >
              <option value="">All types</option>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
            </select>
            <select
              value={txFilters.event_id}
              onChange={(e) => setTxFilters({ ...txFilters, event_id: e.target.value })}
              className="h-10 rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm outline-none focus:border-[#0B8ED0]"
              aria-label="Filter by event"
            >
              <option value="">All events</option>
              {events.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}
            </select>
            <input
              type="date"
              value={txFilters.from}
              onChange={(e) => setTxFilters({ ...txFilters, from: e.target.value })}
              className="h-10 rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm outline-none focus:border-[#0B8ED0]"
              aria-label="Filter from date"
            />
            <input
              type="date"
              value={txFilters.to}
              onChange={(e) => setTxFilters({ ...txFilters, to: e.target.value })}
              className="h-10 rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm outline-none focus:border-[#0B8ED0]"
              aria-label="Filter to date"
            />
            <div className="flex gap-2">
              <button type="button" onClick={() => load(1, txFilters)} className="h-10 rounded-lg bg-[#0B8ED0] px-4 text-xs font-bold text-white hover:bg-[#0878B7]">Apply</button>
              <button
                type="button"
                onClick={() => {
                  const cleared = { type: '', event_id: '', from: '', to: '' };
                  setTxFilters(cleared);
                  setSearch('');
                  load(1, cleared, '');
                }}
                className="h-10 rounded-lg border border-[#DDE7EF] bg-white px-4 text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                Clear
              </button>
            </div>
          </div>

          {loading ? (
            <div className="space-y-2 p-5">
              {[1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />)}
            </div>
          ) : filtered.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-400">No transactions recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[500px] md:min-w-[700px] text-left">
                <thead className="bg-[#F8FBFD] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Date</th>
                    <th className="px-5 py-3">Description</th>
                    <th className="hidden md:table-cell px-5 py-3">Category</th>
                    <th className="px-5 py-3">Type</th>
                    <th className="px-5 py-3">Amount</th>
                    {canManageLedger && <th className="px-5 py-3">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5EDF3] text-sm">
                  {filtered.map((tx) => (
                    <tr key={tx.id} className="transition hover:bg-[#F8FBFD]">
                      <td className="px-5 py-4 font-medium text-slate-600">{tx.transaction_date}</td>
                      <td className="px-5 py-4 font-semibold text-[#0F172A]">{tx.description}</td>
                      <td className="hidden md:table-cell px-5 py-4">
                        <span className="rounded-full border border-[#DDE7EF] bg-[#F8FBFD] px-2.5 py-1 text-xs font-bold text-slate-600">{tx.category}</span>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${tx.type === 'income' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                          {tx.type === 'income' ? 'Income' : 'Expense'}
                        </span>
                      </td>
                      <td className={`px-5 py-4 font-black tabular-nums ${tx.type === 'income' ? 'text-emerald-600' : 'text-[#0F172A]'}`}>
                        {tx.type === 'income' ? '+' : '-'}{fmt(tx.amount)}
                      </td>
                      {canManageLedger && (
                        <td className="px-5 py-4">
                          <button
                            type="button"
                            onClick={() => openTransactionForm(tx)}
                            className="grid h-8 w-8 place-items-center rounded-lg border border-[#DDE7EF] text-slate-500 hover:bg-[#EEF6FB]"
                            aria-label="Edit transaction"
                          >
                            <Pencil size={14} />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {txMeta.total > txMeta.per_page && (
            <div className="flex items-center justify-between border-t border-[#DDE7EF] px-5 py-3">
              <p className="text-xs font-medium text-slate-400">
                Showing <span className="font-bold text-slate-600">{txFrom}-{txTo}</span> of <span className="font-bold text-slate-600">{txMeta.total}</span>
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => load(txMeta.current_page - 1)}
                  disabled={txMeta.current_page === 1}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-[#DDE7EF] text-slate-500 transition hover:bg-[#EEF6FB] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="px-2 text-[13px] font-bold tabular-nums text-[#0F172A]">
                  {txMeta.current_page} / {txMeta.last_page}
                </span>
                <button
                  onClick={() => load(txMeta.current_page + 1)}
                  disabled={txMeta.current_page === txMeta.last_page}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-[#DDE7EF] text-slate-500 transition hover:bg-[#EEF6FB] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {activeTab === 'budgets' && (
        <section className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-[#DDE7EF] p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-[#0F172A]">Budget Allocation</h2>
              <p className="text-sm font-medium text-slate-500">Propose fund allocations for events and projects</p>
            </div>
            {canProposeBudget && (
              <button onClick={() => setShowBudgetForm(true)} className="flex h-10 items-center gap-2 rounded-lg bg-[#0B8ED0] px-4 text-[13px] font-bold text-white hover:bg-[#0878B7] transition">
                <Plus size={16} />
                <span className="hidden sm:inline">Propose Budget</span>
              </button>
            )}
          </div>

          {loading ? (
            <div className="space-y-2 p-5">
              {[1, 2, 3].map((i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100" />)}
            </div>
          ) : budgets.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-400">No budgets proposed yet.</p>
          ) : (
            <div className="divide-y divide-[#E5EDF3]">
              {budgets.map((b) => (
                <div key={b.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-bold text-[#0F172A]">{b.title}</p>
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold capitalize ${budgetStatusBadge[b.approval_status] || 'bg-slate-100 text-slate-500'}`}>
                        {b.approval_status || 'pending'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      Allocated {fmt(b.allocated_amount)} - Remaining {fmt(b.remaining_amount)} - Warning threshold {fmt(b.warning_threshold)}
                      {b.event ? ` - ${b.event.title}` : ''}
                    </p>
                    {b.overspending_risk && (
                      <p className={`mt-2 text-xs font-bold capitalize ${b.overspending_risk === 'high' ? 'text-red-600' : b.overspending_risk === 'medium' ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {b.overspending_risk} overspending risk
                      </p>
                    )}
                    {b.recommended_allocation != null && (
                      <p className="mt-1 text-xs font-semibold text-violet-700">
                        AI recommended allocation {fmt(b.recommended_allocation)} · Safe spending ceiling {fmt(b.safe_spending_limit)}
                      </p>
                    )}
                    {b.advisory_note && <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">{b.advisory_note}</p>}
                    {budgetAdviceErrors[b.id] && (
                      <div className="mt-2 flex max-w-3xl flex-wrap items-center justify-between gap-3 rounded-lg border border-red-100 bg-red-50 p-3 text-xs font-semibold text-red-700">
                        <span className="flex items-start gap-1.5"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{budgetAdviceErrors[b.id]}</span>
                        <button type="button" onClick={() => handleGenerateBudgetAdvice(b.id)} className="shrink-0 font-bold underline">Retry</button>
                      </div>
                    )}
                    {budgetAdviceDetails[b.id]?.advice && (
                      <div className="mt-3 max-w-3xl rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <EngineBadge engine={budgetAdviceDetails[b.id].engine} />
                          {budgetAdviceDetails[b.id].advice.allocation_status && (
                            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${allocationStatusTone[budgetAdviceDetails[b.id].advice.allocation_status] || 'bg-slate-100 text-slate-600'}`}>
                              {allocationStatusLabel[budgetAdviceDetails[b.id].advice.allocation_status] || budgetAdviceDetails[b.id].advice.allocation_status}
                            </span>
                          )}
                          {budgetAdviceDetails[b.id].advice.xai_model && (
                            <span className="text-[11px] font-semibold text-slate-400">Explained by {budgetAdviceDetails[b.id].advice.xai_model}</span>
                          )}
                          {budgetAdviceDetails[b.id].advice.xai_status === 'unavailable' && (
                            <span className="text-[11px] font-semibold text-amber-700">AI explanation unavailable. The displayed figures and advice are deterministic; use AI Advice to retry.</span>
                          )}
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                          {budgetAdviceDetails[b.id].advice.reserve_amount != null && (
                            <span className="text-slate-500">Reserve <strong className="block text-[#0F172A]">{fmt(budgetAdviceDetails[b.id].advice.reserve_amount)}</strong></span>
                          )}
                          {budgetAdviceDetails[b.id].advice.expense_to_income_ratio != null && (
                            <span className="text-slate-500">Expense/income ratio <strong className="block text-[#0F172A]">{(Number(budgetAdviceDetails[b.id].advice.expense_to_income_ratio) * 100).toFixed(1)}%</strong></span>
                          )}
                        </div>
                        <RulesDisclosure
                          label="How this was calculated"
                          items={[
                            ...(budgetAdviceDetails[b.id].advice.deterministic_advice
                              ? [`Deterministic advice before AI rewrite: "${budgetAdviceDetails[b.id].advice.deterministic_advice}"`]
                              : []),
                            ...(Array.isArray(budgetAdviceDetails[b.id].advice.rules_applied) ? budgetAdviceDetails[b.id].advice.rules_applied : []),
                          ]}
                        />
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <p className="text-sm font-black tabular-nums text-[#0F172A]">{fmt(b.allocated_amount)}</p>
                    <button
                      type="button"
                      onClick={() => handleGenerateBudgetAdvice(b.id)}
                      disabled={budgetAdviceGenerating === b.id}
                      className="flex h-9 items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 text-xs font-bold text-violet-700 transition hover:bg-violet-100 disabled:opacity-50"
                    >
                      <Sparkles size={14} />
                      {budgetAdviceGenerating === b.id ? 'Analyzing...' : 'AI Advice'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === 'forecasting' && (
        <section className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
          <div className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
            <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-bold text-[#0F172A]">Financial Forecast</h2>
                <p className="text-sm font-medium text-slate-500">OLS projections based on monthly transaction history</p>
              </div>
              <button
                type="button"
                onClick={handleGenerateForecast}
                disabled={forecastGenerating}
                className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-[#0B8ED0] px-4 text-xs font-bold text-white hover:bg-[#0878B7] disabled:opacity-50"
              >
                <Sparkles size={15} />
                {forecastGenerating ? 'Generating...' : 'Generate Forecast'}
              </button>
            </div>
            {forecastGenError && (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-100 bg-red-50 p-3 text-xs font-semibold text-red-700">
                <span className="flex items-start gap-1.5"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{forecastGenError}</span>
                <button type="button" onClick={handleGenerateForecast} className="shrink-0 font-bold underline">Retry</button>
              </div>
            )}
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <div key={i} className="h-8 animate-pulse rounded-lg bg-slate-100" />)}
              </div>
            ) : forecasts.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">No forecasts recorded yet.</p>
            ) : (
              <div className="space-y-3">
                <ForecastLineGraph forecasts={forecasts} />
                {forecasts.map((f) => {
                  const reliability = getForecastReliability(f);
                  const clampNotice = getClampNotice(f);
                  const sampleMonths = f.model_details?.sample_months;
                  const populatedMonths = f.model_details?.populated_months;
                  const incomeR2 = f.model_details?.income?.r_squared;
                  const expenseR2 = f.model_details?.expense?.r_squared;
                  return (
                    <div key={f.id} className="rounded-lg border border-[#DDE7EF] p-4">
                      <div className="flex items-center justify-between gap-3"><span className="text-sm font-bold text-slate-700">Forecast for {f.forecast_period}</span><span className="text-sm font-bold tabular-nums text-[#0F172A]">Balance {fmt(f.predicted_balance)}</span></div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                        <span className="text-slate-500">Income <strong className="block text-emerald-700">{fmt(f.predicted_income)}</strong></span>
                        <span className="text-slate-500">Balance <strong className="block text-[#0F172A]">{fmt(f.predicted_balance)}</strong></span>
                        <span className="text-slate-500">Safe spend <strong className="block text-[#0B8ED0]">{fmt(f.safe_spending_limit)}</strong></span>
                        <span className="text-slate-500">Risk <strong className="block capitalize text-[#0F172A]">{f.model_details?.risk || 'Not set'}</strong></span>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <EngineBadge engine={f.model_details?.engine} />
                        {Number.isFinite(Number(sampleMonths)) && (
                          <span className="rounded-full border border-[#DDE7EF] px-2.5 py-0.5 text-[11px] font-bold text-slate-600">{sampleMonths} sample month{Number(sampleMonths) === 1 ? '' : 's'}</span>
                        )}
                        {Number.isFinite(Number(populatedMonths)) && (
                          <span className="rounded-full border border-[#DDE7EF] px-2.5 py-0.5 text-[11px] font-bold text-slate-600">{populatedMonths} with recorded transactions</span>
                        )}
                        {Number.isFinite(Number(incomeR2)) && (
                          <span className="rounded-full border border-[#DDE7EF] px-2.5 py-0.5 text-[11px] font-bold text-slate-600">Income fit R² {Number(incomeR2).toFixed(2)}</span>
                        )}
                        {Number.isFinite(Number(expenseR2)) && (
                          <span className="rounded-full border border-[#DDE7EF] px-2.5 py-0.5 text-[11px] font-bold text-slate-600">Expense fit R² {Number(expenseR2).toFixed(2)}</span>
                        )}
                        {reliability.quality && (
                          <span className="rounded-full border border-[#DDE7EF] px-2.5 py-0.5 text-[11px] font-bold capitalize text-slate-600">Fit quality: {String(reliability.quality).replace(/_/g, ' ')}</span>
                        )}
                      </div>
                      {!reliability.isReliable && (
                        <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-amber-50 p-2.5 text-[11px] font-semibold text-amber-700">
                          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                          {reliability.reason || 'Weak confidence in this projection. Treat the figures as directional only.'}
                        </p>
                      )}
                      {clampNotice && (
                        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-red-50 p-2.5 text-[11px] font-semibold text-red-700">
                          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                          {clampNotice}
                        </p>
                      )}
                      {f.confidence_note && <p className="mt-3 text-xs leading-5 text-slate-500">{f.confidence_note}</p>}
                      {f.model_details?.explanation_status === 'unavailable' && <p className="mt-2 text-[11px] font-semibold text-amber-700">AI explanation was unavailable. The OLS forecast and deterministic risk calculations completed normally; generate again to retry the explanation.</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
            <h3 className="text-base font-bold text-[#0F172A]">Summary by Category</h3>
            <div className="mt-4 space-y-3">
              {(summary.by_category || []).length === 0 ? (
                <p className="text-sm text-slate-400">No category data available.</p>
              ) : (
                (summary.by_category || []).map((cat) => (
                  <div key={cat.category + cat.type} className="rounded-lg bg-[#F8FBFD] p-3.5">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-[13px] font-bold text-[#0F172A]">{cat.category}</span>
                        <span className={`ml-2 text-[11px] font-bold ${cat.type === 'income' ? 'text-emerald-600' : 'text-slate-400'}`}>
                          {cat.type}
                        </span>
                      </div>
                      <span className="text-[13px] font-bold tabular-nums text-[#0B8ED0]">{fmt(cat.total)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      )}

      {activeTab === 'reports' && (
        <div className="space-y-5">
          <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
            <div>
              <h2 className="text-lg font-bold text-[#0F172A]">Generate Financial Report</h2>
              <p className="text-sm font-medium text-slate-500">Build and save a ledger-backed report with a financial summary</p>
            </div>
            <form onSubmit={handleGenerateReport} className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-[180px_minmax(180px,1fr)_160px_160px_auto]">
              <select
                value={reportForm.report_type}
                onChange={(event) => setReportForm({ ...reportForm, report_type: event.target.value })}
                className="h-11 rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm outline-none focus:border-[#0B8ED0]"
                aria-label="Report type"
              >
                <option value="monthly">Monthly</option>
                <option value="semester">Semester</option>
                <option value="event">Event-specific</option>
                <option value="custom">Custom period</option>
              </select>
              <select
                value={reportForm.event_id}
                onChange={(event) => setReportForm({ ...reportForm, event_id: event.target.value })}
                disabled={reportForm.report_type !== 'event'}
                className="h-11 rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm outline-none focus:border-[#0B8ED0] disabled:bg-slate-100 disabled:text-slate-400"
                aria-label="Report event"
              >
                <option value="">Select event</option>
                {events.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}
              </select>
              <input
                type="date"
                value={reportForm.period_start}
                onChange={(event) => setReportForm({ ...reportForm, period_start: event.target.value })}
                disabled={reportForm.report_type !== 'custom'}
                className="h-11 rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm outline-none focus:border-[#0B8ED0] disabled:bg-slate-100"
                aria-label="Report start date"
              />
              <input
                type="date"
                value={reportForm.period_end}
                onChange={(event) => setReportForm({ ...reportForm, period_end: event.target.value })}
                disabled={reportForm.report_type !== 'custom'}
                className="h-11 rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm outline-none focus:border-[#0B8ED0] disabled:bg-slate-100"
                aria-label="Report end date"
              />
              <button type="submit" disabled={reportGenerating} className="flex h-11 items-center justify-center gap-2 rounded-lg bg-[#0B8ED0] px-4 text-xs font-bold text-white hover:bg-[#0878B7] disabled:opacity-50">
                <Sparkles size={15} />
                {reportGenerating ? 'Generating...' : 'Generate'}
              </button>
            </form>

            {generatedReport && (
              <div className="mt-5 border-t border-[#DDE7EF] pt-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="font-bold text-[#0F172A]">{generatedReport.report.title}</h3>
                    <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">{generatedReport.report.summary_text}</p>
                    {generatedReport.ai_summary_status === 'unavailable' && <p className="mt-2 text-xs font-semibold text-amber-700">AI summary was unavailable. This report was saved with backend-calculated totals and a deterministic summary; generate it again to retry.</p>}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button type="button" onClick={() => exportGeneratedReport('excel')} className="flex h-9 items-center gap-2 rounded-lg bg-[#0B8ED0] px-3 text-xs font-bold text-white"><FileSpreadsheet size={14} />Excel</button>
                    <button type="button" onClick={() => exportGeneratedReport('pdf')} className="flex h-9 items-center gap-2 rounded-lg border border-[#DDE7EF] px-3 text-xs font-bold text-slate-600"><FileText size={14} />PDF</button>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                  <p className="text-slate-500">Income <strong className="block text-emerald-700">{fmt(generatedReport.totals.income)}</strong></p>
                  <p className="text-slate-500">Expenses <strong className="block text-red-600">{fmt(generatedReport.totals.expense)}</strong></p>
                  <p className="text-slate-500">Balance <strong className="block text-[#0F172A]">{fmt(generatedReport.totals.balance)}</strong></p>
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  Includes {(generatedReport.transactions || []).length} ledger entries, {(generatedReport.audit_logs || []).length} audit entries,
                  {' '}{(generatedReport.budget_advisories || []).length} budget advisories, and {generatedReport.latest_ols_forecast ? 'the latest OLS forecast' : 'no available OLS forecast'}.
                </p>
              </div>
            )}
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
          {[
            { key: 'monthly',  title: 'Monthly Summary',     desc: 'All transactions in the current calendar month', period: 'This month' },
            { key: 'semester', title: 'Semester Report',      desc: 'Transactions from the past 6 months',            period: 'Last 6 months' },
            { key: 'log',      title: 'Full Transaction Log', desc: 'Complete ledger of all recorded transactions',   period: 'All time' },
            { key: 'category', title: 'Category Breakdown',   desc: 'Spending totals grouped by category and type',   period: 'All time' },
          ].map((report) => (
            <div key={report.key} className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm transition hover:shadow-md">
              <span className="inline-block rounded-full bg-[#E6F6FD] px-2.5 py-1 text-[11px] font-bold text-[#0878B7] mb-3">
                {report.period}
              </span>
              <h3 className="text-base font-bold text-[#0F172A]">{report.title}</h3>
              <p className="mt-1 text-sm font-medium text-slate-500">{report.desc}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleExport(report.key, 'excel')}
                  className="flex items-center gap-2 rounded-lg bg-[#0B8ED0] px-4 py-2 text-[13px] font-bold text-white transition hover:bg-[#0878B7]"
                >
                  <FileSpreadsheet size={15} />
                  Export Excel
                </button>
                <button
                  type="button"
                  onClick={() => handleExport(report.key, 'pdf')}
                  className="flex items-center gap-2 rounded-lg border border-[#DDE7EF] px-4 py-2 text-[13px] font-bold text-slate-600 transition hover:bg-[#F8FBFD]"
                >
                  <FileText size={15} />
                  Print / Save PDF
                </button>
              </div>
            </div>
          ))}
          </section>

          <section className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
            <div className="border-b border-[#DDE7EF] p-5">
              <h2 className="text-lg font-bold text-[#0F172A]">Report History</h2>
            </div>
            {reports.length === 0 ? (
              <p className="p-8 text-center text-sm text-slate-400">No saved reports yet.</p>
            ) : (
              <div className="divide-y divide-[#E5EDF3]">
                {reports.map((report) => (
                  <div key={report.id} className="p-5">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <p className="font-bold text-[#0F172A]">{report.title}</p>
                      <span className="text-xs text-slate-400">{String(report.generated_at || '').slice(0, 10)}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{report.summary_text}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {activeTab === 'receipts' && (
        <section className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
          <div className="border-b border-[#DDE7EF] p-5">
            <h2 className="text-lg font-bold text-[#0F172A]">Personal Receipts</h2>
          </div>
          {loading ? (
            <div className="space-y-2 p-5">
              {[1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />)}
            </div>
          ) : personalReceipts.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-400">No receipts available yet.</p>
          ) : (
            <div className="divide-y divide-[#E5EDF3]">
              {personalReceipts.map((receipt) => (
                <div key={receipt.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-bold text-[#0F172A]">{receipt.description}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {receipt.transaction_date} - {receipt.event?.title || receipt.budget?.title || receipt.category}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-[#0B8ED0]">
                      Receipt {receipt.receipt_number || receipt.receipt_reference || receipt.id}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-black tabular-nums text-[#0F172A]">{fmt(receipt.amount)}</p>
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="flex h-9 items-center gap-2 rounded-lg border border-[#DDE7EF] px-3 text-xs font-bold text-slate-600 hover:bg-[#F8FBFD]"
                    >
                      <Download size={14} />
                      Print
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === 'invoices' && (
        <section className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
          <div className="border-b border-[#DDE7EF] p-5">
            <h2 className="text-lg font-bold text-[#0F172A]">Statement of Account & Financial Clearance</h2>
            <p className="mt-1 text-sm text-slate-500">Approved payments are reflected in your balance.</p>
          </div>
          {invoices.length === 0 ? <p className="p-8 text-center text-sm text-emerald-700">Financially cleared — no outstanding invoices.</p> : (
            <div className="divide-y divide-[#E5EDF3]">{invoices.map((invoice) => (
              <div key={invoice.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div><p className="font-bold text-[#0F172A]">{invoice.description}</p><p className="mt-1 text-xs text-slate-500">{invoice.reference} · Due {invoice.due_date || 'Not set'} · {String(invoice.status).replace('_', ' ')}</p></div>
                <div className="grid grid-cols-3 gap-4 text-right text-xs text-slate-500"><span>Due<strong className="block text-sm text-[#0F172A]">{fmt(invoice.amount_due)}</strong></span><span>Paid<strong className="block text-sm text-emerald-700">{fmt(invoice.amount_paid)}</strong></span><span>Balance<strong className="block text-sm text-red-600">{fmt(invoice.remaining_balance)}</strong></span></div>
              </div>
            ))}</div>
          )}
        </section>
      )}

      {activeTab === 'audit' && currentUserRole === 'ADMIN' && (
        <section className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
          <div className="border-b border-[#DDE7EF] p-5"><h2 className="text-lg font-bold text-[#0F172A]">Admin Audit Logs</h2><p className="mt-1 text-sm text-slate-500">Read-only activity history across financial, approval, order, and system modules.</p></div>
          {auditLogs.length === 0 ? <p className="p-8 text-center text-sm text-slate-400">No audit activity recorded.</p> : <div className="divide-y divide-[#E5EDF3]">{auditLogs.map((log) => <article key={log.id} className="p-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-[11px] font-bold uppercase tracking-wide text-[#0B8ED0]">{log.module_label}</p><h3 className="font-bold text-[#0F172A]">{log.action_label}</h3><p className="mt-1 text-sm text-slate-600">{log.subject}</p></div><time className="shrink-0 text-xs text-slate-400">{String(log.created_at || '').replace('T', ' ').slice(0, 19)}</time></div><div className="mt-3 grid gap-2 text-xs sm:grid-cols-2"><p className="rounded-md bg-[#F8FBFD] p-2 text-slate-600"><strong className="text-[#0F172A]">Performed by:</strong> {log.actor?.name || 'System'}{log.actor?.role ? ` · ${log.actor.role}` : ''}</p>{log.affected_user && <p className="rounded-md bg-[#F8FBFD] p-2 text-slate-600"><strong className="text-[#0F172A]">Student / affected user:</strong> {log.affected_user.name} · {log.affected_user.department || 'Department not recorded'} · {log.affected_user.program || 'Course not recorded'} · {log.affected_user.year_level || 'Year not recorded'}</p>}</div>{log.changes?.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{log.changes.slice(0, 6).map((change) => <span key={change.field} className="rounded-full border border-[#DDE7EF] px-2.5 py-1 text-[11px] text-slate-600"><strong>{change.field}:</strong> {change.from ? `${change.from} → ` : ''}{change.to}</span>)}</div>}</article>)}</div>}
        </section>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#0F172A]">{editingTransaction ? 'Edit Transaction' : 'Record Transaction'}</h2>
              <button onClick={() => { setShowForm(false); setEditingTransaction(null); }} className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-[#EEF6FB]"><X size={18} /></button>
            </div>
            <form className="space-y-4" onSubmit={handleCreate}>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Description *</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="e.g. Event supplies purchase"
                  className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Amount (₱) *</label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    placeholder="0.00"
                    className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Type *</label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                    className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                  >
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Category</label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                  >
                    {['Operations', 'Events', 'Elections', 'Merchandise', 'General'].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Date *</label>
                  <input
                    type="date"
                    value={form.transaction_date}
                    onChange={(e) => setForm({ ...form, transaction_date: e.target.value })}
                    className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Linked Budget</label>
                  <select
                    value={form.budget_id}
                    onChange={(e) => {
                      const budgetId = e.target.value;
                      const linkedBudget = budgets.find((budget) => String(budget.id) === String(budgetId));
                      setForm({ ...form, budget_id: budgetId, event_id: linkedBudget?.event_id || form.event_id });
                    }}
                    className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                  >
                    <option value="">No linked budget</option>
                    {budgets.map((budget) => (
                      <option key={budget.id} value={budget.id} disabled={budget.approval_status !== 'approved'}>
                        {budget.title}{budget.approval_status !== 'approved' ? ` (${budget.approval_status || 'pending'})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Linked Event</label>
                  <select
                    value={form.event_id}
                    onChange={(e) => setForm({ ...form, event_id: e.target.value })}
                    className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                  >
                    <option value="">No linked event</option>
                    {events.map((event) => (
                      <option key={event.id} value={event.id}>{event.title}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Receipt Reference</label>
                <input
                  type="text"
                  value={form.receipt_reference}
                  onChange={(e) => setForm({ ...form, receipt_reference: e.target.value })}
                  placeholder="GCash reference, OR number, or payment note"
                  className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                />
              </div>
              {formError && <p className="text-xs text-red-600">{formError}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => { setShowForm(false); setEditingTransaction(null); }} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD]">Cancel</button>
                <button
                  type="submit"
                  disabled={formSubmitting || !form.description || !form.amount || !form.transaction_date}
                  className="h-11 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7] transition disabled:opacity-50"
                >
                  {formSubmitting ? 'Saving...' : editingTransaction ? 'Update Transaction' : 'Save Transaction'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showBudgetForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#0F172A]">Propose Budget</h2>
              <button onClick={() => setShowBudgetForm(false)} className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-[#EEF6FB]"><X size={18} /></button>
            </div>
            <p className="mb-4 text-xs font-medium text-slate-500">
              New budgets await Department Head approval before funds can be tracked against them.
            </p>
            <form className="space-y-4" onSubmit={handleCreateBudget}>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Title *</label>
                <input
                  type="text"
                  value={budgetForm.title}
                  onChange={(e) => setBudgetForm({ ...budgetForm, title: e.target.value })}
                  placeholder="e.g. Sports Fest 2026 Budget"
                  className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Allocated Amount (₱) *</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={budgetForm.allocated_amount}
                    onChange={(e) => setBudgetForm({ ...budgetForm, allocated_amount: e.target.value })}
                    placeholder="0.00"
                    className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Warning Threshold (₱) *</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={budgetForm.warning_threshold}
                    onChange={(e) => setBudgetForm({ ...budgetForm, warning_threshold: e.target.value })}
                    placeholder="0.00"
                    className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Linked Event (optional)</label>
                <select
                  value={budgetForm.event_id}
                  onChange={(e) => setBudgetForm({ ...budgetForm, event_id: e.target.value })}
                  className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                >
                  <option value="">No linked event</option>
                  {events.map((ev) => (
                    <option key={ev.id} value={ev.id}>{ev.title}</option>
                  ))}
                </select>
              </div>
              {budgetFormError && <p className="text-xs text-red-600">{budgetFormError}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowBudgetForm(false)} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD]">Cancel</button>
                <button
                  type="submit"
                  disabled={budgetFormSubmitting || !budgetForm.title.trim() || budgetForm.allocated_amount === '' || budgetForm.warning_threshold === ''}
                  className="h-11 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7] transition disabled:opacity-50"
                >
                  {budgetFormSubmitting ? 'Submitting...' : 'Submit for Approval'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
