import { useEffect, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
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

const statusBadge = {
  completed: 'bg-emerald-50 text-emerald-700',
  pending: 'bg-amber-50 text-amber-700',
  failed: 'bg-red-50 text-red-700',
};

function fmt(n) {
  return `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
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

  const [form, setForm] = useState({ description: '', amount: '', type: 'expense', category: 'Operations', transaction_date: '' });
  const [formError, setFormError] = useState(null);
  const [formSubmitting, setFormSubmitting] = useState(false);

  function load() {
    setLoading(true);
    setError(null);
    Promise.all([getTransactions(), getTransactionSummary(), getForecasts()])
      .then(([txRes, sumRes, fcRes]) => {
        setTransactions(Array.isArray(txRes.data?.data) ? txRes.data.data : (Array.isArray(txRes.data) ? txRes.data : []));
        setSummary(sumRes.data ?? { total_income: 0, total_expense: 0, net_balance: 0 });
        setForecasts(Array.isArray(fcRes.data) ? fcRes.data : []);
      })
      .catch(() => setError('Failed to load financial data.'))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

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
      load();
    } catch (err) {
      setFormError(err.response?.data?.message ?? 'Failed to save transaction.');
    } finally {
      setFormSubmitting(false);
    }
  }

  const filtered = transactions.filter((tx) =>
    (tx.description ?? '').toLowerCase().includes(search.toLowerCase())
  );

  const maxForecast = forecasts.length > 0 ? Math.max(...forecasts.map((f) => f.predicted_expense)) : 1;

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Total Income', value: fmt(summary.total_income), helper: 'Recorded income', icon: ArrowUpRight, up: true },
          { label: 'Total Expenses', value: fmt(summary.total_expense), helper: 'Recorded expenses', icon: ArrowDownRight, up: false },
          { label: 'Net Balance', value: fmt(summary.net_balance), helper: 'Income minus expenses', icon: Coins, up: summary.net_balance >= 0 },
          { label: 'Transactions', value: transactions.length, helper: 'All records', icon: Wallet, up: true },
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

      <div className="flex flex-wrap gap-2">
        {['transactions', 'forecasting', 'reports'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`rounded-lg px-4 py-2.5 text-[13px] font-bold capitalize transition-all ${
              activeTab === tab
                ? 'bg-[#0B8ED0] text-white shadow-lg shadow-[#0B8ED0]/20'
                : 'bg-white text-slate-600 border border-[#DDE7EF] hover:bg-[#EEF6FB]'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 p-5 text-center">
          <p className="text-sm font-semibold text-red-700">{error}</p>
          <button onClick={load} className="mt-2 text-sm font-bold text-red-600 underline">Try again</button>
        </div>
      )}

      {activeTab === 'transactions' && (
        <section className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-[#DDE7EF] p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-[#0F172A]">Transactions</h2>
              <p className="text-sm font-medium text-slate-500">Record and view all financial transactions</p>
            </div>
            <div className="flex gap-2">
              <div className="flex h-10 items-center gap-2 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-3">
                <Search size={15} className="text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  type="text"
                  placeholder="Search transactions..."
                  className="w-[160px] bg-transparent text-[13px] outline-none placeholder:text-slate-400"
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
              <table className="w-full min-w-[700px] text-left">
                <thead className="bg-[#F8FBFD] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Date</th>
                    <th className="px-5 py-3">Description</th>
                    <th className="px-5 py-3">Category</th>
                    <th className="px-5 py-3">Type</th>
                    <th className="px-5 py-3">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5EDF3] text-sm">
                  {filtered.map((tx) => (
                    <tr key={tx.id} className="transition hover:bg-[#F8FBFD]">
                      <td className="px-5 py-4 font-medium text-slate-600">{tx.transaction_date}</td>
                      <td className="px-5 py-4 font-semibold text-[#0F172A]">{tx.description}</td>
                      <td className="px-5 py-4">
                        <span className="rounded-full border border-[#DDE7EF] bg-[#F8FBFD] px-2.5 py-1 text-xs font-bold text-slate-600">{tx.category}</span>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${tx.type === 'income' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                          {tx.type === 'income' ? 'Income' : 'Expense'}
                        </span>
                      </td>
                      <td className={`px-5 py-4 font-black ${tx.type === 'income' ? 'text-emerald-600' : 'text-[#0F172A]'}`}>
                        {tx.type === 'income' ? '+' : '-'}{fmt(tx.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
                    <span className="w-28 truncate text-sm font-bold text-slate-600">{f.forecast_period}</span>
                    <div className="flex-1 h-8 rounded-lg bg-[#F8FBFD] overflow-hidden">
                      <div
                        className="h-full rounded-lg bg-gradient-to-r from-[#0B8ED0] to-[#16C7F3] transition-all duration-500"
                        style={{ width: `${(f.predicted_expense / maxForecast) * 100}%` }}
                      />
                    </div>
                    <span className="w-24 text-right text-sm font-bold text-[#0F172A]">{fmt(f.predicted_expense)}</span>
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
                  <div key={cat.category} className="rounded-lg bg-[#F8FBFD] p-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-bold text-[#0F172A]">{cat.category}</span>
                      <span className="text-[13px] font-bold text-[#0B8ED0]">{fmt(cat.total)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      )}

      {activeTab === 'reports' && (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[
            { title: 'Monthly Summary', desc: 'Income vs expenses for the current month', period: 'This month' },
            { title: 'Semester Report', desc: 'Full financial overview for the current semester', period: 'This semester' },
            { title: 'Transaction Log', desc: 'Complete ledger of all recorded transactions', period: 'All time' },
            { title: 'Category Breakdown', desc: 'Spending distribution across categories', period: 'This semester' },
          ].map((report) => (
            <div key={report.title} className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm hover:shadow-md transition">
              <span className="inline-block rounded-full bg-[#E6F6FD] px-2.5 py-1 text-[11px] font-bold text-[#0878B7] mb-3">
                {report.period}
              </span>
              <h3 className="text-base font-bold text-[#0F172A]">{report.title}</h3>
              <p className="mt-1 text-sm font-medium text-slate-500">{report.desc}</p>
              <button className="mt-4 flex items-center gap-2 text-[13px] font-bold text-[#0B8ED0] hover:text-[#0878B7] transition">
                <Download size={15} />
                Export Report
              </button>
            </div>
          ))}
        </section>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl">
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
                    className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]"
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
                    className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]"
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
