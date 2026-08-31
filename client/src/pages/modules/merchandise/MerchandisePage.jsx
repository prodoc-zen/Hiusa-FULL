import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Circle,
  DollarSign,
  Download,
  Eye,
  ImagePlus,
  Info,
  Minus,
  Package,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  ShoppingBag,
  Ticket,
  Trash2,
  X,
} from 'lucide-react';
import { getGcashSettings, getMerchandise, createItem, updateItem, adjustStock, deleteItem } from '../../../services/merchandiseService';
import { exportOrders, getOrderAnalyticsUsers, getOrders, placeOrder, submitOrderPayment, updateOrderStatus, claimByToken } from '../../../services/orderService';
import { resolveAssetUrl } from '../../../utils/assetUrl';

const STUDENT_CART_KEY = 'hiusa_student_cart';
const EMPTY_ORDER_FILTERS = { search: '', department: '', program: '', major: '', year_level: '', section: '', role: '', position_title: '', status: '', payment_status: '', payment_method: '', merchandise_id: '', ordered_from: '', ordered_to: '', paid_from: '', paid_to: '', claimed_from: '', claimed_to: '', sort: 'newest', per_page: 20 };

function readStudentCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STUDENT_CART_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getRole() {
  try { return JSON.parse(localStorage.getItem('user'))?.role || null; } catch { return null; }
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
function fmt(n) { return `₱${toNumber(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
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

function AddStockModal({ open, itemName, quantity, busy = false, onQuantityChange, onCancel, onConfirm }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-[#0B1831]/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-[#DDE7EF] bg-white p-6 shadow-2xl">
        <h3 className="text-lg font-extrabold text-[#0F172A]">Add Stock</h3>
        <p className="mt-2 text-sm text-slate-600">Enter how many units you want to add for <span className="font-bold text-[#0F172A]">{itemName}</span>.</p>
        <div className="mt-4 space-y-1.5">
          <label className="text-[13px] font-semibold text-[#0F172A]">Quantity to Add</label>
          <input
            type="number"
            min="1"
            value={quantity}
            onChange={(event) => onQuantityChange(event.target.value)}
            className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
          />
        </div>
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={onCancel} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD]" disabled={busy}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className="h-11 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white transition hover:bg-[#0878B7] disabled:opacity-50" disabled={busy}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MerchandisePage({ initialTab }) {
  const location = useLocation();
  const role = getRole();
  const isFulfillmentRole = role === 'ADMIN' || role === 'SBO_OFFICER';
  const defaultTab = role === 'ADMIN' ? 'inventory' : role === 'SBO_OFFICER' ? 'orders' : 'order';
  const [activeTab, setActiveTab] = useState(initialTab || defaultTab);
  const isPersonalShoppingView = ['order', 'cart', 'my-orders'].includes(activeTab) || (activeTab === 'tokens' && !isFulfillmentRole);

  const [items, setItems] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [inventorySearch, setInventorySearch] = useState('');
  const [orderFilters, setOrderFilters] = useState(EMPTY_ORDER_FILTERS);
  const [orderSummary, setOrderSummary] = useState(null);
  const [orderFilterOptions, setOrderFilterOptions] = useState({ departments: [], programs: [], majors: [], roles: [], positions: [], merchandise: [], statuses: [], payment_statuses: [], payment_methods: [] });
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [analyticsModal, setAnalyticsModal] = useState({ open: false, title: '', loading: false, users: [], error: '' });
  const [orderDetails, setOrderDetails] = useState(null);
  const [exportingOrders, setExportingOrders] = useState(false);
  const [studentItemSearch, setStudentItemSearch] = useState('');
  const [studentOrderSearch, setStudentOrderSearch] = useState('');
  const [ordersMeta, setOrdersMeta] = useState({ current_page: 1, last_page: 1, total: 0, per_page: 20 });

  // Officer-only state
  const [showForm, setShowForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [editingItemId, setEditingItemId] = useState(null);
  const [form, setForm] = useState({ name: '', category: '', unit_price: '', stock_quantity: '', description: '', is_active: true });
  const [editForm, setEditForm] = useState({ name: '', category: '', unit_price: '', stock_quantity: '', description: '', is_active: true });
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [editImageFile, setEditImageFile] = useState(null);
  const [editImagePreview, setEditImagePreview] = useState(null);
  const [formError, setFormError] = useState(null);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [claimToken, setClaimToken] = useState('');
  const [claimError, setClaimError] = useState(null);
  const [claimSuccess, setClaimSuccess] = useState(null);
  const [claiming, setClaiming] = useState(false);
  const [transactionMessage, setTransactionMessage] = useState('');
  const [feedback, setFeedback] = useState({ open: false, type: 'success', message: '' });
  const [stockModal, setStockModal] = useState({ open: false, item: null, quantity: '1' });
  const [confirmModal, setConfirmModal] = useState({ open: false, title: '', message: '', confirmText: 'Confirm', action: null, busy: false });

  // Student-only state
  const [cart, setCart] = useState(() => readStudentCart());
  const [draftQty, setDraftQty] = useState({});
  const [cartError, setCartError] = useState(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutSubmitting, setCheckoutSubmitting] = useState(false);
  const [checkoutPayment, setCheckoutPayment] = useState({ method: 'cash', reference: '', proof_file: null });
  const [gcashSettings, setGcashSettings] = useState(null);
  const [paymentModal, setPaymentModal] = useState({ open: false, order: null, reference: '', proof_file: null, busy: false, error: '' });
  const [verificationModal, setVerificationModal] = useState({ open: false, order: null, amount: '', busy: false, error: '' });
  const [rejectionModal, setRejectionModal] = useState({ open: false, order: null, remarks: '', busy: false });
  const [studentTokenSearch, setStudentTokenSearch] = useState('');

  function extractOrders(oRes) {
    const arr = Array.isArray(oRes.data?.data) ? oRes.data.data : (Array.isArray(oRes.data) ? oRes.data : []);
    setOrders(arr);
    if (oRes.data?.current_page !== undefined) {
      setOrdersMeta({ current_page: oRes.data.current_page, last_page: oRes.data.last_page, total: oRes.data.total, per_page: oRes.data.per_page });
    }
    if (oRes.data?.summary) setOrderSummary(oRes.data.summary);
    if (oRes.data?.filter_options) setOrderFilterOptions(oRes.data.filter_options);
  }

  function load() {
    setLoading(true);
    setError(null);
    const calls = isPersonalShoppingView
      ? [getMerchandise(), getOrders({ mine: 1 }), getGcashSettings()]
      : [getMerchandise(), getOrders({ page: 1, ...EMPTY_ORDER_FILTERS })];
    Promise.all(calls)
      .then(([mRes, oRes, gcashRes]) => {
        const merch = Array.isArray(mRes.data?.data) ? mRes.data.data : (Array.isArray(mRes.data) ? mRes.data : []);
        setItems(merch);
        extractOrders(oRes);
        if (gcashRes) setGcashSettings(gcashRes.data ?? gcashRes);
      })
      .catch(() => setError('Failed to load merchandise data.'))
      .finally(() => setLoading(false));
  }

  async function loadOrders(page, filters = orderFilters) {
    setLoading(true);
    try { const oRes = await getOrders({ page, ...filters }); extractOrders(oRes); }
    catch { setError('Failed to load orders.'); }
    finally { setLoading(false); }
  }

  useEffect(load, [isPersonalShoppingView]);
  useEffect(() => { if (initialTab) setActiveTab(initialTab); }, [initialTab]);
  useEffect(() => {
    if (isPersonalShoppingView || activeTab !== 'orders') return undefined;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await getOrders({ page: 1, ...orderFilters });
        extractOrders(response);
      } catch {
        setError('Failed to load orders.');
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [orderFilters, activeTab, isPersonalShoppingView]);
  useEffect(() => {
    if (isPersonalShoppingView && location.state?.openCartAt) {
      setActiveTab('cart');
    }
  }, [isPersonalShoppingView, location.state?.openCartAt]);

  useEffect(() => {
    if (!isPersonalShoppingView) {
      return;
    }

    localStorage.setItem(STUDENT_CART_KEY, JSON.stringify(cart));
    window.dispatchEvent(new Event('hiusa-cart-updated'));
  }, [cart, isPersonalShoppingView]);

  useEffect(() => {
    if (!feedback.open) return;
    const timeoutId = setTimeout(() => setFeedback((prev) => ({ ...prev, open: false })), 3500);
    return () => clearTimeout(timeoutId);
  }, [feedback.open]);

  function showFeedback(type, message) {
    setFeedback({ open: true, type, message });
  }

  useEffect(() => {
    if (!transactionMessage) return;
    showFeedback('success', transactionMessage);
    setTransactionMessage('');
  }, [transactionMessage]);

  useEffect(() => {
    if (!error) return;
    showFeedback('error', error);
    setError(null);
  }, [error]);

  useEffect(() => {
    if (!cartError) return;
    showFeedback('error', cartError);
    setCartError(null);
  }, [cartError]);

  useEffect(() => {
    if (!formError) return;
    showFeedback('error', formError);
    setFormError(null);
  }, [formError]);

  useEffect(() => {
    if (!claimError) return;
    showFeedback('error', claimError);
    setClaimError(null);
  }, [claimError]);

  useEffect(() => {
    if (!claimSuccess) return;
    showFeedback('success', claimSuccess);
    setClaimSuccess(null);
  }, [claimSuccess]);

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
    if (!form.name.trim()) {
      setFormError('Item name is required.');
      return;
    }

    const price = Number.parseFloat(form.unit_price);
    if (!Number.isFinite(price) || price <= 0) {
      setFormError('Unit price must be greater than 0.');
      return;
    }

    const stock = Number.parseInt(form.stock_quantity, 10);
    if (!Number.isInteger(stock) || stock < 0) {
      setFormError('Initial stock must be a non-negative whole number.');
      return;
    }

    setFormSubmitting(true); setFormError(null);
    try {
      await createItem({ name: form.name, category: form.category || null, price, stock_quantity: stock, description: form.description, is_active: form.is_active, imageFile });
      setShowForm(false);
      setForm({ name: '', category: '', unit_price: '', stock_quantity: '', description: '', is_active: true });
      setImageFile(null); setImagePreview(null);
      setTransactionMessage('Product added successfully.');
      load();
    } catch (err) { setFormError(err.response?.data?.message ?? 'Failed to add item.'); }
    finally { setFormSubmitting(false); }
  }

  function openEditForm(item) {
    setEditingItemId(item.id);
    setEditForm({
      name: item.name || '',
      category: item.category || '',
      unit_price: String(item.price ?? ''),
      stock_quantity: String(item.stock_quantity ?? 0),
      description: item.description || '',
      is_active: Boolean(item.is_active),
    });
    setEditImageFile(null);
    setEditImagePreview(resolveAssetUrl(item.image_url));
    setFormError(null);
    setShowEditForm(true);
  }

  function closeEditForm() {
    setShowEditForm(false);
    setEditingItemId(null);
    setEditImageFile(null);
    setEditImagePreview(null);
  }

  async function handleUpdateItem(event) {
    event.preventDefault();
    if (!editingItemId) {
      return;
    }

    if (!editForm.name.trim()) {
      setFormError('Item name is required.');
      return;
    }

    const price = Number.parseFloat(editForm.unit_price);
    if (!Number.isFinite(price) || price <= 0) {
      setFormError('Unit price must be greater than 0.');
      return;
    }

    const stock = Number.parseInt(editForm.stock_quantity, 10);
    if (!Number.isInteger(stock) || stock < 0) {
      setFormError('Stock must be a non-negative whole number.');
      return;
    }

    setFormSubmitting(true);
    setFormError(null);

    try {
      const res = await updateItem(editingItemId, {
        name: editForm.name,
        category: editForm.category || null,
        price,
        stock_quantity: stock,
        description: editForm.description,
        is_active: editForm.is_active,
        imageFile: editImageFile,
      });
      const updated = res.data;
      setItems((prev) => prev.map((row) => (row.id === editingItemId ? { ...row, ...updated } : row)));
      setTransactionMessage(`${editForm.name} updated successfully.`);
      closeEditForm();
    } catch (err) {
      setFormError(err.response?.data?.message ?? 'Failed to update item.');
    } finally {
      setFormSubmitting(false);
    }
  }

  async function handleStatusChange(id, status, remarks = null, verifiedAmount = null) {
    try {
      const res = await updateOrderStatus(id, status, remarks, verifiedAmount);
      setOrders((prev) => prev.map((o) => (o.id === id ? res.data : o)));
      setTransactionMessage(role === 'SBO_OFFICER' && status === 'paid'
        ? `Order ORD-${id} submitted for Admin approval.`
        : role === 'ADMIN' && status === 'paid'
          ? `Order ORD-${id} was directly approved and its receipt is ready.`
        : `Order ORD-${id} marked as ${capitalize(status)}.`);
      return res;
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update order status.');
      throw err;
    }
  }

  async function handlePaymentSubmission() {
    const { order, reference, proof_file: proofFile } = paymentModal;
    if (!order || !/^\d{13}$/.test(reference.trim()) || !proofFile) {
      setPaymentModal((current) => ({ ...current, error: 'Enter the 13-digit GCash reference and attach the payment proof.' }));
      return;
    }

    setPaymentModal((current) => ({ ...current, busy: true, error: '' }));
    try {
      const res = await submitOrderPayment(order.id, { payment_reference: reference.trim(), payment_proof: proofFile });
      setOrders((current) => current.map((row) => (row.id === order.id ? { ...row, ...res.data } : row)));
      setPaymentModal({ open: false, order: null, reference: '', proof_file: null, busy: false, error: '' });
      setTransactionMessage(`Payment proof for ORD-${order.id} was submitted for verification.`);
    } catch (err) {
      setPaymentModal((current) => ({ ...current, busy: false, error: err.response?.data?.message ?? 'Failed to submit payment proof.' }));
    }
  }

  async function handlePaymentVerification() {
    const { order, amount } = verificationModal;
    if (!order || !amount) return;
    setVerificationModal((current) => ({ ...current, busy: true, error: '' }));
    try {
      await handleStatusChange(order.id, 'paid', null, Number(amount));
      setVerificationModal({ open: false, order: null, amount: '', busy: false, error: '' });
    } catch {
      setVerificationModal((current) => ({ ...current, busy: false }));
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
        setTransactionMessage(`${item.name} is now ${nextActive ? 'active' : 'inactive'} for selling.`);
      },
    });
  }

  function confirmDeleteProduct(item) {
    openConfirm({
      title: 'Delete Product',
      message: `Delete ${item.name}? This cannot be undone.`,
      confirmText: 'Delete',
      action: async () => {
        await deleteItem(item.id);
        setItems((prev) => prev.filter((row) => row.id !== item.id));
        setTransactionMessage(`${item.name} was deleted.`);
      },
    });
  }

  function openAddStockModal(item) {
    setStockModal({ open: true, item, quantity: '1' });
  }

  function closeAddStockModal() {
    setStockModal({ open: false, item: null, quantity: '1' });
  }

  function confirmAddStock() {
    if (!stockModal.item) {
      return;
    }

    const addAmount = Number.parseInt(String(stockModal.quantity).trim(), 10);
    if (!Number.isInteger(addAmount) || addAmount <= 0) {
      setError('Please enter a whole number greater than 0 for stock addition.');
      return;
    }

    const item = stockModal.item;
    const nextStock = item.stock_quantity + addAmount;
    closeAddStockModal();

    openConfirm({
      title: 'Confirm Stock Addition',
      message: `Add ${addAmount} unit(s) to ${item.name}? New stock will be ${nextStock}.`,
      confirmText: 'Add Stock',
      action: async () => {
        const res = await adjustStock(item.id, addAmount);
        const updated = res.data;
        setItems((prev) => prev.map((row) => (row.id === item.id ? { ...row, ...updated } : row)));
        setTransactionMessage(`${addAmount} unit(s) added to ${item.name}.`);
      },
    });
  }

  function handleClaim(e) {
    e.preventDefault();
    const token = claimToken.trim().toUpperCase();
    if (!token) return;

    if (!/^[A-Z0-9]{16}$/.test(token)) {
      setClaimError('Token must be 16 letters/numbers.');
      return;
    }

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
    const requested = Number.parseInt(String(draftQty[item.id] || 1), 10);
    setCartError(null);

    if (!Number.isInteger(requested) || requested <= 0) {
      setCartError('Please enter a valid quantity greater than 0.');
      return;
    }

    if (requested > item.stock_quantity) {
      setCartError(`Only ${item.stock_quantity} unit(s) available for ${item.name}.`);
      return;
    }

    setCart((prev) => {
      const existing = prev.find((row) => row.item.id === item.id);

      if (!existing && requested <= item.stock_quantity) {
        setTransactionMessage(`${requested} x ${item.name} added to cart.`);
        return [...prev, { item, quantity: requested }];
      }

      const currentQty = existing?.quantity || 0;
      const nextQty = currentQty + requested;
      if (nextQty > item.stock_quantity) {
        setCartError(`Cannot exceed available stock. ${item.name} has only ${item.stock_quantity} unit(s).`);
        return prev;
      }

      setTransactionMessage(`${item.name} quantity updated in cart.`);

      return prev.map((row) => (row.item.id === item.id ? { ...row, quantity: nextQty } : row));
    });

    setDraftQty((prev) => ({ ...prev, [item.id]: 1 }));
  }

  function changeCartQty(itemId, nextQty) {
    setCartError(null);
    setCart((prev) => prev.map((row) => {
      if (row.item.id !== itemId) return row;
      if (!Number.isInteger(nextQty) || nextQty <= 0) {
        setCartError('Quantity must be at least 1.');
        return row;
      }

      if (nextQty > row.item.stock_quantity) {
        setCartError(`Cannot exceed stock for ${row.item.name}.`);
        return row;
      }

      const safeQty = Math.max(1, Math.min(row.item.stock_quantity, nextQty));
      return { ...row, quantity: safeQty };
    }));
  }

  function removeFromCart(itemId) {
    const removed = cart.find((row) => row.item.id === itemId);
    setCart((prev) => prev.filter((row) => row.item.id !== itemId));
    if (removed) {
      setTransactionMessage(`${removed.item.name} removed from cart.`);
    }
  }

  async function submitCartOrders() {
    if (cart.length === 0) {
      setCartError('Your cart is empty. Add products before checkout.');
      return;
    }

    setCheckoutSubmitting(true);
    setCartError(null);

    if (checkoutPayment.method === 'gcash' && cart.length > 1) {
      setCartError('GCash proof is verified per order. Checkout one item at a time, or reserve this cart with cash and submit proof for each order from My Orders.');
      setCheckoutSubmitting(false);
      return;
    }

    if (checkoutPayment.method === 'gcash' && (!/^\d{13}$/.test(checkoutPayment.reference.trim()) || !checkoutPayment.proof_file)) {
      setCartError('GCash checkout requires a 13-digit reference number and an uploaded payment proof.');
      setCheckoutSubmitting(false);
      return;
    }

    const submittedIds = [];
    try {
      for (const row of cart) {
        await placeOrder({
          merchandise_id: row.item.id,
          quantity: row.quantity,
          payment_method: checkoutPayment.method,
          payment_reference: checkoutPayment.method === 'gcash' ? checkoutPayment.reference : null,
          payment_proof: checkoutPayment.method === 'gcash' ? checkoutPayment.proof_file : null,
        });
        submittedIds.push(row.item.id);
      }

      setCart([]);
      setCheckoutOpen(false);
      setCheckoutPayment({ method: 'cash', reference: '', proof_file: null });
      await load();
      setActiveTab('my-orders');
      setTransactionMessage('Order list submitted successfully. Wait for payment confirmation.');
    } catch (err) {
      const msg = err.response?.data?.message ?? 'Failed to submit cart. Please try again.';
      setCartError(submittedIds.length > 0 ? `Some items were submitted before an error occurred. ${msg}` : msg);
      setCart((prev) => prev.filter((row) => !submittedIds.includes(row.item.id)));
      await load();
    } finally {
      setCheckoutSubmitting(false);
    }
  }

  async function openOrderAnalytics(group, title) {
    setAnalyticsModal({ open: true, title, loading: true, users: [], error: '' });
    try {
      const response = await getOrderAnalyticsUsers({ ...orderFilters, group, per_page: 100 });
      setAnalyticsModal({ open: true, title, loading: false, users: response.data?.data || [], error: '' });
    } catch {
      setAnalyticsModal({ open: true, title, loading: false, users: [], error: 'Unable to load the selected users.' });
    }
  }

  async function handleOrderExport() {
    setExportingOrders(true);
    try {
      const response = await exportOrders(orderFilters);
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `merchandise-orders-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setFeedback({ open: true, type: 'success', message: 'Filtered merchandise orders exported.' });
    } catch {
      setFeedback({ open: true, type: 'error', message: 'Unable to export merchandise orders.' });
    } finally {
      setExportingOrders(false);
    }
  }

  // Derived data
  const totalRevenue = orderSummary?.total_collected ?? orders
    .filter((o) => ['paid', 'claimed'].includes(o.status))
    .reduce((sum, o) => sum + toNumber(o.total_price), 0);
  const activeOrders = orderSummary ? orderSummary.pending_orders + orderSummary.unclaimed_orders : orders.filter((o) => ['pending', 'paid'].includes(o.status)).length;
  const lowStock = items.filter((i) => i.stock_quantity > 0 && i.stock_quantity < 10).length;
  const paidOrders = orders.filter((o) => o.status === 'paid');
  const availableItems = items.filter((i) => i.is_active && i.stock_quantity > 0);
  const cartTotal = useMemo(() => cart.reduce((sum, row) => sum + (toNumber(row.item.price) * row.quantity), 0), [cart]);

  const filteredInventoryItems = items.filter((i) => i.name?.toLowerCase().includes(inventorySearch.toLowerCase()));

  const filteredStudentItems = items.filter((i) =>
    i.is_active && i.stock_quantity > 0 && i.name?.toLowerCase().includes(studentItemSearch.toLowerCase())
  );

  const filteredStudentOrders = orders.filter((o) => {
    const q = studentOrderSearch.toLowerCase();
    return (
      (o.merchandise?.name ?? '').toLowerCase().includes(q)
      || `ord-${o.id}`.toLowerCase().includes(q)
      || (o.claim_token ?? '').toLowerCase().includes(q)
    );
  });

  const filteredStudentTokens = orders
    .filter((o) => o.status === 'paid')
    .filter((o) => {
      const query = studentTokenSearch.trim().toLowerCase();
      if (!query) return true;

      return (
        (o.claim_token || '').toLowerCase().includes(query)
        || (o.merchandise?.name || '').toLowerCase().includes(query)
        || `ord-${o.id}`.toLowerCase().includes(query)
      );
    });

  const filteredOfficerOrders = orders;
  const selectedProgram = orderFilterOptions.programs?.find((program) => program.name === orderFilters.program);
  const availableSections = selectedProgram?.sections?.filter((section) => !orderFilters.year_level || Number(section.year_level) === ['1st Year', '2nd Year', '3rd Year', '4th Year'].indexOf(orderFilters.year_level) + 1) || [];
  const activeOrderFilterCount = Object.entries(orderFilters).filter(([key, value]) => !['sort', 'per_page'].includes(key) && value).length;

  const ordFrom = (ordersMeta.current_page - 1) * ordersMeta.per_page + 1;
  const ordTo = Math.min(ordersMeta.current_page * ordersMeta.per_page, ordersMeta.total);
  const feedbackPopup = feedback.open ? (
    <div className="fixed left-1/2 top-20 z-[70] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2">
      <div className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 shadow-lg ${feedback.type === 'success' ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
        <div className="flex items-start gap-2">
          {feedback.type === 'success' ? (
            <CheckCircle size={17} className="mt-0.5 shrink-0 text-[#16A34A]" />
          ) : (
            <AlertTriangle size={17} className="mt-0.5 shrink-0 text-[#DC2626]" />
          )}
          <p className={`text-sm font-semibold ${feedback.type === 'success' ? 'text-[#166534]' : 'text-[#B91C1C]'}`}>{feedback.message}</p>
        </div>
        <button
          type="button"
          onClick={() => setFeedback((prev) => ({ ...prev, open: false }))}
          className={`text-xs font-bold ${feedback.type === 'success' ? 'text-[#166534]' : 'text-[#B91C1C]'} hover:underline`}
        >
          Dismiss
        </button>
      </div>
    </div>
  ) : null;

  // ── STUDENT VIEW ─────────────────────────────────────────────────────────────
  if (isPersonalShoppingView) {
    return (
      <div className="space-y-6">
        {feedbackPopup}
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

        {/* Order Merchandise tab */}
        {activeTab === 'order' && (
          <section className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-[#DDE7EF] bg-[#EEF6FB] p-4">
              <Info size={18} className="mt-0.5 shrink-0 text-[#0B8ED0]" />
              <p className="text-[13px] font-medium text-[#0B1831]">Reserve available items, then choose cash or submit your GCash reference and payment proof for verification.</p>
            </div>

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
                      ? <img src={resolveAssetUrl(item.image_url)} alt={item.name} className="h-40 w-full object-cover" />
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
                        <p className="text-[13px] text-slate-500">Qty: {o.quantity} - Total: {fmt(o.total_price)}</p>
                        <p className="mt-1 text-[12px] text-slate-400">{fmtDate(o.created_at)}</p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${orderBadge[o.status] || 'bg-slate-100 text-slate-500'}`}>{capitalize(o.status)}</span>
                        {o.claim_token && ['paid', 'claimed'].includes(o.status) && (
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
                    {o.status === 'pending' && (
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#EEF6FB] px-3 py-2">
                        <p className="text-[12px] font-semibold text-[#0B1831]">
                          {o.payment_proof_url ? 'Payment proof submitted and awaiting officer verification.' : gcashSettings?.gcash_qr_url ? 'You can submit GCash proof now or pay cash on pickup.' : 'Pay cash on pickup. GCash is unavailable until the official QR code is configured.'}
                        </p>
                        {gcashSettings?.gcash_qr_url && <button
                          type="button"
                          onClick={() => setPaymentModal({ open: true, order: o, reference: o.payment_reference || '', proof_file: null, busy: false, error: '' })}
                          className="h-9 rounded-lg bg-[#0B8ED0] px-3 text-xs font-bold text-white hover:bg-[#0878B7]"
                        >
                          {o.payment_proof_url ? 'Replace Proof' : 'Submit GCash Proof'}
                        </button>}
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
        {activeTab === 'tokens' && !isFulfillmentRole && (
          <section className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-[#DDE7EF] bg-[#EEF6FB] p-4">
              <Info size={18} className="mt-0.5 shrink-0 text-[#0B8ED0]" />
              <p className="text-[13px] font-medium text-[#0B1831]">After payment approval, present the claim token to an authorized officer to release the item.</p>
            </div>

            <div className="flex h-10 w-full max-w-sm items-center gap-2 rounded-lg border border-[#DDE7EF] bg-white px-3">
              <Search size={15} className="text-slate-400" />
              <input
                value={studentTokenSearch}
                onChange={(e) => setStudentTokenSearch(e.target.value)}
                type="text"
                placeholder="Filter tokens by code or item..."
                className="w-full bg-transparent text-[13px] outline-none placeholder:text-slate-400"
              />
            </div>

            {loading ? (
              <div className="space-y-3">{[1, 2].map((i) => <div key={i} className="h-32 animate-pulse rounded-xl bg-slate-100" />)}</div>
            ) : filteredStudentTokens.length === 0 ? (
              <div className="rounded-xl border border-[#DDE7EF] bg-white p-12 text-center">
                <Ticket size={36} className="mx-auto mb-3 text-slate-200" />
                <p className="text-sm font-semibold text-slate-400">
                  {studentTokenSearch.trim()
                    ? 'No matching active tokens found.'
                    : 'No active tokens. Finalize an order list to receive claim tokens.'}
                </p>
                <button onClick={() => setActiveTab('order')} className="mt-4 rounded-lg bg-[#0B8ED0] px-5 py-2 text-sm font-bold text-white hover:bg-[#0878B7] transition">
                  Browse Merchandise
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredStudentTokens.map((o) => (
                  <div key={o.id} className={`rounded-xl border bg-white p-5 shadow-sm ${o.status === 'paid' ? 'border-amber-200' : 'border-[#DDE7EF]'}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-xs font-bold text-slate-400">ORD-{o.id}</p>
                        <p className="mt-0.5 font-bold text-[#0F172A]">{o.merchandise?.name ?? '-'}</p>
                        <p className="text-[13px] text-slate-500">Qty: {o.quantity} - {fmt(o.total_price)}</p>
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
              <div className="mt-4 space-y-3">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Payment Method</label>
                  <select value={checkoutPayment.method} onChange={(e) => setCheckoutPayment((current) => ({ ...current, method: e.target.value }))} className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]">
                    <option value="cash">Cash on pickup</option>
                    <option value="gcash" disabled={cart.length > 1 || !gcashSettings?.gcash_qr_url}>GCash (single order only){!gcashSettings?.gcash_qr_url ? ' - unavailable' : ''}</option>
                  </select>
                  {cart.length > 1 && <p className="mt-1 text-xs text-slate-500">For GCash, checkout one product at a time so every order has its own reference and proof.</p>}
                  {!gcashSettings?.gcash_qr_url && <p className="mt-1 text-xs font-medium text-amber-700">GCash is unavailable until an administrator uploads the official payment QR code.</p>}
                </div>
                {checkoutPayment.method === 'gcash' && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {gcashSettings?.gcash_qr_url && <div className="rounded-lg border border-[#B9D9E9] bg-[#F8FBFD] p-3 text-center sm:col-span-2"><p className="mb-2 text-xs font-bold text-[#0F172A]">Scan the official HIUSA GCash QR code</p><img src={resolveAssetUrl(gcashSettings.gcash_qr_url)} alt="Official GCash payment QR code" className="mx-auto max-h-52 max-w-full rounded-md object-contain" /></div>}
                    <div className="space-y-1.5">
                      <label className="text-[13px] font-semibold text-[#0F172A]">GCash Reference *</label>
                      <input inputMode="numeric" maxLength={13} value={checkoutPayment.reference} onChange={(e) => setCheckoutPayment((current) => ({ ...current, reference: e.target.value.replace(/\D/g, '') }))} placeholder="13-digit reference" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[13px] font-semibold text-[#0F172A]">Payment Proof *</label>
                      <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setCheckoutPayment((current) => ({ ...current, proof_file: e.target.files?.[0] || null }))} className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 py-2 text-sm outline-none focus:border-[#0B8ED0]" />
                    </div>
                  </div>
                )}
              </div>
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

        {paymentModal.open && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#0B1831]/50 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-xl border border-[#DDE7EF] bg-white p-6 shadow-2xl">
              <h2 className="text-lg font-bold text-[#0F172A]">Submit GCash Payment</h2>
              <p className="mt-1 text-sm text-slate-500">Order ORD-{paymentModal.order?.id} · {fmt(paymentModal.order?.total_price)}</p>
              <div className="mt-4 space-y-3">
                {gcashSettings?.gcash_qr_url && <div className="rounded-lg border border-[#B9D9E9] bg-[#F8FBFD] p-3 text-center"><p className="mb-2 text-xs font-bold text-[#0F172A]">Pay using the official HIUSA GCash QR code</p><img src={resolveAssetUrl(gcashSettings.gcash_qr_url)} alt="Official GCash payment QR code" className="mx-auto max-h-44 max-w-full rounded-md object-contain" /></div>}
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">13-digit GCash Reference</label>
                  <input inputMode="numeric" maxLength={13} value={paymentModal.reference} onChange={(e) => setPaymentModal((current) => ({ ...current, reference: e.target.value.replace(/\D/g, ''), error: '' }))} className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Payment Proof</label>
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setPaymentModal((current) => ({ ...current, proof_file: e.target.files?.[0] || null, error: '' }))} className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 py-2 text-sm" />
                </div>
                {paymentModal.error && <p className="text-xs font-semibold text-red-600">{paymentModal.error}</p>}
              </div>
              <div className="mt-5 flex justify-end gap-3">
                <button type="button" disabled={paymentModal.busy} onClick={() => setPaymentModal({ open: false, order: null, reference: '', proof_file: null, busy: false, error: '' })} className="h-11 rounded-lg border border-[#DDE7EF] px-4 text-sm font-bold text-slate-600">Cancel</button>
                <button type="button" disabled={paymentModal.busy} onClick={handlePaymentSubmission} className="h-11 rounded-lg bg-[#0B8ED0] px-4 text-sm font-bold text-white disabled:opacity-50">{paymentModal.busy ? 'Submitting...' : 'Submit Payment'}</button>
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
      {feedbackPopup}
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
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

      {activeTab === 'inventory' && (
        <section className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-[#DDE7EF] p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-[#0F172A]">Merchandise Inventory</h2>
              <p className="text-sm font-medium text-slate-500">Manage stock levels and product catalog</p>
            </div>
            <div className="flex w-full gap-2 sm:w-auto">
              <div className="flex h-10 flex-1 items-center gap-2 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-3 sm:flex-none">
                <Search size={15} className="text-slate-400" />
                <input value={inventorySearch} onChange={(e) => setInventorySearch(e.target.value)} type="text" placeholder="Search items..." className="w-full bg-transparent text-[13px] outline-none placeholder:text-slate-400 sm:w-[140px]" />
              </div>
              <button onClick={() => setShowForm(true)} className="flex h-10 items-center gap-2 rounded-lg bg-[#0B8ED0] px-4 text-[13px] font-bold text-white hover:bg-[#0878B7] transition">
                <Plus size={16} /><span className="hidden sm:inline">Add Product</span>
              </button>
            </div>
          </div>
          {loading ? (
            <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-3">{[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="h-64 animate-pulse rounded-xl bg-slate-100" />)}</div>
          ) : filteredInventoryItems.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-400">No inventory items yet.</p>
          ) : (
            <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-3">
              {filteredInventoryItems.map((item) => (
                <article key={item.id} className={`rounded-xl border bg-white p-4 shadow-sm ${item.stock_quantity < 10 ? 'border-red-200' : 'border-[#DDE7EF]'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex items-center gap-3">
                      {item.image_url
                        ? <img src={resolveAssetUrl(item.image_url)} alt={item.name} className="h-14 w-14 rounded-lg border border-[#DDE7EF] object-cover" />
                        : <div className="grid h-14 w-14 place-items-center rounded-lg bg-[#E6F6FD]"><Package size={20} className="text-[#0B8ED0]" /></div>}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-[#0F172A]">{item.name}</p>
                        <p className="text-xs font-medium text-slate-500">{fmt(item.price)} per unit</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {item.category && <span className="rounded-full bg-[#EEF6FB] px-2 py-0.5 text-[10px] font-bold text-[#0B8ED0]">{item.category}</span>}
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${stockBadge(item.stock_quantity)}`}>{stockLabel(item.stock_quantity)}</span>
                    </div>
                  </div>

                  <div className="mt-3 rounded-lg bg-[#F8FBFD] px-3 py-2">
                    <p className="text-xs font-medium text-slate-500">In stock:</p>
                    <p className={`text-2xl font-black ${item.stock_quantity < 10 ? 'text-red-600' : 'text-[#0F172A]'}`}>{item.stock_quantity} units</p>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => openAddStockModal(item)}
                      className="rounded-full bg-[#EEF6FB] px-3 py-1 text-xs font-bold text-[#0B8ED0] transition hover:bg-[#E0F0FA]"
                    >
                      Add Stock
                    </button>
                    <button
                      type="button"
                      onClick={() => confirmSellingToggle(item)}
                      className={`rounded-full px-3 py-1 text-xs font-bold transition ${item.is_active ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                    >
                      {item.is_active ? 'Selling: Active' : 'Selling: Inactive'}
                    </button>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openEditForm(item)}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-[#DDE7EF] px-2 text-[11px] font-bold text-[#0B8ED0] transition hover:bg-[#EEF6FB]"
                      >
                        <Pencil size={12} />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => confirmDeleteProduct(item)}
                        className="grid h-7 w-7 place-items-center rounded-md border border-red-100 text-red-500 transition hover:bg-red-50"
                        aria-label={`Delete ${item.name}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === 'orders' && (
        <section className="space-y-4">
          <div className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-[#0F172A]">Merchandise Order Intelligence</h2>
              <p className="text-sm font-medium text-slate-500">Filter cohorts, monitor payments and claims, and drill into the users behind each result.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setShowAdvancedFilters((value) => !value)} className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#DDE7EF] bg-white px-3 text-xs font-bold text-slate-600 hover:bg-[#F8FBFD]"><SlidersHorizontal size={15} />Filters{activeOrderFilterCount > 0 && <span className="rounded-full bg-[#0B8ED0] px-1.5 py-0.5 text-[10px] text-white">{activeOrderFilterCount}</span>}</button>
              <button type="button" onClick={handleOrderExport} disabled={exportingOrders} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#0B8ED0] px-3 text-xs font-bold text-white hover:bg-[#0878B7] disabled:opacity-50"><Download size={15} />{exportingOrders ? 'Exporting...' : 'Export CSV'}</button>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-[minmax(240px,1fr)_repeat(3,minmax(140px,190px))]">
            <label className="relative"><span className="sr-only">Search merchandise orders</span><Search size={15} className="absolute left-3 top-3.5 text-slate-400" /><input value={orderFilters.search} onChange={(event) => setOrderFilters({ ...orderFilters, search: event.target.value })} placeholder="Search order, student, item, reference..." className="h-11 w-full rounded-lg border border-[#DDE7EF] pl-9 pr-3 text-sm outline-none focus:border-[#0B8ED0]" /></label>
            <select aria-label="Order status" value={orderFilters.status} onChange={(event) => setOrderFilters({ ...orderFilters, status: event.target.value })} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm"><option value="">All order statuses</option>{orderFilterOptions.statuses?.map((status) => <option key={status} value={status}>{capitalize(status)}</option>)}</select>
            <select aria-label="Merchandise item" value={orderFilters.merchandise_id} onChange={(event) => setOrderFilters({ ...orderFilters, merchandise_id: event.target.value })} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm"><option value="">All merchandise</option>{orderFilterOptions.merchandise?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
            <select aria-label="Sort orders" value={orderFilters.sort} onChange={(event) => setOrderFilters({ ...orderFilters, sort: event.target.value })} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="amount_high">Highest amount</option><option value="amount_low">Lowest amount</option><option value="student">Student name</option><option value="item">Merchandise item</option><option value="status">Order status</option></select>
          </div>
          {showAdvancedFilters && <div className="mt-4 border-t border-[#E5EDF3] pt-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
            <select aria-label="Department" value={orderFilters.department} onChange={(event) => setOrderFilters({ ...orderFilters, department: event.target.value, program: '', year_level: '', section: '' })} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm"><option value="">All departments</option>{orderFilterOptions.departments?.map((value) => <option key={value}>{value}</option>)}</select>
            <select aria-label="Program or course" value={orderFilters.program} onChange={(event) => setOrderFilters({ ...orderFilters, program: event.target.value, year_level: '', section: '' })} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm"><option value="">All programs</option>{orderFilterOptions.programs?.map((program) => <option key={program.id} value={program.name}>{program.name}</option>)}</select>
            <select aria-label="Major or specialization" value={orderFilters.major} onChange={(event) => setOrderFilters({ ...orderFilters, major: event.target.value })} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm"><option value="">All majors</option>{orderFilterOptions.majors?.map((value) => <option key={value}>{value}</option>)}</select>
            <select aria-label="Year level" value={orderFilters.year_level} disabled={!orderFilters.program} onChange={(event) => setOrderFilters({ ...orderFilters, year_level: event.target.value, section: '' })} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm disabled:bg-slate-100"><option value="">All year levels</option>{['1st Year', '2nd Year', '3rd Year', '4th Year'].map((year) => <option key={year}>{year}</option>)}</select>
            <select aria-label="Section" value={orderFilters.section} disabled={!orderFilters.program || !orderFilters.year_level} onChange={(event) => setOrderFilters({ ...orderFilters, section: event.target.value })} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm disabled:bg-slate-100"><option value="">All sections</option>{availableSections.map((section) => <option key={section.id} value={section.name}>{section.name}</option>)}</select>
            <select aria-label="User role" value={orderFilters.role} onChange={(event) => setOrderFilters({ ...orderFilters, role: event.target.value })} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm"><option value="">All user roles</option>{orderFilterOptions.roles?.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select>
            <select aria-label="SBO position" value={orderFilters.position_title} onChange={(event) => setOrderFilters({ ...orderFilters, position_title: event.target.value })} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm"><option value="">All SBO positions</option>{orderFilterOptions.positions?.map((value) => <option key={value}>{value}</option>)}</select>
            <select aria-label="Payment status" value={orderFilters.payment_status} onChange={(event) => setOrderFilters({ ...orderFilters, payment_status: event.target.value })} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm"><option value="">All payment statuses</option>{orderFilterOptions.payment_statuses?.map((value) => <option key={value}>{capitalize(value)}</option>)}</select>
            <select aria-label="Payment method" value={orderFilters.payment_method} onChange={(event) => setOrderFilters({ ...orderFilters, payment_method: event.target.value })} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm"><option value="">All payment methods</option>{orderFilterOptions.payment_methods?.map((value) => <option key={value}>{value.toUpperCase()}</option>)}</select>
            <select aria-label="Rows per page" value={orderFilters.per_page} onChange={(event) => setOrderFilters({ ...orderFilters, per_page: Number(event.target.value) })} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm">{[10, 20, 50, 100].map((value) => <option key={value} value={value}>{value} rows</option>)}</select>
            {[['ordered_from', 'Ordered from'], ['ordered_to', 'Ordered to'], ['paid_from', 'Paid from'], ['paid_to', 'Paid to'], ['claimed_from', 'Claimed from'], ['claimed_to', 'Claimed to']].map(([key, label]) => <label key={key} className="text-[11px] font-bold text-slate-500">{label}<input type="date" value={orderFilters[key]} onChange={(event) => setOrderFilters({ ...orderFilters, [key]: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-[#DDE7EF] px-2 text-xs" /></label>)}
          </div><button type="button" onClick={() => setOrderFilters(EMPTY_ORDER_FILTERS)} className="mt-3 text-xs font-bold text-[#0B8ED0] hover:text-[#0878B7]">Clear all filters</button></div>}
          </div>
          {orderSummary && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">{[
            ['Total Users', orderSummary.total_users, null, 'Active users in cohort'],
            ['Purchased', orderSummary.purchased_users, 'purchased', `${orderSummary.purchase_rate}% participation`],
            ['Did Not Purchase', orderSummary.not_purchased_users, 'not_purchased', 'Users without matching orders'],
            ['Paid Orders', orderSummary.paid_orders, 'paid', fmt(orderSummary.total_collected)],
            ['Pending Payment', orderSummary.pending_orders, 'pending', `${fmt(orderSummary.outstanding_balance)} outstanding`],
            ['Claimed', orderSummary.claimed_orders, 'claimed', `${orderSummary.unclaimed_orders} still unclaimed`],
          ].map(([label, value, group, helper]) => <button type="button" disabled={!group} onClick={() => group && openOrderAnalytics(group, label)} key={label} className="rounded-xl border border-[#DDE7EF] bg-white p-4 text-left shadow-sm transition enabled:hover:border-[#0B8ED0] enabled:hover:bg-[#F8FBFD]"><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-1 text-2xl font-black text-[#0F172A]">{value}</p><p className="mt-1 text-[10px] font-semibold text-slate-400">{helper}</p></button>)}</div>}
          {orderSummary?.breakdown?.length > 0 && <div className="rounded-xl border border-[#DDE7EF] bg-white p-4 shadow-sm"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Merchandise breakdown</p><div className="mt-3 flex flex-wrap gap-2">{orderSummary.breakdown.map((item) => <span key={item.id} className="rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-3 py-2 text-xs"><strong className="text-[#0F172A]">{item.name}</strong> · {item.quantity} units · {item.orders_count} orders · {fmt(item.collected)}</span>)}</div></div>}
          <div className="overflow-hidden rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
          <div className="border-b border-[#DDE7EF] px-5 py-4"><h3 className="font-bold text-[#0F172A]">Filtered Orders</h3><p className="text-xs text-slate-500">Showing operational, payment, academic, and fulfillment details.</p></div>
          {loading ? (
            <div className="space-y-2 p-5">{[1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />)}</div>
          ) : filteredOfficerOrders.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-400">No orders yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1720px] text-left">
                <thead className="bg-[#F8FBFD] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Order / Reference</th>
                    <th className="px-4 py-3">Student / User</th>
                    <th className="px-4 py-3">Academic Profile</th>
                    <th className="px-5 py-3">Item</th>
                    <th className="px-4 py-3">Quantity / Amount</th>
                    <th className="px-4 py-3">Payment</th>
                    <th className="px-4 py-3">Review Trail</th>
                    <th className="px-4 py-3">Fulfillment</th>
                    <th className="px-4 py-3">Dates</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5EDF3] text-sm">
                  {filteredOfficerOrders.map((o) => (
                    <tr key={o.id} className="transition hover:bg-[#F8FBFD]">
                      <td className="px-4 py-4"><p className="font-mono text-xs font-black text-[#0B8ED0]">ORD-{o.id}</p><p className="mt-1 text-[10px] text-slate-400">{o.transaction?.receipt_reference || o.payment_reference || 'No payment reference'}</p></td>
                      <td className="px-4 py-4"><button type="button" onClick={() => setOrderDetails(o)} className="text-left font-semibold text-[#0F172A] hover:text-[#0B8ED0]">{o.student ? `${o.student.first_name} ${o.student.last_name}` : '-'}</button><p className="mt-0.5 font-mono text-[10px] text-slate-400">{o.student?.school_id} · {(o.student?.role || '').replaceAll('_', ' ')}</p>{o.student?.position_title && <p className="text-[10px] font-semibold text-[#0B8ED0]">{o.student.position_title}</p>}</td>
                      <td className="px-4 py-4 text-xs"><p className="font-semibold text-slate-700">{o.student?.program || 'Program not recorded'}</p><p className="mt-0.5 text-slate-400">{[o.student?.major, o.student?.year_level, o.student?.section].filter(Boolean).join(' · ') || 'No year/section'}</p><p className="text-[10px] text-slate-400">{o.student?.department || 'Department not recorded'}</p></td>
                      <td className="px-4 py-4"><p className="font-semibold text-slate-700">{o.merchandise?.name ?? '-'}</p><p className="text-[10px] text-slate-400">{o.merchandise?.category || 'Uncategorized'} · {fmt(o.merchandise?.price)} each</p></td>
                      <td className="px-4 py-4"><p className="font-bold tabular-nums text-[#0F172A]">{o.quantity} × {fmt(o.merchandise?.price)}</p><p className="text-xs font-black text-[#0B8ED0]">{fmt(o.total_price)}</p></td>
                      <td className="px-4 py-4 text-xs"><p className="font-bold uppercase text-slate-600">{o.payment_method || 'Not selected'}</p><p className="mt-1 text-slate-400">{o.payment_reference || 'No reference'}</p><span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${['paid', 'claimed'].includes(o.status) ? 'bg-emerald-50 text-emerald-700' : o.status === 'cancelled' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>{['paid', 'claimed'].includes(o.status) ? 'Paid' : o.status === 'cancelled' ? 'Cancelled' : 'Pending'}</span></td>
                      <td className="px-4 py-4 text-[10px] text-slate-500"><p><strong>Officer:</strong> {capitalize(o.officer_review_status)}</p><p><strong>Admin:</strong> {capitalize(o.admin_review_status)}</p><p className="mt-1"><strong>Processed:</strong> {o.processor ? `${o.processor.first_name} ${o.processor.last_name}` : '-'}</p><p><strong>Approved:</strong> {o.approver ? `${o.approver.first_name} ${o.approver.last_name}` : '-'}</p></td>
                      <td className="px-4 py-4"><span className={`rounded-full px-3 py-1 text-xs font-bold ${orderBadge[o.status] || 'bg-slate-100 text-slate-500'}`}>{capitalize(o.status)}</span><p className="mt-2 text-[10px] text-slate-400">Released by {o.claim_verifier ? `${o.claim_verifier.first_name} ${o.claim_verifier.last_name}` : '-'}</p></td>
                      <td className="px-4 py-4 text-[10px] text-slate-500"><p><strong>Ordered:</strong> {fmtDate(o.created_at)}</p><p><strong>Paid:</strong> {fmtDate(o.transaction?.transaction_date)}</p><p><strong>Claimed:</strong> {fmtDate(o.claimed_at)}</p></td>
                      <td className="px-4 py-4">
                        <button type="button" onClick={() => setOrderDetails(o)} className="mb-2 inline-flex items-center gap-1 rounded-md border border-[#DDE7EF] px-2.5 py-1.5 text-xs font-bold text-[#0B8ED0] hover:bg-[#EEF6FB]"><Eye size={13} />Details</button>
                        {o.status === 'pending' && (
                          <div className="flex flex-wrap gap-2">
                            <button onClick={() => setVerificationModal({ open: true, order: o, amount: String(o.total_price), busy: false, error: '' })} className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-bold transition ${role === 'ADMIN' ? 'bg-[#0B8ED0] text-white hover:bg-[#0878B7]' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'}`}>
                              {role === 'ADMIN' ? 'Approve Directly' : 'Verify & Submit'} <ArrowRight size={12} />
                            </button>
                            <button onClick={() => setRejectionModal({ open: true, order: o, remarks: '', busy: false })} className="rounded-md bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 transition hover:bg-red-100">Reject</button>
                            {o.payment_proof_url && <a href={resolveAssetUrl(o.payment_proof_url)} target="_blank" rel="noreferrer" title="View payment proof" className="grid h-8 w-8 place-items-center rounded-md border border-[#DDE7EF] text-slate-500 hover:bg-[#EEF6FB]"><Eye size={14} /></a>}
                          </div>
                        )}
                        {o.status === 'paid' && (
                          <span className="text-xs font-semibold text-emerald-700">Awaiting token validation</span>
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
              <p className="text-xs font-medium text-slate-400">Showing <span className="font-bold text-slate-600">{ordFrom}-{ordTo}</span> of <span className="font-bold text-slate-600">{ordersMeta.total}</span></p>
              <div className="flex items-center gap-1">
                <button onClick={() => loadOrders(ordersMeta.current_page - 1)} disabled={ordersMeta.current_page === 1} className="grid h-8 w-8 place-items-center rounded-lg border border-[#DDE7EF] text-slate-500 transition hover:bg-[#EEF6FB] disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft size={14} /></button>
                <span className="px-2 text-[13px] font-bold tabular-nums text-[#0F172A]">{ordersMeta.current_page} / {ordersMeta.last_page}</span>
                <button onClick={() => loadOrders(ordersMeta.current_page + 1)} disabled={ordersMeta.current_page === ordersMeta.last_page} className="grid h-8 w-8 place-items-center rounded-lg border border-[#DDE7EF] text-slate-500 transition hover:bg-[#EEF6FB] disabled:cursor-not-allowed disabled:opacity-40"><ChevronRight size={14} /></button>
              </div>
            </div>
          )}
          </div>
        </section>
      )}

      {analyticsModal.open && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#0B1831]/55 p-4 backdrop-blur-sm"><div className="max-h-[90vh] w-full max-w-7xl overflow-hidden rounded-xl border border-[#DDE7EF] bg-white shadow-2xl"><div className="flex items-start justify-between border-b border-[#DDE7EF] p-5"><div><p className="text-[10px] font-bold uppercase tracking-widest text-[#0B8ED0]">Merchandise drill-down</p><h2 className="mt-1 text-xl font-black text-[#0F172A]">{analyticsModal.title}</h2><p className="mt-1 text-xs text-slate-500">Users and matching orders for the active cohort filters.</p></div><button type="button" aria-label="Close drill-down" onClick={() => setAnalyticsModal({ open: false, title: '', loading: false, users: [], error: '' })} className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-[#EEF6FB]"><X size={18} /></button></div><div className="max-h-[72vh] overflow-auto">{analyticsModal.loading ? <div className="space-y-3 p-5">{[1, 2, 3, 4].map((row) => <div key={row} className="h-16 animate-pulse rounded-lg bg-slate-100" />)}</div> : analyticsModal.error ? <p className="m-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{analyticsModal.error}</p> : analyticsModal.users.length === 0 ? <p className="p-12 text-center text-sm text-slate-400">No users match this drill-down.</p> : <table className="w-full min-w-[1680px] text-left text-xs"><thead className="sticky top-0 bg-[#F8FBFD] text-[10px] font-bold uppercase text-slate-500"><tr>{['Student ID', 'Full Name', 'Department', 'Program / Major', 'Year / Section', 'Role / Position', 'Item', 'Qty', 'Unit Price', 'Total', 'Payment', 'Order', 'Ordered', 'Paid', 'Claimed', 'Approved / Released By', 'Reference'].map((label) => <th key={label} className="px-3 py-3">{label}</th>)}</tr></thead><tbody className="divide-y divide-[#E5EDF3]">{analyticsModal.users.flatMap((user) => user.orders?.length ? user.orders.map((order) => ({ user, order })) : [{ user, order: null }]).map(({ user, order }, index) => <tr key={`${user.school_id}-${order?.id || index}`} className="hover:bg-[#F8FBFD]"><td className="px-3 py-3 font-mono">{user.school_id}</td><td className="px-3 py-3 font-bold text-[#0F172A]">{user.first_name} {user.last_name}<p className="font-normal text-slate-400">{user.email}</p></td><td className="px-3 py-3">{user.department || '-'}</td><td className="px-3 py-3">{user.program || '-'}<p className="text-slate-400">{user.major || 'No major'}</p></td><td className="px-3 py-3">{user.year_level || '-'} · {user.section || '-'}</td><td className="px-3 py-3">{(user.role || '').replaceAll('_', ' ')}<p className="text-[#0B8ED0]">{user.position_title || '-'}</p></td><td className="px-3 py-3 font-semibold">{order?.merchandise?.name || 'Did not purchase'}</td><td className="px-3 py-3">{order?.quantity ?? '-'}</td><td className="px-3 py-3">{order ? fmt(order.merchandise?.price) : '-'}</td><td className="px-3 py-3 font-bold">{order ? fmt(order.total_price) : '-'}</td><td className="px-3 py-3">{order?.payment_method || '-'}<p className="text-slate-400">{order?.payment_reference || '-'}</p></td><td className="px-3 py-3">{capitalize(order?.status)}</td><td className="px-3 py-3">{fmtDate(order?.created_at)}</td><td className="px-3 py-3">{fmtDate(order?.transaction?.transaction_date)}</td><td className="px-3 py-3">{fmtDate(order?.claimed_at)}</td><td className="px-3 py-3">{order?.approver ? `${order.approver.first_name} ${order.approver.last_name}` : '-'}<p className="text-slate-400">{order?.claim_verifier ? `${order.claim_verifier.first_name} ${order.claim_verifier.last_name}` : '-'}</p></td><td className="px-3 py-3 font-mono">{order?.transaction?.receipt_reference || order?.payment_reference || '-'}</td></tr>)}</tbody></table>}</div></div></div>}

      {orderDetails && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#0B1831]/55 p-4 backdrop-blur-sm"><div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-widest text-[#0B8ED0]">Order record</p><h2 className="mt-1 text-xl font-black text-[#0F172A]">ORD-{orderDetails.id} · {orderDetails.merchandise?.name}</h2><p className="mt-1 text-xs text-slate-500">Complete user, payment, approval, and fulfillment information.</p></div><button type="button" aria-label="Close order details" onClick={() => setOrderDetails(null)} className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-[#EEF6FB]"><X size={18} /></button></div><div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[
        ['Student / User', `${orderDetails.student?.first_name || ''} ${orderDetails.student?.last_name || ''}`, orderDetails.student?.school_id],
        ['Contact', orderDetails.student?.email, orderDetails.student?.account_status],
        ['Academic Profile', [orderDetails.student?.department, orderDetails.student?.program, orderDetails.student?.major, orderDetails.student?.year_level, orderDetails.student?.section].filter(Boolean).join(' · '), orderDetails.student?.role?.replaceAll('_', ' ')],
        ['Item & Quantity', `${orderDetails.merchandise?.name} × ${orderDetails.quantity}`, `${fmt(orderDetails.merchandise?.price)} each · ${fmt(orderDetails.total_price)} total`],
        ['Payment', orderDetails.payment_method || 'Not selected', orderDetails.payment_reference || 'No reference'],
        ['Receipt', orderDetails.transaction?.receipt_reference || 'Not generated', orderDetails.transaction?.receipt_number ? `Receipt #${orderDetails.transaction.receipt_number}` : 'Awaiting approval'],
        ['Review Status', `Officer: ${capitalize(orderDetails.officer_review_status)} · Admin: ${capitalize(orderDetails.admin_review_status)}`, orderDetails.review_remarks || 'No remarks'],
        ['Processed / Approved', orderDetails.processor ? `${orderDetails.processor.first_name} ${orderDetails.processor.last_name}` : 'Not processed', orderDetails.approver ? `Approved by ${orderDetails.approver.first_name} ${orderDetails.approver.last_name}` : 'Not approved'],
        ['Fulfillment', capitalize(orderDetails.status), orderDetails.claim_verifier ? `Released by ${orderDetails.claim_verifier.first_name} ${orderDetails.claim_verifier.last_name}` : 'Not released'],
        ['Order Date', fmtDate(orderDetails.created_at), orderDetails.updated_at ? `Updated ${fmtDate(orderDetails.updated_at)}` : null],
        ['Payment Date', fmtDate(orderDetails.transaction?.transaction_date), null],
        ['Claimed / Released Date', fmtDate(orderDetails.claimed_at), null],
      ].map(([label, value, helper]) => <div key={label} className="rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 break-words text-sm font-bold text-[#0F172A]">{value || '-'}</p>{helper && <p className="mt-1 break-words text-xs text-slate-500">{helper}</p>}</div>)}</div>{orderDetails.payment_proof_url && <a href={resolveAssetUrl(orderDetails.payment_proof_url)} target="_blank" rel="noreferrer" className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg border border-[#DDE7EF] px-3 text-xs font-bold text-[#0B8ED0]"><Eye size={14} />View payment proof</a>}</div></div>}

      {activeTab === 'tokens' && isFulfillmentRole && (
        <section className="space-y-4">
          <div className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
            <h2 className="mb-1 text-lg font-bold text-[#0F172A]">Claim by Token</h2>
            <p className="mb-4 text-sm font-medium text-slate-500">Enter the claim token from a paid order to mark it as claimed</p>
            <form onSubmit={handleClaim} className="flex gap-3">
              <input maxLength={16} value={claimToken} onChange={(e) => { setClaimToken(e.target.value.replace(/[^a-z0-9]/gi, '').toUpperCase()); setClaimError(null); }} placeholder="16-character token" className="h-11 flex-1 rounded-lg border border-[#DDE7EF] px-3 font-mono text-sm uppercase outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
              <button type="submit" disabled={claiming || !claimToken.trim()} className="flex h-11 items-center gap-2 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white transition hover:bg-[#0878B7] disabled:opacity-50">
                <Ticket size={16} />{claiming ? 'Processing...' : 'Claim'}
              </button>
            </form>
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
              <h2 className="text-lg font-bold text-[#0F172A]">Add Product</h2>
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
                  {imagePreview ? <img src={imagePreview} alt="Preview" className="h-24 w-24 rounded-lg object-cover" /> : (<><ImagePlus size={24} className="mb-1 text-slate-300" /><span className="text-[13px] font-semibold text-slate-400">Click to upload</span><span className="text-[11px] text-slate-300">JPG, PNG, WebP (max 5MB)</span></>)}
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleImageSelect} className="sr-only" />
                </label>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => { setShowForm(false); setImageFile(null); setImagePreview(null); }} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD]">Cancel</button>
                <button type="submit" disabled={formSubmitting || !form.name || !form.unit_price || !form.stock_quantity} className="h-11 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white transition hover:bg-[#0878B7] disabled:opacity-50">{formSubmitting ? 'Adding...' : 'Add Product'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEditForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#0F172A]">Edit Product</h2>
              <button onClick={closeEditForm} className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-[#EEF6FB]"><X size={18} /></button>
            </div>
            <form className="space-y-4" onSubmit={handleUpdateItem}>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Item Name *</label>
                <input type="text" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} placeholder="e.g. HIUSA T-Shirt (XL)" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Category</label>
                <input type="text" value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} placeholder="e.g. Apparel, Accessories" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Unit Price (₱) *</label>
                  <input type="number" min="0" step="0.01" value={editForm.unit_price} onChange={(e) => setEditForm({ ...editForm, unit_price: e.target.value })} placeholder="0.00" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Stock *</label>
                  <input type="number" min="0" value={editForm.stock_quantity} onChange={(e) => setEditForm({ ...editForm, stock_quantity: e.target.value })} placeholder="0" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Description</label>
                <textarea rows={2} value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} placeholder="Optional description..." className="w-full resize-none rounded-lg border border-[#DDE7EF] px-3 py-2.5 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Selling Status</label>
                <select value={editForm.is_active ? '1' : '0'} onChange={(e) => setEditForm({ ...editForm, is_active: e.target.value === '1' })} className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15">
                  <option value="1">Active</option>
                  <option value="0">Inactive</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Product Image</label>
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-[#DDE7EF] bg-[#F8FBFD] py-4 transition hover:border-[#0B8ED0]/50 hover:bg-[#EEF6FB]">
                  {editImagePreview
                    ? <img src={editImagePreview} alt="Preview" className="h-24 w-24 rounded-lg object-cover" />
                    : (<><ImagePlus size={24} className="mb-1 text-slate-300" /><span className="text-[13px] font-semibold text-slate-400">Click to upload</span><span className="text-[11px] text-slate-300">JPG, PNG, WebP (max 5MB)</span></>)}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => {
                      const file = e.target.files[0];
                      if (!file) return;
                      setEditImageFile(file);
                      setEditImagePreview(URL.createObjectURL(file));
                    }}
                    className="sr-only"
                  />
                </label>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={closeEditForm} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD]">Cancel</button>
                <button type="submit" disabled={formSubmitting || !editForm.name || !editForm.unit_price || !editForm.stock_quantity} className="h-11 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white transition hover:bg-[#0878B7] disabled:opacity-50">{formSubmitting ? 'Saving...' : 'Save Changes'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {verificationModal.open && verificationModal.order && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center bg-[#0B1831]/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-extrabold text-[#0F172A]">{role === 'ADMIN' ? 'Approve Payment Directly' : 'Verify Payment Amount'}</h3>
            <p className="mt-1 text-sm text-slate-500">{role === 'ADMIN' ? 'Approve this order without waiting for an SBO Officer review. ' : ''}Confirm the payment for ORD-{verificationModal.order.id} matches {fmt(verificationModal.order.total_price)}.</p>
            {verificationModal.order.payment_proof_url ? (
              <a href={resolveAssetUrl(verificationModal.order.payment_proof_url)} target="_blank" rel="noreferrer" className="mt-3 inline-flex h-10 items-center gap-2 rounded-lg border border-[#DDE7EF] px-3 text-xs font-bold text-[#0B8ED0] hover:bg-[#EEF6FB]"><Eye size={14} /> View Payment Proof</a>
            ) : (
              <p className="mt-3 text-xs font-semibold text-red-600">No payment proof is attached.</p>
            )}
            <div className="mt-4 space-y-1.5">
              <label className="text-[13px] font-semibold text-[#0F172A]">Amount shown on proof</label>
              <input type="number" min="0.01" step="0.01" value={verificationModal.amount} onChange={(e) => setVerificationModal((current) => ({ ...current, amount: e.target.value, error: '' }))} className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]" />
            </div>
            {verificationModal.error && <p className="mt-2 text-xs font-semibold text-red-600">{verificationModal.error}</p>}
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setVerificationModal({ open: false, order: null, amount: '', busy: false, error: '' })} disabled={verificationModal.busy} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600">Cancel</button>
              <button type="button" onClick={handlePaymentVerification} disabled={verificationModal.busy || (verificationModal.order.payment_method === 'gcash' && !verificationModal.order.payment_proof_url)} className="h-11 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white disabled:opacity-50">{verificationModal.busy ? 'Submitting...' : role === 'ADMIN' ? 'Approve Payment' : 'Verify & Submit'}</button>
            </div>
          </div>
        </div>
      )}

      {rejectionModal.open && rejectionModal.order && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center bg-[#0B1831]/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-extrabold text-[#0F172A]">Reject Payment</h3>
            <p className="mt-1 text-sm text-slate-500">Provide the reason for rejecting order ORD-{rejectionModal.order.id}.</p>
            <textarea rows={4} value={rejectionModal.remarks} onChange={(e) => setRejectionModal((current) => ({ ...current, remarks: e.target.value }))} className="mt-4 w-full rounded-lg border border-[#DDE7EF] px-3 py-2.5 text-sm outline-none focus:border-[#0B8ED0]" placeholder="Rejection reason" />
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setRejectionModal({ open: false, order: null, remarks: '', busy: false })} disabled={rejectionModal.busy} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600">Cancel</button>
              <button
                type="button"
                disabled={rejectionModal.busy || !rejectionModal.remarks.trim()}
                onClick={async () => {
                  setRejectionModal((current) => ({ ...current, busy: true }));
                  await handleStatusChange(rejectionModal.order.id, 'cancelled', rejectionModal.remarks.trim());
                  setRejectionModal({ open: false, order: null, remarks: '', busy: false });
                }}
                className="h-11 rounded-lg bg-red-600 px-5 text-sm font-bold text-white disabled:opacity-50"
              >
                {rejectionModal.busy ? 'Rejecting...' : 'Reject Payment'}
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

      <AddStockModal
        open={stockModal.open}
        itemName={stockModal.item?.name || ''}
        quantity={stockModal.quantity}
        busy={confirmModal.busy}
        onQuantityChange={(quantity) => setStockModal((prev) => ({ ...prev, quantity }))}
        onCancel={closeAddStockModal}
        onConfirm={confirmAddStock}
      />
    </div>
  );
}
