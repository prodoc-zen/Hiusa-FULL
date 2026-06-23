import { useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Coins,
  Download,
  Filter,
  Plus,
  Search,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react';

const summaryCards = [
  { label: 'Total Budget', value: '₱485,000', helper: 'Annual allocation', icon: Wallet, trend: '+12%', up: true },
  { label: 'Total Income', value: '₱128,750', helper: 'This semester', icon: ArrowUpRight, trend: '+8.3%', up: true },
  { label: 'Total Expenses', value: '₱97,340', helper: 'This semester', icon: ArrowDownRight, trend: '+5.1%', up: false },
  { label: 'Balance', value: '₱387,660', helper: 'Available funds', icon: Coins, trend: 'Healthy', up: true },
];

const transactions = [
  { id: 'TXN-001', date: '2026-06-22', desc: 'Event supplies — Annual Assembly', category: 'Events', amount: -12500, status: 'Completed' },
  { id: 'TXN-002', date: '2026-06-20', desc: 'Membership fees collected (Batch 3)', category: 'Income', amount: 45000, status: 'Completed' },
  { id: 'TXN-003', date: '2026-06-18', desc: 'Printing — Election ballots & posters', category: 'Elections', amount: -3200, status: 'Completed' },
  { id: 'TXN-004', date: '2026-06-16', desc: 'Merchandise restock — T-shirts', category: 'Merchandise', amount: -28500, status: 'Pending' },
  { id: 'TXN-005', date: '2026-06-14', desc: 'Sponsorship — Tech company', category: 'Income', amount: 25000, status: 'Completed' },
  { id: 'TXN-006', date: '2026-06-12', desc: 'Food & beverages — Officer meeting', category: 'Operations', amount: -1800, status: 'Completed' },
];

const statusBadge = {
  Completed: 'bg-emerald-50 text-emerald-700',
  Pending: 'bg-amber-50 text-amber-700',
  Failed: 'bg-red-50 text-red-700',
};

const forecastData = [
  { month: 'Jul', projected: 42000, actual: null },
  { month: 'Aug', projected: 38000, actual: null },
  { month: 'Sep', projected: 55000, actual: null },
  { month: 'Oct', projected: 35000, actual: null },
  { month: 'Nov', projected: 48000, actual: null },
  { month: 'Dec', projected: 30000, actual: null },
];

const maxProjected = Math.max(...forecastData.map(d => d.projected));

export default function FinancePage() {
  const [showForm, setShowForm] = useState(false);
  const [activeTab, setActiveTab] = useState('transactions');

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card) => (
          <article
            key={card.label}
            className="group rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm transition-all hover:shadow-md hover:border-[#0B8ED0]/20"
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-emerald-50 text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white transition">
                <card.icon size={19} />
              </div>
              <span className={`flex items-center gap-1 text-[11px] font-bold ${card.up ? 'text-emerald-600' : 'text-red-500'}`}>
                <TrendingUp size={12} className={card.up ? '' : 'rotate-180'} />
                {card.trend}
              </span>
            </div>
            <p className="text-sm font-semibold text-slate-500">{card.label}</p>
            <p className="mt-1 text-2xl font-black text-[#0F172A]">{card.value}</p>
            <p className="mt-1 text-xs font-medium text-slate-400">{card.helper}</p>
          </article>
        ))}
      </section>

      {/* Tab navigation */}
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

      {/* Transactions tab */}
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
                  type="text"
                  placeholder="Search transactions..."
                  className="w-[160px] bg-transparent text-[13px] outline-none placeholder:text-slate-400"
                />
              </div>
              <button type="button" className="grid h-10 w-10 place-items-center rounded-lg border border-[#DDE7EF] text-slate-500 hover:bg-[#EEF6FB]">
                <Filter size={16} />
              </button>
              <button
                type="button"
                onClick={() => setShowForm(true)}
                className="flex h-10 items-center gap-2 rounded-lg bg-[#0B8ED0] px-4 text-[13px] font-bold text-white hover:bg-[#0878B7] transition"
              >
                <Plus size={16} />
                <span className="hidden sm:inline">Record Transaction</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left">
              <thead className="bg-[#F8FBFD] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3">ID</th>
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Description</th>
                  <th className="px-5 py-3">Category</th>
                  <th className="px-5 py-3">Amount</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5EDF3] text-sm">
                {transactions.map((tx) => (
                  <tr key={tx.id} className="transition hover:bg-[#F8FBFD]">
                    <td className="px-5 py-4 font-mono text-xs font-bold text-slate-500">{tx.id}</td>
                    <td className="px-5 py-4 font-medium text-slate-600">{tx.date}</td>
                    <td className="px-5 py-4 font-semibold text-[#0F172A]">{tx.desc}</td>
                    <td className="px-5 py-4">
                      <span className="rounded-full bg-[#F8FBFD] border border-[#DDE7EF] px-2.5 py-1 text-xs font-bold text-slate-600">
                        {tx.category}
                      </span>
                    </td>
                    <td className={`px-5 py-4 font-black ${tx.amount > 0 ? 'text-emerald-600' : 'text-[#0F172A]'}`}>
                      {tx.amount > 0 ? '+' : ''}₱{Math.abs(tx.amount).toLocaleString()}
                    </td>
                    <td className="px-5 py-4">
                      <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusBadge[tx.status]}`}>
                        {tx.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* AI Forecasting tab */}
      {activeTab === 'forecasting' && (
        <section className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
          <div className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-[#0F172A]">AI-Powered Spending Forecast</h2>
            <p className="mb-6 text-sm font-medium text-slate-500">Projected monthly expenses for the next 6 months</p>
            <div className="space-y-3">
              {forecastData.map((d) => (
                <div key={d.month} className="flex items-center gap-4">
                  <span className="w-10 text-sm font-bold text-slate-600">{d.month}</span>
                  <div className="flex-1 h-8 rounded-lg bg-[#F8FBFD] overflow-hidden">
                    <div
                      className="h-full rounded-lg bg-gradient-to-r from-[#0B8ED0] to-[#16C7F3] transition-all duration-500"
                      style={{ width: `${(d.projected / maxProjected) * 100}%` }}
                    />
                  </div>
                  <span className="w-20 text-right text-sm font-bold text-[#0F172A]">₱{(d.projected / 1000).toFixed(0)}k</span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
              <h3 className="text-base font-bold text-[#0F172A]">Budget Advisory</h3>
              <div className="mt-4 space-y-3">
                {[
                  { text: 'Event spending is 15% under projection — consider reallocating to merchandise.', type: 'tip' },
                  { text: 'December expenses expected to drop 38% due to semester break.', type: 'info' },
                  { text: 'Merchandise category trending 22% above budget — review pricing.', type: 'warn' },
                ].map((advice, i) => (
                  <div
                    key={i}
                    className={`rounded-lg p-3.5 text-[13px] font-medium leading-relaxed ${
                      advice.type === 'tip' ? 'bg-emerald-50 text-emerald-700' :
                      advice.type === 'warn' ? 'bg-amber-50 text-amber-700' :
                      'bg-[#E6F6FD] text-[#0878B7]'
                    }`}
                  >
                    {advice.text}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Reports tab */}
      {activeTab === 'reports' && (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[
            { title: 'Monthly Summary', desc: 'Income vs expenses for the current month', period: 'June 2026' },
            { title: 'Semester Report', desc: 'Full financial overview for 1st semester', period: '1st Sem 2026' },
            { title: 'Budget Utilization', desc: 'How allocated budgets were spent per category', period: 'Year-to-date' },
            { title: 'Transaction Log', desc: 'Complete ledger of all recorded transactions', period: 'All time' },
            { title: 'Audit Trail', desc: 'Who recorded, edited, or approved each transaction', period: 'All time' },
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

      {/* Record Transaction Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#0F172A]">Record Transaction</h2>
              <button onClick={() => setShowForm(false)} className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-[#EEF6FB]">
                <X size={18} />
              </button>
            </div>
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setShowForm(false); }}>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Description</label>
                <input type="text" placeholder="e.g. Event supplies purchase" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Amount (₱)</label>
                  <input type="number" placeholder="0.00" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Category</label>
                  <select className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]">
                    <option>Events</option>
                    <option>Income</option>
                    <option>Elections</option>
                    <option>Merchandise</option>
                    <option>Operations</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Date</label>
                  <input type="date" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Type</label>
                  <select className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]">
                    <option>Expense</option>
                    <option>Income</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD]">
                  Cancel
                </button>
                <button type="submit" className="h-11 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7] transition">
                  Save Transaction
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
