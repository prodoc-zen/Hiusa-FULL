import FieldIcon from '../../../components/FieldIcon.jsx';
import RichTextEditor, { RichTextBody } from '../../../components/RichText';
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import TableRowActions from "../../../components/TableRowActions";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle,
  Crown,
  ChevronLeft,
  ChevronRight,
  Circle,
  PhilippinePeso,
  Download,
  ImagePlus,
  Info,
  Minus,
  Package,
  Pencil,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
  ShoppingBag,
  Ticket,
  Trash2,
  X,
} from "lucide-react";
import {
  getGcashSettings,
  getMerchandise,
  createItem,
  updateItem,
  adjustStock,
  deleteItem,
  getMerchandiseAuditLogs,
} from "../../../services/merchandiseService";
import {
  cancelOrder,
  exportOrders,
  getOrderAnalyticsUsers,
  getOrderAuditLogs,
  getOrders,
  openOrderPaymentProof,
  placeOrder,
  submitOrderPayment,
  updateOrderStatus,
  claimByToken,
  verifyClaimToken,
} from "../../../services/orderService";
import { resolveAssetUrl } from "../../../utils/assetUrl";
import { downloadExcelXml } from "../../../utils/excelXml";
import PaginationControls from "../../../components/PaginationControls";
import { fetchAllPages } from "../../../services/pagination";
import AccessibleOverlay from "../../../components/AccessibleOverlay";
import Modal from "../../../components/Modal";
import ReceiptDocument, { ClaimTicket, printClaimTicket } from "../../../components/receipts/ReceiptDocument";
import GcashPaymentSettingsPage from "./GcashPaymentSettingsPage";

const STUDENT_CART_KEY = "hiusa_student_cart";
const CATEGORIES = ["Apparel", "Accessories", "School Supplies", "Drinkware", "Bags", "Other"];
const STANDARD_SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL"];
const cartKey = (item) => item.cart_key || String(item.id);
const itemPrice = (item) => Number(item.effective_price ?? item.price);
const emptyCatalogExtras = { variants: [], promotion_price: "", promotion_buyer_limit: "", low_stock_threshold: "9" };

function CatalogFields({ value, onChange, images, onImagesChange }) {
  const categoryIsCustom = Boolean(value.category_custom || (value.category && !CATEGORIES.includes(value.category)));
  const variants = value.variants || [];
  const changeVariant = (index, patch) => onChange({ ...value, variants: variants.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row) });
  return <>
    <label className="block text-[13px] font-semibold text-[#0F172A]"><FieldIcon label="Category *" />Category *
      <select value={categoryIsCustom ? "Other" : value.category} onChange={(event) => onChange({ ...value, category: event.target.value === "Other" ? "" : event.target.value, category_custom: event.target.value === "Other" })} required className="mt-1 h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm">
        <option value="">Select category</option>
        {CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
      </select>
      {categoryIsCustom && <input value={value.category} onChange={(event) => onChange({ ...value, category: event.target.value, category_custom: true })} placeholder="Enter category name" required className="mt-2 h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm" />}
    </label>
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="text-[13px] font-semibold text-[#0F172A]"><FieldIcon label="Low stock at or below" />Low stock at or below
        <input type="number" min="1" value={value.low_stock_threshold ?? "9"} onChange={(event) => onChange({ ...value, low_stock_threshold: event.target.value })} className="mt-1 h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm" />
      </label>
      <label className="text-[13px] font-semibold text-[#0F172A]"><FieldIcon label="Promo price" />Promo price
        <input type="number" min="0" step="0.01" value={value.promotion_price ?? ""} onChange={(event) => onChange({ ...value, promotion_price: event.target.value })} placeholder="Optional" className="mt-1 h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm" />
      </label>
      <label className="text-[13px] font-semibold text-[#0F172A]"><FieldIcon label="First buyers" />First buyers
        <input type="number" min="1" value={value.promotion_buyer_limit ?? ""} onChange={(event) => onChange({ ...value, promotion_buyer_limit: event.target.value })} placeholder="e.g. 100" className="mt-1 h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm" />
      </label>
    </div>
    <section className="space-y-2 rounded-xl border border-[#DDE7EF] bg-[#F8FBFD] p-3">
      <div className="flex items-center justify-between gap-2"><div><h3 className="text-sm font-bold text-[#0F2F62]">Sizes and variants</h3><p className="text-xs text-slate-600">Add sizes for wearable items. Each has its own stock and optional image.</p></div><button type="button" onClick={() => { onChange({ ...value, variants: [...variants, { name: "", stock_quantity: 0 }] }); onImagesChange([...images, null]); }} className="shrink-0 rounded-lg border border-[#0878B7] px-3 py-2 text-xs font-bold text-[#0878B7]">Add variant</button></div>
      {variants.map((variant, index) => <div key={variant.id || `new-${index}`} className="grid gap-2 rounded-lg border border-[#DDE7EF] bg-white p-2 sm:grid-cols-[1fr_5rem_auto_auto]">
        <div><input list="merchandise-size-options" value={variant.name} onChange={(event) => changeVariant(index, { name: event.target.value })} placeholder="Size / variant" aria-label={`Variant ${index + 1} name`} className="h-10 w-full rounded-lg border border-[#DDE7EF] px-2 text-sm" /><datalist id="merchandise-size-options">{STANDARD_SIZES.map((size) => <option key={size} value={size} />)}</datalist></div>
        <input type="number" min="0" value={variant.stock_quantity} onChange={(event) => changeVariant(index, { stock_quantity: event.target.value })} aria-label={`${variant.name || `Variant ${index + 1}`} stock`} className="h-10 w-full rounded-lg border border-[#DDE7EF] px-2 text-sm" />
        <label className="cursor-pointer rounded-lg border border-[#DDE7EF] px-3 py-2 text-xs font-semibold text-[#0F2F62]">{images[index] ? "Image selected" : variant.image_url ? "Change image" : "Add image"}<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => onImagesChange(images.map((file, imageIndex) => imageIndex === index ? event.target.files[0] : file))} /></label>
        <button type="button" aria-label={`Remove ${variant.name || `variant ${index + 1}`}`} onClick={() => { onChange({ ...value, variants: variants.filter((_, rowIndex) => rowIndex !== index) }); onImagesChange(images.filter((_, rowIndex) => rowIndex !== index)); }} className="grid h-10 w-10 place-items-center rounded-lg text-red-700 hover:bg-red-50"><X size={16} /></button>
      </div>)}
      {variants.length > 0 && <p className="text-xs font-semibold text-[#0F2F62]">Total variant stock: {variants.reduce((sum, row) => sum + (Number(row.stock_quantity) || 0), 0)}</p>}
    </section>
  </>;
}

function ProductImageViewer({ lightbox, onChange, onClose }) {
  if (!lightbox) return null;
  const images = [lightbox.item.image_url, ...(lightbox.item.variants || []).map((variant) => variant.image_url)].filter(Boolean);
  if (!images.length) return null;
  const imageIndex = Math.min(lightbox.index, images.length - 1);
  return <AccessibleOverlay label={`${lightbox.item.name} images`} onClose={onClose} className="fixed inset-0 z-[75] flex items-center justify-center bg-[#0B1831]/85 p-4">
    <div className="w-full max-w-3xl rounded-xl bg-white p-4 shadow-2xl"><div className="flex items-center justify-between gap-3"><h2 className="font-bold text-[#0F2F62]">{lightbox.item.name}</h2><button type="button" onClick={onClose} aria-label="Close image viewer" className="grid h-10 w-10 place-items-center rounded-lg hover:bg-slate-100"><X size={20} /></button></div><img src={resolveAssetUrl(images[imageIndex])} alt={`${lightbox.item.name} image ${imageIndex + 1}`} className="mt-3 max-h-[65vh] w-full rounded-lg bg-[#F8FBFD] object-contain" />{images.length > 1 && <div className="mt-3 flex items-center justify-center gap-3"><button type="button" onClick={() => onChange({ ...lightbox, index: (imageIndex - 1 + images.length) % images.length })} aria-label="Previous image" className="grid h-10 w-10 place-items-center rounded-lg border"><ChevronLeft size={20} /></button><span className="text-sm text-slate-600">{imageIndex + 1} of {images.length}</span><button type="button" onClick={() => onChange({ ...lightbox, index: (imageIndex + 1) % images.length })} aria-label="Next image" className="grid h-10 w-10 place-items-center rounded-lg border"><ChevronRight size={20} /></button></div>}</div>
  </AccessibleOverlay>;
}
const EMPTY_ORDER_FILTERS = {
  search: "",
  program: "",
  major: "",
  year_level: "",
  section: "",
  role: "",
  position_title: "",
  status: "",
  payment_method: "",
  merchandise_id: "",
  ordered_from: "",
  ordered_to: "",
  paid_from: "",
  paid_to: "",
  claimed_from: "",
  claimed_to: "",
  sort: "newest",
  per_page: 10,
};

function readStudentCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STUDENT_CART_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getRole() {
  try {
    return JSON.parse(localStorage.getItem("user"))?.role || null;
  } catch {
    return null;
  }
}

const stockBadge = (qty) => {
  if (qty === 0) return "bg-red-50 text-red-700";
  if (qty < 10) return "bg-amber-50 text-amber-700";
  return "bg-emerald-50 text-emerald-700";
};

const orderBadge = {
  pending: "bg-[#E6F6FD] text-[#0F2F62]",
  paid: "bg-amber-50 text-amber-700",
  claimed: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-red-50 text-red-700",
};

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "-";
}
function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number.parseFloat(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}
function fmt(n) {
  return `₱${toNumber(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(d) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtDateTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function reviewActionLabel(action) {
  return capitalize(String(action || "review updated").replaceAll("_", " "));
}

function StepNode({ active, done, label }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={`grid h-7 w-7 place-items-center rounded-full border-2 transition-colors ${done ? "border-emerald-500 bg-emerald-500" : active ? "border-[#0B8ED0] bg-[#0878B7]" : "border-slate-200 bg-white"}`}
      >
        {done ? (
          <CheckCircle size={14} className="text-white" />
        ) : (
          <Circle
            size={10}
            className={active ? "text-white" : "text-slate-300"}
          />
        )}
      </div>
      <span
        className={`text-xs font-bold ${done || active ? "text-[#0F172A]" : "text-slate-500"}`}
      >
        {label}
      </span>
    </div>
  );
}

function StepTracker({ status }) {
  const done1 = ["paid", "claimed"].includes(status);
  const done2 = status === "claimed";
  return (
    <div className="flex flex-col">
      <StepNode active={status === "pending"} done={done1} label="Ordered" />
      <p className="ml-10 text-[11px] text-slate-500">Your order has been placed.</p>
      <div
        className={`ml-[13px] h-6 w-px ${done1 ? "bg-emerald-400" : "bg-slate-200"}`}
      />
      <StepNode active={status === "paid"} done={done2} label="Paid" />
      <p className="ml-10 text-[11px] text-slate-500">{done1 ? 'Payment approved. Bring your claim token to pickup.' : 'Awaiting payment approval.'}</p>
      <div
        className={`ml-[13px] h-6 w-px ${done2 ? "bg-emerald-400" : "bg-slate-200"}`}
      />
      <StepNode active={status === "claimed"} done={false} label="Claimed" />
      <p className="ml-10 text-[11px] text-slate-500">{done2 ? 'Items handed over and token used.' : 'Show your token when collecting your items.'}</p>
    </div>
  );
}

function ConfirmModal({
  open,
  title,
  message,
  confirmText = "Confirm",
  busy = false,
  danger = false,
  onCancel,
  onConfirm,
}) {
  if (!open) return null;

  return (
    <AccessibleOverlay label={title} onClose={() => !busy && onCancel()} className="fixed inset-0 z-[60] flex items-center justify-center bg-[#0B1831]/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-lg border border-[#DDE7EF] bg-white p-6 shadow-2xl">
        <h3 className="text-lg font-extrabold text-[#0F172A]">{title}</h3>
        <p className="mt-2 whitespace-pre-line text-sm text-slate-600">{message}</p>
        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD]"
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`h-11 rounded-lg px-5 text-sm font-bold text-white transition disabled:opacity-50 ${danger ? "bg-[#DC2626] hover:bg-[#B91C1C]" : "bg-[#0878B7] hover:bg-[#0F2F62]"}`}
            disabled={busy}
          >
            {busy ? "Processing..." : confirmText}
          </button>
        </div>
      </div>
    </AccessibleOverlay>
  );
}

function AddStockModal({
  open,
  itemName,
  quantity,
  note,
  variants,
  variantId,
  busy = false,
  onQuantityChange,
  onNoteChange,
  onVariantChange,
  onCancel,
  onConfirm,
}) {
  if (!open) return null;

  return (
    <AccessibleOverlay label="Add merchandise stock" onClose={() => !busy && onCancel()} className="fixed inset-0 z-[65] flex items-center justify-center bg-[#0B1831]/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-lg border border-[#DDE7EF] bg-white p-6 shadow-2xl">
        <h3 className="text-lg font-extrabold text-[#0F172A]">Add Stock</h3>
        <p className="mt-2 text-sm text-slate-600">
          Enter how many units you want to add for{" "}
          <span className="font-bold text-[#0F172A]">{itemName}</span>.
        </p>
        <div className="mt-4 space-y-1.5">
          {variants?.length > 0 && <label className="block text-[13px] font-semibold text-[#0F172A]"><FieldIcon label="Variant" />Variant
            <select value={variantId} onChange={(event) => onVariantChange(event.target.value)} className="mt-1 h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm" required>
              <option value="">Select variant</option>
              {variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.name} · {variant.stock_quantity} in stock</option>)}
            </select>
          </label>}
          <label className="text-[13px] font-semibold text-[#0F172A]">
           <FieldIcon label="Quantity to Add" /> Quantity to Add
          </label>
          <input
            type="number"
            min="1"
            value={quantity}
            onChange={(event) => onQuantityChange(event.target.value)}
            className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
          />
          <label className="block text-[13px] font-semibold text-[#0F172A]"><FieldIcon label="Reason for stock addition" />Reason for stock addition
            <textarea value={note} onChange={(event) => onNoteChange(event.target.value)} maxLength={500} required rows={2} className="mt-1 w-full rounded-lg border border-[#DDE7EF] px-3 py-2 text-sm" placeholder="e.g. New delivery received" />
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD]"
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="h-11 rounded-lg bg-[#0878B7] px-5 text-sm font-bold text-white transition hover:bg-[#0F2F62] disabled:opacity-50"
            disabled={busy}
          >
            Continue
          </button>
        </div>
      </div>
    </AccessibleOverlay>
  );
}

function reviewTone(status) {
  if (status === "approved") return "bg-emerald-50 text-emerald-700";
  if (status === "rejected") return "bg-red-50 text-red-700";
  return "bg-amber-50 text-amber-700";
}

function FulfillmentOrderRow({
  order,
  role,
  onDetails,
  onApprove,
  onReject,
}) {
  const studentName = order.student
    ? `${order.student.first_name} ${order.student.last_name}`
    : "Unknown buyer";
  const academicProfile = [
    order.student?.program,
    order.student?.year_level,
    order.student?.section,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="rounded-lg border border-[#DDE7EF] bg-white p-4 transition hover:bg-[#F8FBFD] sm:p-5">
      <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-[minmax(220px,1.2fr)_minmax(190px,1fr)_minmax(170px,.8fr)_minmax(210px,1fr)_auto] 2xl:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-black text-[#0878B7]">
              ORD-{order.id}
            </span>
            <span
              className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${orderBadge[order.status] || "bg-slate-100 text-slate-600"}`}
            >
              {capitalize(order.status)}
            </span>
            <span className="text-[11px] font-medium text-slate-500">
              {fmtDate(order.created_at)}
            </span>
          </div>
          <p className="mt-2 block max-w-full truncate text-left text-sm font-extrabold text-[#0F172A]">
            {studentName}
          </p>
          <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">
            {order.student?.school_id || "No school ID"}
          </p>
          <p className="mt-1 truncate text-[11px] text-slate-500">
            {academicProfile || order.student?.department || "No academic profile"}
          </p>
        </div>

        <div className="min-w-0 border-t border-[#EEF6FB] pt-4 xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0">
          <p className="truncate text-sm font-bold text-[#0F172A]">
            {order.merchandise?.name || "Unavailable item"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {order.quantity} x {fmt(order.unit_price ?? Number(order.total_price) / Number(order.quantity || 1))}
          </p>
          <p className="mt-1 text-sm font-black tabular-nums text-[#0878B7]">
            {fmt(order.total_price)}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-500">
            <span className="uppercase">{order.payment_method || "No method"}</span>
            <span aria-hidden="true">·</span>
            {order.payment_method !== 'cash' && <span className="max-w-32 truncate font-mono">{order.payment_reference || 'Reference pending'}</span>}
          </div>
        </div>

        <div className="border-t border-[#EEF6FB] pt-4 xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Payment review
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${reviewTone(order.officer_review_status)}`}>
              Officer: {capitalize(order.officer_review_status)}
            </span>
            <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${reviewTone(order.admin_review_status)}`}>
              Admin: {capitalize(order.admin_review_status)}
            </span>
          </div>
        </div>

        <div className="border-t border-[#EEF6FB] pt-4 xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0">
          {order.status === "paid" && order.claim_token ? (
            <div className="rounded-lg border border-[#DDE7EF] bg-[#EEF6FB] px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#0878B7]">
                <Ticket size={13} /> Ready for pickup
              </p>
              <p className="mt-1 break-all font-mono text-sm font-black tracking-wider text-[#0B1831]">
                {order.claim_token}
              </p>
            </div>
          ) : order.status === "claimed" ? (
            <div className="rounded-lg bg-emerald-50 px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-xs font-bold text-emerald-700">
                <CheckCircle size={14} /> Claimed {fmtDate(order.claimed_at)}
              </p>
              <p className="mt-1 text-[10px] text-emerald-700/80">
                Released by {order.claim_verifier ? `${order.claim_verifier.first_name} ${order.claim_verifier.last_name}` : "authorized staff"}
              </p>
            </div>
          ) : order.status === "cancelled" ? (
            <p className="rounded-lg bg-red-50 px-3 py-2.5 text-xs font-semibold text-red-700">
              Order cancelled
            </p>
          ) : (
            <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-700">
              Token unlocks after Admin approval
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-[#EEF6FB] pt-4 md:col-span-2 xl:col-span-1 xl:w-40 xl:flex-col xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0">
          <button
            type="button"
            onClick={() => onDetails(order)}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-[#DDE7EF] bg-white px-3 text-xs font-bold text-[#0878B7] hover:bg-[#F8FBFD]"
          >
            Review
          </button>
          {order.status === "pending" && (
            <>
              <button
                type="button"
                onClick={() => onApprove(order)}
                className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-700"
              >
                {role === "ADMIN" ? "Approve" : "Verify"} <ArrowRight size={13} />
              </button>
              <button
                type="button"
                onClick={() => onReject(order)}
                className="min-h-11 flex-1 rounded-lg border border-red-200 bg-white px-3 text-xs font-bold text-red-700 hover:bg-red-50"
              >
                Reject
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

export default function MerchandisePage({ initialTab }) {
  const location = useLocation();
  const role = getRole();
  const isFulfillmentRole = role === "ADMIN" || role === "SBO_OFFICER";
  const defaultTab =
    role === "ADMIN"
      ? "inventory"
      : role === "SBO_OFFICER"
        ? "orders"
        : "order";
  const [activeTab, setActiveTab] = useState(initialTab || defaultTab);
  const isPersonalShoppingView =
    ["order", "cart", "my-orders"].includes(activeTab);

  const [items, setItems] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [inventorySearch, setInventorySearch] = useState("");
  const [inventoryCategory, setInventoryCategory] = useState("all");
  const [orderFilters, setOrderFilters] = useState(EMPTY_ORDER_FILTERS);
  const [orderSummary, setOrderSummary] = useState(null);
  const [orderFilterOptions, setOrderFilterOptions] = useState({
    programs: [],
    majors: [],
    roles: [],
    positions: [],
    merchandise: [],
    statuses: [],
    payment_methods: [],
  });
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [showPaymentSettings, setShowPaymentSettings] = useState(false);
  const [paymentSettingsBusy, setPaymentSettingsBusy] = useState(false);
  const [orderQueueView, setOrderQueueView] = useState('auto');
  const [tokenStatusFilter, setTokenStatusFilter] = useState('paid');
  const [analyticsModal, setAnalyticsModal] = useState({
    open: false,
    title: "",
    loading: false,
    users: [],
    error: "",
    group: "",
    currentPage: 1,
    totalUsers: 0,
  });
  const [analyticsRowPage, setAnalyticsRowPage] = useState(1);
  const [exportingAnalytics, setExportingAnalytics] = useState(false);
  const [orderDetails, setOrderDetails] = useState(null);
  const [orderReviewTrail, setOrderReviewTrail] = useState({
    loading: false,
    entries: [],
    error: "",
  });
  const [exportingOrders, setExportingOrders] = useState(false);
  const [studentItemSearch, setStudentItemSearch] = useState("");
  const [productPreview, setProductPreview] = useState(null);
  const [studentCategory, setStudentCategory] = useState("all");
  const [studentItemSort, setStudentItemSort] = useState("featured");
  const [studentOrderSearch, setStudentOrderSearch] = useState("");
  const [ordersMeta, setOrdersMeta] = useState({
    current_page: 1,
    last_page: 1,
    total: 0,
    per_page: 10,
  });
  const [pendingOrdersTotal, setPendingOrdersTotal] = useState(0);

  // Officer-only state
  const [showForm, setShowForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [editingItemId, setEditingItemId] = useState(null);
  const [form, setForm] = useState({
    name: "",
    category: "",
    category_custom: false,
    unit_price: "",
    stock_quantity: "",
    description: "",
    is_active: true,
    ...emptyCatalogExtras,
  });
  const [editForm, setEditForm] = useState({
    name: "",
    category: "",
    category_custom: false,
    unit_price: "",
    stock_quantity: "",
    description: "",
    is_active: true,
    ...emptyCatalogExtras,
  });
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [editImageFile, setEditImageFile] = useState(null);
  const [editImagePreview, setEditImagePreview] = useState(null);
  const [formError, setFormError] = useState(null);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [claimToken, setClaimToken] = useState("");
  const [claimError, setClaimError] = useState(null);
  const [claimSuccess, setClaimSuccess] = useState(null);
  const [claiming, setClaiming] = useState(false);
  const [claimPreview, setClaimPreview] = useState(null);
  const [transactionMessage, setTransactionMessage] = useState("");
  const [feedback, setFeedback] = useState({
    open: false,
    type: "success",
    message: "",
  });
  const [stockModal, setStockModal] = useState({
    open: false,
    item: null,
    quantity: "1",
    note: "",
    variantId: "",
  });
  const [selectedVariants, setSelectedVariants] = useState({});
  const [lightbox, setLightbox] = useState(null);
  const [auditModal, setAuditModal] = useState(null);
  const [variantImages, setVariantImages] = useState([]);
  const [confirmModal, setConfirmModal] = useState({
    open: false,
    title: "",
    message: "",
    confirmText: "Confirm",
    action: null,
    busy: false,
    danger: false,
  });

  async function openOrderDetails(order) {
    setOrderDetails(order);
    setOrderReviewTrail({ loading: true, entries: [], error: "" });
    try {
      const response = await getOrderAuditLogs(order.id);
      setOrderReviewTrail({
        loading: false,
        entries: Array.isArray(response.data) ? response.data : [],
        error: "",
      });
    } catch (requestError) {
      setOrderReviewTrail({
        loading: false,
        entries: [],
        error:
          requestError.response?.data?.message ||
          "Could not load this order review trail.",
      });
    }
  }

  // Student-only state
  const [cart, setCart] = useState(() => readStudentCart());
  const [draftQty, setDraftQty] = useState({});
  const [cartError, setCartError] = useState(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutSubmitting, setCheckoutSubmitting] = useState(false);
  const [checkoutPayment, setCheckoutPayment] = useState({
    method: "cash",
    reference: "",
    proof_file: null,
  });
  const [gcashSettings, setGcashSettings] = useState(null);
  const [paymentModal, setPaymentModal] = useState({
    open: false,
    order: null,
    reference: "",
    proof_file: null,
    busy: false,
    error: "",
  });
  const [verificationModal, setVerificationModal] = useState({
    open: false,
    order: null,
    amount: "",
    busy: false,
    error: "",
  });
  const [rejectionModal, setRejectionModal] = useState({
    open: false,
    order: null,
    remarks: "",
    busy: false,
    error: "",
  });

  function extractOrders(oRes) {
    const arr = Array.isArray(oRes.data?.data)
      ? oRes.data.data
      : Array.isArray(oRes.data)
        ? oRes.data
        : [];
    setOrders(arr);
    if (oRes.data?.current_page !== undefined) {
      setOrdersMeta({
        current_page: oRes.data.current_page,
        last_page: oRes.data.last_page,
        total: oRes.data.total,
        per_page: oRes.data.per_page,
      });
    }
    if (oRes.data?.summary) setOrderSummary(oRes.data.summary);
    if (oRes.data?.filter_options)
      setOrderFilterOptions(oRes.data.filter_options);
  }

  function load() {
    setLoading(true);
    setError(null);
    const managerOrderFilters = activeTab === "tokens"
      ? { ...EMPTY_ORDER_FILTERS, status: tokenStatusFilter, sort: "oldest" }
      : EMPTY_ORDER_FILTERS;
    const calls = isPersonalShoppingView
      ? [
          fetchAllPages((p) => getMerchandise(p).then((r) => r.data)).then((rows) => ({ data: rows })),
          getOrders({ mine: 1 }),
          getGcashSettings(),
          // /orders ignores status filters entirely for the personal ("mine")
          // view server-side, so the only way to get an accurate pending count
          // is to walk the student's own order history (bounded per-student,
          // unlike a full-table walk) rather than trust a filtered request.
          fetchAllPages((p) => getOrders({ mine: 1, ...p }).then((r) => r.data), {}, { perPage: 10 }),
        ]
      : [fetchAllPages((p) => getMerchandise(p).then((r) => r.data)).then((rows) => ({ data: rows })), getOrders({ page: 1, ...managerOrderFilters })];
    Promise.all(calls)
      .then(([mRes, oRes, gcashRes, allMineOrders]) => {
        const merch = Array.isArray(mRes.data?.data)
          ? mRes.data.data
          : Array.isArray(mRes.data)
            ? mRes.data
            : [];
        setItems(merch);
        setCart((previous) => previous.map((row) => {
          const latest = merch.find((item) => item.id === row.item.id);
          if (!latest) return row;
          const variant = latest.variants?.find((entry) => entry.id === row.item.merchandise_variant_id);
          return { ...row, item: { ...latest, merchandise_variant_id: variant?.id, variant_name: variant?.name, cart_key: variant ? `${latest.id}:${variant.id}` : String(latest.id), stock_quantity: variant?.stock_quantity ?? latest.stock_quantity, image_url: variant?.image_url || latest.image_url } };
        }));
        extractOrders(oRes);
        if (gcashRes) setGcashSettings(gcashRes.data ?? gcashRes);
        if (allMineOrders) {
          setPendingOrdersTotal(allMineOrders.filter((o) => o.status === "pending").length);
        }
      })
      .catch(() => setError("Failed to load merchandise data."))
      .finally(() => setLoading(false));
  }

  async function loadOrders(page, filters = orderFilters) {
    setLoading(true);
    try {
      const oRes = await getOrders({ page, ...filters });
      extractOrders(oRes);
    } catch {
      setError("Failed to load orders.");
    } finally {
      setLoading(false);
    }
  }

  async function loadPersonalOrders(page) {
    setLoading(true);
    try {
      const oRes = await getOrders({ mine: 1, page });
      extractOrders(oRes);
    } catch {
      setError("Failed to load orders.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(load, [activeTab, isPersonalShoppingView, tokenStatusFilter]);
  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);
  useEffect(() => {
    if (isPersonalShoppingView || activeTab !== "orders") return undefined;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await getOrders({ page: 1, ...orderFilters });
        extractOrders(response);
      } catch {
        setError("Failed to load orders.");
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [orderFilters, activeTab, isPersonalShoppingView]);
  useEffect(() => {
    if (isPersonalShoppingView && location.state?.openCartAt) {
      setActiveTab("cart");
    }
  }, [isPersonalShoppingView, location.state?.openCartAt]);

  useEffect(() => {
    if (!isPersonalShoppingView) {
      return;
    }

    localStorage.setItem(STUDENT_CART_KEY, JSON.stringify(cart));
    window.dispatchEvent(new Event("hiusa-cart-updated"));
  }, [cart, isPersonalShoppingView]);

  useEffect(() => {
    if (!feedback.open) return;
    const timeoutId = setTimeout(
      () => setFeedback((prev) => ({ ...prev, open: false })),
      3500,
    );
    return () => clearTimeout(timeoutId);
  }, [feedback.open]);

  function showFeedback(type, message) {
    setFeedback({ open: true, type, message });
  }

  async function handleViewPaymentProof(orderId) {
    try {
      await openOrderPaymentProof(orderId);
    } catch (err) {
      showFeedback(
        "error",
        err.response?.data?.message || "Failed to open payment proof.",
      );
    }
  }

  useEffect(() => {
    if (!transactionMessage) return;
    showFeedback("success", transactionMessage);
    setTransactionMessage("");
  }, [transactionMessage]);

  useEffect(() => {
    if (!error) return;
    showFeedback("error", error);
    setError(null);
  }, [error]);

  useEffect(() => {
    if (!cartError) return;
    showFeedback("error", cartError);
    setCartError(null);
  }, [cartError]);

  useEffect(() => {
    if (!formError) return;
    showFeedback("error", formError);
    setFormError(null);
  }, [formError]);

  useEffect(() => {
    if (!claimError) return;
    showFeedback("error", claimError);
    setClaimError(null);
  }, [claimError]);

  useEffect(() => {
    if (!claimSuccess) return;
    showFeedback("success", claimSuccess);
    setClaimSuccess(null);
  }, [claimSuccess]);

  function openConfirm({ title, message, confirmText, action, danger = false }) {
    setConfirmModal({
      open: true,
      title,
      message,
      confirmText,
      action,
      busy: false,
      danger,
    });
  }

  function closeConfirm() {
    setConfirmModal({
      open: false,
      title: "",
      message: "",
      confirmText: "Confirm",
      action: null,
      busy: false,
      danger: false,
    });
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
      setFormError("Item name is required.");
      return;
    }

    const price = Number.parseFloat(form.unit_price);
    if (!Number.isFinite(price) || price <= 0) {
      setFormError("Unit price must be greater than 0.");
      return;
    }

    const stock = Number.parseInt(form.stock_quantity, 10);
    if (!form.category.trim()) { setFormError("Select a category."); return; }
    if ((!form.variants.length && !Number.isInteger(stock)) || stock < 0) {
      setFormError("Initial stock must be a non-negative whole number.");
      return;
    }

    setFormSubmitting(true);
    setFormError(null);
    try {
      await createItem({
        name: form.name,
        category: form.category || null,
        price,
        stock_quantity: form.variants.length ? form.variants.reduce((sum, row) => sum + Number(row.stock_quantity), 0) : stock,
        description: form.description,
        is_active: form.is_active,
        imageFile,
        variants: form.variants,
        variantImages,
        low_stock_threshold: form.low_stock_threshold,
        promotion_price: form.promotion_price || "",
        promotion_buyer_limit: form.promotion_buyer_limit || "",
      });
      setShowForm(false);
      setForm({
        name: "",
        category: "",
        category_custom: false,
        unit_price: "",
        stock_quantity: "",
        description: "",
        is_active: true,
        ...emptyCatalogExtras,
      });
      setVariantImages([]);
      setImageFile(null);
      setImagePreview(null);
      setTransactionMessage("Product added successfully.");
      load();
    } catch (err) {
      setFormError(err.response?.data?.message ?? "Failed to add item.");
    } finally {
      setFormSubmitting(false);
    }
  }

  function openEditForm(item) {
    setEditingItemId(item.id);
    setEditForm({
      name: item.name || "",
      category: item.category || "",
      category_custom: Boolean(item.category && !CATEGORIES.includes(item.category)),
      unit_price: String(item.price ?? ""),
      stock_quantity: String(item.stock_quantity ?? 0),
      description: item.description || "",
      is_active: Boolean(item.is_active),
      variants: item.variants || [],
      low_stock_threshold: String(item.low_stock_threshold ?? 9),
      promotion_price: String(item.promotion_price ?? ""),
      promotion_buyer_limit: String(item.promotion_buyer_limit ?? ""),
      stock_note: "",
    });
    setVariantImages((item.variants || []).map(() => null));
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
      setFormError("Item name is required.");
      return;
    }

    const price = Number.parseFloat(editForm.unit_price);
    if (!Number.isFinite(price) || price <= 0) {
      setFormError("Unit price must be greater than 0.");
      return;
    }

    const stock = Number.parseInt(editForm.stock_quantity, 10);
    if (!editForm.category.trim()) { setFormError("Select a category."); return; }
    if ((!editForm.variants.length && !Number.isInteger(stock)) || stock < 0) {
      setFormError("Stock must be a non-negative whole number.");
      return;
    }

    setFormSubmitting(true);
    setFormError(null);

    try {
      const res = await updateItem(editingItemId, {
        name: editForm.name,
        category: editForm.category || null,
        price,
        stock_quantity: editForm.variants.length ? editForm.variants.reduce((sum, row) => sum + Number(row.stock_quantity), 0) : stock,
        description: editForm.description,
        is_active: editForm.is_active,
        imageFile: editImageFile,
        variants: editForm.variants,
        variantImages,
        low_stock_threshold: editForm.low_stock_threshold,
        promotion_price: editForm.promotion_price || "",
        promotion_buyer_limit: editForm.promotion_buyer_limit || "",
        stock_note: editForm.stock_note || "",
      });
      const updated = res.data;
      setItems((prev) =>
        prev.map((row) =>
          row.id === editingItemId ? { ...row, ...updated } : row,
        ),
      );
      setTransactionMessage(`${editForm.name} updated successfully.`);
      closeEditForm();
    } catch (err) {
      setFormError(err.response?.data?.message ?? "Failed to update item.");
    } finally {
      setFormSubmitting(false);
    }
  }

  async function handleStatusChange(
    id,
    status,
    remarks = null,
    verifiedAmount = null,
  ) {
    try {
      const res = await updateOrderStatus(id, status, remarks, verifiedAmount);
      setOrders((prev) => prev.map((o) => (o.id === id ? res.data : o)));
      if (orderDetails?.id === id) {
        await openOrderDetails(res.data);
      }
      setTransactionMessage(
        role === "SBO_OFFICER" && status === "paid"
          ? `Order ORD-${id} submitted for Admin approval.`
          : role === "ADMIN" && status === "paid"
            ? `Order ORD-${id} was directly approved and its receipt is ready.`
            : `Order ORD-${id} marked as ${capitalize(status)}.`,
      );
      return res;
    } catch (err) {
      setError(err.response?.data?.message || "Failed to update order status.");
      throw err;
    }
  }

  async function handlePaymentSubmission() {
    const { order, reference, proof_file: proofFile } = paymentModal;
    if (!order || !/^\d{13}$/.test(reference.trim()) || !proofFile) {
      setPaymentModal((current) => ({
        ...current,
        error:
          "Enter the 13-digit GCash reference and attach the payment proof.",
      }));
      return;
    }

    setPaymentModal((current) => ({ ...current, busy: true, error: "" }));
    try {
      const res = await submitOrderPayment(order.id, {
        payment_reference: reference.trim(),
        payment_proof: proofFile,
      });
      setOrders((current) =>
        current.map((row) =>
          row.id === order.id ? { ...row, ...res.data } : row,
        ),
      );
      setPaymentModal({
        open: false,
        order: null,
        reference: "",
        proof_file: null,
        busy: false,
        error: "",
      });
      setTransactionMessage(
        `Payment proof for ORD-${order.id} was submitted for verification.`,
      );
    } catch (err) {
      setPaymentModal((current) => ({
        ...current,
        busy: false,
        error: err.response?.data?.message ?? "Failed to submit payment proof.",
      }));
    }
  }

  function openPaymentVerification(order) {
    setVerificationModal({
      open: true,
      order,
      amount: String(order.total_price),
      busy: false,
      error: "",
    });
  }

  function openOrderRejection(order) {
    setRejectionModal({
      open: true,
      order,
      remarks: "",
      busy: false,
      error: "",
    });
  }

  function confirmBuyerCancellation(order) {
    openConfirm({
      title: "Cancel this order?",
      message: `Cancel ORD-${order.id} for ${order.merchandise?.name ?? "this item"}? This unpaid order has not reserved stock.`,
      confirmText: "Cancel Order",
      danger: true,
      action: async () => {
        const response = await cancelOrder(order.id);
        setOrders((current) =>
          current.map((row) => (row.id === order.id ? response.data : row)),
        );
        setPendingOrdersTotal((current) => Math.max(0, current - 1));
        setTransactionMessage(
          `Order ORD-${order.id} was cancelled.`,
        );
      },
    });
  }

  async function handlePaymentVerification() {
    const { order, amount } = verificationModal;
    if (!order) return;
    if (!amount || Number(amount) <= 0) {
      setVerificationModal((current) => ({ ...current, error: "Enter the verified payment amount." }));
      return;
    }
    setVerificationModal((current) => ({ ...current, busy: true, error: "" }));
    try {
      await handleStatusChange(order.id, "paid", null, Number(amount));
      setVerificationModal({
        open: false,
        order: null,
        amount: "",
        busy: false,
        error: "",
      });
    } catch (requestError) {
      setVerificationModal((current) => ({ ...current, busy: false, error: requestError.response?.data?.message || "Payment review failed." }));
    }
  }

  async function handleClaimByToken(token) {
    setClaiming(true);
    setClaimError(null);
    setClaimSuccess(null);
    try {
      const res = await claimByToken(token.trim().toUpperCase());
      setClaimSuccess(
        `Order claimed for ${res.data?.student?.first_name ?? "student"}.`,
      );
      setClaimToken("");
      setClaimPreview(null);
      load();
    } catch (err) {
      setClaimError(
        err.response?.data?.message ?? "Invalid or already used token.",
      );
    } finally {
      setClaiming(false);
    }
  }

  function confirmSellingToggle(item) {
    const nextActive = !item.is_active;
    openConfirm({
      title: nextActive ? "Set Item Active" : "Set Item Inactive",
      message: nextActive
        ? `Mark ${item.name} as active for selling?`
        : `Mark ${item.name} as inactive? Students will not be able to order this item.`,
      confirmText: nextActive ? "Set Active" : "Set Inactive",
      action: async () => {
        const res = await updateItem(item.id, { is_active: nextActive });
        const updated = res.data;
        setItems((prev) =>
          prev.map((row) =>
            row.id === item.id ? { ...row, ...updated } : row,
          ),
        );
        setTransactionMessage(
          `${item.name} is now ${nextActive ? "active" : "inactive"} for selling.`,
        );
      },
    });
  }

  function confirmDeleteProduct(item) {
    openConfirm({
      title: "Delete Product",
      message: `Delete ${item.name}? This cannot be undone.`,
      confirmText: "Delete",
      action: async () => {
        await deleteItem(item.id);
        setItems((prev) => prev.filter((row) => row.id !== item.id));
        setTransactionMessage(`${item.name} was deleted.`);
      },
    });
  }

  function openAddStockModal(item) {
    setStockModal({ open: true, item, quantity: "1", note: "", variantId: "" });
  }

  function closeAddStockModal() {
    setStockModal({ open: false, item: null, quantity: "1", note: "", variantId: "" });
  }

  function confirmAddStock() {
    if (!stockModal.item) {
      return;
    }

    const addAmount = Number.parseInt(String(stockModal.quantity).trim(), 10);
    if (!Number.isInteger(addAmount) || addAmount <= 0) {
      setError(
        "Please enter a whole number greater than 0 for stock addition.",
      );
      return;
    }

    const item = stockModal.item;
    const note = stockModal.note.trim();
    const variantId = stockModal.variantId ? Number(stockModal.variantId) : null;
    if (!note || (item.variants?.length && !variantId)) {
      setError("Select a variant and enter a reason for this stock addition.");
      return;
    }
    const nextStock = item.stock_quantity + addAmount;
    closeAddStockModal();

    openConfirm({
      title: "Confirm Stock Addition",
      message: `Add ${addAmount} unit(s) to ${item.name}? New stock will be ${nextStock}.`,
      confirmText: "Add Stock",
      action: async () => {
        const res = await adjustStock(item.id, addAmount, note, variantId);
        const updated = res.data;
        setItems((prev) =>
          prev.map((row) =>
            row.id === item.id ? { ...row, ...updated } : row,
          ),
        );
        setTransactionMessage(`${addAmount} unit(s) added to ${item.name}.`);
      },
    });
  }

  async function handleClaim(e) {
    e.preventDefault();
    const token = claimToken.trim().toUpperCase();
    if (!token) return;

    if (!/^[A-Z0-9]{16}$/.test(token)) {
      setClaimError("Token must be 16 letters/numbers.");
      return;
    }

    setClaiming(true);
    setClaimError(null);
    setClaimSuccess(null);
    try {
      const response = await verifyClaimToken(token);
      setClaimPreview(response.data);
    } catch (requestError) {
      setClaimError(requestError.response?.data?.message || "Unable to verify this token.");
    } finally {
      setClaiming(false);
    }
  }

  function addToCart(item) {
    const variant = item.variants?.length ? item.variants.find((row) => row.id === Number(selectedVariants[item.id])) : null;
    if (item.variants?.length && !variant) {
      setCartError(`Select a variant for ${item.name}.`);
      return;
    }
    const cartItem = variant ? { ...item, merchandise_variant_id: variant.id, variant_name: variant.name, cart_key: `${item.id}:${variant.id}`, stock_quantity: variant.stock_quantity, image_url: variant.image_url || item.image_url } : item;
    const requested = Number.parseInt(String(draftQty[item.id] || 1), 10);
    setCartError(null);

    if (!Number.isInteger(requested) || requested <= 0) {
      setCartError("Please enter a valid quantity greater than 0.");
      return;
    }

    if (requested > cartItem.stock_quantity) {
      setCartError(
        `Only ${cartItem.stock_quantity} unit(s) available for ${item.name}.`,
      );
      return;
    }

    const alreadyInCart = cart.find((row) => cartKey(row.item) === cartKey(cartItem))?.quantity || 0;
    if (alreadyInCart + requested > cartItem.stock_quantity) {
      setCartError(`Cannot exceed available stock. ${item.name} has only ${cartItem.stock_quantity} unit(s).`);
      return false;
    }

    setCart((prev) => {
      const existing = prev.find((row) => cartKey(row.item) === cartKey(cartItem));

      if (!existing && requested <= cartItem.stock_quantity) {
        setTransactionMessage(`${requested} x ${item.name} added to cart.`);
        return [...prev, { item: cartItem, quantity: requested }];
      }

      const currentQty = existing?.quantity || 0;
      const nextQty = currentQty + requested;
      if (nextQty > cartItem.stock_quantity) {
        setCartError(
          `Cannot exceed available stock. ${item.name} has only ${item.stock_quantity} unit(s).`,
        );
        return prev;
      }

      setTransactionMessage(`${item.name} quantity updated in cart.`);

      return prev.map((row) =>
        cartKey(row.item) === cartKey(cartItem) ? { ...row, quantity: nextQty } : row,
      );
    });

    setDraftQty((prev) => ({ ...prev, [item.id]: 1 }));
    return true;
  }

  function changeCartQty(itemId, nextQty) {
    setCartError(null);
    setCart((prev) =>
      prev.map((row) => {
        if (cartKey(row.item) !== itemId) return row;
        if (!Number.isInteger(nextQty) || nextQty <= 0) {
          setCartError("Quantity must be at least 1.");
          return row;
        }

        if (nextQty > row.item.stock_quantity) {
          setCartError(`Cannot exceed stock for ${row.item.name}.`);
          return row;
        }

        const safeQty = Math.max(1, Math.min(row.item.stock_quantity, nextQty));
        return { ...row, quantity: safeQty };
      }),
    );
  }

  function removeFromCart(itemId) {
    const removed = cart.find((row) => cartKey(row.item) === itemId);
    setCart((prev) => prev.filter((row) => cartKey(row.item) !== itemId));
    if (removed) {
      setTransactionMessage(`${removed.item.name} removed from cart.`);
    }
  }

  async function submitCartOrders() {
    if (cart.length === 0) {
      setCartError("Your cart is empty. Add products before checkout.");
      return;
    }

    setCheckoutSubmitting(true);
    setCartError(null);

    if (checkoutPayment.method === "gcash" && cart.length > 1) {
      setCartError(
        "GCash proof is verified per order. Checkout one item at a time, or reserve this cart with cash and submit proof for each order from My Orders.",
      );
      setCheckoutSubmitting(false);
      return;
    }

    if (
      checkoutPayment.method === "gcash" &&
      (!/^\d{13}$/.test(checkoutPayment.reference.trim()) ||
        !checkoutPayment.proof_file)
    ) {
      setCartError(
        "GCash checkout requires a 13-digit reference number and an uploaded payment proof.",
      );
      setCheckoutSubmitting(false);
      return;
    }

    const submittedIds = [];
    try {
      for (const row of cart) {
        await placeOrder({
          merchandise_id: row.item.id,
          merchandise_variant_id: row.item.merchandise_variant_id,
          quantity: row.quantity,
          payment_method: checkoutPayment.method,
          payment_reference:
            checkoutPayment.method === "gcash"
              ? checkoutPayment.reference
              : null,
          payment_proof:
            checkoutPayment.method === "gcash"
              ? checkoutPayment.proof_file
              : null,
        });
        submittedIds.push(cartKey(row.item));
      }

      setCart([]);
      setCheckoutOpen(false);
      setCheckoutPayment({ method: "cash", reference: "", proof_file: null });
      await load();
      setActiveTab("my-orders");
      setTransactionMessage(
        "Order list submitted successfully. Wait for payment confirmation.",
      );
    } catch (err) {
      const msg =
        err.response?.data?.message ??
        "Failed to submit cart. Please try again.";
      setCartError(
        submittedIds.length > 0
          ? `Some items were submitted before an error occurred. ${msg}`
          : msg,
      );
      setCart((prev) =>
        prev.filter((row) => !submittedIds.includes(cartKey(row.item))),
      );
      await load();
    } finally {
      setCheckoutSubmitting(false);
    }
  }

  async function openOrderAnalytics(group, title, page = 1) {
    setAnalyticsRowPage(1);
    setAnalyticsModal({
      open: true,
      title,
      loading: true,
      users: [],
      error: "",
      group,
      currentPage: page,
      totalUsers: 0,
    });
    try {
      const response = await getOrderAnalyticsUsers({
        ...orderFilters,
        group,
        page,
        per_page: 10,
      });
      setAnalyticsModal({
        open: true,
        title,
        loading: false,
        users: response.data?.data || [],
        error: "",
        group,
        currentPage: response.data?.current_page || page,
        totalUsers: response.data?.total || 0,
      });
    } catch {
      setAnalyticsModal({
        open: true,
        title,
        loading: false,
        users: [],
        error: "Unable to load the selected users.",
        group,
        currentPage: page,
        totalUsers: 0,
      });
    }
  }

  async function exportOrderAnalytics() {
    if (exportingAnalytics) return;
    setExportingAnalytics(true);
    try {
      const filters = { ...orderFilters, group: analyticsModal.group };
      const first = await getOrderAnalyticsUsers({ ...filters, page: 1 });
      const users = [...(first.data?.data || [])];
      const lastPage = Number(first.data?.last_page || 1);
      for (let start = 2; start <= lastPage; start += 10) {
        const responses = await Promise.all(Array.from({ length: Math.min(10, lastPage - start + 1) }, (_, index) => getOrderAnalyticsUsers({ ...filters, page: start + index })));
        responses.forEach((response) => users.push(...(response.data?.data || [])));
      }
      const rows = users.flatMap((user) => (user.orders?.length ? user.orders : [null]).map((order) => [
        user.school_id, `${user.first_name || ''} ${user.last_name || ''}`.trim(), user.email, user.role, user.department, user.program, user.year_level, user.section,
        order?.id ? `ORD-${order.id}` : '', order?.merchandise?.name, order?.quantity, order?.unit_price ?? order?.merchandise?.price, order?.total_price, order?.payment_method, order?.status, order?.created_at,
      ]));
      downloadExcelXml(`merchandise-${analyticsModal.group}-${new Date().toISOString().slice(0, 10)}.xls`, ['School ID', 'Name', 'Email', 'Role', 'Department', 'Program', 'Year', 'Section', 'Order', 'Item', 'Quantity', 'Unit price', 'Total', 'Mode of payment', 'Status', 'Ordered'], rows);
      showFeedback('success', 'Excel file exported.');
    } catch {
      showFeedback('error', 'Could not export the selected users.');
    } finally {
      setExportingAnalytics(false);
    }
  }

  async function handleOrderExport() {
    setExportingOrders(true);
    try {
      const response = await exportOrders(orderFilters);
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `merchandise-orders-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setFeedback({
        open: true,
        type: "success",
        message: "Filtered merchandise orders exported.",
      });
    } catch {
      setFeedback({
        open: true,
        type: "error",
        message: "Unable to export merchandise orders.",
      });
    } finally {
      setExportingOrders(false);
    }
  }

  // Derived data
  const totalRevenue =
    orderSummary?.total_collected ??
    orders
      .filter((o) => ["paid", "claimed"].includes(o.status))
      .reduce((sum, o) => sum + toNumber(o.total_price), 0);
  const activeOrders = orderSummary
    ? orderSummary.pending_orders + orderSummary.unclaimed_orders
    : orders.filter((o) => ["pending", "paid"].includes(o.status)).length;
  const lowStock = items.filter((i) => i.is_low_stock).length;
  const topSellers = [...(orderSummary?.breakdown || [])].sort((left, right) => Number(right.quantity) - Number(left.quantity)).slice(0, 5);
  const tokenOrders = orders.filter((o) => o.status === tokenStatusFilter);
  const availableItems = items.filter(
    (i) => i.is_active && i.stock_quantity > 0,
  );
  const availableUnits = availableItems.reduce(
    (sum, item) => sum + item.stock_quantity,
    0,
  );
  const cartTotal = useMemo(
    () =>
      cart.reduce(
        (sum, row) => sum + itemPrice(row.item) * row.quantity,
        0,
      ),
    [cart],
  );
  const cartQuantity = cart.reduce((sum, row) => sum + row.quantity, 0);

  const inventoryCategories = [...new Set(items.map((item) => item.category).filter(Boolean))].sort();
  const filteredInventoryItems = items.filter((item) =>
    (inventoryCategory === "all" || item.category === inventoryCategory) &&
    item.name?.toLowerCase().includes(inventorySearch.toLowerCase()),
  );

  const studentCategories = [
    "all",
    ...new Set(
      items
        .filter((item) => item.is_active && item.category)
        .map((item) => item.category),
    ),
  ];
  const filteredStudentItems = items
    .filter(
      (item) =>
        item.is_active &&
        (studentCategory === "all" || item.category === studentCategory) &&
        [item.name, item.category, item.description].some((value) =>
          (value ?? "")
            .toLowerCase()
            .includes(studentItemSearch.trim().toLowerCase()),
        ),
    )
    .sort((left, right) => {
      if (studentItemSort === "price-low") {
        return toNumber(left.price) - toNumber(right.price);
      }
      if (studentItemSort === "price-high") {
        return toNumber(right.price) - toNumber(left.price);
      }
      if (studentItemSort === "stock") {
        return right.stock_quantity - left.stock_quantity;
      }
      return Number(right.stock_quantity > 0) - Number(left.stock_quantity > 0);
    });

  const filteredStudentOrders = orders.filter((o) => {
    const q = studentOrderSearch.toLowerCase();
    return (
      (o.merchandise?.name ?? "").toLowerCase().includes(q) ||
      `ord-${o.id}`.toLowerCase().includes(q) ||
      (o.claim_token ?? "").toLowerCase().includes(q)
    );
  });

  const analyticsRows = analyticsModal.users.flatMap((user) =>
    user.orders?.length
      ? user.orders.map((order) => ({ user, order }))
      : [{ user, order: null }],
  );
  const pagedAnalyticsRows = analyticsRows.slice(
    (analyticsRowPage - 1) * 10,
    analyticsRowPage * 10,
  );

  const filteredOfficerOrders = orders;
  const selectedProgram = orderFilterOptions.programs?.find(
    (program) => program.name === orderFilters.program,
  );
  const availableSections =
    selectedProgram?.sections?.filter(
      (section) =>
        !orderFilters.year_level ||
        Number(section.year_level) ===
          ["1st Year", "2nd Year", "3rd Year", "4th Year"].indexOf(
            orderFilters.year_level,
          ) +
            1,
    ) || [];
  const activeOrderFilterCount = Object.entries(orderFilters).filter(
    ([key, value]) => !["sort", "per_page"].includes(key) && value,
  ).length;

  const ordFrom = (ordersMeta.current_page - 1) * ordersMeta.per_page + 1;
  const ordTo = Math.min(
    ordersMeta.current_page * ordersMeta.per_page,
    ordersMeta.total,
  );
  const feedbackPopup = feedback.open ? (
    <div className="dashboard-centered-popup fixed top-[calc(var(--dashboard-navbar-bottom,68px)+0.75rem)] z-[70] w-[calc(100vw-2rem)] -translate-x-1/2">
      <div
        className={`flex items-start justify-between gap-3 rounded-lg border px-4 py-3 shadow-lg ${feedback.type === "success" ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}
      >
        <div className="flex items-start gap-2">
          {feedback.type === "success" ? (
            <CheckCircle size={17} className="mt-0.5 shrink-0 text-[#16A34A]" />
          ) : (
            <AlertTriangle
              size={17}
              className="mt-0.5 shrink-0 text-[#DC2626]"
            />
          )}
          <p
            className={`text-sm font-semibold ${feedback.type === "success" ? "text-[#166534]" : "text-[#B91C1C]"}`}
          >
            {feedback.message}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setFeedback((prev) => ({ ...prev, open: false }))}
          className={`text-xs font-bold ${feedback.type === "success" ? "text-[#166534]" : "text-[#B91C1C]"} hover:underline`}
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
        <ProductImageViewer lightbox={lightbox} onChange={setLightbox} onClose={() => setLightbox(null)} />
        <Modal open={Boolean(productPreview)} title={productPreview?.name} onClose={() => setProductPreview(null)} maxWidth="max-w-xl" footer={productPreview && <button type="button" onClick={() => { if (addToCart(productPreview)) setProductPreview(null); }} disabled={productPreview.stock_quantity === 0} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#0878B7] px-4 text-sm font-bold text-white disabled:opacity-50"><ShoppingBag size={16} />Add to cart</button>}>
          {cartError && <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{cartError}</p>}
          {productPreview && <div className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
            {productPreview.image_url ? <img src={resolveAssetUrl(productPreview.image_url)} alt={productPreview.name} className="aspect-square w-full rounded-lg border border-[#DDE7EF] object-cover" /> : <div className="grid aspect-square place-items-center rounded-lg bg-[#EEF6FB]"><Package size={42} className="text-[#0878B7]" /></div>}
            <div className="min-w-0 space-y-3"><p className="text-xl font-black text-[#0F2F62]">{fmt(productPreview.effective_price ?? productPreview.price)}</p><p className="text-sm font-semibold text-[#0F172A]">{productPreview.stock_quantity} unit{productPreview.stock_quantity === 1 ? '' : 's'} in stock</p>{productPreview.description && <RichTextBody value={productPreview.description} className="text-sm leading-6 text-slate-600" />}{productPreview.variants?.length > 0 && <label className="block text-xs font-bold text-[#0F2F62]">Size / variant<select value={selectedVariants[productPreview.id] || ''} onChange={(event) => setSelectedVariants((current) => ({ ...current, [productPreview.id]: event.target.value }))} className="mt-1 h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm"><option value="">Select variant</option>{productPreview.variants.map((variant) => <option key={variant.id} value={variant.id} disabled={variant.stock_quantity === 0}>{variant.name} · {variant.stock_quantity} in stock</option>)}</select></label>}<label className="block text-xs font-bold text-[#0F2F62]">Quantity<input type="number" min="1" max={productPreview.stock_quantity} value={draftQty[productPreview.id] || 1} onChange={(event) => setDraftQty((current) => ({ ...current, [productPreview.id]: Math.max(1, Math.min(productPreview.stock_quantity, Number(event.target.value || 1))) }))} className="mt-1 h-11 w-24 rounded-lg border border-[#DDE7EF] px-3 text-sm" /></label></div>
          </div>}
        </Modal>
        {/* Student metric cards */}
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            {
              label: "Available Items",
              value: availableItems.length,
              helper: `${availableUnits} unit${availableUnits === 1 ? "" : "s"} currently in stock`,
              icon: Package,
            },
            {
              label: "My Orders",
              value: ordersMeta.total,
              helper: "Total reservations",
              icon: ShoppingBag,
            },
            {
              label: "Pending Payment",
              value: pendingOrdersTotal,
              helper: "Awaiting payment",
              icon: Ticket,
            },
            {
              label: "My Cart",
              value: cartQuantity,
              helper: `${fmt(cartTotal)} in cart · Open cart`,
              icon: ShoppingBag,
              action: () => setActiveTab("cart"),
            },
          ].map((stat) => {
            const Metric = stat.action ? "button" : "article";
            return <Metric
              {...(stat.action ? { type: "button", onClick: stat.action } : {})}
              key={stat.label}
              className={`group rounded-lg border border-[#DDE7EF] bg-white p-5 text-left shadow-sm ${stat.action ? "transition hover:border-[#0B8ED0] hover:shadow-md" : ""}`}
            >
              <div className="mb-3 grid h-10 w-10 place-items-center rounded-lg bg-[#E6F6FD] text-[#0F2F62] transition group-hover:bg-[#0F2F62] group-hover:text-white">
                <stat.icon size={19} />
              </div>
              <p className="text-sm font-semibold text-slate-500">
                {stat.label}
              </p>
              <p className="mt-1 text-2xl font-black text-[#0F172A]">
                {stat.value}
              </p>
              <p className="mt-1 text-xs font-medium text-slate-500">
                {stat.helper}
              </p>
            </Metric>;
          })}
        </section>

        {/* Order Merchandise tab */}
        {activeTab === "order" && (
          <section className="space-y-5">
            <div className="rounded-lg border border-[#DDE7EF] bg-white p-4 shadow-sm">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px]">
                <label className="flex h-11 items-center gap-2 rounded-lg border border-[#DDE7EF] px-3 focus-within:border-[#0B8ED0] focus-within:ring-4 focus-within:ring-[#16C7F3]/15">
                  <Search size={16} className="shrink-0 text-slate-500" />
                  <span className="sr-only">Search merchandise</span>
                  <input
                    value={studentItemSearch}
                    onChange={(e) => setStudentItemSearch(e.target.value)}
                    type="search"
                    placeholder="Search product, category, or description"
                    className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-slate-500"
                  />
                </label>
                <div className="relative"><SlidersHorizontal size={15} className="pointer-events-none absolute left-3 top-3.5 text-[#0878B7]" aria-hidden="true" /><select
                  aria-label="Filter merchandise category"
                  value={studentCategory}
                  onChange={(event) => setStudentCategory(event.target.value)}
                  className="h-11 w-full rounded-lg border border-[#DDE7EF] bg-white pl-9 pr-3 text-[13px] font-semibold text-slate-600 outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                >
                  {studentCategories.map((category) => (
                    <option key={category} value={category}>
                      {category === "all" ? "All categories" : category}
                    </option>
                  ))}
                </select></div>
                <div className="relative"><Settings2 size={15} className="pointer-events-none absolute left-3 top-3.5 text-[#0878B7]" aria-hidden="true" /><select
                  aria-label="Sort merchandise"
                  value={studentItemSort}
                  onChange={(event) => setStudentItemSort(event.target.value)}
                  className="h-11 w-full rounded-lg border border-[#DDE7EF] bg-white pl-9 pr-3 text-[13px] font-semibold text-slate-600 outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                >
                  <option value="featured">Available first</option>
                  <option value="stock">Most stock</option>
                  <option value="price-low">Price: low to high</option>
                  <option value="price-high">Price: high to low</option>
                </select></div>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#EEF6FB] pt-3">
                <p className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                  <Boxes size={15} className="text-[#0878B7]" />
                  {availableUnits} total units available across {availableItems.length} products
                </p>
                <p className="text-xs font-medium text-slate-500">
                  Stock refreshes after every reservation or cancellation.
                </p>
              </div>
            </div>

            {loading ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div
                    key={i}
                    className="h-96 animate-pulse rounded-lg border border-[#DDE7EF] bg-white"
                  />
                ))}
              </div>
            ) : filteredStudentItems.length === 0 ? (
              <div className="rounded-lg border border-[#DDE7EF] bg-white p-12 text-center">
                <Package size={36} className="mx-auto mb-3 text-slate-200" />
                <p className="text-sm font-bold text-[#0F172A]">
                  No merchandise matches your filters.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setStudentItemSearch("");
                    setStudentCategory("all");
                  }}
                  className="mt-3 text-xs font-bold text-[#0878B7] hover:text-[#0878B7]"
                >
                  Clear search and category
                </button>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {filteredStudentItems.map((item) => (
                  <article
                    key={item.id}
                    className={`group flex min-w-0 flex-col overflow-hidden rounded-lg border bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md ${item.stock_quantity === 0 ? "border-slate-200" : "border-[#DDE7EF] hover:border-[#0B8ED0]/40"}`}
                  >
                    <div className="relative overflow-hidden bg-[#F8FBFD]">
                      {item.image_url ? (
                        <button type="button" onClick={() => setLightbox({ item, index: 0 })} className="block w-full" aria-label={`View ${item.name} images`}><img
                          src={resolveAssetUrl(item.image_url)}
                          alt={item.name}
                          className={`h-48 w-full object-cover transition duration-300 group-hover:scale-[1.02] ${item.stock_quantity === 0 ? "grayscale" : ""}`}
                        /></button>
                      ) : (
                        <div className="flex h-48 items-center justify-center">
                          <Package size={44} className="text-slate-200" />
                        </div>
                      )}
                      <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
                        <span className="rounded-full border border-white/70 bg-white/95 px-2.5 py-1 text-[10px] font-bold uppercase text-[#0F2F62] shadow-sm">
                          {item.category || "Merchandise"}
                        </span>
                        <span
                          className={`shrink-0 rounded-full border border-white/70 px-2.5 py-1 text-[11px] font-extrabold shadow-sm ${item.is_low_stock ? "bg-amber-50 text-amber-700" : stockBadge(item.stock_quantity)}`}
                        >
                          {item.is_low_stock ? "LOW STOCK" : item.stock_quantity === 0 ? "OUT OF STOCK" : `${item.stock_quantity} in stock`}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-1 flex-col p-4">
                      <div className="mb-2 flex flex-wrap gap-1">{item.promotion_available_to_viewer && <span className="rounded-full bg-[#F9EAA6] px-2 py-0.5 text-[10px] font-bold text-[#0F2F62]">FIRST {item.promotion_buyer_limit} BUYERS</span>}<span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">ACTIVE</span></div>
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="min-w-0 font-bold leading-snug text-[#0F172A]">
                          {item.name}
                        </h3>
                        <div className="shrink-0 text-right"><p className="text-lg font-black text-[#0878B7]">{fmt(item.effective_price ?? item.price)}</p>{item.promotion_available_to_viewer && <p className="text-xs text-slate-500"><s>{fmt(item.price)}</s> · {item.promotion_remaining} buyer slots left</p>}</div>
                      </div>
                      {item.description && <RichTextBody value={item.description} className="mt-2 min-h-10 line-clamp-2 text-[12px] leading-5 text-slate-500" />}
                      <button type="button" onClick={() => { setCartError(null); setProductPreview(item); }} className="mt-2 w-fit text-xs font-bold text-[#0878B7] hover:underline">View product details</button>
                      {item.variants?.length > 0 && <label className="mt-3 block text-xs font-semibold text-[#0F2F62]"><FieldIcon label="Size / variant" />Size / variant
                        <select value={selectedVariants[item.id] || ""} onChange={(event) => setSelectedVariants((prev) => ({ ...prev, [item.id]: event.target.value }))} className="mt-1 h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm" aria-label={`Select variant for ${item.name}`}>
                          <option value="">Select variant</option>{item.variants.map((variant) => <option key={variant.id} value={variant.id} disabled={variant.stock_quantity === 0}>{variant.name} · {variant.stock_quantity} available</option>)}
                        </select>
                      </label>}
                      <div className="mt-auto flex items-center gap-2 border-t border-[#EEF6FB] pt-4">
                        <button
                          type="button"
                          onClick={() =>
                            setDraftQty((prev) => ({
                              ...prev,
                              [item.id]: Math.max(
                                1,
                                Number(prev[item.id] || 1) - 1,
                              ),
                            }))
                          }
                          disabled={item.stock_quantity === 0}
                          className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-[#DDE7EF] text-slate-600 hover:bg-[#F8FBFD] disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label={`Decrease quantity for ${item.name}`}
                        >
                          <Minus size={14} />
                        </button>
                        <input
                          type="number"
                          min="1"
                          max={item.stock_quantity}
                          value={draftQty[item.id] || 1}
                          onChange={(e) => {
                            const typed = Number(e.target.value || 1);
                            const safe = Math.max(
                              1,
                              Math.min(item.stock_quantity, typed),
                            );
                            setDraftQty((prev) => ({
                              ...prev,
                              [item.id]: safe,
                            }));
                          }}
                          disabled={item.stock_quantity === 0}
                          className="h-11 w-16 rounded-lg border border-[#DDE7EF] text-center text-sm font-bold outline-none focus:border-[#0B8ED0] disabled:bg-slate-50 disabled:text-slate-500"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setDraftQty((prev) => ({
                              ...prev,
                              [item.id]: Math.min(
                                item.stock_quantity,
                                Number(prev[item.id] || 1) + 1,
                              ),
                            }))
                          }
                          disabled={item.stock_quantity === 0}
                          className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-[#DDE7EF] text-slate-600 hover:bg-[#F8FBFD] disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label={`Increase quantity for ${item.name}`}
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => addToCart(item)}
                        disabled={item.stock_quantity === 0}
                        className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#0878B7] text-[13px] font-bold text-white transition hover:bg-[#0F2F62] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                      >
                        <ShoppingBag size={14} />
                        {item.stock_quantity === 0
                          ? "Currently unavailable"
                          : "Add to Cart"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {activeTab === "cart" && (
          <section className="overflow-hidden rounded-lg border border-[#DDE7EF] bg-white shadow-sm">
            <div className="flex flex-col justify-between gap-3 border-b border-[#DDE7EF] p-5 sm:flex-row sm:items-center">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[#0878B7]">
                  Review your selection
                </p>
                <h2 className="mt-1 text-xl font-extrabold text-[#0F172A]">
                  Your merchandise cart
                </h2>
                <p className="mt-1 text-sm font-medium text-slate-500">
                  Placing an order does not reserve stock. Stock is reserved after payment approval.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab("order")}
                className="h-11 rounded-lg border border-[#DDE7EF] bg-white px-4 text-sm font-bold text-[#0878B7] hover:bg-[#F8FBFD]"
              >
                Continue Shopping
              </button>
            </div>
            {cart.length === 0 ? (
              <div className="p-8 text-center">
                <ShoppingBag
                  size={36}
                  className="mx-auto mb-2 text-slate-200"
                />
                <p className="text-sm font-semibold text-slate-500">
                  Your cart is empty.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab("order")}
                  className="mt-4 rounded-lg bg-[#0878B7] px-5 py-2 text-sm font-bold text-white hover:bg-[#0F2F62] transition"
                >
                  Browse Merchandise
                </button>
              </div>
            ) : (
              <div className="space-y-4 p-5">
                {cart.map((row) => (
                  <div
                    key={cartKey(row.item)}
                    className="flex flex-wrap items-center gap-4 rounded-lg border border-[#DDE7EF] p-4 transition hover:border-[#0B8ED0]/30"
                  >
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-[#F8FBFD]">
                      {row.item.image_url ? (
                        <img
                          src={resolveAssetUrl(row.item.image_url)}
                          alt={row.item.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="grid h-full w-full place-items-center">
                          <Package size={24} className="text-slate-200" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-40 flex-1">
                      <p className="font-bold text-[#0F172A]">
                        {row.item.name}
                      </p>
                      <p className="text-xs text-slate-500">
                          {row.item.variant_name ? `${row.item.variant_name} · ` : ""}{fmt(itemPrice(row.item))} each · {row.item.stock_quantity} available
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          changeCartQty(cartKey(row.item), row.quantity - 1)
                        }
                        className="grid h-9 w-9 place-items-center rounded-lg border border-[#DDE7EF] text-slate-600 hover:bg-[#F8FBFD]"
                        aria-label={`Decrease quantity for ${row.item.name}`}
                      >
                        <Minus size={13} />
                      </button>
                      <span className="w-8 text-center text-sm font-black text-[#0F172A]">
                        {row.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          changeCartQty(cartKey(row.item), row.quantity + 1)
                        }
                        disabled={row.quantity >= row.item.stock_quantity}
                        className="grid h-9 w-9 place-items-center rounded-lg border border-[#DDE7EF] text-slate-600 hover:bg-[#F8FBFD] disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={`Increase quantity for ${row.item.name}`}
                      >
                        <Plus size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeFromCart(cartKey(row.item))}
                        className="ml-1 grid h-9 w-9 place-items-center rounded-lg border border-red-100 text-red-600 hover:bg-red-50"
                        aria-label={`Remove ${row.item.name} from cart`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <p className="min-w-24 text-right text-base font-black text-[#0F172A]">
                      {fmt(toNumber(row.item.price) * row.quantity)}
                    </p>
                  </div>
                ))}
                <div className="flex flex-col gap-4 border-t border-[#DDE7EF] pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold text-slate-500">
                      {cartQuantity} total item{cartQuantity === 1 ? "" : "s"}
                    </p>
                    <p className="mt-1 text-lg font-black text-[#0F172A]">
                      Order total: <span className="text-[#0878B7]">{fmt(cartTotal)}</span>
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        openConfirm({
                          title: "Clear your cart?",
                          message: "Remove every item from this cart? No order has been placed yet.",
                          confirmText: "Clear Cart",
                          danger: true,
                          action: async () => setCart([]),
                        })
                      }
                      className="h-11 rounded-lg border border-[#DDE7EF] px-4 text-xs font-bold text-slate-600 hover:bg-[#F8FBFD]"
                    >
                      Clear Cart
                    </button>
                    <button
                      type="button"
                      onClick={() => setCheckoutOpen(true)}
                      className="h-11 rounded-lg bg-[#0878B7] px-4 text-xs font-bold text-white hover:bg-[#0F2F62]"
                    >
                      Review & Continue
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {/* My Orders tab */}
        {activeTab === "my-orders" && (
          <section className="space-y-4">
            <div className="flex h-10 w-full max-w-sm items-center gap-2 rounded-lg border border-[#DDE7EF] bg-white px-3">
              <Search size={15} className="text-slate-500" />
              <input
                value={studentOrderSearch}
                onChange={(e) => setStudentOrderSearch(e.target.value)}
                type="text"
                placeholder="Search orders or token..."
                className="w-full bg-transparent text-[13px] outline-none placeholder:text-slate-500"
              />
            </div>

            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-24 animate-pulse rounded-lg bg-slate-100"
                  />
                ))}
              </div>
            ) : filteredStudentOrders.length === 0 ? (
              <div className="rounded-lg border border-[#DDE7EF] bg-white p-12 text-center">
                <ShoppingBag
                  size={36}
                  className="mx-auto mb-3 text-slate-200"
                />
                <p className="text-sm font-semibold text-slate-500">
                  {studentOrderSearch.trim() && ordersMeta.total > 0
                    ? "No orders on this page match your search."
                    : "No orders yet. Browse merchandise to place your first order."}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredStudentOrders.map((o) => (
                  <div
                    key={o.id}
                    className={`rounded-lg border bg-white p-5 shadow-sm ${o.status === "claimed" ? "border-emerald-200" : o.status === "paid" ? "border-amber-200" : "border-[#DDE7EF]"}`}
                  >
                    <div className="grid gap-4 lg:grid-cols-[210px_minmax(0,1fr)]">
                    <aside className="rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-4"><p className="mb-4 text-xs font-bold uppercase text-[#0F2F62]">Order status</p>{o.status === 'cancelled' ? <p className="text-sm font-bold text-red-700">Cancelled</p> : <StepTracker status={o.status} />}</aside>
                    <div className="min-w-0 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-[#F8FBFD] sm:h-28 sm:w-28">
                          {(o.variant?.image_url || o.merchandise?.image_url) ? (
                            <img
                              src={resolveAssetUrl(o.variant?.image_url || o.merchandise?.image_url)}
                              alt={o.merchandise?.name ?? "Merchandise"}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="grid h-full w-full place-items-center">
                              <Package size={22} className="text-slate-200" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-mono text-xs font-bold text-slate-500">
                            ORD-{o.id}
                          </p>
                          <p className="mt-0.5 truncate font-bold text-[#0F172A]">
                            {o.merchandise?.name ?? "-"}
                          </p>
                          <p className="text-[13px] text-slate-500">
                            Qty: {o.quantity} · Total: {fmt(o.total_price)}
                          </p>
                          <p className="mt-1 text-[12px] text-slate-500">
                            {fmtDate(o.created_at)}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-bold ${orderBadge[o.status] || "bg-slate-100 text-slate-500"}`}
                        >
                          {o.status === "claimed" ? "CLAIMED" : capitalize(o.status)}
                        </span>
                      </div>
                    </div>
                    {o.status === "paid" && (
                      <ClaimTicket order={o} onPrint={() => printClaimTicket(o)} />
                    )}
                    {o.status === "paid" && (
                      <div className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2">
                        <Info size={14} className="text-amber-600 shrink-0" />
                        <p className="text-[12px] font-semibold text-amber-700">
                          Payment confirmed! Show your token again to collect
                          your item.
                        </p>
                      </div>
                    )}
                    {o.status === "pending" && (
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#EEF6FB] px-3 py-2">
                        <p className="text-[12px] font-semibold text-[#0B1831]">
                          {o.payment_proof_url
                            ? "Payment proof submitted and awaiting officer verification."
                            : gcashSettings?.gcash_qr_url
                              ? "You can submit GCash proof now or pay cash on pickup."
                              : "Pay cash on pickup. GCash is unavailable until the official QR code is configured."}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {gcashSettings?.gcash_qr_url && (
                            <button
                              type="button"
                              onClick={() =>
                                setPaymentModal({
                                  open: true,
                                  order: o,
                                  reference: o.payment_reference || "",
                                  proof_file: null,
                                  busy: false,
                                  error: "",
                                })
                              }
                              className="h-9 rounded-lg bg-[#0878B7] px-3 text-xs font-bold text-white hover:bg-[#0F2F62]"
                            >
                              {o.payment_proof_url
                                ? "Replace Proof"
                                : "Submit GCash Proof"}
                            </button>
                          )}
                          {!o.payment_proof_url &&
                            o.officer_review_status === "pending" &&
                            o.admin_review_status === "pending" && (
                              <button
                                type="button"
                                onClick={() => confirmBuyerCancellation(o)}
                                className="h-9 rounded-lg border border-red-200 bg-white px-3 text-xs font-bold text-[#DC2626] transition hover:bg-red-50"
                              >
                                Cancel Order
                              </button>
                            )}
                        </div>
                      </div>
                    )}
                    {o.status === "cancelled" && (
                      <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-red-600" />
                        <p className="text-[12px] font-semibold text-red-700">
                          {o.review_remarks || "This order was cancelled and its stock was returned."}
                        </p>
                      </div>
                    )}
                    {o.status === "claimed" && (
                      <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2">
                        <CheckCircle
                          size={14}
                          className="text-emerald-600 shrink-0"
                        />
                        <p className="text-[12px] font-semibold text-emerald-700">
                          Item successfully claimed{o.claimed_at ? ` on ${fmtDateTime(o.claimed_at)}` : ""}.
                        </p>
                      </div>
                    )}
                    </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <PaginationControls
              currentPage={ordersMeta.current_page}
              totalItems={ordersMeta.total}
              pageSize={ordersMeta.per_page}
              onPageChange={loadPersonalOrders}
              label="orders"
            />
          </section>
        )}

        {checkoutOpen && (
          <AccessibleOverlay label="Confirm merchandise reservation" onClose={() => !checkoutSubmitting && setCheckoutOpen(false)} className="fixed inset-0 z-[60] flex items-center justify-center bg-[#0B1831]/50 p-4 backdrop-blur-sm">
            <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-lg border border-[#DDE7EF] bg-white p-5 shadow-2xl sm:p-6">
              <p className="text-xs font-bold uppercase tracking-wider text-[#0878B7]">
                Final review
              </p>
              <h2 className="mt-1 text-xl font-extrabold text-[#0F172A]">
                Confirm your reservation
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Check quantities and available stock before choosing payment.
              </p>
              <div className="mt-4 max-h-72 space-y-2 overflow-y-auto rounded-lg border border-[#DDE7EF] p-3">
                {cart.map((row) => (
                  <div
                    key={cartKey(row.item)}
                    className="flex items-center justify-between gap-3 border-b border-[#EEF6FB] pb-2 last:border-b-0 last:pb-0"
                  >
                    <div>
                      <p className="text-sm font-bold text-[#0F172A]">
                        {row.item.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        Qty: {row.quantity} × {fmt(itemPrice(row.item))} · {row.item.stock_quantity} in stock
                      </p>
                    </div>
                    <p className="text-sm font-black text-[#0F172A]">
                      {fmt(toNumber(row.item.price) * row.quantity)}
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-end justify-between rounded-lg bg-[#EEF6FB] px-4 py-3">
                <div>
                  <p className="text-xs font-semibold text-slate-500">Grand total</p>
                  <p className="text-[11px] font-medium text-slate-500">
                    {cartQuantity} item{cartQuantity === 1 ? "" : "s"}
                  </p>
                </div>
                <p className="text-xl font-black text-[#0878B7]">{fmt(cartTotal)}</p>
              </div>
              <div className="mt-4 space-y-3">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">
                   <FieldIcon label="Payment Method" /> Payment Method
                  </label>
                  <select
                    value={checkoutPayment.method}
                    onChange={(e) =>
                      setCheckoutPayment((current) => ({
                        ...current,
                        method: e.target.value,
                      }))
                    }
                    className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]"
                  >
                    <option value="cash">Cash on pickup</option>
                    <option
                      value="gcash"
                      disabled={cart.length > 1 || !gcashSettings?.gcash_qr_url}
                    >
                      GCash (single order only)
                      {!gcashSettings?.gcash_qr_url ? " - unavailable" : ""}
                    </option>
                  </select>
                  {cart.length > 1 && (
                    <p className="mt-1 text-xs text-slate-500">
                      For GCash, checkout one product at a time so every order
                      has its own reference and proof.
                    </p>
                  )}
                  {!gcashSettings?.gcash_qr_url && (
                    <p className="mt-1 text-xs font-medium text-amber-700">
                      GCash is unavailable until an administrator uploads the
                      official payment QR code.
                    </p>
                  )}
                </div>
                {checkoutPayment.method === "gcash" && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {gcashSettings?.gcash_qr_url && (
                      <div className="rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-3 text-center sm:col-span-2">
                        <p className="mb-2 text-xs font-bold text-[#0F172A]">
                          Scan the official HIUSA GCash QR code
                        </p>
                        <img
                          src={resolveAssetUrl(gcashSettings.gcash_qr_url)}
                          alt="Official GCash payment QR code"
                          className="mx-auto max-h-52 max-w-full rounded-md object-contain"
                        />
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <label className="text-[13px] font-semibold text-[#0F172A]">
                       <FieldIcon label="GCash Reference *" /> GCash Reference *
                      </label>
                      <input
                        inputMode="numeric"
                        maxLength={13}
                        value={checkoutPayment.reference}
                        onChange={(e) =>
                          setCheckoutPayment((current) => ({
                            ...current,
                            reference: e.target.value.replace(/\D/g, ""),
                          }))
                        }
                        placeholder="13-digit reference"
                        className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[13px] font-semibold text-[#0F172A]">
                       <FieldIcon label="Payment Proof *" /> Payment Proof *
                      </label>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(e) =>
                          setCheckoutPayment((current) => ({
                            ...current,
                            proof_file: e.target.files?.[0] || null,
                          }))
                        }
                        className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 py-2 text-sm outline-none focus:border-[#0B8ED0]"
                      />
                    </div>
                  </div>
                )}
              </div>
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-3">
                <Info size={15} className="mt-0.5 shrink-0 text-[#0878B7]" />
                <p className="text-[11px] font-medium leading-5 text-[#0B1831]">
                  Submitting reserves the stock. You may cancel later from My Orders only while the order remains unpaid and unreviewed.
                </p>
              </div>
              <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setCheckoutOpen(false)}
                  className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD]"
                  disabled={checkoutSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitCartOrders}
                  className="h-11 rounded-lg bg-[#0878B7] px-5 text-sm font-bold text-white transition hover:bg-[#0F2F62] disabled:opacity-50"
                  disabled={checkoutSubmitting}
                >
                  {checkoutSubmitting ? "Reserving..." : "Place Reservation"}
                </button>
              </div>
            </div>
          </AccessibleOverlay>
        )}

        {paymentModal.open && (
          <AccessibleOverlay label="Submit GCash payment" onClose={() => !paymentModal.busy && setPaymentModal({ open: false, order: null, reference: "", proof_file: null, busy: false, error: "" })} className="fixed inset-0 z-[70] flex items-center justify-center bg-[#0B1831]/50 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-lg border border-[#DDE7EF] bg-white p-6 shadow-2xl">
              <h2 className="text-lg font-bold text-[#0F172A]">
                Submit GCash Payment
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Order ORD-{paymentModal.order?.id} ·{" "}
                {fmt(paymentModal.order?.total_price)}
              </p>
              <div className="mt-4 space-y-3">
                {gcashSettings?.gcash_qr_url && (
                  <div className="rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-3 text-center">
                    <p className="mb-2 text-xs font-bold text-[#0F172A]">
                      Pay using the official HIUSA GCash QR code
                    </p>
                    <img
                      src={resolveAssetUrl(gcashSettings.gcash_qr_url)}
                      alt="Official GCash payment QR code"
                      className="mx-auto max-h-44 max-w-full rounded-md object-contain"
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">
                   <FieldIcon label="13-digit GCash Reference" /> 13-digit GCash Reference
                  </label>
                  <input
                    inputMode="numeric"
                    maxLength={13}
                    value={paymentModal.reference}
                    onChange={(e) =>
                      setPaymentModal((current) => ({
                        ...current,
                        reference: e.target.value.replace(/\D/g, ""),
                        error: "",
                      }))
                    }
                    className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">
                   <FieldIcon label="Payment Proof" /> Payment Proof
                  </label>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) =>
                      setPaymentModal((current) => ({
                        ...current,
                        proof_file: e.target.files?.[0] || null,
                        error: "",
                      }))
                    }
                    className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 py-2 text-sm"
                  />
                </div>
                {paymentModal.error && (
                  <p className="text-xs font-semibold text-red-600">
                    {paymentModal.error}
                  </p>
                )}
              </div>
              <div className="mt-5 flex justify-end gap-3">
                <button
                  type="button"
                  disabled={paymentModal.busy}
                  onClick={() =>
                    setPaymentModal({
                      open: false,
                      order: null,
                      reference: "",
                      proof_file: null,
                      busy: false,
                      error: "",
                    })
                  }
                  className="h-11 rounded-lg border border-[#DDE7EF] px-4 text-sm font-bold text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={paymentModal.busy}
                  onClick={handlePaymentSubmission}
                  className="h-11 rounded-lg bg-[#0878B7] px-4 text-sm font-bold text-white disabled:opacity-50"
                >
                  {paymentModal.busy ? "Submitting..." : "Submit Payment"}
                </button>
              </div>
            </div>
          </AccessibleOverlay>
        )}

        <ConfirmModal
          open={confirmModal.open}
          title={confirmModal.title}
          message={confirmModal.message}
          confirmText={confirmModal.confirmText}
          busy={confirmModal.busy}
          danger={confirmModal.danger}
          onCancel={closeConfirm}
          onConfirm={async () => {
            if (!confirmModal.action) return;
            setConfirmModal((prev) => ({ ...prev, busy: true }));
            try {
              await confirmModal.action();
              closeConfirm();
            } catch (requestError) {
              showFeedback(
                "error",
                requestError.response?.data?.message ||
                  "The requested action could not be completed.",
              );
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
      {activeTab === "inventory" && (
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Total Items",
            value: items.length,
            helper: "In inventory",
            icon: Package,
          },
          {
            label: "Low Stock",
            value: lowStock,
            helper: "Needs restocking",
            icon: AlertTriangle,
          },
          {
            label: "Active Orders",
            value: activeOrders,
            helper: "Pending fulfillment",
            icon: ShoppingBag,
          },
          {
            label: "Revenue",
            value: fmt(totalRevenue),
            helper: "From paid orders",
            icon: PhilippinePeso,
          },
        ].map((stat) => (
          <article
            key={stat.label}
            className="group rounded-lg border border-[#DDE7EF] bg-white p-5 shadow-sm transition hover:border-[#0B8ED0]/20 hover:shadow-md"
          >
            <div className="mb-3 grid h-10 w-10 place-items-center rounded-lg bg-[#E6F6FD] text-[#0F2F62] transition group-hover:bg-[#0F2F62] group-hover:text-white">
              <stat.icon size={19} />
            </div>
            <p className="text-sm font-semibold text-slate-500">{stat.label}</p>
            <p className="mt-1 text-2xl font-black text-[#0F172A]">
              {stat.value}
            </p>
            <p className="mt-1 text-xs font-medium text-slate-500">
              {stat.helper}
            </p>
          </article>
        ))}
      </section>
      )}

      {activeTab === "inventory" && (
        <section className="rounded-xl border border-[#DDE7EF] bg-white p-4 shadow-sm">
          <h2 className="text-sm font-bold text-[#0F2F62]">Top sellers</h2>
          {topSellers.length === 0 ? <p className="mt-2 text-sm text-slate-500">No paid merchandise sales yet.</p> : <>
            <div className="mt-4 grid grid-cols-3 items-end gap-2 rounded-lg bg-[#EEF6FB] p-3 sm:gap-4">{[1, 0, 2].map((rank) => {
              const seller = topSellers[rank];
              return seller ? <div key={`${seller.id}-${rank}`} className="text-center"><div className="mb-2 flex h-8 items-center justify-center text-[#0F2F62]">{rank === 0 ? <Crown size={26} aria-label="First place" /> : <span className="text-sm font-bold">#{rank + 1}</span>}</div><div className="truncate text-xs font-bold text-[#0F172A]" title={seller.name}>{seller.name}</div><div className={`mt-2 flex flex-col items-center justify-center rounded-t-lg bg-[#0F2F62] px-1 text-white ${rank === 0 ? 'h-28' : rank === 1 ? 'h-20' : 'h-16'}`}><span className="text-lg font-black tabular-nums">{seller.quantity}</span><span className="text-[10px]">sold</span></div></div> : <div key={rank} />;
            })}</div>
            <ol className="mt-3 space-y-2">{topSellers.map((seller, index) => <li key={`${seller.id}-${index}`} className="flex items-center gap-3 rounded-lg border border-[#DDE7EF] px-3 py-2 text-xs"><strong className="w-6 text-[#0878B7]">#{index + 1}</strong><span className="min-w-0 flex-1 truncate font-semibold text-[#0F2F62]">{seller.name}</span><span className="text-slate-500">{fmt(seller.collected)} collected</span><strong className="tabular-nums text-[#0F2F62]">{seller.quantity} sold</strong></li>)}</ol>
          </>}
        </section>
      )}

      {activeTab === "inventory" && (
        <section className="rounded-lg border border-[#DDE7EF] bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-[#DDE7EF] p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-[#0F172A]">
                Product catalog
              </h2>
              <p className="text-sm font-medium text-slate-500">
                Manage stock levels and product catalog
              </p>
            </div>
            <div className="flex w-full gap-2 sm:w-auto">
              <div className="relative min-w-0"><SlidersHorizontal size={14} className="pointer-events-none absolute left-3 top-3 text-[#0878B7]" aria-hidden="true" /><select aria-label="Filter inventory by category" value={inventoryCategory} onChange={(event) => setInventoryCategory(event.target.value)} className="h-10 w-full min-w-0 rounded-lg border border-[#DDE7EF] bg-white pl-8 pr-3 text-xs font-semibold text-[#0F2F62] focus-visible:outline-2 focus-visible:outline-[#16C7F3]"><option value="all">All categories</option>{inventoryCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select></div>
              <div className="flex h-10 flex-1 items-center gap-2 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-3 sm:flex-none">
                <Search size={15} className="text-slate-500" />
                <input
                  value={inventorySearch}
                  onChange={(e) => setInventorySearch(e.target.value)}
                  type="text"
                  placeholder="Search items..."
                  className="w-full bg-transparent text-[13px] outline-none placeholder:text-slate-500 sm:w-[140px]"
                />
              </div>
              {role === "ADMIN" && <button
                onClick={() => setShowForm(true)}
                className="flex h-10 items-center gap-2 rounded-lg bg-[#0878B7] px-4 text-[13px] font-bold text-white hover:bg-[#0F2F62] transition"
              >
                <Plus size={16} />
                <span className="hidden sm:inline">Add Product</span>
              </button>}
            </div>
          </div>
          {loading ? (
            <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div
                  key={i}
                  className="h-64 animate-pulse rounded-lg bg-slate-100"
                />
              ))}
            </div>
          ) : filteredInventoryItems.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-500">
              No inventory items yet.
            </p>
          ) : (
            <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-3">
              {filteredInventoryItems.map((item) => (
                <article
                  key={item.id}
                  className={`rounded-xl border bg-white p-4 shadow-sm ${item.is_low_stock ? "border-amber-300" : "border-[#DDE7EF]"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex items-center gap-3">
                      {item.image_url ? (
                        <button type="button" onClick={() => setLightbox({ item, index: 0 })} aria-label={`View ${item.name} images`}><img
                          src={resolveAssetUrl(item.image_url)}
                          alt={item.name}
                          className="h-14 w-14 rounded-lg border border-[#DDE7EF] object-cover"
                        /></button>
                      ) : (
                        <div className="grid h-14 w-14 place-items-center rounded-lg bg-[#E6F6FD]">
                          <Package size={20} className="text-[#0878B7]" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-[#0F172A]">
                          {item.name}
                        </p>
                        <p className="text-xs font-medium text-slate-500">
                          {item.promotion_available_to_viewer ? <><strong className="text-[#0878B7]">{fmt(item.effective_price)}</strong> <s>{fmt(item.price)}</s> · {item.promotion_remaining} slots left</> : `${fmt(item.price)} per unit`}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {item.category && (
                        <span className="rounded-full bg-[#EEF6FB] px-2 py-0.5 text-[10px] font-bold text-[#0F2F62]">
                          {item.category}
                        </span>
                      )}
                      {(item.is_low_stock || item.stock_quantity === 0) && <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${item.stock_quantity === 0 ? stockBadge(0) : "bg-amber-50 text-amber-700"}`}
                      >
                        {item.stock_quantity === 0 ? "Out of Stock" : "Low Stock"}
                      </span>}
                    </div>
                  </div>

                  {item.variants?.length > 0 && <p className="mt-2 text-xs text-slate-600">{item.variants.map((variant) => `${variant.name}: ${variant.stock_quantity}`).join(" · ")}</p>}
                  {role === "ADMIN" && <button type="button" onClick={async () => { try { const response = await getMerchandiseAuditLogs(item.id); setAuditModal({ item, logs: response.data }); } catch { showFeedback("error", "Could not load product history."); } }} className="mt-2 text-xs font-semibold text-[#0878B7] hover:underline">View audit history</button>}

                  <div className="mt-3 rounded-lg bg-[#F8FBFD] px-3 py-2">
                    <p className="text-xs font-medium text-slate-500">
                      In stock:
                    </p>
                    <p
                      className={`text-2xl font-black ${item.stock_quantity < 10 ? "text-red-600" : "text-[#0F172A]"}`}
                    >
                      {item.stock_quantity} units
                    </p>
                  </div>

                  {role === "ADMIN" && <div className="mt-3 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => openAddStockModal(item)}
                      className="rounded-full bg-[#EEF6FB] px-3 py-1 text-xs font-bold text-[#0F2F62] transition hover:bg-[#E6F6FD]"
                    >
                      Add Stock
                    </button>
                    <button type="button" role="switch" aria-checked={item.is_active} aria-label={`Selling status for ${item.name}`} onClick={() => confirmSellingToggle(item)} className="inline-flex items-center gap-2 text-xs font-bold text-[#0F2F62]"><span>{item.is_active ? "ACTIVE" : "INACTIVE"}</span><span className={`relative h-6 w-11 rounded-full transition ${item.is_active ? "bg-emerald-600" : "bg-slate-400"}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition ${item.is_active ? "left-6" : "left-1"}`} /></span></button>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openEditForm(item)}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-[#DDE7EF] px-2 text-[11px] font-bold text-[#0878B7] transition hover:bg-[#F8FBFD]"
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
                  </div>}
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === "orders" && (
        <section aria-label="Order management" className="min-w-0 space-y-4">
          {orderSummary && (
            <dl aria-label="Order summary" className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[#DDE7EF] bg-[#DDE7EF] lg:grid-cols-4">
              {[
                ["Pending review", orderSummary.pending_orders, `${fmt(orderSummary.outstanding_balance)} awaiting approval`],
                ["Ready for pickup", orderSummary.unclaimed_orders, "Approved orders with active tokens"],
                ["Claimed", orderSummary.claimed_orders, "Orders released to buyers"],
                ["Collected", fmt(orderSummary.total_collected), `${orderSummary.paid_orders} paid orders`],
              ].map(([label, value, helper]) => (
                <div key={label} className="min-w-0 bg-white px-4 py-3">
                  <dt className="text-xs font-medium text-slate-600">{label}</dt>
                  <dd className="mt-1 text-xl font-bold tabular-nums text-[#0F172A]">{value}</dd>
                  <dd className="mt-1 text-xs text-slate-500">{helper}</dd>
                </div>
              ))}
            </dl>
          )}
          <div className="min-w-0 overflow-hidden rounded-lg border border-[#DDE7EF] bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-[#0F172A]">Order queue</h2>
                <span className="text-xs tabular-nums text-slate-500">{loading ? "Loading..." : `${ordersMeta.total} ${ordersMeta.total === 1 ? "order" : "orders"}`}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setShowPaymentSettings(true)} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#DDE7EF] px-3 text-xs font-semibold text-slate-600 hover:bg-[#F8FBFD]">
                  <Settings2 size={15} /> {role === "ADMIN" ? "Payment settings" : "View GCash QR"}
                </button>
                <button type="button" onClick={handleOrderExport} disabled={exportingOrders} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#DDE7EF] px-3 text-xs font-semibold text-slate-600 hover:bg-[#F8FBFD] disabled:opacity-50">
                  <Download size={15} /> {exportingOrders ? "Exporting..." : "Export CSV"}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DDE7EF] px-4">
              <div role="group" aria-label="Filter orders by status" className="flex max-w-full gap-4 overflow-x-auto">
                {[
                  ["", "All orders"],
                  ["pending", "Pending review"],
                  ["paid", "Ready for pickup"],
                  ["claimed", "Claimed"],
                  ["cancelled", "Cancelled"],
                ].map(([status, label]) => (
                  <button key={status} type="button" aria-pressed={orderFilters.status === status} onClick={() => setOrderFilters((current) => ({ ...current, status }))} className={`min-h-11 shrink-0 border-b-2 px-1 text-xs font-semibold transition-colors ${orderFilters.status === status ? "border-[#0878B7] text-[#0F2F62]" : "border-transparent text-slate-500 hover:text-[#0F172A]"}`}>{label}</button>
                ))}
              </div>
              <button type="button" aria-expanded={showAdvancedFilters} aria-controls="order-advanced-filters" onClick={() => setShowAdvancedFilters((value) => !value)} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-xs font-semibold text-slate-600 hover:bg-[#F8FBFD]">
                <SlidersHorizontal size={15} /> More filters
                {activeOrderFilterCount > 0 && <span className="rounded-full bg-[#EEF6FB] px-1.5 py-0.5 text-[10px] text-[#0F2F62]">{activeOrderFilterCount}</span>}
              </button>
            </div>
            <div className="border-b border-[#DDE7EF] p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_200px_170px]">
              <label className="relative min-w-0 sm:col-span-2 lg:col-span-1">
                <span className="sr-only">Search merchandise orders</span>
                <Search
                  size={15}
                  className="absolute left-3 top-3.5 text-slate-500"
                />
                <input
                  value={orderFilters.search}
                  onChange={(event) =>
                    setOrderFilters({
                      ...orderFilters,
                      search: event.target.value,
                    })
                  }
                  placeholder="Search order, student, item, reference..."
                  className="h-11 w-full rounded-lg border border-[#DDE7EF] pl-9 pr-3 text-sm outline-none focus:border-[#0B8ED0]"
                />
              </label>
              <select
                aria-label="Merchandise item"
                value={orderFilters.merchandise_id}
                onChange={(event) =>
                  setOrderFilters({
                    ...orderFilters,
                    merchandise_id: event.target.value,
                  })
                }
                className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm"
              >
                <option value="">All merchandise</option>
                {orderFilterOptions.merchandise?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Sort orders"
                value={orderFilters.sort}
                onChange={(event) =>
                  setOrderFilters({ ...orderFilters, sort: event.target.value })
                }
                className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="amount_high">Highest amount</option>
                <option value="amount_low">Lowest amount</option>
                <option value="student">Student name</option>
                <option value="item">Merchandise item</option>
                <option value="status">Order status</option>
              </select>
            </div>
            {showAdvancedFilters && (
              <div id="order-advanced-filters" className="mt-4 border-t border-[#DDE7EF] pt-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
                  <select
                    aria-label="Program or course"
                    value={orderFilters.program}
                    onChange={(event) =>
                      setOrderFilters({
                        ...orderFilters,
                        program: event.target.value,
                        year_level: "",
                        section: "",
                      })
                    }
                    className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm"
                  >
                    <option value="">All programs</option>
                    {orderFilterOptions.programs?.map((program) => (
                      <option key={program.id} value={program.name}>
                        {program.name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Major or specialization"
                    value={orderFilters.major}
                    onChange={(event) =>
                      setOrderFilters({
                        ...orderFilters,
                        major: event.target.value,
                      })
                    }
                    className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm"
                  >
                    <option value="">All majors</option>
                    {orderFilterOptions.majors?.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                  <select
                    aria-label="Year level"
                    value={orderFilters.year_level}
                    disabled={!orderFilters.program}
                    onChange={(event) =>
                      setOrderFilters({
                        ...orderFilters,
                        year_level: event.target.value,
                        section: "",
                      })
                    }
                    className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm disabled:bg-slate-100"
                  >
                    <option value="">All year levels</option>
                    {["1st Year", "2nd Year", "3rd Year", "4th Year"].map(
                      (year) => (
                        <option key={year}>{year}</option>
                      ),
                    )}
                  </select>
                  <select
                    aria-label="Section"
                    value={orderFilters.section}
                    disabled={!orderFilters.program || !orderFilters.year_level}
                    onChange={(event) =>
                      setOrderFilters({
                        ...orderFilters,
                        section: event.target.value,
                      })
                    }
                    className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm disabled:bg-slate-100"
                  >
                    <option value="">All sections</option>
                    {availableSections.map((section) => (
                      <option key={section.id} value={section.name}>
                        {section.name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="User role"
                    value={orderFilters.role}
                    onChange={(event) =>
                      setOrderFilters({
                        ...orderFilters,
                        role: event.target.value,
                      })
                    }
                    className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm"
                  >
                    <option value="">All user roles</option>
                    {orderFilterOptions.roles?.map((value) => (
                      <option key={value} value={value}>
                        {value.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="SBO position"
                    value={orderFilters.position_title}
                    onChange={(event) =>
                      setOrderFilters({
                        ...orderFilters,
                        position_title: event.target.value,
                      })
                    }
                    className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm"
                  >
                    <option value="">All SBO positions</option>
                    {orderFilterOptions.positions?.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                  <select
                    aria-label="Payment method"
                    value={orderFilters.payment_method}
                    onChange={(event) =>
                      setOrderFilters({
                        ...orderFilters,
                        payment_method: event.target.value,
                      })
                    }
                    className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm"
                  >
                    <option value="">All payment methods</option>
                    {orderFilterOptions.payment_methods?.map((value) => (
                      <option key={value}>{value.toUpperCase()}</option>
                    ))}
                  </select>
                  <div className="flex h-11 items-center rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-3 text-xs font-bold text-slate-500">
                    10 rows per page
                  </div>
                  {[
                    ["ordered_from", "Ordered from"],
                    ["ordered_to", "Ordered to"],
                    ["paid_from", "Paid from"],
                    ["paid_to", "Paid to"],
                    ["claimed_from", "Claimed from"],
                    ["claimed_to", "Claimed to"],
                  ].map(([key, label]) => (
                    <label
                      key={key}
                      className="text-[11px] font-bold text-slate-500"
                    >
                      {label}
                      <input
                        type="date"
                        value={orderFilters[key]}
                        onChange={(event) =>
                          setOrderFilters({
                            ...orderFilters,
                            [key]: event.target.value,
                          })
                        }
                        className="mt-1 h-10 w-full rounded-lg border border-[#DDE7EF] px-2 text-xs"
                      />
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setOrderFilters(EMPTY_ORDER_FILTERS)}
                  className="mt-3 text-xs font-bold text-[#0878B7] hover:text-[#0878B7]"
                >
                  Clear all filters
                </button>
              </div>
            )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DDE7EF] px-4 py-2">
              <p className="text-xs text-slate-500">Open an order to review payment and pickup details.</p>
              <div role="group" aria-label="Order queue view" className="flex rounded-lg border border-[#DDE7EF] p-0.5">
                {[["auto", "Auto"], ["table", "Table"], ["cards", "Cards"]].map(([view, label]) => (
                  <button key={view} type="button" aria-pressed={orderQueueView === view} onClick={() => setOrderQueueView(view)} className={`min-h-10 rounded-md px-3 text-xs font-bold ${orderQueueView === view ? "bg-[#0F2F62] text-white" : "text-[#0F2F62]"}`}>{label}</button>
                ))}
              </div>
            </div>
            {loading ? (
              <div className="space-y-2 p-5">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-12 animate-pulse rounded-lg bg-slate-100"
                  />
                ))}
              </div>
            ) : filteredOfficerOrders.length === 0 ? (
              <p className="p-8 text-center text-sm text-slate-500">
                {activeOrderFilterCount > 0 ? "No orders match these filters." : "No orders yet."}
              </p>
            ) : (
              <>
              <div className={`${orderQueueView === 'table' ? 'hidden' : orderQueueView === 'cards' ? 'grid gap-3 p-3 sm:grid-cols-2' : 'grid gap-3 p-3 xl:hidden'}`}>
                {filteredOfficerOrders.map((order) => (
                  <FulfillmentOrderRow
                    key={order.id}
                    order={order}
                    role={role}
                    onDetails={openOrderDetails}
                    onApprove={openPaymentVerification}
                    onReject={openOrderRejection}
                  />
                ))}
              </div>
              <div className={`${orderQueueView === 'cards' ? 'hidden' : orderQueueView === 'table' ? 'overflow-x-auto' : 'hidden overflow-x-auto xl:block'}`}>
                <table className="w-full min-w-[1100px] text-left">
                  <thead className="bg-[#F8FBFD] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Order / Reference</th>
                      <th className="px-4 py-3">Student / User</th>
                      <th className="px-4 py-3">Role</th>
                      <th className="hidden px-4 py-3">Academic Profile</th>
                      <th className="px-5 py-3">Item</th>
                      <th className="px-4 py-3">Amount</th>
                      <th className="px-4 py-3">Quantity</th>
                      <th className="px-4 py-3">Total</th>
                      <th className="px-4 py-3">Mode of payment</th>
                      <th className="hidden px-4 py-3">Review Trail</th>
                      <th className="px-4 py-3">Fulfillment</th>
                      <th className="hidden px-4 py-3">Dates</th>
                      <th className="px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#DDE7EF] text-sm">
                    {filteredOfficerOrders.map((o) => (
                      <tr key={o.id} className="transition hover:bg-[#F8FBFD]">
                        <td className="px-4 py-4">
                          <p className="font-mono text-xs font-black text-[#0878B7]">
                            ORD-{o.id}
                          </p>
                          <p className="mt-1 text-[10px] text-slate-500">
                            {o.transaction?.receipt_reference || (o.payment_method === 'cash' ? 'Cash payment' : o.payment_reference || 'Reference pending')}
                          </p>
                        </td>
                        <td className="px-4 py-4">
                          <p className="text-left font-semibold text-[#0F172A]">
                            {o.student
                              ? `${o.student.first_name} ${o.student.last_name}`
                              : "-"}
                          </p>
                          <p className="mt-0.5 font-mono text-[10px] text-slate-500">{o.student?.school_id}</p>
                          {o.student?.position_title && (
                            <p className="text-[10px] font-semibold text-[#0878B7]">
                              {o.student.position_title}
                            </p>
                          )}
                          <p className="mt-1 max-w-52 truncate text-[10px] text-slate-500">
                            {[o.student?.program, o.student?.year_level, o.student?.section]
                              .filter(Boolean)
                              .join(" · ") || "No academic profile"}
                          </p>
                        </td>
                        <td className="px-4 py-4 text-xs font-semibold text-[#0F2F62]">{(o.student?.role || '-').replaceAll('_', ' ')}{o.student?.position_title && <p className="mt-1 text-[10px] text-[#64748B]">{o.student.position_title}</p>}</td>
                        <td className="hidden px-4 py-4 text-xs">
                          <p className="font-semibold text-slate-700">
                            {o.student?.program || "Program not recorded"}
                          </p>
                          <p className="mt-0.5 text-slate-500">
                            {[
                              o.student?.major,
                              o.student?.year_level,
                              o.student?.section,
                            ]
                              .filter(Boolean)
                              .join(" · ") || "No year/section"}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            {o.student?.department || "Department not recorded"}
                          </p>
                        </td>
                        <td className="px-4 py-4">
                          <p className="font-semibold text-slate-700">
                            {o.merchandise?.name ?? "-"}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            {o.merchandise?.category || "Uncategorized"} ·{" "}
                            {fmt(o.unit_price ?? Number(o.total_price) / Number(o.quantity || 1))} each
                          </p>
                        </td>
                        <td className="px-4 py-4 font-semibold tabular-nums">{fmt(o.unit_price ?? Number(o.total_price) / Number(o.quantity || 1))}</td>
                        <td className="px-4 py-4 font-semibold tabular-nums">{o.quantity}</td>
                        <td className="px-4 py-4 font-black tabular-nums text-[#0878B7]">{fmt(o.total_price)}</td>
                        <td className="px-4 py-4 text-xs">
                          <p className="font-bold uppercase text-slate-600">
                            {o.payment_method || "Not selected"}
                          </p>
                          {o.payment_method !== 'cash' && <p className="mt-1 text-slate-500">{o.payment_reference || 'Reference pending'}</p>}
                          <span
                            className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${["paid", "claimed"].includes(o.status) ? "bg-emerald-50 text-emerald-700" : o.status === "cancelled" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}
                          >
                            {["paid", "claimed"].includes(o.status)
                              ? "Paid"
                              : o.status === "cancelled"
                                ? "Cancelled"
                                : "Pending"}
                          </span>
                          <div className="mt-2 flex flex-wrap gap-1">
                            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${reviewTone(o.officer_review_status)}`}>
                              Officer: {capitalize(o.officer_review_status)}
                            </span>
                            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${reviewTone(o.admin_review_status)}`}>
                              Admin: {capitalize(o.admin_review_status)}
                            </span>
                          </div>
                        </td>
                        <td className="hidden px-4 py-4 text-[10px] text-slate-500">
                          <p>
                            <strong>Officer:</strong>{" "}
                            {capitalize(o.officer_review_status)}
                          </p>
                          <p>
                            <strong>Admin:</strong>{" "}
                            {capitalize(o.admin_review_status)}
                          </p>
                          <p className="mt-1">
                            <strong>Processed:</strong>{" "}
                            {o.processor
                              ? `${o.processor.first_name} ${o.processor.last_name}`
                              : "-"}
                          </p>
                          <p>
                            <strong>Approved:</strong>{" "}
                            {o.approver
                              ? `${o.approver.first_name} ${o.approver.last_name}`
                              : "-"}
                          </p>
                        </td>
                        <td className="px-4 py-4">
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-bold ${orderBadge[o.status] || "bg-slate-100 text-slate-500"}`}
                          >
                            {capitalize(o.status)}
                          </span>
                          <p className="mt-2 text-[10px] text-slate-500">
                            Released by{" "}
                            {o.claim_verifier
                              ? `${o.claim_verifier.first_name} ${o.claim_verifier.last_name}`
                              : "-"}
                          </p>
                          {o.status === "paid" && o.claim_token && (
                            <div className="mt-2 rounded-lg border border-[#DDE7EF] bg-[#EEF6FB] px-2.5 py-2">
                              <p className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-[#0878B7]">
                                <Ticket size={11} /> Claim token
                              </p>
                              <p className="mt-1 font-mono text-xs font-black tracking-wide text-[#0B1831]">
                                {o.claim_token}
                              </p>
                            </div>
                          )}
                        </td>
                        <td className="hidden px-4 py-4 text-[10px] text-slate-500">
                          <p>
                            <strong>Ordered:</strong> {fmtDate(o.created_at)}
                          </p>
                          <p>
                            <strong>Paid:</strong>{" "}
                            {fmtDate(o.transaction?.transaction_date)}
                          </p>
                          <p>
                            <strong>Claimed:</strong> {fmtDate(o.claimed_at)}
                          </p>
                        </td>
                        <td className="px-4 py-4">
                          <TableRowActions subject={`Order ${o.id}`} label="Order actions" actions={[
                            { label: 'Review order', icon: Search, onClick: () => openOrderDetails(o) },
                            o.status === 'pending' && { label: role === 'ADMIN' ? 'Approve directly' : 'Verify & submit', icon: ArrowRight, onClick: () => setVerificationModal({ open: true, order: o, amount: String(o.total_price), busy: false, error: '' }) },
                            o.status === 'pending' && { label: 'Reject order', icon: X, danger: true, onClick: () => setRejectionModal({ open: true, order: o, remarks: '', busy: false, error: '' }) },
                          ]} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </>
            )}
            {ordersMeta.total > ordersMeta.per_page && (
              <div className="flex items-center justify-between border-t border-[#DDE7EF] px-5 py-3">
                <p className="text-xs font-medium text-slate-500">
                  Showing{" "}
                  <span className="font-bold text-slate-600">
                    {ordFrom}-{ordTo}
                  </span>{" "}
                  of{" "}
                  <span className="font-bold text-slate-600">
                    {ordersMeta.total}
                  </span>
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => loadOrders(ordersMeta.current_page - 1)}
                    disabled={ordersMeta.current_page === 1}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-[#DDE7EF] text-slate-500 transition hover:bg-[#F8FBFD] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span className="px-2 text-[13px] font-bold tabular-nums text-[#0F172A]">
                    {ordersMeta.current_page} / {ordersMeta.last_page}
                  </span>
                  <button
                    onClick={() => loadOrders(ordersMeta.current_page + 1)}
                    disabled={ordersMeta.current_page === ordersMeta.last_page}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-[#DDE7EF] text-slate-500 transition hover:bg-[#F8FBFD] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
          {orderSummary && (
              <div className="flex flex-col gap-3 px-1 py-2 text-xs sm:flex-row sm:items-center sm:justify-between">
                <p className="text-slate-500">
                  <span className="font-bold text-[#0F172A]">Cohort:</span>{" "}
                  {orderSummary.purchased_users} of {orderSummary.total_users} users purchased ({orderSummary.purchase_rate}%).
                </p>
                <div className="flex flex-wrap gap-3">
                  <button type="button" onClick={() => openOrderAnalytics("purchased", "Purchased users")} className="font-bold text-[#0878B7] hover:text-[#0878B7]">
                    View purchasers
                  </button>
                  <button type="button" onClick={() => openOrderAnalytics("not_purchased", "Users without purchases")} className="font-bold text-slate-600 hover:text-[#0878B7]">
                    View non-buyers
                  </button>
                </div>
              </div>
          )}
        </section>
      )}

      <Modal
        open={showPaymentSettings}
        title={role === "ADMIN" ? "GCash payment settings" : "GCash payment QR"}
        description="The official QR image shown to buyers who choose GCash at checkout."
        onClose={() => !paymentSettingsBusy && setShowPaymentSettings(false)}
        closeOnBackdrop={!paymentSettingsBusy}
        closeOnEscape={!paymentSettingsBusy}
        maxWidth="max-w-2xl"
      >
        <GcashPaymentSettingsPage embedded showHeading={false} readOnly={role !== "ADMIN"} onBusyChange={setPaymentSettingsBusy} />
      </Modal>

      {analyticsModal.open && (
        <AccessibleOverlay label="Merchandise analytics details" onClose={() => setAnalyticsModal({ open: false, title: "", loading: false, users: [], error: "", group: "", currentPage: 1, totalUsers: 0 })} className="fixed inset-0 z-[80] flex items-center justify-center bg-[#0B1831]/55 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-7xl overflow-hidden rounded-lg border border-[#DDE7EF] bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-[#DDE7EF] p-5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#0878B7]">
                  Merchandise drill-down
                </p>
                <h2 className="mt-1 text-xl font-black text-[#0F172A]">
                  {analyticsModal.title}
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Users and matching orders for the active cohort filters.
                </p>
                <button type="button" onClick={exportOrderAnalytics} disabled={exportingAnalytics || analyticsModal.loading} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#DDE7EF] px-3 text-xs font-bold text-[#0878B7] disabled:opacity-50"><Download size={14} /> {exportingAnalytics ? 'Exporting...' : 'Export Excel'}</button>
              </div>
              <button
                type="button"
                aria-label="Close drill-down"
                onClick={() =>
                  setAnalyticsModal({
                    open: false,
                    title: "",
                    loading: false,
                    users: [],
                    error: "",
                    group: "",
                    currentPage: 1,
                    totalUsers: 0,
                  })
                }
                className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-[#F8FBFD]"
              >
                <X size={18} />
              </button>
            </div>
            <div className="max-h-[72vh] overflow-auto">
              {analyticsModal.loading ? (
                <div className="space-y-3 p-5">
                  {[1, 2, 3, 4].map((row) => (
                    <div
                      key={row}
                      className="h-16 animate-pulse rounded-lg bg-slate-100"
                    />
                  ))}
                </div>
              ) : analyticsModal.error ? (
                <p className="m-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {analyticsModal.error}
                </p>
              ) : analyticsModal.users.length === 0 ? (
                <p className="p-12 text-center text-sm text-slate-500">
                  No users match this drill-down.
                </p>
              ) : (
                <>
                <table className="w-full min-w-[1680px] text-left text-xs">
                  <thead className="sticky top-0 bg-[#F8FBFD] text-[10px] font-bold uppercase text-slate-500">
                    <tr>
                      {[
                        "Student ID",
                        "Full Name",
                        "Department",
                        "Program / Major",
                        "Year / Section",
                        "Role / Position",
                        "Item",
                        "Qty",
                        "Unit Price",
                        "Total",
                        "Payment",
                        "Order",
                        "Ordered",
                        "Paid",
                        "Claimed",
                        "Approved / Released By",
                        "Reference",
                      ].map((label) => (
                        <th key={label} className="px-3 py-3">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#DDE7EF]">
                    {pagedAnalyticsRows.map(({ user, order }, index) => (
                        <tr
                          key={`${user.school_id}-${order?.id || index}`}
                          className="hover:bg-[#F8FBFD]"
                        >
                          <td className="px-3 py-3 font-mono">
                            {user.school_id}
                          </td>
                          <td className="px-3 py-3 font-bold text-[#0F172A]">
                            {user.first_name} {user.last_name}
                            <p className="font-normal text-slate-500">
                              {user.email}
                            </p>
                          </td>
                          <td className="px-3 py-3">
                            {user.department || "-"}
                          </td>
                          <td className="px-3 py-3">
                            {user.program || "-"}
                            <p className="text-slate-500">
                              {user.major || "No major"}
                            </p>
                          </td>
                          <td className="px-3 py-3">
                            {user.year_level || "-"} · {user.section || "-"}
                          </td>
                          <td className="px-3 py-3">
                            {(user.role || "").replaceAll("_", " ")}
                            <p className="text-[#0878B7]">
                              {user.position_title || "-"}
                            </p>
                          </td>
                          <td className="px-3 py-3 font-semibold">
                            {order?.merchandise?.name || "Did not purchase"}
                          </td>
                          <td className="px-3 py-3">
                            {order?.quantity ?? "-"}
                          </td>
                          <td className="px-3 py-3">
                            {order ? fmt(order.merchandise?.price) : "-"}
                          </td>
                          <td className="px-3 py-3 font-bold">
                            {order ? fmt(order.total_price) : "-"}
                          </td>
                          <td className="px-3 py-3">
                            {order?.payment_method || "-"}
                            <p className="text-slate-500">
                              {order?.payment_reference || "-"}
                            </p>
                          </td>
                          <td className="px-3 py-3">
                            {capitalize(order?.status)}
                          </td>
                          <td className="px-3 py-3">
                            {fmtDate(order?.created_at)}
                          </td>
                          <td className="px-3 py-3">
                            {fmtDate(order?.transaction?.transaction_date)}
                          </td>
                          <td className="px-3 py-3">
                            {fmtDate(order?.claimed_at)}
                          </td>
                          <td className="px-3 py-3">
                            {order?.approver
                              ? `${order.approver.first_name} ${order.approver.last_name}`
                              : "-"}
                            <p className="text-slate-500">
                              {order?.claim_verifier
                                ? `${order.claim_verifier.first_name} ${order.claim_verifier.last_name}`
                                : "-"}
                            </p>
                          </td>
                          <td className="px-3 py-3 font-mono">
                            {order?.transaction?.receipt_reference ||
                              order?.payment_reference ||
                              "-"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                <PaginationControls
                  currentPage={analyticsRowPage}
                  totalItems={analyticsRows.length}
                  pageSize={10}
                  onPageChange={setAnalyticsRowPage}
                  label="drill-down rows"
                />
                <PaginationControls
                  currentPage={analyticsModal.currentPage}
                  totalItems={analyticsModal.totalUsers}
                  pageSize={10}
                  onPageChange={(nextPage) =>
                    openOrderAnalytics(
                      analyticsModal.group,
                      analyticsModal.title,
                      nextPage,
                    )
                  }
                  label="matching users"
                />
                </>
              )}
            </div>
          </div>
        </AccessibleOverlay>
      )}

      {orderDetails && (
        <AccessibleOverlay label="Merchandise order details" onClose={() => setOrderDetails(null)} className="fixed inset-0 z-[80] flex items-center justify-center bg-[#0B1831]/55 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg border border-[#DDE7EF] bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#0878B7]">
                  Order record
                </p>
                <h2 className="mt-1 text-xl font-black text-[#0F172A]">
                  ORD-{orderDetails.id} · {orderDetails.merchandise?.name}
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Complete user, payment, approval, and fulfillment information.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close order details"
                onClick={() => setOrderDetails(null)}
                className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-[#F8FBFD]"
              >
                <X size={18} />
              </button>
            </div>
            <div className="mt-5"><ReceiptDocument order={orderDetails} onViewProof={handleViewPaymentProof} /></div>
            <section className="mt-5 border-t border-[#DDE7EF] pt-5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#0878B7]">
                  Review trail
                </p>
                <h3 className="mt-1 text-base font-black text-[#0F172A]">
                  Order activity history
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  A permanent record of payment review and fulfillment actions.
                </p>
              </div>
              {orderReviewTrail.loading ? (
                <div className="mt-4 space-y-2">
                  {[1, 2, 3].map((row) => (
                    <div
                      key={row}
                      className="h-16 animate-pulse rounded-lg bg-slate-100"
                    />
                  ))}
                </div>
              ) : orderReviewTrail.error ? (
                <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {orderReviewTrail.error}
                </p>
              ) : orderReviewTrail.entries.length === 0 ? (
                <p className="mt-4 rounded-lg border border-dashed border-[#DDE7EF] p-4 text-center text-sm text-slate-500">
                  No review actions have been recorded yet.
                </p>
              ) : (
                <ol className="mt-4 space-y-3">
                  {orderReviewTrail.entries.map((entry) => (
                    <li
                      key={entry.id}
                      className="relative rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-4 pl-11"
                    >
                      <span className="absolute left-4 top-5 h-3 w-3 rounded-full border-2 border-white bg-[#0878B7] ring-2 ring-[#DDE7EF]" />
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-sm font-bold text-[#0F172A]">
                            {reviewActionLabel(entry.action)}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {entry.user
                              ? `${entry.user.first_name} ${entry.user.last_name}`
                              : "System"}
                            {entry.user?.position_title
                              ? ` · ${entry.user.position_title}`
                              : entry.user?.role
                                ? ` · ${entry.user.role.replaceAll("_", " ")}`
                                : ""}
                          </p>
                        </div>
                        <time className="text-[11px] font-semibold text-slate-500">
                          {fmtDateTime(entry.created_at)}
                        </time>
                      </div>
                      {entry.new_values?.review_remarks && (
                        <p className="mt-2 rounded-md bg-white px-3 py-2 text-xs text-slate-600">
                          Remarks: {entry.new_values.review_remarks}
                        </p>
                      )}
                      {entry.old_values?.status && entry.old_values.status !== entry.new_values?.status && <p className="mt-1 text-xs text-slate-600">Status: {capitalize(entry.old_values.status)} → {capitalize(entry.new_values?.status)}</p>}
                      {entry.new_values?.variant_name && <p className="mt-1 text-xs text-slate-600">Variant: {entry.new_values.variant_name}</p>}
                      {entry.new_values?.total_price !== undefined && <p className="mt-1 text-xs text-slate-600">Order total: {fmt(entry.new_values.total_price)}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        </AccessibleOverlay>
      )}

      {activeTab === "tokens" && isFulfillmentRole && (
        <section className="space-y-4">
          <div className="rounded-lg border border-[#DDE7EF] bg-white p-4 shadow-sm sm:p-5">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#E6F6FD] text-[#0F2F62]">
                <Ticket size={19} />
              </span>
              <div>
                <h2 className="text-lg font-bold text-[#0F172A]">
                  Validate a claim token
                </h2>
                <p className="mt-1 text-sm font-medium text-slate-500">
                  Match the buyer and item below, then confirm before releasing merchandise.
                </p>
              </div>
            </div>
            <form onSubmit={handleClaim} className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
              <label htmlFor="claim-token" className="min-w-0 flex-1 text-xs font-bold text-[#0F172A]">
               <FieldIcon label="16-character claim token" /> 16-character claim token
              <input
                id="claim-token"
                maxLength={16}
                value={claimToken}
                onChange={(e) => {
                  setClaimToken(
                    e.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase(),
                  );
                  setClaimError(null);
                }}
                placeholder="16-character token"
                className="mt-1.5 h-11 w-full rounded-lg border border-[#DDE7EF] px-3 font-mono text-sm uppercase tracking-wider outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
              />
              </label>
              <button
                type="submit"
                disabled={claiming || !claimToken.trim()}
                className="flex h-11 items-center justify-center gap-2 rounded-lg bg-[#0878B7] px-5 text-sm font-bold text-white transition hover:bg-[#0F2F62] disabled:opacity-50"
              >
                <Ticket size={16} />
                {claiming ? "Checking..." : "Claim"}
              </button>
            </form>
          </div>

          <div className="rounded-lg border border-[#DDE7EF] bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#DDE7EF] p-5">
              <div>
              <h2 className="text-lg font-bold text-[#0F172A]">
                Token register
              </h2>
              <p className="text-sm font-medium text-slate-500">
                Review pending and claimed tokens.
              </p>
              </div>
              <div className="relative"><Ticket size={15} className="pointer-events-none absolute left-3 top-3.5 text-[#0878B7]" aria-hidden="true" /><select aria-label="Filter claim tokens by status" value={tokenStatusFilter} onChange={(event) => setTokenStatusFilter(event.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] bg-white pl-9 pr-3 text-sm"><option value="paid">Pending claim</option><option value="claimed">Claimed</option></select></div>
            </div>
            {loading ? (
              <div className="space-y-2 p-5">
                {[1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-12 animate-pulse rounded-lg bg-slate-100"
                  />
                ))}
              </div>
            ) : tokenOrders.length === 0 ? (
              <p className="p-8 text-center text-sm text-slate-500">
                No tokens match this status.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1050px] text-left">
                  <thead className="bg-[#F8FBFD] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Order</th>
                      <th className="px-4 py-3">Purchaser</th>
                      <th className="px-4 py-3">Section</th>
                      <th className="px-4 py-3">Department</th>
                      <th className="px-4 py-3">Course / program</th>
                      <th className="px-4 py-3">Payment mode</th>
                      <th className="px-4 py-3">Number of items</th>
                      <th className="px-4 py-3">Status / token</th>
                      <th className="px-4 py-3">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#DDE7EF] text-sm">
                    {tokenOrders.map((o) => (
                      <tr key={o.id} className="transition hover:bg-[#F8FBFD]">
                        <td className="px-4 py-4 font-mono text-xs font-black text-[#0878B7]">ORD-{o.id}</td>
                        <td className="px-4 py-4 font-semibold text-[#0F172A]">
                          {o.student
                            ? `${o.student.first_name} ${o.student.last_name}`
                            : "-"}
                        </td>
                        <td className="px-4 py-4">{o.student?.section || "-"}</td>
                        <td className="px-4 py-4">{o.student?.department || "-"}</td>
                        <td className="px-4 py-4">{o.student?.program || "-"}</td>
                        <td className="px-4 py-4 uppercase">{o.payment_method || "-"}</td>
                        <td className="px-4 py-4 font-bold">{o.quantity}</td>
                        <td className="px-4 py-4"><span className={`rounded-full px-2 py-1 text-xs font-bold ${o.status === 'claimed' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{o.status === 'claimed' ? 'Claimed' : 'Pending claim'}</span><br /><span className="font-mono text-xs">{o.claim_token || '-'}</span></td>
                        <td className="px-4 py-4"><TableRowActions subject={`Order ${o.id}`} label="Order actions" actions={[{ label: 'Review order', icon: Search, onClick: () => openOrderDetails(o) }]} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <PaginationControls
              currentPage={ordersMeta.current_page}
              totalItems={ordersMeta.total}
              pageSize={ordersMeta.per_page}
              onPageChange={(page) => loadOrders(page, { ...EMPTY_ORDER_FILTERS, status: tokenStatusFilter, sort: "oldest" })}
              label="paid orders"
            />
          </div>
        </section>
      )}

      {claimPreview && (
        <AccessibleOverlay label="Verify claim before release" onClose={() => !claiming && setClaimPreview(null)} className="fixed inset-0 z-[80] flex items-center justify-center bg-[#0B1831]/55 p-4">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-5 shadow-2xl">
            <h2 className="text-lg font-black text-[#0F172A]">Verify purchaser and release</h2>
            <p className="mt-1 text-sm text-slate-600">Check the school ID and items with the purchaser. Release finalizes this token.</p>
            <div className="mt-4"><ReceiptDocument order={claimPreview} onViewProof={handleViewPaymentProof} releasingOfficer={(() => { try { const user = JSON.parse(localStorage.getItem("user")); return [user?.first_name, user?.last_name].filter(Boolean).join(" ") || "Current officer"; } catch { return "Current officer"; } })()} /></div>
            {claimError && <p className="mt-3 text-sm font-semibold text-red-700">{claimError}</p>}
            <div className="mt-5 flex flex-wrap justify-end gap-3"><button type="button" disabled={claiming} onClick={() => setClaimPreview(null)} className="min-h-11 rounded-lg border border-[#DDE7EF] px-4 text-sm font-bold">Cancel</button><button type="button" disabled={claiming} onClick={() => handleClaimByToken(claimPreview.claim_token)} className="min-h-11 rounded-lg bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">{claiming ? "Releasing..." : "Confirm Claim / Release"}</button></div>
          </div>
        </AccessibleOverlay>
      )}

      {showForm && (
        <AccessibleOverlay label="Add merchandise product" onClose={() => { if (!formSubmitting) { setShowForm(false); setImageFile(null); setImagePreview(null); } }} className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#0F172A]">Add Product</h2>
              <button
                onClick={() => {
                  setShowForm(false);
                  setImageFile(null);
                  setImagePreview(null);
                }}
                className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-[#F8FBFD]"
              >
                <X size={18} />
              </button>
            </div>
            <form className="space-y-4" onSubmit={handleAddItem}>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">
                 <FieldIcon label="Item Name *" /> Item Name *
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. HIUSA T-Shirt (XL)"
                  className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                />
              </div>
              <CatalogFields value={form} onChange={setForm} images={variantImages} onImagesChange={setVariantImages} />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">
                   <FieldIcon label="Unit Price (₱) *" /> Unit Price (₱) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.unit_price}
                    onChange={(e) =>
                      setForm({ ...form, unit_price: e.target.value })
                    }
                    placeholder="0.00"
                    className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">
                   <FieldIcon label="Initial Stock *" /> Initial Stock *
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={form.stock_quantity}
                    disabled={form.variants.length > 0}
                    onChange={(e) =>
                      setForm({ ...form, stock_quantity: e.target.value })
                    }
                    placeholder="0"
                    className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">
                 <FieldIcon label="Description" /> Description
                </label>
                <RichTextEditor
                  rows={2}
                  value={form.description}
                  onChange={(description) =>
                    setForm({ ...form, description })
                  }
                  placeholder="Optional description..."
                  ariaLabel="Product description"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">
                 <FieldIcon label="Selling Status" /> Selling Status
                </label>
                <select
                  value={form.is_active ? "1" : "0"}
                  onChange={(e) =>
                    setForm({ ...form, is_active: e.target.value === "1" })
                  }
                  className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                >
                  <option value="1">Active</option>
                  <option value="0">Inactive</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">
                 <FieldIcon label="Product Image" /> Product Image
                </label>
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-[#DDE7EF] bg-[#F8FBFD] py-4 transition hover:border-[#0B8ED0]/50 hover:bg-[#F8FBFD]">
                  {imagePreview ? (
                    <img
                      src={imagePreview}
                      alt="Preview"
                      className="h-24 w-24 rounded-lg object-cover"
                    />
                  ) : (
                    <>
                      <ImagePlus size={24} className="mb-1 text-slate-300" />
                      <span className="text-[13px] font-semibold text-slate-500">
                        Click to upload
                      </span>
                      <span className="text-[11px] text-slate-300">
                        JPG, PNG, WebP (max 5MB)
                      </span>
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleImageSelect}
                    className="sr-only"
                  />
                </label>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setImageFile(null);
                    setImagePreview(null);
                  }}
                  className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    formSubmitting ||
                    !form.name ||
                    !form.unit_price ||
                    (!form.stock_quantity && !form.variants.length) || !form.category
                  }
                  className="h-11 rounded-lg bg-[#0878B7] px-5 text-sm font-bold text-white transition hover:bg-[#0F2F62] disabled:opacity-50"
                >
                  {formSubmitting ? "Adding..." : "Add Product"}
                </button>
              </div>
            </form>
          </div>
        </AccessibleOverlay>
      )}

      <ProductImageViewer lightbox={lightbox} onChange={setLightbox} onClose={() => setLightbox(null)} />

      {auditModal && <AccessibleOverlay label={`${auditModal.item.name} audit history`} onClose={() => setAuditModal(null)} className="fixed inset-0 z-[70] flex items-center justify-center bg-[#0B1831]/50 p-4">
        <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 shadow-2xl"><div className="flex items-center justify-between gap-2"><h2 className="font-bold text-[#0F2F62]">{auditModal.item.name} history</h2><button type="button" onClick={() => setAuditModal(null)} aria-label="Close audit history" className="grid h-10 w-10 place-items-center rounded-lg hover:bg-slate-100"><X size={18} /></button></div>{auditModal.logs.length === 0 ? <p className="mt-4 text-sm text-slate-500">No recorded changes yet.</p> : <ol className="mt-4 space-y-3">{auditModal.logs.map((log) => <li key={log.id} className="rounded-lg border border-[#DDE7EF] p-3 text-xs"><div className="flex flex-wrap justify-between gap-1"><strong className="capitalize text-[#0F2F62]">{log.action.replaceAll("_", " ")}</strong><time className="text-slate-500">{fmtDateTime(log.created_at)}</time></div><p className="mt-1 text-slate-600">{log.user ? `${log.user.first_name} ${log.user.last_name}` : log.user_id || "System"} · {log.actor_role || log.user?.role || ""}</p>{log.new_values?.note && <p className="mt-1">Note: {log.new_values.note}</p>}{log.old_values?.stock_quantity !== undefined && <p className="mt-1">Stock: {log.old_values.stock_quantity} → {log.new_values?.stock_quantity}{log.new_values?.variant_name ? ` · ${log.new_values.variant_name}` : ""}</p>}{log.old_values?.price !== undefined && log.old_values.price !== log.new_values?.price && <p className="mt-1">Price: {fmt(log.old_values.price)} → {fmt(log.new_values?.price)}</p>}</li>)}</ol>}</div>
      </AccessibleOverlay>}

      {showEditForm && (
        <AccessibleOverlay label="Edit merchandise product" onClose={() => !formSubmitting && closeEditForm()} className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#0F172A]">Edit Product</h2>
              <button
                onClick={closeEditForm}
                className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-[#F8FBFD]"
              >
                <X size={18} />
              </button>
            </div>
            <form className="space-y-4" onSubmit={handleUpdateItem}>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">
                 <FieldIcon label="Item Name *" /> Item Name *
                </label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) =>
                    setEditForm({ ...editForm, name: e.target.value })
                  }
                  placeholder="e.g. HIUSA T-Shirt (XL)"
                  className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                />
              </div>
              <CatalogFields value={editForm} onChange={setEditForm} images={variantImages} onImagesChange={setVariantImages} />
              <label className="block text-[13px] font-semibold text-[#0F172A]"><FieldIcon label="Stock change reason" />Stock change reason
                <textarea value={editForm.stock_note || ""} onChange={(event) => setEditForm({ ...editForm, stock_note: event.target.value })} maxLength={500} rows={2} placeholder="Required when changing product or variant stock" className="mt-1 w-full rounded-lg border border-[#DDE7EF] px-3 py-2 text-sm" />
              </label>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">
                   <FieldIcon label="Unit Price (₱) *" /> Unit Price (₱) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editForm.unit_price}
                    onChange={(e) =>
                      setEditForm({ ...editForm, unit_price: e.target.value })
                    }
                    placeholder="0.00"
                    className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">
                   <FieldIcon label="Stock *" /> Stock *
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={editForm.stock_quantity}
                    disabled={editForm.variants.length > 0}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        stock_quantity: e.target.value,
                      })
                    }
                    placeholder="0"
                    className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">
                 <FieldIcon label="Description" /> Description
                </label>
                <RichTextEditor
                  rows={2}
                  value={editForm.description}
                  onChange={(description) =>
                    setEditForm({ ...editForm, description })
                  }
                  placeholder="Optional description..."
                  ariaLabel="Product description"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">
                 <FieldIcon label="Selling Status" /> Selling Status
                </label>
                <select
                  value={editForm.is_active ? "1" : "0"}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      is_active: e.target.value === "1",
                    })
                  }
                  className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                >
                  <option value="1">Active</option>
                  <option value="0">Inactive</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">
                 <FieldIcon label="Product Image" /> Product Image
                </label>
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-[#DDE7EF] bg-[#F8FBFD] py-4 transition hover:border-[#0B8ED0]/50 hover:bg-[#F8FBFD]">
                  {editImagePreview ? (
                    <img
                      src={editImagePreview}
                      alt="Preview"
                      className="h-24 w-24 rounded-lg object-cover"
                    />
                  ) : (
                    <>
                      <ImagePlus size={24} className="mb-1 text-slate-300" />
                      <span className="text-[13px] font-semibold text-slate-500">
                        Click to upload
                      </span>
                      <span className="text-[11px] text-slate-300">
                        JPG, PNG, WebP (max 5MB)
                      </span>
                    </>
                  )}
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
                <button
                  type="button"
                  onClick={closeEditForm}
                  className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    formSubmitting ||
                    !editForm.name ||
                    !editForm.unit_price ||
                    (!editForm.stock_quantity && !editForm.variants.length) || !editForm.category
                  }
                  className="h-11 rounded-lg bg-[#0878B7] px-5 text-sm font-bold text-white transition hover:bg-[#0F2F62] disabled:opacity-50"
                >
                  {formSubmitting ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </AccessibleOverlay>
      )}

      {verificationModal.open && verificationModal.order && (
        <AccessibleOverlay label="Verify merchandise payment" onClose={() => !verificationModal.busy && setVerificationModal({ open: false, order: null, amount: "", busy: false, error: "" })} className="fixed inset-0 z-[65] flex items-center justify-center bg-[#0B1831]/50 p-4 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-extrabold text-[#0F172A]">
              {role === "ADMIN"
                ? "Approve Payment Directly"
                : "Verify Payment Amount"}
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {role === "ADMIN"
                ? "Approve this order without waiting for an SBO Officer review. "
                : ""}
              Confirm the payment for ORD-{verificationModal.order.id} matches{" "}
              {fmt(verificationModal.order.total_price)}.
            </p>
            <div className="mt-4"><ReceiptDocument order={verificationModal.order} onViewProof={handleViewPaymentProof} /></div>
            {verificationModal.order.payment_method === "gcash" && !verificationModal.order.payment_proof_url && (
              <p className="mt-3 text-xs font-semibold text-red-600">
                No payment proof is attached.
              </p>
            )}
            <div className="mt-4 space-y-1.5">
              <label htmlFor="verified-order-amount" className="text-[13px] font-semibold text-[#0F172A]">
               <FieldIcon label="Amount verified" /> Amount verified
              </label>
              <input
                id="verified-order-amount"
                type="number"
                min="0.01"
                step="0.01"
                value={verificationModal.amount}
                onChange={(e) =>
                  setVerificationModal((current) => ({
                    ...current,
                    amount: e.target.value,
                    error: "",
                  }))
                }
                className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]"
              />
            </div>
            {verificationModal.error && (
              <p className="mt-2 text-xs font-semibold text-red-600">
                {verificationModal.error}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() =>
                  setVerificationModal({
                    open: false,
                    order: null,
                    amount: "",
                    busy: false,
                    error: "",
                  })
                }
                disabled={verificationModal.busy}
                className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePaymentVerification}
                disabled={
                  verificationModal.busy ||
                  (verificationModal.order.payment_method === "gcash" &&
                    !verificationModal.order.payment_proof_url)
                }
                className="h-11 rounded-lg bg-emerald-600 px-5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {verificationModal.busy
                  ? "Submitting..."
                  : role === "ADMIN"
                    ? "Approve Payment"
                    : "Verify & Submit"}
              </button>
            </div>
          </div>
        </AccessibleOverlay>
      )}

      {rejectionModal.open && rejectionModal.order && (
        <AccessibleOverlay label="Reject merchandise payment" onClose={() => !rejectionModal.busy && setRejectionModal({ open: false, order: null, remarks: "", busy: false })} className="fixed inset-0 z-[65] flex items-center justify-center bg-[#0B1831]/50 p-4 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-extrabold text-[#0F172A]">
              Reject Payment
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Provide the reason for rejecting order ORD-
              {rejectionModal.order.id}.
            </p>
            <div className="mt-4"><ReceiptDocument order={rejectionModal.order} onViewProof={handleViewPaymentProof} /></div>
            <label htmlFor="rejection-reason" className="mt-4 block text-sm font-semibold text-[#0F172A]"><FieldIcon label="Rejection reason" />Rejection reason</label>
            <textarea
              id="rejection-reason"
              rows={4}
              maxLength={1000}
              required
              value={rejectionModal.remarks}
              onChange={(e) =>
                setRejectionModal((current) => ({
                  ...current,
                  remarks: e.target.value,
                  error: "",
                }))
              }
              className="mt-4 w-full rounded-lg border border-[#DDE7EF] px-3 py-2.5 text-sm outline-none focus:border-[#0B8ED0]"
              placeholder="Rejection reason"
            />
            {rejectionModal.error && <p className="mt-2 text-sm font-semibold text-red-700">{rejectionModal.error}</p>}
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() =>
                  setRejectionModal({
                    open: false,
                    order: null,
                    remarks: "",
                    busy: false,
                    error: "",
                  })
                }
                disabled={rejectionModal.busy}
                className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={rejectionModal.busy || !rejectionModal.remarks.trim()}
                onClick={async () => {
                  setRejectionModal((current) => ({ ...current, busy: true }));
                  try {
                    await handleStatusChange(rejectionModal.order.id, "cancelled", rejectionModal.remarks.trim());
                    setRejectionModal({ open: false, order: null, remarks: "", busy: false });
                  } catch (requestError) {
                    setRejectionModal((current) => ({ ...current, busy: false, error: requestError.response?.data?.message || "Payment rejection failed." }));
                  }
                }}
                className="h-11 rounded-lg bg-red-600 px-5 text-sm font-bold text-white disabled:opacity-50"
              >
                {rejectionModal.busy ? "Rejecting..." : "Reject Payment"}
              </button>
            </div>
          </div>
        </AccessibleOverlay>
      )}

      <ConfirmModal
        open={confirmModal.open}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmText={confirmModal.confirmText}
        busy={confirmModal.busy}
        danger={confirmModal.danger}
        onCancel={closeConfirm}
        onConfirm={async () => {
          if (!confirmModal.action) return;
          setConfirmModal((prev) => ({ ...prev, busy: true }));
          try {
            await confirmModal.action();
            closeConfirm();
          } catch (requestError) {
            showFeedback(
              "error",
              requestError.response?.data?.message ||
                "The requested action could not be completed.",
            );
          } finally {
            setConfirmModal((prev) => ({ ...prev, busy: false }));
          }
        }}
      />

      <AddStockModal
        open={stockModal.open}
        itemName={stockModal.item?.name || ""}
        quantity={stockModal.quantity}
        note={stockModal.note}
        variants={stockModal.item?.variants}
        variantId={stockModal.variantId}
        busy={confirmModal.busy}
        onQuantityChange={(quantity) =>
          setStockModal((prev) => ({ ...prev, quantity }))
        }
        onNoteChange={(note) => setStockModal((prev) => ({ ...prev, note }))}
        onVariantChange={(variantId) => setStockModal((prev) => ({ ...prev, variantId }))}
        onCancel={closeAddStockModal}
        onConfirm={confirmAddStock}
      />
    </div>
  );
}
