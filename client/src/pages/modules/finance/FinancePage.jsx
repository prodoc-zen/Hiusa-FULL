import { useEffect, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Coins,
  Download,
  Plus,
  Search,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react';
import {
  getTransactions,
  getTransactionSummary,
  createTransaction,
  getForecasts,
} from '../../../services/financeService';

function fmt(n) {
  return `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function downloadCSV(rows, filename) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map((r) =>
      headers.map((h) => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(',')
    ),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function FinancePage({ initialTab = 'transactions' }) {
  const [showForm, setShowForm] = useState(false);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [transactions, setTransactions] = useState([]);
  const [summary, setSummary] = useState({ total_income: 0, total_expense: 0, net_balance: 0 });
  const [forecasts, setForecasts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [txMeta, setTxMeta] = useState({ current_page: 1, last_page: 1, total: 0, per_page: 20 });

  const [form, setForm] = useState({ description: '', amount: '', type: 'expense', category: 'Operations', transaction_date: '' });
  const [formError, setFormError] = useState(null);
  const [formSubmitting, setFormSubmitting] = useState(false);

  function load(page = 1) {
    setLoading(true);
    setError(null);
    Promise.all([getTransactions({ page }), getTransactionSummary(), getForecasts()])
      .then(([txRes, sumRes, fcRes]) => {
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
        setForecasts(Array.isArray(fcRes.data) ? fcRes.data : []);
      })
      .catch(() => setError('Failed to load financial data.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { setActiveTab(initialTab); }, [initialTab]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.description || !form.amount || !form.transaction_date) return;
    setFormSubmitting(true);
    setFormError(null);
    try {
      await createTransaction({
        description: form.description,
        amount: parseFloat(form.amount),
        type: form.type,
        category: form.category,
        transaction_date: form.transaction_date,
      });
      setShowForm(false);
      setForm({ description: '', amount: '', type: 'expense', category: 'Operations', transaction_date: '' });
      load(1);
    } catch (err) {
      setFormError(err.response?.data?.message ?? 'Failed to save transaction.');
    } finally {
      setFormSubmitting(false);
    }
  }

  async function handleExport(type) {
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
      downloadCSV(rows, `hiusa-category-breakdown-${yyyy}-${mm}.csv`);
      return;
    }

    try {
      const allRes = await getTransactions({ per_page: 1000 });
      const all = Array.isArray(allRes.data?.data) ? allRes.data.data : (Array.isArray(allRes.data) ? allRes.data : []);

      const toRow = (tx) => ({
        Date: tx.transaction_date,
        Description: tx.description,
        Category: tx.category,
        Type: tx.type,
        'Amount (₱)': Number(tx.amount).toFixed(2),
      });

      if (type === 'monthly') {
        const filtered = all.filter((tx) => String(tx.transaction_date).startsWith(`${yyyy}-${mm}`));
        downloadCSV(filtered.map(toRow), `hiusa-monthly-${yyyy}-${mm}.csv`);
      } else if (type === 'semester') {
        const cutoff = new Date(today);
        cutoff.setMonth(cutoff.getMonth() - 6);
        const filtered = all.filter((tx) => new Date(tx.transaction_date) >= cutoff);
        downloadCSV(filtered.map(toRow), `hiusa-semester-${yyyy}.csv`);
      } else if (type === 'log') {
        downloadCSV(all.map(toRow), `hiusa-transaction-log-${yyyy}-${mm}-${dd}.csv`);
      }
    } catch {
      alert('Failed to fetch transactions for export. Please try again.');
    }
  }

  const filtered = transactions.filter((tx) =>
    (tx.description ?? '').toLowerCase().includes(search.toLowerCase())
  );

  const maxForecast = forecasts.length > 0 ? Math.max(...forecasts.map((f) => f.predicted_expense)) : 1;
  const txFrom = (txMeta.current_page - 1) * txMeta.per_page + 1;
  const txTo = Math.min(txMeta.current_page * txMeta.per_page, txMeta.total);

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Total Income', value: fmt(summary.total_income), helper: 'Recorded income', icon: ArrowUpRight, up: true },
          { label: 'Total Expenses', value: fmt(summary.total_expense), helper: 'Recorded expenses', icon: ArrowDownRight, up: false },
          { label: 'Net Balance', value: fmt(summary.net_balance), helper: 'Income minus expenses', icon: Coins, up: summary.net_balance >= 0 },
          { label: 'Transactions', value: txMeta.total || transactions.length, helper: 'All records', icon: Wallet, up: true },
        ].map((card) => (
          <article key={card.label} className="group rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm transition-all hover:shadow-md hover:border-[#0B8ED0]/20">
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
                  type="text"
                  placeholder="Search transactions..."
                  className="w-full bg-transparent text-[13px] outline-none placeholder:text-slate-400 sm:w-[160px]"
                />
              </div>
              <button onClick={() => setShowForm(true)} className="flex h-10 items-center gap-2 rounded-lg bg-[#0B8ED0] px-4 text-[13px] font-bold text-white hover:bg-[#0878B7] transition">
                <Plus size={16} />
                <span className="hidden sm:inline">Record Transaction</span>
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {txMeta.total > txMeta.per_page && (
            <div className="flex items-center justify-between border-t border-[#DDE7EF] px-5 py-3">
              <p className="text-xs font-medium text-slate-400">
                Showing <span className="font-bold text-slate-600">{txFrom}–{txTo}</span> of <span className="font-bold text-slate-600">{txMeta.total}</span>
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

      {activeTab === 'forecasting' && (
        <section className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
          <div className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-[#0F172A]">Spending Forecast</h2>
            <p className="mb-6 text-sm font-medium text-slate-500">Projected expenses per period</p>
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <div key={i} className="h-8 animate-pulse rounded-lg bg-slate-100" />)}
              </div>
            ) : forecasts.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">No forecasts recorded yet.</p>
            ) : (
              <div className="space-y-3">
                {forecasts.map((f) => (
                  <div key={f.id} className="flex items-center gap-4">
                    <span className="w-36 truncate text-sm font-bold text-slate-600">{f.forecast_period}</span>
                    <div className="flex-1 h-8 rounded-lg bg-[#F8FBFD] overflow-hidden">
                      <div
                        className="h-full rounded-lg bg-gradient-to-r from-[#0B8ED0] to-[#16C7F3] transition-all duration-500"
                        style={{ width: `${(f.predicted_expense / maxForecast) * 100}%` }}
                      />
                    </div>
                    <span className="w-24 text-right text-sm font-bold tabular-nums text-[#0F172A]">{fmt(f.predicted_expense)}</span>
                  </div>
                ))}
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
              <button
                onClick={() => handleExport(report.key)}
                className="mt-4 flex items-center gap-2 rounded-lg bg-[#0B8ED0] px-4 py-2 text-[13px] font-bold text-white transition hover:bg-[#0878B7]"
              >
                <Download size={15} />
                Export CSV
              </button>
            </div>
          ))}
        </section>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#0F172A]">Record Transaction</h2>
              <button onClick={() => setShowForm(false)} className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-[#EEF6FB]"><X size={18} /></button>
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
              <div className="grid grid-cols-2 gap-4">
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
              <div className="grid grid-cols-2 gap-4">
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
              {formError && <p className="text-xs text-red-600">{formError}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD]">Cancel</button>
                <button
                  type="submit"
                  disabled={formSubmitting || !form.description || !form.amount || !form.transaction_date}
                  className="h-11 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7] transition disabled:opacity-50"
                >
                  {formSubmitting ? 'Saving...' : 'Save Transaction'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
