import { useEffect, useMemo, useState } from 'react';
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
  Minus,
  Package,
  Plus,
  Search,
  ShoppingBag,
  Ticket,
  Trash2,
  X,
} from 'lucide-react';
import { getMerchandise, createItem, updateItem, adjustStock } from '../../../services/merchandiseService';
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
function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number.parseFloat(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}
function fmt(n) { return `₱${toNumber(n).toLocaleString('en-PH')}`; }
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

function ConfirmModal({ open, title, message, confirmText = 'Confirm', busy = false, onCancel, onConfirm }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#0B1831]/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-[#DDE7EF] bg-white p-6 shadow-2xl">
        <h3 className="text-lg font-extrabold text-[#0F172A]">{title}</h3>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={onCancel} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD]" disabled={busy}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className="h-11 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white transition hover:bg-[#0878B7] disabled:opacity-50" disabled={busy}>
            {busy ? 'Processing...' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MerchandisePage({ initialTab }) {
  const role = getRole();
  const isStudent = role === 'student';
  const defaultTab = isStudent ? 'order' : 'inventory';
  const [activeTab, setActiveTab] = useState(initialTab || defaultTab);

  const [items, setItems] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [inventorySearch, setInventorySearch] = useState('');
  const [officerOrderSearch, setOfficerOrderSearch] = useState('');
  const [studentItemSearch, setStudentItemSearch] = useState('');
  const [studentOrderSearch, setStudentOrderSearch] = useState('');
  const [ordersMeta, setOrdersMeta] = useState({ current_page: 1, last_page: 1, total: 0, per_page: 20 });

  // Officer-only state
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', category: '', unit_price: '', stock_quantity: '', description: '', is_active: true });
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [formError, setFormError] = useState(null);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [claimToken, setClaimToken] = useState('');
  const [claimError, setClaimError] = useState(null);
  const [claimSuccess, setClaimSuccess] = useState(null);
  const [claiming, setClaiming] = useState(false);
  const [stockDraft, setStockDraft] = useState({});
  const [confirmModal, setConfirmModal] = useState({ open: false, title: '', message: '', confirmText: 'Confirm', action: null, busy: false });

  // Student-only state
  const [cart, setCart] = useState([]);
  const [draftQty, setDraftQty] = useState({});
  const [cartError, setCartError] = useState(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutSubmitting, setCheckoutSubmitting] = useState(false);

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
        const merch = Array.isArray(mRes.data?.data) ? mRes.data.data : (Array.isArray(mRes.data) ? mRes.data : []);
        setItems(merch);
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

  function openConfirm({ title, message, confirmText, action }) {
    setConfirmModal({ open: true, title, message, confirmText, action, busy: false });
  }

  function closeConfirm() {
    setConfirmModal({ open: false, title: '', message: '', confirmText: 'Confirm', action: null, busy: false });
  }

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
      await createItem({ name: form.name, category: form.category || null, price: parseFloat(form.unit_price), stock_quantity: parseInt(form.stock_quantity, 10), description: form.description, is_active: form.is_active, imageFile });
      setShowForm(false);
      setForm({ name: '', category: '', unit_price: '', stock_quantity: '', description: '', is_active: true });
      setImageFile(null); setImagePreview(null);
      load();
    } catch (err) { setFormError(err.response?.data?.message ?? 'Failed to add item.'); }
    finally { setFormSubmitting(false); }
  }

  async function handleStatusChange(id, status) {
    try {
      const res = await updateOrderStatus(id, status);
      setOrders((prev) => prev.map((o) => (o.id === id ? res.data : o)));
    } catch {
      setError('Failed to update order status.');
    }
  }

  async function handleClaimByToken(token) {
    setClaiming(true); setClaimError(null); setClaimSuccess(null);
    try {
      const res = await claimByToken(token.trim().toUpperCase());
      setClaimSuccess(`Order claimed for ${res.data?.student?.first_name ?? 'student'}.`);
      setClaimToken('');
      load();
    } catch (err) { setClaimError(err.response?.data?.message ?? 'Invalid or already used token.'); }
    finally { setClaiming(false); }
  }

  function confirmStatusChange(order, nextStatus) {
    openConfirm({
      title: 'Confirm Status Update',
      message: `Set order ORD-${order.id} to ${capitalize(nextStatus)}?`,
      confirmText: `Mark ${capitalize(nextStatus)}`,
      action: async () => handleStatusChange(order.id, nextStatus),
    });
  }

  function confirmSellingToggle(item) {
    const nextActive = !item.is_active;
    openConfirm({
      title: nextActive ? 'Set Item Active' : 'Set Item Inactive',
      message: nextActive
        ? `Mark ${item.name} as active for selling?`
        : `Mark ${item.name} as inactive? Students will not be able to order this item.`,
      confirmText: nextActive ? 'Set Active' : 'Set Inactive',
      action: async () => {
        const res = await updateItem(item.id, { is_active: nextActive });
        const updated = res.data;
        setItems((prev) => prev.map((row) => (row.id === item.id ? { ...row, ...updated } : row)));
      },
    });
  }

  function confirmStockUpdate(item) {
    const raw = stockDraft[item.id];
    const nextStock = Number.parseInt(String(raw ?? item.stock_quantity), 10);

    if (!Number.isInteger(nextStock) || nextStock < 0) {
      setError('Stock quantity must be a non-negative whole number.');
      return;
    }

    openConfirm({
      title: 'Update Stock Quantity',
      message: `Set ${item.name} stock from ${item.stock_quantity} to ${nextStock}?`,
      confirmText: 'Update Stock',
      action: async () => {
        const res = await adjustStock(item.id, nextStock);
        const updated = res.data;
        setItems((prev) => prev.map((row) => (row.id === item.id ? { ...row, ...updated } : row)));
      },
    });
  }

  function handleClaim(e) {
    e.preventDefault();
    const token = claimToken.trim().toUpperCase();
    if (!token) return;

    const match = orders.find((order) => (order.claim_token || '').toUpperCase() === token);
    const studentName = match?.student ? `${match.student.first_name} ${match.student.last_name}` : null;
    const itemName = match?.merchandise?.name || null;
    const quantity = match?.quantity || null;
    const details = match
      ? `\n\nStudent: ${studentName || '-'}\nItem: ${itemName || '-'}\nQuantity: ${quantity || '-'}\nStatus: ${capitalize(match.status)}`
      : '';

    openConfirm({
      title: 'Confirm Token Claim',
      message: `Use token ${token} to release an item? This finalizes the claim.${details}`,
      confirmText: 'Confirm Claim',
      action: async () => handleClaimByToken(token),
    });
  }

  function addToCart(item) {
    const requested = Math.max(1, Math.min(item.stock_quantity, Number(draftQty[item.id] || 1)));
    setCartError(null);

    setCart((prev) => {
      const existing = prev.find((row) => row.item.id === item.id);
      if (!existing) {
        return [...prev, { item, quantity: requested }];
      }

      const nextQty = Math.min(item.stock_quantity, existing.quantity + requested);
      if (nextQty === existing.quantity) {
        setCartError(`Cannot add more than available stock for ${item.name}.`);
        return prev;
      }

      return prev.map((row) => (row.item.id === item.id ? { ...row, quantity: nextQty } : row));
    });

    setDraftQty((prev) => ({ ...prev, [item.id]: 1 }));
  }

  function changeCartQty(itemId, nextQty) {
    setCart((prev) => prev.map((row) => {
      if (row.item.id !== itemId) return row;
      const safeQty = Math.max(1, Math.min(row.item.stock_quantity, nextQty));
      return { ...row, quantity: safeQty };
    }));
  }

  function removeFromCart(itemId) {
    setCart((prev) => prev.filter((row) => row.item.id !== itemId));
  }

  async function submitCartOrders() {
    setCheckoutSubmitting(true);
    setCartError(null);

    const submittedIds = [];
    try {
      for (const row of cart) {
        await placeOrder({ merchandise_id: row.item.id, quantity: row.quantity });
        submittedIds.push(row.item.id);
      }

      setCart([]);
      setCheckoutOpen(false);
      await load();
      setActiveTab('my-orders');
    } catch (err) {
      const msg = err.response?.data?.message ?? 'Failed to submit cart. Please try again.';
      setCartError(submittedIds.length > 0 ? `Some items were submitted before an error occurred. ${msg}` : msg);
      setCart((prev) => prev.filter((row) => !submittedIds.includes(row.item.id)));
      await load();
    } finally {
      setCheckoutSubmitting(false);
    }
  }

  // Derived data
  const totalRevenue = orders
    .filter((o) => ['paid', 'claimed'].includes(o.status))
    .reduce((sum, o) => sum + toNumber(o.total_price), 0);
  const activeOrders = orders.filter((o) => ['pending', 'paid'].includes(o.status)).length;
  const lowStock = items.filter((i) => i.stock_quantity > 0 && i.stock_quantity < 10).length;
  const paidOrders = orders.filter((o) => o.status === 'paid');
  const availableItems = items.filter((i) => i.stock_quantity > 0);
  const cartTotal = useMemo(() => cart.reduce((sum, row) => sum + (toNumber(row.item.price) * row.quantity), 0), [cart]);

  const filteredInventoryItems = items.filter((i) => i.name?.toLowerCase().includes(inventorySearch.toLowerCase()));

  const filteredStudentItems = items.filter((i) =>
    i.stock_quantity > 0 && i.name?.toLowerCase().includes(studentItemSearch.toLowerCase())
  );

  const filteredStudentOrders = orders.filter((o) => {
    const q = studentOrderSearch.toLowerCase();
    return (
      (o.merchandise?.name ?? '').toLowerCase().includes(q)
      || `ord-${o.id}`.toLowerCase().includes(q)
      || (o.claim_token ?? '').toLowerCase().includes(q)
    );
  });

  const filteredOfficerOrders = orders.filter((o) => {
    const q = officerOrderSearch.toLowerCase().trim();
    if (!q) return true;
    const studentName = `${o.student?.first_name ?? ''} ${o.student?.last_name ?? ''}`.toLowerCase();
    return (
      `ord-${o.id}`.toLowerCase().includes(q)
      || (o.claim_token ?? '').toLowerCase().includes(q)
      || (o.merchandise?.name ?? '').toLowerCase().includes(q)
      || studentName.includes(q)
      || (o.status ?? '').toLowerCase().includes(q)
    );
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

        <div className="flex items-center justify-between rounded-xl border border-[#DDE7EF] bg-white px-4 py-3">
          <p className="text-[13px] font-semibold text-slate-500">Use the sidebar to navigate pages. Cart is available from Order Merchandise.</p>
          <button type="button" onClick={() => setActiveTab('cart')} className="rounded-lg bg-[#0B8ED0] px-4 py-2 text-xs font-bold text-white hover:bg-[#0878B7]">
            View Cart ({cart.length})
          </button>
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

            {cartError && (
              <div className="rounded-xl border border-red-100 bg-red-50 p-4">
                <p className="text-sm font-semibold text-red-700">{cartError}</p>
              </div>
            )}

            <div className="flex h-10 w-full max-w-sm items-center gap-2 rounded-lg border border-[#DDE7EF] bg-white px-3">
              <Search size={15} className="text-slate-400" />
              <input value={studentItemSearch} onChange={(e) => setStudentItemSearch(e.target.value)} type="text" placeholder="Search merchandise..." className="w-full bg-transparent text-[13px] outline-none placeholder:text-slate-400" />
            </div>

            {loading ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[1, 2, 3].map((i) => <div key={i} className="h-56 animate-pulse rounded-xl bg-slate-100" />)}
              </div>
            ) : filteredStudentItems.length === 0 ? (
              <div className="rounded-xl border border-[#DDE7EF] bg-white p-12 text-center">
                <Package size={36} className="mx-auto mb-3 text-slate-200" />
                <p className="text-sm font-semibold text-slate-400">No items available right now.</p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredStudentItems.map((item) => (
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
                      <div className="mt-3 flex items-center gap-2">
                        <button type="button" onClick={() => setDraftQty((prev) => ({ ...prev, [item.id]: Math.max(1, Number(prev[item.id] || 1) - 1) }))} className="grid h-10 w-10 place-items-center rounded-lg border border-[#DDE7EF] text-slate-600 hover:bg-[#EEF6FB]" aria-label={`Decrease quantity for ${item.name}`}>
                          <Minus size={14} />
                        </button>
                        <input
                          type="number"
                          min="1"
                          max={item.stock_quantity}
                          value={draftQty[item.id] || 1}
                          onChange={(e) => {
                            const typed = Number(e.target.value || 1);
                            const safe = Math.max(1, Math.min(item.stock_quantity, typed));
                            setDraftQty((prev) => ({ ...prev, [item.id]: safe }));
                          }}
                          className="h-10 w-16 rounded-lg border border-[#DDE7EF] text-center text-sm font-bold outline-none focus:border-[#0B8ED0]"
                        />
                        <button type="button" onClick={() => setDraftQty((prev) => ({ ...prev, [item.id]: Math.min(item.stock_quantity, Number(prev[item.id] || 1) + 1) }))} className="grid h-10 w-10 place-items-center rounded-lg border border-[#DDE7EF] text-slate-600 hover:bg-[#EEF6FB]" aria-label={`Increase quantity for ${item.name}`}>
                          <Plus size={14} />
                        </button>
                      </div>
                      <button type="button" onClick={() => addToCart(item)} className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#0B8ED0] text-[13px] font-bold text-white transition hover:bg-[#0878B7]">
                        <ShoppingBag size={14} />
                        Add To Cart
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {activeTab === 'cart' && (
          <section className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
            <div className="border-b border-[#DDE7EF] p-5">
              <h2 className="text-lg font-bold text-[#0F172A]">Order Cart</h2>
              <p className="text-sm font-medium text-slate-500">Review your items before finalizing your reservation list.</p>
            </div>
            {cart.length === 0 ? (
              <div className="p-8 text-center">
                <ShoppingBag size={36} className="mx-auto mb-2 text-slate-200" />
                <p className="text-sm font-semibold text-slate-400">Your cart is empty.</p>
                <button type="button" onClick={() => setActiveTab('order')} className="mt-4 rounded-lg bg-[#0B8ED0] px-5 py-2 text-sm font-bold text-white hover:bg-[#0878B7] transition">
                  Browse Merchandise
                </button>
              </div>
            ) : (
              <div className="space-y-4 p-5">
                {cart.map((row) => (
                  <div key={row.item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#DDE7EF] p-4">
                    <div>
                      <p className="font-bold text-[#0F172A]">{row.item.name}</p>
                      <p className="text-xs text-slate-500">{fmt(row.item.price)} each</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => changeCartQty(row.item.id, row.quantity - 1)} className="grid h-9 w-9 place-items-center rounded-lg border border-[#DDE7EF] text-slate-600 hover:bg-[#EEF6FB]" aria-label={`Decrease quantity for ${row.item.name}`}>
                        <Minus size={13} />
                      </button>
                      <span className="w-8 text-center text-sm font-black text-[#0F172A]">{row.quantity}</span>
                      <button type="button" onClick={() => changeCartQty(row.item.id, row.quantity + 1)} className="grid h-9 w-9 place-items-center rounded-lg border border-[#DDE7EF] text-slate-600 hover:bg-[#EEF6FB]" aria-label={`Increase quantity for ${row.item.name}`}>
                        <Plus size={13} />
                      </button>
                      <button type="button" onClick={() => removeFromCart(row.item.id)} className="ml-1 grid h-9 w-9 place-items-center rounded-lg border border-red-100 text-red-600 hover:bg-red-50" aria-label={`Remove ${row.item.name} from cart`}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <p className="text-sm font-black text-[#0F172A]">{fmt(toNumber(row.item.price) * row.quantity)}</p>
                  </div>
                ))}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#DDE7EF] pt-4">
                  <p className="text-sm font-bold text-slate-600">Total: <span className="text-[#0F172A]">{fmt(cartTotal)}</span></p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setCart([])} className="h-10 rounded-lg border border-[#DDE7EF] px-4 text-xs font-bold text-slate-600 hover:bg-[#F8FBFD]">
                      Clear Cart
                    </button>
                    <button type="button" onClick={() => setCheckoutOpen(true)} className="h-10 rounded-lg bg-[#0B8ED0] px-4 text-xs font-bold text-white hover:bg-[#0878B7]">
                      Finalize Order List
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {/* My Orders tab */}
        {activeTab === 'my-orders' && (
          <section className="space-y-4">
            <div className="flex h-10 w-full max-w-sm items-center gap-2 rounded-lg border border-[#DDE7EF] bg-white px-3">
              <Search size={15} className="text-slate-400" />
              <input value={studentOrderSearch} onChange={(e) => setStudentOrderSearch(e.target.value)} type="text" placeholder="Search orders or token..." className="w-full bg-transparent text-[13px] outline-none placeholder:text-slate-400" />
            </div>

            {loading ? (
              <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-100" />)}</div>
            ) : filteredStudentOrders.length === 0 ? (
              <div className="rounded-xl border border-[#DDE7EF] bg-white p-12 text-center">
                <ShoppingBag size={36} className="mx-auto mb-3 text-slate-200" />
                <p className="text-sm font-semibold text-slate-400">No orders yet. Browse merchandise to place your first order.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredStudentOrders.map((o) => (
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
                <p className="text-sm font-semibold text-slate-400">No active tokens. Finalize an order list to receive claim tokens.</p>
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

        {checkoutOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#0B1831]/50 p-4 backdrop-blur-sm">
            <div className="w-full max-w-xl rounded-xl border border-[#DDE7EF] bg-white p-6 shadow-2xl">
              <h2 className="text-lg font-bold text-[#0F172A]">Confirm Order List</h2>
              <p className="mt-1 text-sm text-slate-500">Please review all items before finalizing.</p>
              <div className="mt-4 max-h-72 space-y-2 overflow-y-auto rounded-lg border border-[#DDE7EF] p-3">
                {cart.map((row) => (
                  <div key={row.item.id} className="flex items-center justify-between gap-3 border-b border-[#EEF2F7] pb-2 last:border-b-0 last:pb-0">
                    <div>
                      <p className="text-sm font-bold text-[#0F172A]">{row.item.name}</p>
                      <p className="text-xs text-slate-500">Qty: {row.quantity} x {fmt(row.item.price)}</p>
                    </div>
                    <p className="text-sm font-black text-[#0F172A]">{fmt(toNumber(row.item.price) * row.quantity)}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-sm font-bold text-[#0F172A]">Grand Total: {fmt(cartTotal)}</p>
              <div className="mt-5 flex justify-end gap-3">
                <button type="button" onClick={() => setCheckoutOpen(false)} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD]" disabled={checkoutSubmitting}>
                  Cancel
                </button>
                <button type="button" onClick={submitCartOrders} className="h-11 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white transition hover:bg-[#0878B7] disabled:opacity-50" disabled={checkoutSubmitting}>
                  {checkoutSubmitting ? 'Submitting...' : 'Confirm & Submit'}
                </button>
              </div>
            </div>
          </div>
        )}

        <ConfirmModal
          open={confirmModal.open}
          title={confirmModal.title}
          message={confirmModal.message}
          confirmText={confirmModal.confirmText}
          busy={confirmModal.busy}
          onCancel={closeConfirm}
          onConfirm={async () => {
            if (!confirmModal.action) return;
            setConfirmModal((prev) => ({ ...prev, busy: true }));
            try {
              await confirmModal.action();
              closeConfirm();
            } finally {
              setConfirmModal((prev) => ({ ...prev, busy: false }));
            }
          }}
        />
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

      <div className="rounded-xl border border-[#DDE7EF] bg-white px-4 py-3">
        <p className="text-[13px] font-semibold text-slate-500">Use the sidebar to switch between merchandise pages.</p>
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
                <input value={inventorySearch} onChange={(e) => setInventorySearch(e.target.value)} type="text" placeholder="Search items..." className="w-full bg-transparent text-[13px] outline-none placeholder:text-slate-400 sm:w-[140px]" />
              </div>
              <button onClick={() => setShowForm(true)} className="flex h-10 items-center gap-2 rounded-lg bg-[#0B8ED0] px-4 text-[13px] font-bold text-white hover:bg-[#0878B7] transition">
                <Plus size={16} /><span className="hidden sm:inline">Add Item</span>
              </button>
            </div>
          </div>
          {loading ? (
            <div className="space-y-2 p-5">{[1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />)}</div>
          ) : filteredInventoryItems.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-400">No inventory items yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left">
                <thead className="bg-[#F8FBFD] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Item</th>
                    <th className="px-5 py-3">Stock</th>
                    <th className="px-5 py-3">Adjust Stock</th>
                    <th className="px-5 py-3">Unit Price</th>
                    <th className="px-5 py-3">Stock Status</th>
                    <th className="px-5 py-3">Selling</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5EDF3] text-sm">
                  {filteredInventoryItems.map((item) => (
                    <tr key={item.id} className="transition hover:bg-[#F8FBFD]">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          {item.image_url
                            ? <img src={item.image_url} alt={item.name} className="h-9 w-9 shrink-0 rounded-lg border border-[#DDE7EF] object-cover" />
                            : <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#E6F6FD]"><Package size={16} className="text-[#0B8ED0]" /></div>}
                          <span className="font-bold text-[#0F172A]">{item.name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min="0"
                            value={stockDraft[item.id] ?? item.stock_quantity}
                            onChange={(event) => setStockDraft((prev) => ({ ...prev, [item.id]: event.target.value }))}
                            className="h-9 w-24 rounded-lg border border-[#DDE7EF] px-2 text-sm font-semibold text-[#0F172A] outline-none focus:border-[#0B8ED0]"
                          />
                          <button
                            type="button"
                            onClick={() => confirmStockUpdate(item)}
                            className="h-9 rounded-md border border-[#DDE7EF] px-3 text-xs font-bold text-[#0F172A] transition hover:bg-[#F8FBFD]"
                          >
                            Save
                          </button>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 font-bold tabular-nums text-[#0F172A]">{fmt(item.price)}</td>
                      <td className="px-5 py-3.5">
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${stockBadge(item.stock_quantity)}`}>{stockLabel(item.stock_quantity)}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <button
                          type="button"
                          onClick={() => confirmSellingToggle(item)}
                          className={`rounded-full px-3 py-1 text-xs font-bold transition ${item.is_active ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                        >
                          {item.is_active ? 'Active' : 'Inactive'}
                        </button>
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
          <div className="flex flex-col gap-3 border-b border-[#DDE7EF] p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-[#0F172A]">Orders</h2>
              <p className="text-sm font-medium text-slate-500">Process and track student merchandise orders</p>
            </div>
            <div className="flex h-10 w-full max-w-sm items-center gap-2 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-3">
              <Search size={15} className="text-slate-400" />
              <input value={officerOrderSearch} onChange={(e) => setOfficerOrderSearch(e.target.value)} type="text" placeholder="Search order or token..." className="w-full bg-transparent text-[13px] outline-none placeholder:text-slate-400" />
            </div>
          </div>
          {loading ? (
            <div className="space-y-2 p-5">{[1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />)}</div>
          ) : filteredOfficerOrders.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-400">No orders yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[540px] text-left md:min-w-[850px]">
                <thead className="bg-[#F8FBFD] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="hidden px-5 py-3 md:table-cell">Order</th>
                    <th className="px-5 py-3">Token</th>
                    <th className="px-5 py-3">Student</th>
                    <th className="px-5 py-3">Item</th>
                    <th className="hidden px-5 py-3 md:table-cell">Qty</th>
                    <th className="px-5 py-3">Total</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5EDF3] text-sm">
                  {filteredOfficerOrders.map((o) => (
                    <tr key={o.id} className="transition hover:bg-[#F8FBFD]">
                      <td className="hidden px-5 py-4 font-mono text-xs font-bold text-slate-500 md:table-cell">#{o.id}</td>
                      <td className="px-5 py-4 font-mono text-xs font-black text-[#0B8ED0]">{o.claim_token || '-'}</td>
                      <td className="px-5 py-4 font-semibold text-[#0F172A]">{o.student ? `${o.student.first_name} ${o.student.last_name}` : '-'}</td>
                      <td className="px-5 py-4 font-medium text-slate-600">{o.merchandise?.name ?? '-'}</td>
                      <td className="hidden px-5 py-4 font-bold tabular-nums text-[#0F172A] md:table-cell">{o.quantity}</td>
                      <td className="px-5 py-4 font-bold tabular-nums text-[#0F172A]">{fmt(o.total_price)}</td>
                      <td className="px-5 py-4">
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${orderBadge[o.status] || 'bg-slate-100 text-slate-500'}`}>{capitalize(o.status)}</span>
                      </td>
                      <td className="px-5 py-4">
                        {o.status === 'pending' && (
                          <button onClick={() => confirmStatusChange(o, 'paid')} className="flex items-center gap-1 rounded-md bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700 transition hover:bg-amber-100">
                            Mark Paid <ArrowRight size={12} />
                          </button>
                        )}
                        {o.status === 'paid' && (
                          <button onClick={() => confirmStatusChange(o, 'claimed')} className="flex items-center gap-1 rounded-md bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100">
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
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Category</label>
                <input type="text" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Apparel, Accessories" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
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
                <label className="text-[13px] font-semibold text-[#0F172A]">Selling Status</label>
                <select value={form.is_active ? '1' : '0'} onChange={(e) => setForm({ ...form, is_active: e.target.value === '1' })} className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15">
                  <option value="1">Active</option>
                  <option value="0">Inactive</option>
                </select>
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

      <ConfirmModal
        open={confirmModal.open}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmText={confirmModal.confirmText}
        busy={confirmModal.busy}
        onCancel={closeConfirm}
        onConfirm={async () => {
          if (!confirmModal.action) return;
          setConfirmModal((prev) => ({ ...prev, busy: true }));
          try {
            await confirmModal.action();
            closeConfirm();
          } finally {
            setConfirmModal((prev) => ({ ...prev, busy: false }));
          }
        }}
      />
    </div>
  );
}
