import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Circle,
  DollarSign,
  ImagePlus,
  Info,
  Package,
  Plus,
  Search,
  ShoppingBag,
  Ticket,
  X,
} from 'lucide-react';
import { getMerchandise, createItem } from '../../../services/merchandiseService';
import { getOrders, placeOrder, updateOrderStatus, claimByToken } from '../../../services/orderService';

function getRole() {
  try { return JSON.parse(localStorage.getItem('user'))?.role || 'officer'; } catch { return 'officer'; }
}

const stockBadge = (qty) => {
  if (qty === 0) return 'bg-red-50 text-red-700';
  if (qty < 10) return 'bg-amber-50 text-amber-700';
  return 'bg-emerald-50 text-emerald-700';
};
const stockLabel = (qty) => (qty === 0 ? 'Out of Stock' : qty < 10 ? 'Low Stock' : 'Available');

const orderBadge = {
  pending: 'bg-[#E6F6FD] text-[#0B8ED0]',
  paid: 'bg-amber-50 text-amber-700',
  claimed: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-red-50 text-red-700',
};

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : '-'; }
function fmt(n) { return `₱${Number(n || 0).toLocaleString('en-PH')}`; }
function fmtDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function StepNode({ active, done, label }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`grid h-7 w-7 place-items-center rounded-full border-2 transition-colors ${done ? 'border-emerald-500 bg-emerald-500' : active ? 'border-[#0B8ED0] bg-[#0B8ED0]' : 'border-slate-200 bg-white'}`}>
        {done ? <CheckCircle size={14} className="text-white" /> : <Circle size={10} className={active ? 'text-white' : 'text-slate-300'} />}
      </div>
      <span className={`text-[10px] font-bold ${done || active ? 'text-[#0F172A]' : 'text-slate-400'}`}>{label}</span>
    </div>
  );
}

function StepTracker({ status }) {
  const done1 = ['paid', 'claimed'].includes(status);
  const done2 = status === 'claimed';
  return (
    <div className="flex items-start gap-0">
      <StepNode active={status === 'pending'} done={done1} label="Reserved" />
      <div className={`mt-3 h-px w-10 ${done1 ? 'bg-emerald-400' : 'bg-slate-200'}`} />
      <StepNode active={status === 'paid'} done={done2} label="Paid" />
      <div className={`mt-3 h-px w-10 ${done2 ? 'bg-emerald-400' : 'bg-slate-200'}`} />
      <StepNode active={status === 'claimed'} done={false} label="Claimed" />
    </div>
  );
}

export default function MerchandisePage({ initialTab }) {
  const navigate = useNavigate();
  const role = getRole();
  const isStudent = role === 'student';
  const defaultTab = isStudent ? 'order' : 'inventory';
  const [activeTab, setActiveTab] = useState(initialTab || defaultTab);

  const [items, setItems] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [ordersMeta, setOrdersMeta] = useState({ current_page: 1, last_page: 1, total: 0, per_page: 20 });

  // Officer-only state
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', unit_price: '', stock_quantity: '', description: '' });
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [formError, setFormError] = useState(null);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [claimToken, setClaimToken] = useState('');
  const [claimError, setClaimError] = useState(null);
  const [claimSuccess, setClaimSuccess] = useState(null);
  const [claiming, setClaiming] = useState(false);

  // Student-only state
  const [reserving, setReserving] = useState(null);
  const [reserveError, setReserveError] = useState(null);

  function extractOrders(oRes) {
    const arr = Array.isArray(oRes.data?.data) ? oRes.data.data : (Array.isArray(oRes.data) ? oRes.data : []);
    setOrders(arr);
    if (oRes.data?.current_page !== undefined) {
      setOrdersMeta({ current_page: oRes.data.current_page, last_page: oRes.data.last_page, total: oRes.data.total, per_page: oRes.data.per_page });
    }
  }

  function load() {
    setLoading(true);
    setError(null);
    const calls = isStudent
      ? [getMerchandise(), getOrders()]
      : [getMerchandise(), getOrders({ page: 1 })];
    Promise.all(calls)
      .then(([mRes, oRes]) => {
        setItems(Array.isArray(mRes.data) ? mRes.data : []);
        extractOrders(oRes);
      })
      .catch(() => setError('Failed to load merchandise data.'))
      .finally(() => setLoading(false));
  }

  async function loadOrders(page) {
    setLoading(true);
    try { const oRes = await getOrders({ page }); extractOrders(oRes); }
    catch { setError('Failed to load orders.'); }
    finally { setLoading(false); }
  }

  useEffect(load, []);
  useEffect(() => { if (initialTab) setActiveTab(initialTab); }, [initialTab]);

  // Officer handlers
  function handleImageSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  async function handleAddItem(e) {
    e.preventDefault();
    if (!form.name || !form.unit_price || !form.stock_quantity) return;
    setFormSubmitting(true); setFormError(null);
    try {
      await createItem({ name: form.name, price: parseFloat(form.unit_price), stock_quantity: parseInt(form.stock_quantity, 10), description: form.description, is_active: true, imageFile });
      setShowForm(false);
      setForm({ name: '', unit_price: '', stock_quantity: '', description: '' });
      setImageFile(null); setImagePreview(null);
      load();
    } catch (err) { setFormError(err.response?.data?.message ?? 'Failed to add item.'); }
    finally { setFormSubmitting(false); }
  }

  async function handleStatusChange(id, status) {
    try {
      const res = await updateOrderStatus(id, status);
      setOrders((prev) => prev.map((o) => (o.id === id ? res.data : o)));
    } catch { alert('Failed to update order status.'); }
  }

  async function handleClaim(e) {
    e.preventDefault();
    if (!claimToken.trim()) return;
    setClaiming(true); setClaimError(null); setClaimSuccess(null);
    try {
      const res = await claimByToken(claimToken.trim().toUpperCase());
      setClaimSuccess(`Order claimed for ${res.data?.student?.first_name ?? 'student'}.`);
      setClaimToken('');
      load();
    } catch (err) { setClaimError(err.response?.data?.message ?? 'Invalid or already used token.'); }
    finally { setClaiming(false); }
  }

  // Student handler
  async function handleReserve(item) {
    setReserving(item.id); setReserveError(null);
    try {
      await placeOrder({ merchandise_id: item.id, quantity: 1 });
      await load();
      setActiveTab('tokens');
    } catch (err) {
      setReserveError(err.response?.data?.message ?? 'Failed to place order. Please try again.');
    } finally { setReserving(null); }
  }

  // Derived data
  const totalRevenue = orders.filter((o) => ['paid', 'claimed'].includes(o.status)).reduce((s, o) => s + (o.total_price || 0), 0);
  const activeOrders = orders.filter((o) => ['pending', 'paid'].includes(o.status)).length;
  const lowStock = items.filter((i) => i.stock_quantity > 0 && i.stock_quantity < 10).length;
  const paidOrders = orders.filter((o) => o.status === 'paid');
  const availableItems = items.filter((i) => i.stock_quantity > 0);

  const filteredItems = items.filter((i) => i.name?.toLowerCase().includes(search.toLowerCase()));
  const filteredOrders = orders.filter((o) => {
    const q = search.toLowerCase();
    return (o.merchandise?.name ?? '').toLowerCase().includes(q) || `ord-${o.id}`.includes(q);
  });

  const ordFrom = (ordersMeta.current_page - 1) * ordersMeta.per_page + 1;
  const ordTo = Math.min(ordersMeta.current_page * ordersMeta.per_page, ordersMeta.total);

  // ── STUDENT VIEW ─────────────────────────────────────────────────────────────
  if (isStudent) {
    return (
      <div className="space-y-6">
        {/* Student metric cards */}
        <section className="grid gap-4 sm:grid-cols-3">
          {[
            { label: 'Available Items', value: availableItems.length, helper: 'Ready to reserve', icon: Package },
            { label: 'My Orders', value: orders.length, helper: 'Total reservations', icon: ShoppingBag },
            { label: 'Pending Payment', value: orders.filter((o) => o.status === 'pending').length, helper: 'Awaiting payment', icon: Ticket },
          ].map((stat) => (
            <article key={stat.label} className="group rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm transition hover:border-[#0B8ED0]/20 hover:shadow-md">
              <div className="mb-3 grid h-10 w-10 place-items-center rounded-lg bg-[#E6F6FD] text-[#0B8ED0] transition group-hover:bg-[#0B8ED0] group-hover:text-white">
                <stat.icon size={19} />
              </div>
              <p className="text-sm font-semibold text-slate-500">{stat.label}</p>
              <p className="mt-1 text-2xl font-black text-[#0F172A]">{stat.value}</p>
              <p className="mt-1 text-xs font-medium text-slate-400">{stat.helper}</p>
            </article>
          ))}
        </section>

        {/* Student tabs */}
        <div className="flex flex-wrap gap-2">
          {[['order', 'Order Merchandise'], ['my-orders', 'My Orders'], ['tokens', 'Claim Tokens']].map(([key, label]) => (
            <button key={key} onClick={() => setActiveTab(key)}
              className={`rounded-lg px-4 py-2.5 text-[13px] font-bold transition-all ${activeTab === key ? 'bg-[#0B8ED0] text-white shadow-lg shadow-[#0B8ED0]/20' : 'border border-[#DDE7EF] bg-white text-slate-600 hover:bg-[#EEF6FB]'}`}>
              {label}
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-xl border border-red-100 bg-red-50 p-5 text-center">
            <p className="text-sm font-semibold text-red-700">{error}</p>
            <button onClick={load} className="mt-2 text-sm font-bold text-red-600 underline">Try again</button>
          </div>
        )}

        {/* Order Merchandise tab */}
        {activeTab === 'order' && (
          <section className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-[#DDE7EF] bg-[#EEF6FB] p-4">
              <Info size={18} className="mt-0.5 shrink-0 text-[#0B8ED0]" />
              <p className="text-[13px] font-medium text-[#0B1831]">No online payment required. Orders are reserved with a claim token. Present your token to the officer and pay in person during pickup.</p>
            </div>

            {reserveError && (
              <div className="rounded-xl border border-red-100 bg-red-50 p-4">
                <p className="text-sm font-semibold text-red-700">{reserveError}</p>
              </div>
            )}

            <div className="flex h-10 w-full max-w-sm items-center gap-2 rounded-lg border border-[#DDE7EF] bg-white px-3">
              <Search size={15} className="text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} type="text" placeholder="Search merchandise..." className="w-full bg-transparent text-[13px] outline-none placeholder:text-slate-400" />
            </div>

            {loading ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[1, 2, 3].map((i) => <div key={i} className="h-56 animate-pulse rounded-xl bg-slate-100" />)}
              </div>
            ) : filteredItems.filter((i) => i.stock_quantity > 0).length === 0 ? (
              <div className="rounded-xl border border-[#DDE7EF] bg-white p-12 text-center">
                <Package size={36} className="mx-auto mb-3 text-slate-200" />
                <p className="text-sm font-semibold text-slate-400">No items available right now.</p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredItems.filter((i) => i.stock_quantity > 0).map((item) => (
                  <div key={item.id} className="flex flex-col rounded-xl border border-[#DDE7EF] bg-white shadow-sm overflow-hidden">
                    {item.image_url
                      ? <img src={item.image_url} alt={item.name} className="h-40 w-full object-cover" />
                      : <div className="flex h-40 items-center justify-center bg-[#F8FBFD]"><Package size={40} className="text-slate-200" /></div>
                    }
                    <div className="flex flex-1 flex-col p-4">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-bold text-[#0F172A] leading-snug">{item.name}</p>
                        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${stockBadge(item.stock_quantity)}`}>{stockLabel(item.stock_quantity)}</span>
                      </div>
                      {item.description && <p className="mt-1 text-[12px] text-slate-400 line-clamp-2">{item.description}</p>}
                      <p className="mt-3 text-lg font-black text-[#0B8ED0]">{fmt(item.price)}</p>
                      <button
                        onClick={() => handleReserve(item)}
                        disabled={reserving === item.id || item.stock_quantity === 0}
                        className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#0B8ED0] text-[13px] font-bold text-white transition hover:bg-[#0878B7] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {reserving === item.id ? 'Reserving...' : 'Reserve & Get Token'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* My Orders tab */}
        {activeTab === 'my-orders' && (
          <section className="space-y-4">
            <div className="flex h-10 w-full max-w-sm items-center gap-2 rounded-lg border border-[#DDE7EF] bg-white px-3">
              <Search size={15} className="text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} type="text" placeholder="Search orders..." className="w-full bg-transparent text-[13px] outline-none placeholder:text-slate-400" />
            </div>

            {loading ? (
              <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-100" />)}</div>
            ) : filteredOrders.length === 0 ? (
              <div className="rounded-xl border border-[#DDE7EF] bg-white p-12 text-center">
                <ShoppingBag size={36} className="mx-auto mb-3 text-slate-200" />
                <p className="text-sm font-semibold text-slate-400">No orders yet. Browse merchandise to place your first order.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredOrders.map((o) => (
                  <div key={o.id} className={`rounded-xl border bg-white p-5 shadow-sm ${o.status === 'claimed' ? 'border-emerald-200' : o.status === 'paid' ? 'border-amber-200' : 'border-[#DDE7EF]'}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-xs font-bold text-slate-400">ORD-{o.id}</p>
                        <p className="mt-0.5 font-bold text-[#0F172A]">{o.merchandise?.name ?? '-'}</p>
                        <p className="text-[13px] text-slate-500">Qty: {o.quantity} · Total: {fmt(o.total_price)}</p>
                        <p className="mt-1 text-[12px] text-slate-400">{fmtDate(o.created_at)}</p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${orderBadge[o.status] || 'bg-slate-100 text-slate-500'}`}>{capitalize(o.status)}</span>
                        {o.claim_token && (
                          <span className="font-mono text-xs font-black text-slate-500">TKN: {o.claim_token}</span>
                        )}
                      </div>
                    </div>
                    {o.status === 'paid' && (
                      <div className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2">
                        <Info size={14} className="text-amber-600 shrink-0" />
                        <p className="text-[12px] font-semibold text-amber-700">Payment confirmed! Show your token again to collect your item.</p>
                      </div>
                    )}
                    {o.status === 'claimed' && (
                      <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2">
                        <CheckCircle size={14} className="text-emerald-600 shrink-0" />
                        <p className="text-[12px] font-semibold text-emerald-700">Item successfully claimed. Thank you!</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Student Claim Tokens tab */}
        {activeTab === 'tokens' && (
          <section className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-[#DDE7EF] bg-[#EEF6FB] p-4">
              <Info size={18} className="mt-0.5 shrink-0 text-[#0B8ED0]" />
              <p className="text-[13px] font-medium text-[#0B1831]">Pay → Show token → officer marks Paid. Claim → Show token again → officer releases item → Completed.</p>
            </div>

            {loading ? (
              <div className="space-y-3">{[1, 2].map((i) => <div key={i} className="h-32 animate-pulse rounded-xl bg-slate-100" />)}</div>
            ) : orders.filter((o) => ['pending', 'paid'].includes(o.status)).length === 0 ? (
              <div className="rounded-xl border border-[#DDE7EF] bg-white p-12 text-center">
                <Ticket size={36} className="mx-auto mb-3 text-slate-200" />
                <p className="text-sm font-semibold text-slate-400">No active tokens. Reserve an item to get a claim token.</p>
                <button onClick={() => setActiveTab('order')} className="mt-4 rounded-lg bg-[#0B8ED0] px-5 py-2 text-sm font-bold text-white hover:bg-[#0878B7] transition">
                  Browse Merchandise
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {orders.filter((o) => ['pending', 'paid'].includes(o.status)).map((o) => (
                  <div key={o.id} className={`rounded-xl border bg-white p-5 shadow-sm ${o.status === 'paid' ? 'border-amber-200' : 'border-[#DDE7EF]'}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-xs font-bold text-slate-400">ORD-{o.id}</p>
                        <p className="mt-0.5 font-bold text-[#0F172A]">{o.merchandise?.name ?? '-'}</p>
                        <p className="text-[13px] text-slate-500">Qty: {o.quantity} · {fmt(o.total_price)}</p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-bold ${orderBadge[o.status] || 'bg-slate-100 text-slate-500'}`}>{capitalize(o.status)}</span>
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-4">
                      <StepTracker status={o.status} />
                      {o.claim_token && (
                        <div className="text-right">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Your Token</p>
                          <p className="font-mono text-xl font-black text-[#0B8ED0]">{o.claim_token}</p>
                        </div>
                      )}
                    </div>

                    {o.status === 'paid' && (
                      <div className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2">
                        <Info size={14} className="text-amber-600 shrink-0" />
                        <p className="text-[12px] font-semibold text-amber-700">Payment received! Show token <span className="font-black">{o.claim_token}</span> to the officer to claim your item.</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    );
  }

  // ── OFFICER VIEW ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Total Items', value: items.length, helper: 'In inventory', icon: Package },
          { label: 'Low Stock', value: lowStock, helper: 'Needs restocking', icon: AlertTriangle },
          { label: 'Active Orders', value: activeOrders, helper: 'Pending fulfillment', icon: ShoppingBag },
          { label: 'Revenue', value: fmt(totalRevenue), helper: 'From paid orders', icon: DollarSign },
        ].map((stat) => (
          <article key={stat.label} className="group rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm transition hover:border-[#0B8ED0]/20 hover:shadow-md">
            <div className="mb-3 grid h-10 w-10 place-items-center rounded-lg bg-rose-50 text-rose-600 transition group-hover:bg-rose-600 group-hover:text-white">
              <stat.icon size={19} />
            </div>
            <p className="text-sm font-semibold text-slate-500">{stat.label}</p>
            <p className="mt-1 text-2xl font-black text-[#0F172A]">{stat.value}</p>
            <p className="mt-1 text-xs font-medium text-slate-400">{stat.helper}</p>
          </article>
        ))}
      </section>

      <div className="flex flex-wrap gap-2">
        {[['inventory', 'Manage Inventory'], ['orders', 'Process Orders'], ['tokens', 'Issue Tokens']].map(([key, label]) => (
          <button key={key} onClick={() => setActiveTab(key)}
            className={`rounded-lg px-4 py-2.5 text-[13px] font-bold transition-all ${activeTab === key ? 'bg-[#0B8ED0] text-white shadow-lg shadow-[#0B8ED0]/20' : 'border border-[#DDE7EF] bg-white text-slate-600 hover:bg-[#EEF6FB]'}`}>
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 p-5 text-center">
          <p className="text-sm font-semibold text-red-700">{error}</p>
          <button onClick={load} className="mt-2 text-sm font-bold text-red-600 underline">Try again</button>
        </div>
      )}

      {activeTab === 'inventory' && (
        <section className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-[#DDE7EF] p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-[#0F172A]">Inventory</h2>
              <p className="text-sm font-medium text-slate-500">Manage merchandise stock and pricing</p>
            </div>
            <div className="flex w-full gap-2 sm:w-auto">
              <div className="flex h-10 flex-1 items-center gap-2 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-3 sm:flex-none">
                <Search size={15} className="text-slate-400" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} type="text" placeholder="Search items..." className="w-full bg-transparent text-[13px] outline-none placeholder:text-slate-400 sm:w-[140px]" />
              </div>
              <button onClick={() => setShowForm(true)} className="flex h-10 items-center gap-2 rounded-lg bg-[#0B8ED0] px-4 text-[13px] font-bold text-white hover:bg-[#0878B7] transition">
                <Plus size={16} /><span className="hidden sm:inline">Add Item</span>
              </button>
            </div>
          </div>
          {loading ? (
            <div className="space-y-2 p-5">{[1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />)}</div>
          ) : filteredItems.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-400">No inventory items yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left">
                <thead className="bg-[#F8FBFD] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Item</th>
                    <th className="px-5 py-3">Stock</th>
                    <th className="px-5 py-3">Unit Price</th>
                    <th className="px-5 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5EDF3] text-sm">
                  {filteredItems.map((item) => (
                    <tr key={item.id} className="transition hover:bg-[#F8FBFD]">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          {item.image_url
                            ? <img src={item.image_url} alt={item.name} className="h-9 w-9 shrink-0 rounded-lg border border-[#DDE7EF] object-cover" />
                            : <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#E6F6FD]"><Package size={16} className="text-[#0B8ED0]" /></div>}
                          <span className="font-bold text-[#0F172A]">{item.name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 font-black tabular-nums text-[#0F172A]">{item.stock_quantity}</td>
                      <td className="px-5 py-3.5 font-bold tabular-nums text-[#0F172A]">{fmt(item.price)}</td>
                      <td className="px-5 py-3.5">
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${stockBadge(item.stock_quantity)}`}>{stockLabel(item.stock_quantity)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {activeTab === 'orders' && (
        <section className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
          <div className="border-b border-[#DDE7EF] p-5">
            <h2 className="text-lg font-bold text-[#0F172A]">Orders</h2>
            <p className="text-sm font-medium text-slate-500">Process and track student merchandise orders</p>
          </div>
          {loading ? (
            <div className="space-y-2 p-5">{[1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />)}</div>
          ) : orders.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-400">No orders yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[400px] text-left md:min-w-[650px]">
                <thead className="bg-[#F8FBFD] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="hidden px-5 py-3 md:table-cell">Order</th>
                    <th className="px-5 py-3">Student</th>
                    <th className="px-5 py-3">Item</th>
                    <th className="hidden px-5 py-3 md:table-cell">Qty</th>
                    <th className="px-5 py-3">Total</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5EDF3] text-sm">
                  {orders.map((o) => (
                    <tr key={o.id} className="transition hover:bg-[#F8FBFD]">
                      <td className="hidden px-5 py-4 font-mono text-xs font-bold text-slate-500 md:table-cell">#{o.id}</td>
                      <td className="px-5 py-4 font-semibold text-[#0F172A]">{o.student ? `${o.student.first_name} ${o.student.last_name}` : '-'}</td>
                      <td className="px-5 py-4 font-medium text-slate-600">{o.merchandise?.name ?? '-'}</td>
                      <td className="hidden px-5 py-4 font-bold tabular-nums text-[#0F172A] md:table-cell">{o.quantity}</td>
                      <td className="px-5 py-4 font-bold tabular-nums text-[#0F172A]">{fmt(o.total_price)}</td>
                      <td className="px-5 py-4">
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${orderBadge[o.status] || 'bg-slate-100 text-slate-500'}`}>{capitalize(o.status)}</span>
                      </td>
                      <td className="px-5 py-4">
                        {o.status === 'pending' && (
                          <button onClick={() => handleStatusChange(o.id, 'paid')} className="flex items-center gap-1 rounded-md bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700 transition hover:bg-amber-100">
                            Mark Paid <ArrowRight size={12} />
                          </button>
                        )}
                        {o.status === 'paid' && (
                          <button onClick={() => handleStatusChange(o.id, 'claimed')} className="flex items-center gap-1 rounded-md bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100">
                            Mark Claimed <ArrowRight size={12} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {ordersMeta.total > ordersMeta.per_page && (
            <div className="flex items-center justify-between border-t border-[#DDE7EF] px-5 py-3">
              <p className="text-xs font-medium text-slate-400">Showing <span className="font-bold text-slate-600">{ordFrom}–{ordTo}</span> of <span className="font-bold text-slate-600">{ordersMeta.total}</span></p>
              <div className="flex items-center gap-1">
                <button onClick={() => loadOrders(ordersMeta.current_page - 1)} disabled={ordersMeta.current_page === 1} className="grid h-8 w-8 place-items-center rounded-lg border border-[#DDE7EF] text-slate-500 transition hover:bg-[#EEF6FB] disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft size={14} /></button>
                <span className="px-2 text-[13px] font-bold tabular-nums text-[#0F172A]">{ordersMeta.current_page} / {ordersMeta.last_page}</span>
                <button onClick={() => loadOrders(ordersMeta.current_page + 1)} disabled={ordersMeta.current_page === ordersMeta.last_page} className="grid h-8 w-8 place-items-center rounded-lg border border-[#DDE7EF] text-slate-500 transition hover:bg-[#EEF6FB] disabled:cursor-not-allowed disabled:opacity-40"><ChevronRight size={14} /></button>
              </div>
            </div>
          )}
        </section>
      )}

      {activeTab === 'tokens' && (
        <section className="space-y-4">
          <div className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
            <h2 className="mb-1 text-lg font-bold text-[#0F172A]">Claim by Token</h2>
            <p className="mb-4 text-sm font-medium text-slate-500">Enter the claim token from a paid order to mark it as claimed</p>
            <form onSubmit={handleClaim} className="flex gap-3">
              <input value={claimToken} onChange={(e) => setClaimToken(e.target.value.toUpperCase())} placeholder="e.g. A1B2C3D4" className="h-11 flex-1 rounded-lg border border-[#DDE7EF] px-3 font-mono text-sm uppercase outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
              <button type="submit" disabled={claiming || !claimToken.trim()} className="flex h-11 items-center gap-2 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white transition hover:bg-[#0878B7] disabled:opacity-50">
                <Ticket size={16} />{claiming ? 'Processing...' : 'Claim'}
              </button>
            </form>
            {claimError && <p className="mt-2 text-xs text-red-600">{claimError}</p>}
            {claimSuccess && <p className="mt-2 text-xs font-semibold text-emerald-600">{claimSuccess}</p>}
          </div>

          <div className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
            <div className="border-b border-[#DDE7EF] p-5">
              <h2 className="text-lg font-bold text-[#0F172A]">Paid Orders Awaiting Pickup</h2>
              <p className="text-sm font-medium text-slate-500">Orders with active claim tokens</p>
            </div>
            {loading ? (
              <div className="space-y-2 p-5">{[1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />)}</div>
            ) : paidOrders.length === 0 ? (
              <p className="p-8 text-center text-sm text-slate-400">No paid orders awaiting pickup.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-left md:min-w-[550px]">
                  <thead className="bg-[#F8FBFD] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-5 py-3">Claim Token</th>
                      <th className="px-5 py-3">Student</th>
                      <th className="px-5 py-3">Item</th>
                      <th className="hidden px-5 py-3 md:table-cell">Qty</th>
                      <th className="px-5 py-3">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5EDF3] text-sm">
                    {paidOrders.map((o) => (
                      <tr key={o.id} className="transition hover:bg-[#F8FBFD]">
                        <td className="px-5 py-4 font-mono text-xs font-black text-[#0B8ED0]">{o.claim_token}</td>
                        <td className="px-5 py-4 font-semibold text-[#0F172A]">{o.student ? `${o.student.first_name} ${o.student.last_name}` : '-'}</td>
                        <td className="px-5 py-4 font-medium text-slate-600">{o.merchandise?.name ?? '-'}</td>
                        <td className="hidden px-5 py-4 font-bold tabular-nums text-[#0F172A] md:table-cell">{o.quantity}</td>
                        <td className="px-5 py-4 font-bold tabular-nums text-[#0F172A]">{fmt(o.total_price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#0F172A]">Add Merchandise Item</h2>
              <button onClick={() => { setShowForm(false); setImageFile(null); setImagePreview(null); }} className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-[#EEF6FB]"><X size={18} /></button>
            </div>
            <form className="space-y-4" onSubmit={handleAddItem}>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Item Name *</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. HIUSA T-Shirt (XL)" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Unit Price (₱) *</label>
                  <input type="number" min="0" step="0.01" value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: e.target.value })} placeholder="0.00" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Initial Stock *</label>
                  <input type="number" min="0" value={form.stock_quantity} onChange={(e) => setForm({ ...form, stock_quantity: e.target.value })} placeholder="0" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Description</label>
                <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional description..." className="w-full resize-none rounded-lg border border-[#DDE7EF] px-3 py-2.5 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Product Image</label>
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-[#DDE7EF] bg-[#F8FBFD] py-4 transition hover:border-[#0B8ED0]/50 hover:bg-[#EEF6FB]">
                  {imagePreview ? <img src={imagePreview} alt="Preview" className="h-24 w-24 rounded-lg object-cover" /> : (<><ImagePlus size={24} className="mb-1 text-slate-300" /><span className="text-[13px] font-semibold text-slate-400">Click to upload</span><span className="text-[11px] text-slate-300">JPG, PNG, WebP (max 2MB)</span></>)}
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleImageSelect} className="sr-only" />
                </label>
              </div>
              {formError && <p className="text-xs text-red-600">{formError}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => { setShowForm(false); setImageFile(null); setImagePreview(null); }} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD]">Cancel</button>
                <button type="submit" disabled={formSubmitting || !form.name || !form.unit_price || !form.stock_quantity} className="h-11 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white transition hover:bg-[#0878B7] disabled:opacity-50">{formSubmitting ? 'Adding...' : 'Add Item'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
