import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  DollarSign,
  Filter,
  Package,
  Plus,
  Search,
  ShoppingBag,
  Ticket,
  X,
} from 'lucide-react';

const stats = [
  { label: 'Total Items', value: '32', helper: 'In inventory', icon: Package },
  { label: 'Low Stock', value: '4', helper: 'Needs restocking', icon: AlertTriangle },
  { label: 'Active Orders', value: '18', helper: 'Pending fulfillment', icon: ShoppingBag },
  { label: 'Revenue', value: '₱67,200', helper: 'This semester', icon: DollarSign },
];

const inventory = [
  { name: 'HIUSA Official T-Shirt (S)', sku: 'MERCH-001', stock: 45, price: 350, status: 'In Stock' },
  { name: 'HIUSA Official T-Shirt (M)', sku: 'MERCH-002', stock: 62, price: 350, status: 'In Stock' },
  { name: 'HIUSA Official T-Shirt (L)', sku: 'MERCH-003', stock: 3, price: 350, status: 'Low Stock' },
  { name: 'HIUSA Lanyard', sku: 'MERCH-004', stock: 120, price: 75, status: 'In Stock' },
  { name: 'HIUSA Sticker Pack', sku: 'MERCH-005', stock: 200, price: 50, status: 'In Stock' },
  { name: 'HIUSA Tote Bag', sku: 'MERCH-006', stock: 0, price: 280, status: 'Out of Stock' },
  { name: 'HIUSA Cap', sku: 'MERCH-007', stock: 2, price: 320, status: 'Low Stock' },
];

const orders = [
  { id: 'ORD-001', student: 'Ana Garcia', item: 'T-Shirt (M)', qty: 1, status: 'Processing', date: '2026-06-22' },
  { id: 'ORD-002', student: 'Ben Torres', item: 'Lanyard', qty: 2, status: 'Ready', date: '2026-06-21' },
  { id: 'ORD-003', student: 'Clara Dela Cruz', item: 'Sticker Pack', qty: 3, status: 'Fulfilled', date: '2026-06-20' },
  { id: 'ORD-004', student: 'David Lim', item: 'T-Shirt (L)', qty: 1, status: 'Processing', date: '2026-06-22' },
  { id: 'ORD-005', student: 'Eva Mendoza', item: 'Tote Bag', qty: 1, status: 'Cancelled', date: '2026-06-19' },
];

const tokens = [
  { code: 'TKN-7A3F', student: 'Ana Garcia', item: 'T-Shirt (M)', status: 'Active', issued: '2026-06-22' },
  { code: 'TKN-9B2E', student: 'Ben Torres', item: 'Lanyard', status: 'Redeemed', issued: '2026-06-21' },
  { code: 'TKN-4C8D', student: 'Clara Dela Cruz', item: 'Sticker Pack', status: 'Redeemed', issued: '2026-06-20' },
  { code: 'TKN-1D5F', student: 'David Lim', item: 'T-Shirt (L)', status: 'Active', issued: '2026-06-22' },
];

const stockBadge = {
  'In Stock': 'bg-emerald-50 text-emerald-700',
  'Low Stock': 'bg-amber-50 text-amber-700',
  'Out of Stock': 'bg-red-50 text-red-700',
};

const orderBadge = {
  Processing: 'bg-[#E6F6FD] text-[#0B8ED0]',
  Ready: 'bg-amber-50 text-amber-700',
  Fulfilled: 'bg-emerald-50 text-emerald-700',
  Cancelled: 'bg-red-50 text-red-700',
};

const tokenBadge = {
  Active: 'bg-[#E6F6FD] text-[#0B8ED0]',
  Redeemed: 'bg-emerald-50 text-emerald-700',
  Expired: 'bg-slate-100 text-slate-500',
};

export default function MerchandisePage({ initialTab = 'inventory' }) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  return (
    <div className="space-y-6">
      {/* Stats */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <article key={stat.label} className="group rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm transition hover:shadow-md hover:border-[#0B8ED0]/20">
            <div className="mb-3 grid h-10 w-10 place-items-center rounded-lg bg-rose-50 text-rose-600 group-hover:bg-rose-600 group-hover:text-white transition">
              <stat.icon size={19} />
            </div>
            <p className="text-sm font-semibold text-slate-500">{stat.label}</p>
            <p className="mt-1 text-2xl font-black text-[#0F172A]">{stat.value}</p>
            <p className="mt-1 text-xs font-medium text-slate-400">{stat.helper}</p>
          </article>
        ))}
      </section>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {['inventory', 'orders', 'tokens'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`rounded-lg px-4 py-2.5 text-[13px] font-bold capitalize transition-all ${
              activeTab === tab
                ? 'bg-[#0B8ED0] text-white shadow-lg shadow-[#0B8ED0]/20'
                : 'bg-white text-slate-600 border border-[#DDE7EF] hover:bg-[#EEF6FB]'
            }`}
          >
            {tab === 'tokens' ? 'Issue Tokens' : tab === 'orders' ? 'Process Orders' : 'Manage Inventory'}
          </button>
        ))}
      </div>

      {/* Inventory */}
      {activeTab === 'inventory' && (
        <section className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-[#DDE7EF] p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-[#0F172A]">Inventory</h2>
              <p className="text-sm font-medium text-slate-500">Manage merchandise stock and pricing</p>
            </div>
            <div className="flex gap-2">
              <div className="flex h-10 items-center gap-2 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-3">
                <Search size={15} className="text-slate-400" />
                <input type="text" placeholder="Search items..." className="w-[140px] bg-transparent text-[13px] outline-none placeholder:text-slate-400" />
              </div>
              <button onClick={() => setShowForm(true)} className="flex h-10 items-center gap-2 rounded-lg bg-[#0B8ED0] px-4 text-[13px] font-bold text-white hover:bg-[#0878B7] transition">
                <Plus size={16} />
                <span className="hidden sm:inline">Add Item</span>
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[650px] text-left">
              <thead className="bg-[#F8FBFD] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3">Item</th>
                  <th className="px-5 py-3">SKU</th>
                  <th className="px-5 py-3">Stock</th>
                  <th className="px-5 py-3">Price</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5EDF3] text-sm">
                {inventory.map((item) => (
                  <tr key={item.sku} className="transition hover:bg-[#F8FBFD]">
                    <td className="px-5 py-4 font-bold text-[#0F172A]">{item.name}</td>
                    <td className="px-5 py-4 font-mono text-xs font-bold text-slate-500">{item.sku}</td>
                    <td className="px-5 py-4 font-black text-[#0F172A]">{item.stock}</td>
                    <td className="px-5 py-4 font-bold text-[#0F172A]">₱{item.price}</td>
                    <td className="px-5 py-4">
                      <span className={`rounded-full px-3 py-1 text-xs font-bold ${stockBadge[item.status]}`}>{item.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Orders */}
      {activeTab === 'orders' && (
        <section className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-[#DDE7EF] p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-[#0F172A]">Orders</h2>
              <p className="text-sm font-medium text-slate-500">Process and track student merchandise orders</p>
            </div>
            <button type="button" className="grid h-10 w-10 place-items-center rounded-lg border border-[#DDE7EF] text-slate-500 hover:bg-[#EEF6FB]"><Filter size={16} /></button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[650px] text-left">
              <thead className="bg-[#F8FBFD] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3">Order ID</th>
                  <th className="px-5 py-3">Student</th>
                  <th className="px-5 py-3">Item</th>
                  <th className="px-5 py-3">Qty</th>
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5EDF3] text-sm">
                {orders.map((o) => (
                  <tr key={o.id} className="transition hover:bg-[#F8FBFD]">
                    <td className="px-5 py-4 font-mono text-xs font-bold text-slate-500">{o.id}</td>
                    <td className="px-5 py-4 font-semibold text-[#0F172A]">{o.student}</td>
                    <td className="px-5 py-4 font-medium text-slate-600">{o.item}</td>
                    <td className="px-5 py-4 font-bold text-[#0F172A]">{o.qty}</td>
                    <td className="px-5 py-4 font-medium text-slate-600">{o.date}</td>
                    <td className="px-5 py-4">
                      <span className={`rounded-full px-3 py-1 text-xs font-bold ${orderBadge[o.status]}`}>{o.status}</span>
                    </td>
                    <td className="px-5 py-4">
                      {o.status === 'Processing' && (
                        <button className="flex items-center gap-1 rounded-md bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition">
                          Mark Ready <ArrowRight size={12} />
                        </button>
                      )}
                      {o.status === 'Ready' && (
                        <button className="flex items-center gap-1 rounded-md bg-[#E6F6FD] px-3 py-1.5 text-xs font-bold text-[#0B8ED0] hover:bg-[#d2eef9] transition">
                          Fulfill <ArrowRight size={12} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Tokens */}
      {activeTab === 'tokens' && (
        <section className="space-y-4">
          <div className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-[#DDE7EF] p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-bold text-[#0F172A]">Queue Tokens</h2>
                <p className="text-sm font-medium text-slate-500">Generate and manage redemption tokens</p>
              </div>
              <button className="flex h-10 items-center gap-2 rounded-lg bg-[#0B8ED0] px-4 text-[13px] font-bold text-white hover:bg-[#0878B7] transition">
                <Ticket size={16} />
                Generate Token
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[550px] text-left">
                <thead className="bg-[#F8FBFD] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Token Code</th>
                    <th className="px-5 py-3">Student</th>
                    <th className="px-5 py-3">Item</th>
                    <th className="px-5 py-3">Issued</th>
                    <th className="px-5 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5EDF3] text-sm">
                  {tokens.map((t) => (
                    <tr key={t.code} className="transition hover:bg-[#F8FBFD]">
                      <td className="px-5 py-4 font-mono text-xs font-black text-[#0B8ED0]">{t.code}</td>
                      <td className="px-5 py-4 font-semibold text-[#0F172A]">{t.student}</td>
                      <td className="px-5 py-4 font-medium text-slate-600">{t.item}</td>
                      <td className="px-5 py-4 font-medium text-slate-600">{t.issued}</td>
                      <td className="px-5 py-4">
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${tokenBadge[t.status]}`}>{t.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* Add Item Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#0F172A]">Add Merchandise Item</h2>
              <button onClick={() => setShowForm(false)} className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-[#EEF6FB]"><X size={18} /></button>
            </div>
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setShowForm(false); }}>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Item Name</label>
                <input type="text" placeholder="e.g. HIUSA T-Shirt (XL)" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Price (₱)</label>
                  <input type="number" placeholder="0.00" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Initial Stock</label>
                  <input type="number" placeholder="0" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">SKU</label>
                <input type="text" placeholder="Auto-generated" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD]">Cancel</button>
                <button type="submit" className="h-11 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7] transition">Add Item</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
