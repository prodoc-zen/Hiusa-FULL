import { filterValues, matchesFilter } from '../../../utils/filterValues';
import HiusaSelect from '../../../components/ui/Select';
import { formatDisplayText } from '../../../utils/displayText.js';
import { manilaDateStamp } from '../../../utils/dateTime';
import RichTextEditor, { RichTextBody } from '../../../components/RichText';
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button, DataTable, Drawer, EmptyState, FlowStepper, Field, Input, NextStep, PageHeader, SkeletonCard, SkeletonTable, StatusBadge, Textarea } from "../../../components/ui";
import { orderLifecycle, toNextStepProps } from "../../../lib/lifecycle";
import useRecordParam from "../../../lib/useRecordParam";
import TableRowActions from "../../../components/TableRowActions";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  ImagePlus,
  Minus,
  Package,
  Pencil,
  Plus,
  Search,
  Settings2,
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
  getOrder,
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
    <Field label="Category" required>
      <HiusaSelect value={categoryIsCustom ? "Other" : value.category} onChange={(event) => onChange({ ...value, category: event.target.value === "Other" ? "" : event.target.value, category_custom: event.target.value === "Other" })}>
        <option value="">Select category</option>
        {CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
      </HiusaSelect>
    </Field>
    {categoryIsCustom && <Field label="Category name" required>
      <Input value={value.category} onChange={(event) => onChange({ ...value, category: event.target.value, category_custom: true })} placeholder="Enter category name" />
    </Field>}
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Low stock at or below" optional>
        <Input type="number" min="1" value={value.low_stock_threshold ?? "9"} onChange={(event) => onChange({ ...value, low_stock_threshold: event.target.value })} />
      </Field>
      <Field label="Promo price" optional>
        <Input type="number" min="0" step="0.01" value={value.promotion_price ?? ""} onChange={(event) => onChange({ ...value, promotion_price: event.target.value })} />
      </Field>
      <Field label="First buyers" optional>
        <Input type="number" min="1" value={value.promotion_buyer_limit ?? ""} onChange={(event) => onChange({ ...value, promotion_buyer_limit: event.target.value })} placeholder="e.g. 100" />
      </Field>
    </div>
    <section className="space-y-3 border-t border-line pt-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">Sizes and variants</h3>
          <p className="text-xs text-ink-muted">Add sizes for wearable items. Each has its own stock and optional image.</p>
        </div>
        <Button type="button" variant="secondary" size="sm" className="shrink-0" onClick={() => { onChange({ ...value, variants: [...variants, { name: "", stock_quantity: 0 }] }); onImagesChange([...images, null]); }}>Add variant</Button>
      </div>
      {variants.map((variant, index) => <div key={variant.id || `new-${index}`} className="grid gap-2 sm:grid-cols-[1fr_5rem_auto_auto] sm:items-center">
        <div><Input list="merchandise-size-options" value={variant.name} onChange={(event) => changeVariant(index, { name: event.target.value })} placeholder="Size / variant" aria-label={`Variant ${index + 1} name`} /><datalist id="merchandise-size-options">{STANDARD_SIZES.map((size) => <option key={size} value={size} />)}</datalist></div>
        <Input type="number" min="0" value={variant.stock_quantity} onChange={(event) => changeVariant(index, { stock_quantity: event.target.value })} aria-label={`${formatDisplayText(variant.name) || `Variant ${index + 1}`} stock`} />
        <label className="inline-flex h-11 cursor-pointer items-center justify-center rounded-control border border-line px-3 text-xs font-semibold text-ink hover:bg-subtle">{images[index] ? "Image selected" : variant.image_url ? "Change image" : "Add image"}<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => onImagesChange(images.map((file, imageIndex) => imageIndex === index ? event.target.files[0] : file))} /></label>
        <button type="button" aria-label={`Remove ${formatDisplayText(variant.name) || `variant ${index + 1}`}`} onClick={() => { onChange({ ...value, variants: variants.filter((_, rowIndex) => rowIndex !== index) }); onImagesChange(images.filter((_, rowIndex) => rowIndex !== index)); }} className="grid h-11 w-11 place-items-center rounded-control text-danger-strong hover:bg-danger-tint"><X size={16} aria-hidden="true" /></button>
      </div>)}
      {variants.length > 0 && <p className="text-xs font-semibold text-ink">Total variant stock: {variants.reduce((sum, row) => sum + (Number(row.stock_quantity) || 0), 0)}</p>}
    </section>
  </>;
}

function ProductImageViewer({ lightbox, onChange, onClose }) {
  if (!lightbox) return null;
  const images = [lightbox.item.image_url, ...(lightbox.item.variants || []).map((variant) => variant.image_url)].filter(Boolean);
  if (!images.length) return null;
  const imageIndex = Math.min(lightbox.index, images.length - 1);
  return <AccessibleOverlay label={`${lightbox.item.name} images`} onClose={onClose} className="fixed inset-0 z-[75] flex items-center justify-center bg-navy-950/85 p-4">
    <div className="w-full max-w-3xl rounded-card bg-white p-4"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold text-ink">{formatDisplayText(lightbox.item.name)}</h2><button type="button" onClick={onClose} aria-label="Close image viewer" className="grid h-11 w-11 place-items-center rounded-control hover:bg-subtle"><X size={20} /></button></div><img src={resolveAssetUrl(images[imageIndex])} alt={`${formatDisplayText(lightbox.item.name)} image ${imageIndex + 1}`} className="mt-3 max-h-[65vh] w-full rounded-control bg-subtle object-contain" />{images.length > 1 && <div className="mt-3 flex items-center justify-center gap-3"><button type="button" onClick={() => onChange({ ...lightbox, index: (imageIndex - 1 + images.length) % images.length })} aria-label="Previous image" className="grid h-11 w-11 place-items-center rounded-control border border-line"><ChevronLeft size={20} /></button><span className="text-sm text-ink-muted">{imageIndex + 1} of {images.length}</span><button type="button" onClick={() => onChange({ ...lightbox, index: (imageIndex + 1) % images.length })} aria-label="Next image" className="grid h-11 w-11 place-items-center rounded-control border border-line"><ChevronRight size={20} /></button></div>}</div>
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

const ORDER_TONE = {
  pending: "active",
  paid: "warning",
  claimed: "success",
  cancelled: "danger",
};

function OrderStatus({ status }) {
  return <StatusBadge tone={ORDER_TONE[status] || "neutral"} label={capitalize(status)} />;
}

// One summary tile. It is a link when it has a route and a button when it only switches the tab on this
// page, so every tile is something the viewer can open.
function StatTile({ label, value, context, to, onClick }) {
  const body = (
    <>
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums text-ink">{value}</p>
      {context && <p className="mt-1.5 text-xs text-ink-muted">{context}</p>}
    </>
  );
  const className = "block w-full rounded-card border border-line bg-surface p-4 text-left transition-colors duration-150 hover:bg-subtle";
  if (to) return <Link to={to} onClick={onClick} className={className}>{body}</Link>;
  return <button type="button" onClick={onClick} className={className}>{body}</button>;
}

function ProductForm({ editing = false, value, onChange, images, onImagesChange, preview, onImage, submitDisabled, submitLabel, onSubmit, onCancel }) {
  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <Field label="Item name" required>
        <Input type="text" value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} placeholder="e.g. HIUSA T-Shirt (XL)" />
      </Field>
      <CatalogFields value={value} onChange={onChange} images={images} onImagesChange={onImagesChange} />
      {editing && (
        <Field label="Stock change reason">
          <Textarea value={value.stock_note || ""} onChange={(event) => onChange({ ...value, stock_note: event.target.value })} maxLength={500} rows={2} placeholder="Required when changing product or variant stock" />
        </Field>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Unit price (₱)" required>
          <Input type="number" min="0" step="0.01" value={value.unit_price} onChange={(event) => onChange({ ...value, unit_price: event.target.value })} placeholder="0.00" />
        </Field>
        <Field label="Available to order" hint="Units held by unpaid orders are already taken out." required>
          <Input type="number" min="0" value={value.stock_quantity} disabled={value.variants.length > 0} onChange={(event) => onChange({ ...value, stock_quantity: event.target.value })} placeholder="0" />
        </Field>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink">Description<span className="ml-1 font-normal text-ink-muted">(optional)</span></span>
        <RichTextEditor rows={2} value={value.description} onChange={(description) => onChange({ ...value, description })} placeholder="Describe the item" ariaLabel="Product description" />
      </div>
      <Field label="Selling status">
        <HiusaSelect value={value.is_active ? "1" : "0"} onChange={(event) => onChange({ ...value, is_active: event.target.value === "1" })}>
          <option value="1">Active</option>
          <option value="0">Inactive</option>
        </HiusaSelect>
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink">Product image<span className="ml-1 font-normal text-ink-muted">(optional)</span></span>
        <label className="flex min-h-11 cursor-pointer flex-col items-center justify-center rounded-control border border-dashed border-line py-4 hover:bg-subtle">
          {preview ? (
            <img src={preview} alt="Preview" className="h-24 w-24 rounded-control object-cover" />
          ) : (
            <>
              <ImagePlus size={24} className="mb-1 text-ink-soft" aria-hidden="true" />
              <span className="text-[13px] font-medium text-ink">Choose an image</span>
              <span className="text-xs text-ink-muted">JPG, PNG or WebP, up to 5 MB</span>
            </>
          )}
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onImage} className="sr-only" />
        </label>
      </div>
      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={submitDisabled}>{submitLabel}</Button>
      </div>
    </form>
  );
}

// A quiet notice row with a text action: the Add product button stays the one prominent control on the screen.
function InventoryNotice({ title, body, actionLabel, onAction }) {
  return (
    <div className="flex flex-col gap-1 rounded-card border border-line bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-sm text-ink-muted-strong">{body}</p>
      </div>
      <button type="button" onClick={onAction} className="inline-flex min-h-11 shrink-0 items-center self-start rounded-control text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800 sm:self-auto">{actionLabel}</button>
    </div>
  );
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "-";
}
// Payment methods are stored lowercase. A buyer who has not chosen one yet reads as blank.
function paymentLabel(method) {
  if (!method) return "";
  return String(method).toLowerCase() === "gcash" ? "GCash" : capitalize(method);
}
// The ID and the course are joined with a separator so they never read as one string.
function studentProfile(student) {
  return [student?.program, student?.year_level && `Y${student.year_level}`, student?.section].filter(Boolean).join(" · ") || student?.role?.replaceAll("_", " ") || "";
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

// The lifecycle describes a pending order from the buyer's side. A cash order carries no proof, so the
// staff who collect the cash are the ones who verify it, and the officer and the Admin review in two
// steps: the officer's verification waits for the Admin's approval.
function staffOrderFlow(order, role) {
  const flow = orderLifecycle(order, role);
  if (order.status !== "pending") return flow;
  if (order.officer_review_status === "approved") {
    if (role === "ADMIN") {
      return { ...flow, actorRole: "ADMIN", nextAction: { tone: "action", title: "Approve the verified payment", body: "An officer verified this payment. Approve it to issue the claim token." } };
    }
    return { ...flow, actorRole: "ADMIN", nextAction: { tone: "waiting", title: "Verified: waiting for Admin approval", body: "You verified this payment. The Admin approves it and the claim token is issued." } };
  }
  if (!order.payment_proof_url) {
    return { ...flow, actorRole: role, nextAction: { tone: "action", title: "Collect the cash and verify the payment", body: "No GCash proof was submitted. Verify the payment once the buyer has paid at pickup." } };
  }
  return flow;
}

function staffNextStepProps(order, role, flow, onVerify) {
  const props = toNextStepProps(flow);
  if (order.status === "pending" && flow.nextAction.tone === "action") {
    return { ...props, primary: { label: role === "ADMIN" ? "Approve payment" : "Verify payment", onClick: onVerify } };
  }
  return props;
}

function OrderStage({ flow, title, order, className = "" }) {
  return (
    <div className={`min-w-0 space-y-1.5 ${className}`}>
      {order.status !== "cancelled" && <FlowStepper variant="compact" steps={flow.steps} ariaLabel={`ORD-${order.id} progress`} />}
      <p className="text-xs font-semibold text-ink">{title ?? flow.nextAction.title}</p>
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
    <AccessibleOverlay label={title} onClose={() => !busy && onCancel()} className="fixed inset-0 z-[60] flex items-center justify-center bg-navy-950/50 p-4">
      <div className="w-full max-w-md rounded-card border border-line bg-white p-6">
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        <p className="mt-2 whitespace-pre-line text-sm text-ink-muted-strong">{message}</p>
        <div className="mt-5 flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button type="button" variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>
            {busy ? "Processing..." : confirmText}
          </Button>
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
    <AccessibleOverlay label="Add merchandise stock" onClose={() => !busy && onCancel()} className="fixed inset-0 z-[65] flex items-center justify-center bg-navy-950/50 p-4">
      <div className="w-full max-w-md rounded-card border border-line bg-white p-6">
        <h3 className="text-base font-semibold text-ink">Add stock</h3>
        <p className="mt-2 text-sm text-ink-muted-strong">
          Enter how many units you want to add for{" "}
          <span className="font-semibold text-ink">{itemName}</span>.
        </p>
        <div className="mt-4 space-y-4">
          {variants?.length > 0 && <Field label="Variant" required>
            <HiusaSelect value={variantId} onChange={(event) => onVariantChange(event.target.value)}>
              <option value="">Select variant</option>
              {variants.map((variant) => <option key={variant.id} value={variant.id}>{formatDisplayText(variant.name)} · {variant.stock_quantity} in stock</option>)}
            </HiusaSelect>
          </Field>}
          <Field label="Quantity to add">
            <Input type="number" min="1" value={quantity} onChange={(event) => onQuantityChange(event.target.value)} />
          </Field>
          <Field label="Reason for stock addition" required>
            <Textarea value={note} onChange={(event) => onNoteChange(event.target.value)} maxLength={500} rows={2} placeholder="e.g. New delivery received" />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button type="button" onClick={onConfirm} disabled={busy}>Continue</Button>
        </div>
      </div>
    </AccessibleOverlay>
  );
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
  const flow = staffOrderFlow(order, role);

  return (
    <article className="border-b border-line px-4 py-4 last:border-b-0">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold text-brand-700">
              ORD-{order.id}
            </span>
            <OrderStatus status={order.status} />
            <span className="text-xs text-ink-muted">
              {fmtDate(order.created_at)}
            </span>
          </div>
          <p className="mt-2 max-w-full truncate text-sm font-semibold text-ink">
            {studentName}
          </p>
          <p className="mt-0.5 truncate font-mono text-xs text-ink-muted">
            {order.student?.school_id || "No school ID"}
          </p>
          <p className="mt-1 truncate text-xs text-ink-muted">
            {academicProfile || order.student?.department || "No academic profile"}
          </p>
          <OrderStage flow={flow} order={order} className="mt-3" />
        </div>

        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">
            {formatDisplayText(order.merchandise?.name) || "Unavailable item"}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            {order.quantity} x {fmt(order.unit_price ?? Number(order.total_price) / Number(order.quantity || 1))}
          </p>
          <p className="mt-1 text-sm font-semibold tabular-nums text-ink">
            {fmt(order.total_price)}
          </p>
          {order.payment_method && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
              <span>{paymentLabel(order.payment_method)}</span>
              {order.payment_method !== "cash" && <>
                <span aria-hidden="true">·</span>
                <span className="max-w-32 truncate font-mono">{order.payment_reference || "Reference pending"}</span>
              </>}
            </div>
          )}
        </div>

        <div className="min-w-0">
          {order.status === "paid" && order.claim_token ? (
            <>
              <p className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                <Ticket size={13} aria-hidden="true" /> Ready for pickup
              </p>
              <p className="mt-1 break-all font-mono text-sm font-semibold text-ink">
                {order.claim_token}
              </p>
            </>
          ) : order.status === "claimed" ? (
            <>
              <p className="flex items-center gap-1.5 text-xs font-semibold text-success-strong">
                <CheckCircle size={14} aria-hidden="true" /> Claimed {fmtDate(order.claimed_at)}
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                Released by {order.claim_verifier ? `${formatDisplayText(order.claim_verifier.first_name)} ${formatDisplayText(order.claim_verifier.last_name)}` : "authorized staff"}
              </p>
            </>
          ) : order.status === "cancelled" ? (
            <p className="text-xs font-semibold text-danger-strong">
              Order cancelled
            </p>
          ) : (
            <p className="text-xs text-ink-muted">
              Token unlocks after Admin approval
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-start gap-2 md:justify-end">
          <Button type="button" variant="secondary" onClick={() => onDetails(order)}>
            Review
          </Button>
          {order.status === "paid" && (
            <Button variant="secondary" to="/dashboard/merchandise/claim-tokens" rightIcon={ArrowRight}>
              Claim desk
            </Button>
          )}
          {order.status === "pending" && (
            <>
              <Button type="button" variant="secondary" onClick={() => onApprove(order)} rightIcon={ArrowRight}>
                {role === "ADMIN" ? "Approve" : "Verify"}
              </Button>
              <Button type="button" variant="secondary" className="text-danger-strong" onClick={() => onReject(order)}>
                Reject
              </Button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

export default function MerchandisePage({ initialTab }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [recordId, setRecordId] = useRecordParam();
  const role = getRole();
  const isFulfillmentRole = role === "ADMIN" || role === "SBO_OFFICER";
  const defaultTab =
    role === "ADMIN"
      ? "inventory"
      : role === "SBO_OFFICER"
        ? "orders"
        : "order";
  const [activeTab, setActiveTab] = useState(initialTab === "gcash" ? "orders" : initialTab || defaultTab);
  const isPersonalShoppingView =
    ["order", "cart", "my-orders"].includes(activeTab);

  const [items, setItems] = useState([]);
  const [orders, setOrders] = useState([]);
  const [mineOrders, setMineOrders] = useState([]);
  const [placedOrderIds, setPlacedOrderIds] = useState(() => location.state?.placedOrderIds ?? []);
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
  const [showPaymentSettings, setShowPaymentSettings] = useState(initialTab === "gcash");
  const [paymentSettingsBusy, setPaymentSettingsBusy] = useState(false);
  const [tokenStatusFilter, setTokenStatusFilter] = useState('claimable');
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

  function openOrderDetails(order) {
    setRecordId(order.id);
  }

  function closeOrderDetails() {
    setRecordId(null);
  }

  async function loadOrderTrail(orderId) {
    setOrderReviewTrail({ loading: true, entries: [], error: "" });
    try {
      const response = await getOrderAuditLogs(orderId);
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
          setMineOrders(allMineOrders);
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
    if (initialTab) setActiveTab(initialTab === "gcash" ? "orders" : initialTab);
  }, [initialTab]);
  useEffect(() => {
    if (activeTab !== "inventory" || role !== "ADMIN") return;
    getGcashSettings()
      .then((response) => setGcashSettings(response.data ?? response))
      .catch(() => {});
  }, [activeTab, role]);
  useEffect(() => {
    if (activeTab !== "my-orders") setPlacedOrderIds([]);
  }, [activeTab]);
  useEffect(() => {
    if (!recordId || !["orders", "tokens", "my-orders"].includes(activeTab)) {
      setOrderDetails(null);
      return undefined;
    }
    const found = [...orders, ...mineOrders].find((order) => String(order.id) === recordId);
    if (found) {
      setOrderDetails(found);
      return undefined;
    }
    if (loading || (orderDetails && String(orderDetails.id) === recordId)) return undefined;

    const notFound = () => {
      showFeedback("error", `ORD-${recordId} was not found${isPersonalShoppingView ? " in your orders" : ""}.`);
      setRecordId(null);
    };
    // A deep link to an order outside the loaded page reads that order by id. The server answers 404
    // for an order this person cannot see, so a buyer's link to someone else's order is not found too.
    let cancelled = false;
    getOrder(recordId)
      .then((response) => {
        if (cancelled) return;
        if (response.data?.id) setOrderDetails(response.data);
        else notFound();
      })
      .catch(() => {
        if (!cancelled) notFound();
      });
    return () => {
      cancelled = true;
    };
    // The setter changes identity with every URL change and the open order is only read to avoid a
    // second lookup, so neither may re-run the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId, activeTab, orders, mineOrders, loading, isPersonalShoppingView]);
  useEffect(() => {
    if (!orderDetails?.id || isPersonalShoppingView) return;
    loadOrderTrail(orderDetails.id);
  }, [orderDetails?.id, isPersonalShoppingView]);
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
        await loadOrderTrail(id);
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
      const merge = (rows) =>
        rows.map((row) => (row.id === order.id ? { ...row, ...res.data } : row));
      setOrders(merge);
      setMineOrders(merge);
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
    setOrderDetails(null);
    setVerificationModal({
      open: true,
      order,
      amount: String(order.total_price),
      busy: false,
      error: "",
    });
  }

  function openOrderRejection(order) {
    setOrderDetails(null);
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
      confirmText: "Cancel order",
      danger: true,
      action: async () => {
        const response = await cancelOrder(order.id);
        const replace = (rows) =>
          rows.map((row) => (row.id === order.id ? response.data : row));
        setOrders(replace);
        setMineOrders(replace);
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
      title: nextActive ? "Set item active" : "Set item inactive",
      message: nextActive
        ? `Mark ${item.name} as active for selling?`
        : `Mark ${item.name} as inactive? Students will not be able to order this item.`,
      confirmText: nextActive ? "Set active" : "Set inactive",
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
      title: "Delete product",
      danger: true,
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
        "Enter a whole number greater than 0 for stock addition.",
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
      title: "Confirm stock addition",
      message: `Add ${addAmount} unit(s) to ${item.name}? New stock will be ${nextStock}.`,
      confirmText: "Add stock",
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
      setCartError("Enter a valid quantity greater than 0.");
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
    const placedIds = [];
    try {
      for (const row of cart) {
        const placed = await placeOrder({
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
        if (placed?.data?.id) placedIds.push(placed.data.id);
      }

      setCart([]);
      setCheckoutOpen(false);
      setCheckoutPayment({ method: "cash", reference: "", proof_file: null });
      await load();
      setPlacedOrderIds(placedIds);
      setActiveTab("my-orders");
      navigate("/dashboard/merchandise/my-orders", { state: { placedOrderIds: placedIds } });
      setTransactionMessage(
        placedIds.length === 1
          ? `Order ORD-${placedIds[0]} reserved.`
          : "Your orders are reserved.",
      );
    } catch (err) {
      const msg =
        err.response?.data?.message ??
        "Failed to submit cart. Try again.";
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
      downloadExcelXml(`merchandise-${analyticsModal.group}-${manilaDateStamp()}.xls`, ['School ID', 'Name', 'Email', 'Role', 'Department', 'Program', 'Year', 'Section', 'Order', 'Item', 'Quantity', 'Unit price', 'Total', 'Mode of payment', 'Status', 'Ordered'], rows);
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
      anchor.download = `merchandise-orders-${manilaDateStamp()}.csv`;
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
  const tokenOrders = orders.filter((o) => tokenStatusFilter === 'claimable' ? ['paid', 'claimed'].includes(o.status) : matchesFilter(tokenStatusFilter, o.status));
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
    matchesFilter(inventoryCategory, item.category) &&
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
        matchesFilter(studentCategory, item.category) &&
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
  const selectedPrograms = orderFilterOptions.programs?.filter(
    (program) => matchesFilter(orderFilters.program, program.name),
  );
  const availableSections =
    selectedPrograms?.flatMap((program) => program.sections || []).filter(
      (section) =>
        filterValues(orderFilters.year_level).length === 0 || filterValues(orderFilters.year_level).some((year) => Number(section.year_level) === ["1st Year", "2nd Year", "3rd Year", "4th Year"].indexOf(year) + 1),
    ) || [];
  const activeOrderFilterCount = Object.entries(orderFilters).filter(
    ([key, value]) => !["sort", "per_page"].includes(key) && value,
  ).length;

  const gcashReady = Boolean(gcashSettings?.gcash_qr_url);
  const gcashUnavailable = gcashSettings !== null && !gcashReady;



  function browseShop() {
    setActiveTab("order");
    navigate("/dashboard/merchandise/order-merchandise");
  }

  function openProofModal(order) {
    setPaymentModal({
      open: true,
      order,
      reference: order.payment_reference || "",
      proof_file: null,
      busy: false,
      error: "",
    });
  }

  // My orders is always seen as the buyer, even by an officer or Admin buying for themselves. Rows, the
  // detail and the checkout confirmation all read this one function so their stage text cannot differ.
  function buyerStage(order) {
    const flow = orderLifecycle(order, "STUDENT");
    if (order.status === "pending" && order.officer_review_status === "approved") {
      const steps = flow.steps.map((step) => ({ ...step, state: step.key === "reserved" ? "done" : step.key === "proof" ? "current" : step.state }));
      const verified = {
        ...flow,
        steps,
        current: steps.find((step) => step.key === "proof"),
        actorRole: "ADMIN",
        nextAction: { tone: "waiting", title: "Payment verified: waiting for Admin approval", body: "An officer verified your payment. Your claim token is issued once the Admin approves it." },
      };
      return { flow: verified, props: toNextStepProps(verified) };
    }
    const props = toNextStepProps(flow);
    if (order.status === "pending" && !order.payment_proof_url && gcashUnavailable) {
      return { flow, props: { ...props, title: "Pay cash at pickup", body: "Online payment is not available. Your items are reserved and the order is confirmed once the payment is checked." } };
    }
    return { flow, props };
  }

  function buyerNextStepProps(order, { reserved = 0 } = {}) {
    const { props } = buyerStage(order);
    const next = reserved
      ? { ...props, title: reserved > 1 ? `${reserved} orders reserved` : `ORD-${order.id} reserved`, body: `${reserved > 1 ? `ORD-${order.id} is next. ` : ""}Next: ${props.title}. ${props.body}` }
      : props;
    if (order.status === "pending" && props.tone === "action") {
      return {
        ...next,
        primary: gcashReady
          ? { label: "Submit GCash proof", onClick: () => openProofModal(order) }
          : reserved ? { label: "View order", onClick: () => openOrderDetails(order) } : undefined,
      };
    }
    return next;
  }

  function renderBuyerStage(order, className) {
    const { flow, props } = buyerStage(order);
    return <OrderStage flow={flow} title={props.title} order={order} className={className} />;
  }

  const placedOrders = placedOrderIds
    .map((id) => orders.find((order) => order.id === id) ?? mineOrders.find((order) => order.id === id))
    .filter(Boolean);
  const placedNextStep = placedOrders.length > 0 && activeTab === "my-orders" ? (
    <NextStep {...buyerNextStepProps(placedOrders[0], { reserved: placedOrders.length })} />
  ) : null;

  const feedbackPopup = feedback.open ? (
    <div className="dashboard-centered-popup fixed top-[calc(var(--dashboard-navbar-bottom,68px)+0.75rem)] z-[70] w-[calc(100vw-2rem)] -translate-x-1/2">
      <div
        className={`flex items-start justify-between gap-3 rounded-card border px-4 py-3 ${feedback.type === "success" ? "border-success/30 bg-success-tint" : "border-danger/40 bg-danger-tint"}`}
      >
        <div className="flex items-start gap-2">
          {feedback.type === "success" ? (
            <CheckCircle size={17} className="mt-0.5 shrink-0 text-success" />
          ) : (
            <AlertTriangle
              size={17}
              className="mt-0.5 shrink-0 text-danger"
            />
          )}
          <p
            className={`text-sm font-semibold ${feedback.type === "success" ? "text-success-strong" : "text-danger-strong"}`}
          >
            {feedback.message}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setFeedback((prev) => ({ ...prev, open: false }))}
          className={`inline-flex min-h-11 items-center text-sm font-medium ${feedback.type === "success" ? "text-success-strong" : "text-danger-strong"} hover:underline`}
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
        <PageHeader nextStep={placedNextStep} />
        {feedbackPopup}
        <ProductImageViewer lightbox={lightbox} onChange={setLightbox} onClose={() => setLightbox(null)} />
        <Modal open={Boolean(productPreview)} title={formatDisplayText(productPreview?.name)} onClose={() => setProductPreview(null)} maxWidth="max-w-xl" footer={productPreview && <Button type="button" leftIcon={ShoppingBag} onClick={() => { if (addToCart(productPreview)) setProductPreview(null); }} disabled={productPreview.stock_quantity === 0}>Add to cart</Button>}>
          {cartError && <p role="alert" className="mb-3 rounded-control border border-danger/40 bg-danger-tint p-3 text-sm font-semibold text-danger-strong">{cartError}</p>}
          {productPreview && <div className={`grid gap-4 ${productPreview.image_url ? "sm:grid-cols-[180px_minmax(0,1fr)]" : ""}`}>
            {productPreview.image_url && <img src={resolveAssetUrl(productPreview.image_url)} alt={formatDisplayText(productPreview.name)} className="aspect-square w-full rounded-control border border-line object-cover" />}
            <div className="min-w-0 space-y-3">
              <p className="text-xl font-semibold tabular-nums text-ink">{fmt(productPreview.effective_price ?? productPreview.price)}</p>
              <p className="text-sm font-semibold text-ink">{productPreview.stock_quantity} unit{productPreview.stock_quantity === 1 ? '' : 's'} in stock</p>
              {productPreview.description && <RichTextBody value={productPreview.description} className="text-sm leading-6 text-ink-muted-strong" />}
              {productPreview.variants?.length > 0 && <Field label="Size or variant">
                <HiusaSelect value={selectedVariants[productPreview.id] || ''} onChange={(event) => setSelectedVariants((current) => ({ ...current, [productPreview.id]: event.target.value }))}>
                  <option value="">Select variant</option>
                  {productPreview.variants.map((variant) => <option key={variant.id} value={variant.id} disabled={variant.stock_quantity === 0}>{formatDisplayText(variant.name)} · {variant.stock_quantity} in stock</option>)}
                </HiusaSelect>
              </Field>}
              <div className="w-28">
                <Field label="Quantity">
                  <Input type="number" min="1" max={productPreview.stock_quantity} value={draftQty[productPreview.id] || 1} onChange={(event) => setDraftQty((current) => ({ ...current, [productPreview.id]: Math.max(1, Math.min(productPreview.stock_quantity, Number(event.target.value || 1))) }))} />
                </Field>
              </div>
            </div>
          </div>}
        </Modal>

        {/* Order Merchandise tab */}
        {activeTab === "order" && (
          <section className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_200px_200px]">
              <Input
                value={studentItemSearch}
                onChange={(e) => setStudentItemSearch(e.target.value)}
                type="search"
                aria-label="Search merchandise"
                placeholder="Search products"
              />
              <HiusaSelect filter
                aria-label="Filter merchandise category"
                value={studentCategory}
                onChange={(event) => setStudentCategory(event.target.value)}
              >
                {studentCategories.map((category) => (
                  <option key={category} value={category}>
                    {category === "all" ? "All categories" : category}
                  </option>
                ))}
              </HiusaSelect>
              <HiusaSelect
                aria-label="Sort merchandise"
                value={studentItemSort}
                onChange={(event) => setStudentItemSort(event.target.value)}
              >
                <option value="featured">Available first</option>
                <option value="stock">Most stock</option>
                <option value="price-low">Price: low to high</option>
                <option value="price-high">Price: high to low</option>
              </HiusaSelect>
            </div>
            {(studentItemSearch || studentCategory !== "all") && (
              <button
                type="button"
                onClick={() => {
                  setStudentItemSearch("");
                  setStudentCategory("all");
                }}
                className="inline-flex min-h-11 items-center rounded-control text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800"
              >
                Clear
              </button>
            )}
            {gcashUnavailable && (
              <p className="text-sm text-ink-muted-strong">Online payment is not available. Pay cash at pickup.</p>
            )}
            {cartQuantity > 0 && (
              <div className="flex flex-col gap-2 rounded-card border border-line bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-ink">{cartQuantity} item{cartQuantity === 1 ? "" : "s"} in your cart, <span className="tabular-nums">{fmt(cartTotal)}</span></p>
                <Button type="button" variant="secondary" onClick={() => setActiveTab("cart")}>View cart</Button>
              </div>
            )}

            {loading ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <SkeletonCard key={i} className="h-72" />
                ))}
              </div>
            ) : filteredStudentItems.length === 0 ? (
              items.some((item) => item.is_active) ? (
                <EmptyState
                  kind="filtered"
                  title="No merchandise matches your filters"
                  onClearFilters={() => {
                    setStudentItemSearch("");
                    setStudentCategory("all");
                  }}
                />
              ) : (
                <EmptyState
                  icon={Package}
                  title="Nothing to buy yet"
                  description="Your officers add merchandise here."
                />
              )
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {filteredStudentItems.map((item) => (
                  <article
                    key={item.id}
                    className="flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface"
                  >
                    {item.image_url && (
                      <div className="bg-subtle">
                        <button type="button" onClick={() => setLightbox({ item, index: 0 })} className="block w-full" aria-label={`View ${formatDisplayText(item.name)} images`}><img
                          src={resolveAssetUrl(item.image_url)}
                          alt={formatDisplayText(item.name)}
                          className={`h-44 w-full object-cover ${item.stock_quantity === 0 ? "grayscale" : ""}`}
                        /></button>
                      </div>
                    )}
                    <div className="flex flex-1 flex-col gap-2 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="font-semibold leading-snug text-ink">
                            {formatDisplayText(item.name)}
                          </h3>
                          <p className="mt-0.5 text-xs text-ink-muted">{item.category || "Merchandise"}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-semibold tabular-nums text-ink">{fmt(item.effective_price ?? item.price)}</p>
                          {item.promotion_available_to_viewer && <p className="text-xs text-ink-muted"><s>{fmt(item.price)}</s> · {item.promotion_remaining} buyer slots left</p>}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        {item.stock_quantity === 0 ? (
                          <StatusBadge tone="danger" label="Out of stock" />
                        ) : (
                          <>
                            <span className="text-ink-muted">{item.stock_quantity} in stock</span>
                            {item.is_low_stock && <StatusBadge tone="warning" label="Low stock" />}
                          </>
                        )}
                        {item.promotion_available_to_viewer && <StatusBadge tone="active" label={`First ${item.promotion_buyer_limit} buyers`} />}
                      </div>
                      <div className="min-h-10">
                        {item.description && <RichTextBody value={item.description} className="line-clamp-2 text-xs leading-5 text-ink-muted" />}
                      </div>
                      <button type="button" onClick={() => { setCartError(null); setProductPreview(item); }} className="inline-flex min-h-11 w-fit items-center rounded-control text-sm font-medium text-brand-700 hover:underline">View product details</button>
                      {item.variants?.length > 0 && <Field label="Size or variant">
                        <HiusaSelect value={selectedVariants[item.id] || ""} onChange={(event) => setSelectedVariants((prev) => ({ ...prev, [item.id]: event.target.value }))} aria-label={`Select variant for ${formatDisplayText(item.name)}`}>
                          <option value="">Select variant</option>{item.variants.map((variant) => <option key={variant.id} value={variant.id} disabled={variant.stock_quantity === 0}>{formatDisplayText(variant.name)} · {variant.stock_quantity} available</option>)}
                        </HiusaSelect>
                      </Field>}
                      <div className="mt-auto flex items-center gap-2 border-t border-line pt-4">
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
                          className="grid h-11 w-11 shrink-0 place-items-center rounded-control border border-line text-ink hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label={`Decrease quantity for ${formatDisplayText(item.name)}`}
                        >
                          <Minus size={14} aria-hidden="true" />
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
                          aria-label={`Quantity for ${formatDisplayText(item.name)}`}
                          className="h-11 w-16 rounded-control border border-line text-center text-sm font-normal tabular-nums text-ink disabled:bg-subtle disabled:text-ink-soft"
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
                          className="grid h-11 w-11 shrink-0 place-items-center rounded-control border border-line text-ink hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label={`Increase quantity for ${formatDisplayText(item.name)}`}
                        >
                          <Plus size={14} aria-hidden="true" />
                        </button>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        leftIcon={ShoppingBag}
                        onClick={() => addToCart(item)}
                        disabled={item.stock_quantity === 0}
                        className="w-full"
                      >
                        {item.stock_quantity === 0
                          ? "Currently unavailable"
                          : "Add to cart"}
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {activeTab === "cart" && (
          <section className="rounded-card border border-line bg-surface">
            <div className="flex flex-col justify-between gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
              <div>
                <h2 className="text-base font-semibold text-ink">
                  Your cart
                </h2>
                <p className="mt-1 text-sm text-ink-muted-strong">
                  Placing an order does not reserve stock. Stock is reserved after payment approval.
                </p>
              </div>
              <Button type="button" variant="secondary" onClick={() => setActiveTab("order")}>
                Continue shopping
              </Button>
            </div>
            {cart.length === 0 ? (
              <div className="px-4">
                <EmptyState
                  icon={ShoppingBag}
                  title="Your cart is empty"
                  action={<Button type="button" onClick={() => setActiveTab("order")}>Browse merchandise</Button>}
                />
              </div>
            ) : (
              <div className="p-4">
                <ul className="divide-y divide-line">
                  {cart.map((row) => (
                    <li
                      key={cartKey(row.item)}
                      className="flex flex-wrap items-center gap-4 py-4 first:pt-0"
                    >
                      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-control bg-subtle">
                        {row.item.image_url ? (
                          <img
                            src={resolveAssetUrl(row.item.image_url)}
                            alt={formatDisplayText(row.item.name)}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="grid h-full w-full place-items-center">
                            <Package size={24} className="text-ink-soft" aria-hidden="true" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-40 flex-1">
                        <p className="font-semibold text-ink">
                          {formatDisplayText(row.item.name)}
                        </p>
                        <p className="text-xs text-ink-muted">
                          {row.item.variant_name ? `${row.item.variant_name} · ` : ""}{fmt(itemPrice(row.item))} each · {row.item.stock_quantity} available
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            changeCartQty(cartKey(row.item), row.quantity - 1)
                          }
                          className="grid h-11 w-11 place-items-center rounded-control border border-line text-ink hover:bg-subtle"
                          aria-label={`Decrease quantity for ${formatDisplayText(row.item.name)}`}
                        >
                          <Minus size={13} aria-hidden="true" />
                        </button>
                        <span className="w-8 text-center text-sm font-semibold tabular-nums text-ink">
                          {row.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            changeCartQty(cartKey(row.item), row.quantity + 1)
                          }
                          disabled={row.quantity >= row.item.stock_quantity}
                          className="grid h-11 w-11 place-items-center rounded-control border border-line text-ink hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label={`Increase quantity for ${formatDisplayText(row.item.name)}`}
                        >
                          <Plus size={13} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeFromCart(cartKey(row.item))}
                          className="ml-1 grid h-11 w-11 place-items-center rounded-control text-danger-strong hover:bg-danger-tint"
                          aria-label={`Remove ${formatDisplayText(row.item.name)} from cart`}
                        >
                          <Trash2 size={13} aria-hidden="true" />
                        </button>
                      </div>
                      <p className="min-w-24 text-right font-semibold tabular-nums text-ink">
                        {fmt(toNumber(row.item.price) * row.quantity)}
                      </p>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-col gap-4 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs text-ink-muted">
                      {cartQuantity} total item{cartQuantity === 1 ? "" : "s"}
                    </p>
                    <p className="mt-1 text-lg font-semibold text-ink">
                      Order total: <span className="tabular-nums">{fmt(cartTotal)}</span>
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        openConfirm({
                          title: "Clear your cart?",
                          message: "Remove every item from this cart? No order has been placed yet.",
                          confirmText: "Clear cart",
                          danger: true,
                          action: async () => setCart([]),
                        })
                      }
                    >
                      Clear cart
                    </Button>
                    <Button type="button" onClick={() => setCheckoutOpen(true)}>
                      Review and continue
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {/* My Orders tab */}
        {activeTab === "my-orders" && (
          <section className="space-y-4">
            {orders.length > 0 && (
              <div className="max-w-sm">
                <Input
                  value={studentOrderSearch}
                  onChange={(e) => setStudentOrderSearch(e.target.value)}
                  type="search"
                  aria-label="Search orders"
                  placeholder="Search orders or token"
                />
              </div>
            )}

            {loading ? (
              <SkeletonTable columns={4} rows={3} />
            ) : filteredStudentOrders.length === 0 ? (
              studentOrderSearch.trim() && ordersMeta.total > 0 ? (
                <EmptyState
                  kind="filtered"
                  title="No orders on this page match your search"
                  onClearFilters={() => setStudentOrderSearch("")}
                />
              ) : (
                <EmptyState
                  icon={ShoppingBag}
                  title="No orders yet"
                  description="Browse the shop to place your first order."
                  action={<Button onClick={browseShop}>Browse the shop</Button>}
                />
              )
            ) : (
              <ul className="divide-y divide-line rounded-card border border-line bg-surface">
                {filteredStudentOrders.map((o) => (
                  <li key={o.id} className="min-w-0 space-y-3 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-control bg-subtle">
                          {(o.variant?.image_url || o.merchandise?.image_url) ? (
                            <img
                              src={resolveAssetUrl(o.variant?.image_url || o.merchandise?.image_url)}
                              alt={formatDisplayText(o.merchandise?.name) ?? "Merchandise"}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="grid h-full w-full place-items-center">
                              <Package size={22} className="text-ink-soft" aria-hidden="true" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-mono text-xs font-semibold text-ink-muted">
                            ORD-{o.id}
                          </p>
                          <p className="mt-0.5 truncate font-semibold text-ink">
                            {formatDisplayText(o.merchandise?.name) ?? "-"}
                          </p>
                          <p className="text-sm text-ink-muted">
                            Qty: {o.quantity} · Total: <span className="tabular-nums">{fmt(o.total_price)}</span>
                          </p>
                          <p className="mt-1 text-xs text-ink-muted">
                            {fmtDate(o.created_at)}
                          </p>
                        </div>
                      </div>
                      <OrderStatus status={o.status} />
                    </div>
                    <div className="flex flex-wrap items-end justify-between gap-3 border-t border-line pt-3">
                      {renderBuyerStage(o, "min-w-[220px] flex-1")}
                      <Button type="button" variant="secondary" onClick={() => openOrderDetails(o)}>
                        View details
                      </Button>
                    </div>
                    {o.status === "paid" && (
                      <ClaimTicket order={o} onPrint={() => printClaimTicket(o)} />
                    )}
                    {o.status === "pending" && (
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm text-ink-muted-strong">
                          {o.payment_proof_url
                            ? "Payment proof submitted and awaiting officer verification."
                            : gcashReady
                              ? "You can submit GCash proof now or pay cash on pickup."
                              : "Online payment is not available. Pay cash at pickup."}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {gcashSettings?.gcash_qr_url && (
                            <Button
                              type="button"
                              variant="secondary"
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
                            >
                              {o.payment_proof_url
                                ? "Replace proof"
                                : "Submit GCash proof"}
                            </Button>
                          )}
                          {!o.payment_proof_url &&
                            o.officer_review_status === "pending" &&
                            o.admin_review_status === "pending" && (
                              <Button
                                type="button"
                                variant="secondary"
                                className="text-danger-strong"
                                onClick={() => confirmBuyerCancellation(o)}
                              >
                                Cancel order
                              </Button>
                            )}
                        </div>
                      </div>
                    )}
                    {o.status === "cancelled" && (
                      <p className="flex items-start gap-2 text-sm text-danger-strong">
                        <AlertTriangle size={14} className="mt-1 shrink-0" aria-hidden="true" />
                        {o.review_remarks || "This order was cancelled and its stock was returned."}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
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

        <Drawer
          open={Boolean(orderDetails) && activeTab === "my-orders"}
          title={orderDetails ? `ORD-${orderDetails.id}` : ""}
          description={orderDetails ? formatDisplayText(orderDetails.merchandise?.name) : ""}
          onClose={closeOrderDetails}
          width="max-w-xl"
        >
          {orderDetails && (
            <div className="space-y-5">
              <FlowStepper variant="full" steps={buyerStage(orderDetails).flow.steps} ariaLabel={`ORD-${orderDetails.id} progress`} />
              <NextStep {...buyerNextStepProps(orderDetails)} />
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 text-sm">
                {[
                  ["Quantity", orderDetails.quantity],
                  ["Total", fmt(orderDetails.total_price)],
                  ["Payment", (orderDetails.payment_method || "cash").toUpperCase()],
                  ["Ordered", fmtDate(orderDetails.created_at)],
                  orderDetails.claim_token && ["Claim token", orderDetails.claim_token],
                  orderDetails.claimed_at && ["Claimed", fmtDateTime(orderDetails.claimed_at)],
                ].filter(Boolean).map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-xs font-semibold text-ink-muted-strong">{label}</dt>
                    <dd className={`mt-0.5 break-all font-semibold text-ink ${label === "Claim token" ? "font-mono" : ""}`}>{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </Drawer>

        {checkoutOpen && (
          <AccessibleOverlay label="Confirm merchandise reservation" onClose={() => !checkoutSubmitting && setCheckoutOpen(false)} className="fixed inset-0 z-[60] flex items-center justify-center bg-navy-950/50 p-4">
            <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-card border border-line bg-white p-5 sm:p-6">
              <h2 className="text-lg font-semibold text-ink">
                Confirm your reservation
              </h2>
              <p className="mt-1 text-sm text-ink-muted-strong">
                Check quantities and available stock before choosing payment.
              </p>
              <ul className="mt-4 max-h-72 divide-y divide-line overflow-y-auto border-y border-line">
                {cart.map((row) => (
                  <li
                    key={cartKey(row.item)}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-ink">
                        {formatDisplayText(row.item.name)}
                      </p>
                      <p className="text-xs text-ink-muted">
                        Qty: {row.quantity} × {fmt(itemPrice(row.item))} · {row.item.stock_quantity} in stock
                      </p>
                    </div>
                    <p className="text-sm font-semibold tabular-nums text-ink">
                      {fmt(toNumber(row.item.price) * row.quantity)}
                    </p>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex items-end justify-between">
                <div>
                  <p className="text-xs font-semibold text-ink-muted">Grand total</p>
                  <p className="text-xs text-ink-muted">
                    {cartQuantity} item{cartQuantity === 1 ? "" : "s"}
                  </p>
                </div>
                <p className="text-xl font-semibold tabular-nums text-ink">{fmt(cartTotal)}</p>
              </div>
              <div className="mt-4 space-y-4">
                <div>
                  <Field label="Payment method">
                    <HiusaSelect
                      value={checkoutPayment.method}
                      onChange={(e) =>
                        setCheckoutPayment((current) => ({
                          ...current,
                          method: e.target.value,
                        }))
                      }
                    >
                      <option value="cash">Cash on pickup</option>
                      <option
                        value="gcash"
                        disabled={cart.length > 1 || !gcashSettings?.gcash_qr_url}
                      >
                        GCash (single order only)
                        {!gcashSettings?.gcash_qr_url ? " - unavailable" : ""}
                      </option>
                    </HiusaSelect>
                  </Field>
                  <p className="mt-2 text-xs text-ink-muted-strong">
                    {checkoutPayment.method === "gcash"
                      ? "Next: an officer checks your proof. Once it is verified, your claim token appears in My orders."
                      : "Next: your items are reserved. Pay cash at pickup. Once an officer verifies the payment, your claim token appears in My orders."}
                  </p>
                  {cart.length > 1 && (
                    <p className="mt-1 text-xs text-ink-muted">
                      For GCash, checkout one product at a time so every order
                      has its own reference and proof.
                    </p>
                  )}
                  {!gcashReady && (
                    <p className="mt-1 text-xs font-medium text-warning-strong">
                      Online payment is not available. Pay cash at pickup.
                    </p>
                  )}
                </div>
                {checkoutPayment.method === "gcash" && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {gcashSettings?.gcash_qr_url && (
                      <div className="text-center sm:col-span-2">
                        <p className="mb-2 text-xs font-semibold text-ink">
                          Scan the official HIUSA GCash QR code
                        </p>
                        <img
                          src={resolveAssetUrl(gcashSettings.gcash_qr_url)}
                          alt="Official GCash payment QR code"
                          className="mx-auto max-h-52 max-w-full rounded-control object-contain"
                        />
                      </div>
                    )}
                    <Field label="GCash reference" required>
                      <Input
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
                      />
                    </Field>
                    <Field label="Payment proof" required>
                      <Input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(e) =>
                          setCheckoutPayment((current) => ({
                            ...current,
                            proof_file: e.target.files?.[0] || null,
                          }))
                        }
                        className="py-1.5"
                      />
                    </Field>
                  </div>
                )}
              </div>
              <p className="mt-4 text-xs text-ink-muted-strong">
                Stock is set aside for you only after your payment is approved. You can cancel later from My orders only while the order remains unpaid and unreviewed.
              </p>
              <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Button type="button" variant="secondary" onClick={() => setCheckoutOpen(false)} disabled={checkoutSubmitting}>
                  Cancel
                </Button>
                <Button type="button" onClick={submitCartOrders} disabled={checkoutSubmitting}>
                  {checkoutSubmitting ? "Reserving..." : "Place reservation"}
                </Button>
              </div>
            </div>
          </AccessibleOverlay>
        )}

        {paymentModal.open && (
          <AccessibleOverlay label="Submit GCash payment" onClose={() => !paymentModal.busy && setPaymentModal({ open: false, order: null, reference: "", proof_file: null, busy: false, error: "" })} className="fixed inset-0 z-[70] flex items-center justify-center bg-navy-950/50 p-4">
            <div className="w-full max-w-md rounded-card border border-line bg-white p-6">
              <h2 className="text-lg font-semibold text-ink">
                Submit GCash payment
              </h2>
              <p className="mt-1 text-sm text-ink-muted-strong">
                Order ORD-{paymentModal.order?.id} ·{" "}
                {fmt(paymentModal.order?.total_price)}
              </p>
              <div className="mt-4 space-y-4">
                {gcashSettings?.gcash_qr_url && (
                  <div className="text-center">
                    <p className="mb-2 text-xs font-semibold text-ink">
                      Pay using the official HIUSA GCash QR code
                    </p>
                    <img
                      src={resolveAssetUrl(gcashSettings.gcash_qr_url)}
                      alt="Official GCash payment QR code"
                      className="mx-auto max-h-44 max-w-full rounded-control object-contain"
                    />
                  </div>
                )}
                <Field label="13-digit GCash reference" required>
                  <Input
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
                  />
                </Field>
                <Field label="Payment proof" required>
                  <Input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) =>
                      setPaymentModal((current) => ({
                        ...current,
                        proof_file: e.target.files?.[0] || null,
                        error: "",
                      }))
                    }
                    className="py-1.5"
                  />
                </Field>
                {paymentModal.error && (
                  <p role="alert" className="text-xs font-semibold text-danger-strong">
                    {paymentModal.error}
                  </p>
                )}
              </div>
              <div className="mt-5 flex justify-end gap-3">
                <Button
                  type="button"
                  variant="secondary"
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
                >
                  Cancel
                </Button>
                <Button type="button" disabled={paymentModal.busy} onClick={handlePaymentSubmission}>
                  {paymentModal.busy ? "Submitting..." : "Submit payment"}
                </Button>
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
  const outOfStockItems = items.filter((item) => item.is_active && item.stock_quantity === 0);
  const everyItemSoldOut = outOfStockItems.length > 0 && outOfStockItems.length === items.filter((item) => item.is_active).length;
  const inventoryGuidance = activeTab === "inventory" && !loading && role === "ADMIN" && (outOfStockItems.length > 0 || gcashUnavailable) ? (
    <div className="space-y-3">
      {outOfStockItems.length > 0 && (
        <InventoryNotice
          title={everyItemSoldOut ? "Every active item is out of stock" : `${outOfStockItems.length} ${outOfStockItems.length === 1 ? "item is" : "items are"} out of stock`}
          body="Students cannot order an item until you add stock."
          actionLabel="Add stock"
          onAction={() => openAddStockModal(outOfStockItems[0])}
        />
      )}
      {gcashUnavailable && (
        <InventoryNotice
          title="Set up GCash so students can pay online"
          body="Upload the official GCash QR code. Until then students pay cash at pickup."
          actionLabel="Set up GCash"
          onAction={() => setShowPaymentSettings(true)}
        />
      )}
    </div>
  ) : undefined;
  const addProductButton = activeTab === "inventory" && role === "ADMIN" && (loading || items.length > 0) ? (
    <Button leftIcon={Plus} onClick={() => setShowForm(true)}>Add product</Button>
  ) : undefined;

  const closeAnalytics = () => setAnalyticsModal({ open: false, title: "", loading: false, users: [], error: "", group: "", currentPage: 1, totalUsers: 0 });
  const closeAddForm = () => {
    if (formSubmitting) return;
    setShowForm(false);
    setImageFile(null);
    setImagePreview(null);
  };
  const inventoryColumns = [
    {
      key: "name",
      header: "Item",
      render: (item) => (
        <div className="flex min-w-0 items-center gap-3">
          {item.image_url ? (
            <button type="button" onClick={() => setLightbox({ item, index: 0 })} aria-label={`View ${formatDisplayText(item.name)} images`} className="shrink-0"><img
              src={resolveAssetUrl(item.image_url)}
              alt={formatDisplayText(item.name)}
              className="h-10 w-10 rounded-control border border-line object-cover"
            /></button>
          ) : (
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-subtle">
              <Package size={18} className="text-ink-soft" aria-hidden="true" />
            </div>
          )}
          <div className="min-w-0 text-left">
            <p className="truncate font-semibold text-ink">{formatDisplayText(item.name)}</p>
            {item.variants?.length > 0 && <p className="text-xs text-ink-muted">{item.variants.map((variant) => `${variant.name}: ${variant.stock_quantity}`).join(" · ")}</p>}
          </div>
        </div>
      ),
    },
    { key: "category", header: "Category", render: (item) => item.category || "" },
    {
      key: "price",
      header: "Price",
      align: "right",
      render: (item) => item.promotion_available_to_viewer
        ? <><strong className="font-semibold">{fmt(item.effective_price)}</strong> <s className="text-ink-muted">{fmt(item.price)}</s><span className="block text-xs text-ink-muted">{item.promotion_remaining} slots left</span></>
        : fmt(item.price),
    },
    { key: "stock", header: "In stock", align: "right", render: (item) => item.stock_quantity },
    {
      key: "status",
      header: "Status",
      render: (item) => !item.is_active
        ? <StatusBadge tone="neutral" label="Not selling" />
        : item.stock_quantity === 0
          ? <StatusBadge tone="danger" label="Out of stock" />
          : item.is_low_stock
            ? <StatusBadge tone="warning" label="Low stock" />
            : null,
    },
  ];
  const inventoryFiltersActive = Boolean(inventorySearch) || inventoryCategory !== "all";
  const clearInventoryFilters = () => {
    setInventorySearch("");
    setInventoryCategory("all");
  };
  const analyticsColumns = [
    {
      key: "student",
      header: "Student",
      render: ({ user }) => (
        <div className="min-w-0 text-left">
          <p className="font-semibold text-ink">{formatDisplayText(user.first_name)} {formatDisplayText(user.last_name)}</p>
          <p className="text-xs text-ink-muted"><span className="font-mono">{user.school_id}</span>{user.email ? ` · ${user.email}` : ""}</p>
        </div>
      ),
    },
    {
      key: "program",
      header: "Program",
      render: ({ user }) => (
        <div className="text-left">
          <p>{user.program || ""}</p>
          <p className="text-xs text-ink-muted">{[user.year_level, user.section].filter(Boolean).join(" · ")}</p>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      render: ({ user }) => [(user.role || "").replaceAll("_", " "), formatDisplayText(user.position_title)].filter(Boolean).join(" · "),
    },
    { key: "item", header: "Item", render: ({ order }) => formatDisplayText(order?.merchandise?.name) || "Did not purchase" },
    { key: "quantity", header: "Qty", align: "right", render: ({ order }) => order?.quantity ?? "" },
    { key: "total", header: "Total", align: "right", render: ({ order }) => (order ? fmt(order.total_price) : "") },
    { key: "status", header: "Order", render: ({ order }) => (order ? <OrderStatus status={order.status} /> : null) },
    { key: "ordered", header: "Ordered", render: ({ order }) => (order ? fmtDate(order.created_at) : "") },
  ];
  const tokenColumns = [
    { key: "order", header: "Order", render: (o) => <span className="font-mono text-xs font-semibold text-brand-700">ORD-{o.id}</span> },
    {
      key: "purchaser",
      header: "Purchaser",
      render: (o) => (
        <div className="min-w-0 text-left">
          <p className="font-semibold text-ink">{o.student ? `${formatDisplayText(o.student.first_name)} ${formatDisplayText(o.student.last_name)}` : ""}</p>
          <p className="text-xs text-ink-muted">{[o.student?.program, o.student?.section, o.student?.department].filter(Boolean).join(" · ")}</p>
        </div>
      ),
    },
    { key: "payment", header: "Payment", render: (o) => paymentLabel(o.payment_method) },
    { key: "quantity", header: "Items", align: "right", render: (o) => o.quantity },
    {
      key: "token",
      header: "Status",
      render: (o) => <StatusBadge tone={o.status === "claimed" ? "success" : "warning"} label={o.status === "claimed" ? "Claimed" : "Waiting to be claimed"} />,
    },
  ];
  const linkButton = "inline-flex min-h-11 items-center rounded-control text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800";

  return (
    <div className="space-y-6">
      <PageHeader primary={addProductButton} nextStep={inventoryGuidance} />
      {feedbackPopup}
      {activeTab === "inventory" && (
        <section aria-label="Inventory summary" className="grid gap-3 sm:grid-cols-2">
          <StatTile to="/dashboard/merchandise/manage-orders" label="Open orders" value={activeOrders} context="Pending or ready for pickup" />
          <StatTile to="/dashboard/merchandise/manage-orders" label="Collected" value={fmt(totalRevenue)} context="From paid orders" />
        </section>
      )}

      {activeTab === "inventory" && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-full sm:w-64">
              <Input
                value={inventorySearch}
                onChange={(e) => setInventorySearch(e.target.value)}
                type="search"
                aria-label="Search inventory"
                placeholder="Search items"
              />
            </div>
            <div className="w-full sm:w-56">
              <HiusaSelect filter aria-label="Filter inventory by category" value={inventoryCategory} onChange={(event) => setInventoryCategory(event.target.value)}>
                <option value="all">All categories</option>
                {inventoryCategories.map((category) => <option key={category} value={category}>{category}</option>)}
              </HiusaSelect>
            </div>
            {inventoryFiltersActive && <button type="button" onClick={clearInventoryFilters} className={linkButton}>Clear</button>}
          </div>
          {items.length > 0 && (
            <p className="text-xs text-ink-muted">
              {items.length} {items.length === 1 ? "item" : "items"}{lowStock > 0 ? `, ${lowStock} low on stock` : ""}
            </p>
          )}
          <DataTable
            caption="Merchandise inventory"
            columns={inventoryColumns}
            rows={filteredInventoryItems}
            rowKey={(item) => item.id}
            loading={loading}
            pageSize={20}
            emptyState={items.length > 0 ? (
              <EmptyState
                kind="filtered"
                title="No items match these filters"
                onClearFilters={clearInventoryFilters}
              />
            ) : role === "ADMIN" ? (
              <EmptyState
                icon={Package}
                title="No items yet"
                description="Add your first merchandise item so students can order it from the Shop."
                action={<Button leftIcon={Plus} onClick={() => setShowForm(true)}>Add your first item</Button>}
              />
            ) : (
              <EmptyState
                kind="restricted"
                title="No items yet"
                description="Only the Admin can add merchandise."
              />
            )}
            actions={role === "ADMIN" ? (item) => (
              <TableRowActions subject={formatDisplayText(item.name)} actions={[
                { label: 'View audit history', icon: Eye, onClick: async () => { try { const response = await getMerchandiseAuditLogs(item.id); setAuditModal({ item, logs: response.data }); } catch { showFeedback("error", "Could not load product history."); } } },
                { label: 'Add stock', icon: Plus, onClick: () => openAddStockModal(item) },
                { label: item.is_active ? 'Stop selling' : 'Start selling', onClick: () => confirmSellingToggle(item) },
                { label: 'Edit', icon: Pencil, onClick: () => openEditForm(item) },
                item.is_active && { label: `Delete ${formatDisplayText(item.name)}`, icon: Trash2, danger: true, onClick: () => confirmDeleteProduct(item) },
              ]} />
            ) : undefined}
          />
        </section>
      )}

      {activeTab === "inventory" && (
        <section className="rounded-card border border-line bg-white p-4">
          <h2 className="text-sm font-semibold text-ink">Top sellers</h2>
          {topSellers.length === 0 ? <p className="mt-2 text-sm text-ink-muted">No paid merchandise sales yet.</p> : (
            <ol className="mt-3 divide-y divide-line">
              {topSellers.map((seller, index) => (
                <li key={`${seller.id}-${index}`} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className="w-6 tabular-nums text-ink-muted">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold text-ink">{formatDisplayText(seller.name)}</span>
                  <span className="text-xs text-ink-muted">{fmt(seller.collected)} collected</span>
                  <span className="w-20 text-right tabular-nums text-ink">{seller.quantity} sold</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {activeTab === "orders" && (
        <section aria-label="Order management" className="min-w-0 space-y-4">
          <div className="min-w-0 overflow-hidden rounded-card border border-line bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-ink">Order queue</h2>
                  <span className="text-xs tabular-nums text-ink-muted">{loading ? "Loading..." : `${ordersMeta.total} ${ordersMeta.total === 1 ? "order" : "orders"}`}</span>
                </div>
                {orderSummary && (
                  <p className="mt-1 text-xs text-ink-muted">
                    {orderSummary.pending_orders} pending review · {orderSummary.unclaimed_orders} ready for pickup · {orderSummary.claimed_orders} claimed · {fmt(orderSummary.total_collected)} collected
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" leftIcon={Settings2} onClick={() => setShowPaymentSettings(true)}>
                  {role === "ADMIN" ? "Payment settings" : "View GCash QR"}
                </Button>
                <Button type="button" variant="secondary" leftIcon={Download} onClick={handleOrderExport} disabled={exportingOrders}>
                  {exportingOrders ? "Exporting..." : "Export CSV"}
                </Button>
              </div>
            </div>
            <div className="border-b border-line px-4">
              <div role="group" aria-label="Filter orders by status" className="flex flex-wrap gap-x-4">
                {[
                  ["", "All orders"],
                  ["pending", "Pending review"],
                  ["paid", "Ready for pickup"],
                  ["claimed", "Claimed"],
                  ["cancelled", "Cancelled"],
                ].map(([status, label]) => (
                  <button key={status} type="button" aria-pressed={orderFilters.status === status} onClick={() => setOrderFilters((current) => ({ ...current, status }))} className={`min-h-11 shrink-0 border-b-2 px-1 text-sm transition-colors duration-150 ${orderFilters.status === status ? "border-brand-700 font-semibold text-ink" : "border-transparent font-medium text-ink-muted hover:text-ink"}`}>{label}</button>
                ))}
              </div>
            </div>
            <div className="border-b border-line p-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_200px_170px_auto]">
                <div className="sm:col-span-2 lg:col-span-1">
                  <Input
                    aria-label="Search merchandise orders"
                    value={orderFilters.search}
                    onChange={(event) =>
                      setOrderFilters({
                        ...orderFilters,
                        search: event.target.value,
                      })
                    }
                    placeholder="Search order, student, item, reference"
                  />
                </div>
                <HiusaSelect filter
                  aria-label="Merchandise item"
                  value={orderFilters.merchandise_id}
                  onChange={(event) =>
                    setOrderFilters({
                      ...orderFilters,
                      merchandise_id: event.target.value,
                    })
                  }
                >
                  <option value="">All merchandise</option>
                  {orderFilterOptions.merchandise?.map((item) => (
                    <option key={item.id} value={item.id}>
                      {formatDisplayText(item.name)}
                    </option>
                  ))}
                </HiusaSelect>
                <HiusaSelect
                  aria-label="Sort orders"
                  value={orderFilters.sort}
                  onChange={(event) =>
                    setOrderFilters({ ...orderFilters, sort: event.target.value })
                  }
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="amount_high">Highest amount</option>
                  <option value="amount_low">Lowest amount</option>
                  <option value="student">Student name</option>
                  <option value="item">Merchandise item</option>
                  <option value="status">Order status</option>
                </HiusaSelect>
                <button type="button" aria-expanded={showAdvancedFilters} aria-controls="order-advanced-filters" onClick={() => setShowAdvancedFilters((value) => !value)} className="inline-flex min-h-11 items-center justify-center rounded-control border border-line px-3 text-sm font-medium text-ink hover:bg-subtle sm:col-span-2 lg:col-span-1 lg:min-h-10">
                  More filters{activeOrderFilterCount > 0 ? ` (${activeOrderFilterCount})` : ""}
                </button>
              </div>
              {showAdvancedFilters && (
                <div id="order-advanced-filters" className="mt-4 border-t border-line pt-4">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
                    <HiusaSelect filter
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
                    >
                      <option value="">All programs</option>
                      {orderFilterOptions.programs?.map((program) => (
                        <option key={program.id} value={program.name}>
                          {formatDisplayText(program.name)}
                        </option>
                      ))}
                    </HiusaSelect>
                    <HiusaSelect filter
                      aria-label="Major or specialization"
                      value={orderFilters.major}
                      onChange={(event) =>
                        setOrderFilters({
                          ...orderFilters,
                          major: event.target.value,
                        })
                      }
                    >
                      <option value="">All majors</option>
                      {orderFilterOptions.majors?.map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </HiusaSelect>
                    <HiusaSelect filter
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
                    >
                      <option value="">All year levels</option>
                      {["1st Year", "2nd Year", "3rd Year", "4th Year"].map(
                        (year) => (
                          <option key={year}>{year}</option>
                        ),
                      )}
                    </HiusaSelect>
                    <HiusaSelect filter
                      aria-label="Section"
                      value={orderFilters.section}
                      disabled={!orderFilters.program || !orderFilters.year_level}
                      onChange={(event) =>
                        setOrderFilters({
                          ...orderFilters,
                          section: event.target.value,
                        })
                      }
                    >
                      <option value="">All sections</option>
                      {availableSections.map((section) => (
                        <option key={section.id} value={section.name}>
                          {formatDisplayText(section.name)}
                        </option>
                      ))}
                    </HiusaSelect>
                    <HiusaSelect filter
                      aria-label="User role"
                      value={orderFilters.role}
                      onChange={(event) =>
                        setOrderFilters({
                          ...orderFilters,
                          role: event.target.value,
                        })
                      }
                    >
                      <option value="">All user roles</option>
                      {orderFilterOptions.roles?.map((value) => (
                        <option key={value} value={value}>
                          {value.replaceAll("_", " ")}
                        </option>
                      ))}
                    </HiusaSelect>
                    <HiusaSelect filter
                      aria-label="SBO position"
                      value={orderFilters.position_title}
                      onChange={(event) =>
                        setOrderFilters({
                          ...orderFilters,
                          position_title: event.target.value,
                        })
                      }
                    >
                      <option value="">All SBO positions</option>
                      {orderFilterOptions.positions?.map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </HiusaSelect>
                    <HiusaSelect filter
                      aria-label="Payment method"
                      value={orderFilters.payment_method}
                      onChange={(event) =>
                        setOrderFilters({
                          ...orderFilters,
                          payment_method: event.target.value,
                        })
                      }
                    >
                      <option value="">All payment methods</option>
                      {orderFilterOptions.payment_methods?.map((value) => (
                        <option key={value} value={value}>{value.toUpperCase()}</option>
                      ))}
                    </HiusaSelect>
                    {[
                      ["ordered_from", "Ordered from"],
                      ["ordered_to", "Ordered to"],
                      ["paid_from", "Paid from"],
                      ["paid_to", "Paid to"],
                      ["claimed_from", "Claimed from"],
                      ["claimed_to", "Claimed to"],
                    ].map(([key, label]) => (
                      <Field key={key} label={label}>
                        <Input
                          type="date"
                          value={orderFilters[key]}
                          onChange={(event) =>
                            setOrderFilters({
                              ...orderFilters,
                              [key]: event.target.value,
                            })
                          }
                        />
                      </Field>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setOrderFilters(EMPTY_ORDER_FILTERS)}
                    className={`mt-2 ${linkButton}`}
                  >
                    Clear all filters
                  </button>
                </div>
              )}
            </div>
            {loading ? (
              <div className="px-4 py-3">
                <SkeletonTable columns={6} rows={5} />
              </div>
            ) : filteredOfficerOrders.length === 0 ? (
              <div className="px-4">
                {activeOrderFilterCount > 0 ? (
                  <EmptyState
                    kind="filtered"
                    title="No orders match these filters"
                    onClearFilters={() => setOrderFilters(EMPTY_ORDER_FILTERS)}
                  />
                ) : (
                  <EmptyState
                    icon={ShoppingBag}
                    title="No orders yet"
                    description={role === "ADMIN" ? "Orders appear here when students check out from the Shop. Add merchandise in Inventory first." : "Orders appear here when students check out from the Shop."}
                    action={role === "ADMIN" ? <Button variant="secondary" to="/dashboard/merchandise/manage-inventory">Open inventory</Button> : undefined}
                  />
                )}
              </div>
            ) : (
              <>
                <div className="xl:hidden">
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
                <div className="hidden xl:block">
                  <table className="w-full text-left">
                    <caption className="sr-only">Merchandise orders</caption>
                    <thead className="bg-subtle text-xs font-semibold text-ink-muted">
                      <tr>
                        <th className="px-3 py-2.5">Order</th>
                        <th className="px-3 py-2.5">Student / User</th>
                        <th className="px-3 py-2.5">Item</th>
                        <th className="px-3 py-2.5 text-right">Total</th>
                        <th className="px-3 py-2.5">Mode of payment</th>
                        <th className="px-3 py-2.5">Fulfillment</th>
                        <th className="px-3 py-2.5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line text-sm">
                      {filteredOfficerOrders.map((o) => (
                        <tr key={o.id} className="transition-colors duration-150 hover:bg-subtle">
                          <td className="px-3 py-2.5 align-top">
                            <p className="font-mono text-xs font-semibold text-brand-700">
                              ORD-{o.id}
                            </p>
                          </td>
                          <td className="px-3 py-2.5 align-top">
                            <p className="text-left font-semibold text-ink">
                              {o.student
                                ? `${formatDisplayText(o.student.first_name)} ${formatDisplayText(o.student.last_name)}`
                                : ""}
                            </p>
                            <p className="mt-0.5 text-xs text-ink-muted">
                              <span className="font-mono">{o.student?.school_id}</span>
                              {studentProfile(o.student) && ` · ${studentProfile(o.student)}`}
                            </p>
                          </td>
                          <td className="px-3 py-2.5 align-top">
                            <p className="text-ink">
                              {formatDisplayText(o.merchandise?.name) ?? ""}
                            </p>
                            <p className="mt-0.5 text-xs text-ink-muted">
                              {o.quantity} x {fmt(o.unit_price ?? Number(o.total_price) / Number(o.quantity || 1))}
                            </p>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right align-top tabular-nums text-ink">{fmt(o.total_price)}</td>
                          <td className="px-3 py-2.5 align-top text-xs">
                            {o.payment_method && <>
                              <p className="text-ink">{paymentLabel(o.payment_method)}</p>
                              {o.payment_method !== "cash" && <p className="mt-0.5 max-w-32 break-words text-ink-muted">{o.payment_reference || "Reference pending"}</p>}
                            </>}
                          </td>
                          <td className="px-3 py-2.5 align-top">
                            <OrderStatus status={o.status} />
                            <OrderStage flow={staffOrderFlow(o, role)} order={o} className="mt-1.5" />
                          </td>
                          <td className="px-3 py-2.5 text-right align-top">
                            <div className="flex justify-end">
                              <TableRowActions subject={`Order ${o.id}`} label="Order actions" actions={[
                                { label: 'Review order', icon: Search, onClick: () => openOrderDetails(o) },
                                o.status === 'paid' && { label: 'Release at claim desk', icon: Ticket, onClick: () => navigate('/dashboard/merchandise/claim-tokens') },
                                o.status === 'pending' && { label: role === 'ADMIN' ? 'Approve directly' : 'Verify and submit', icon: ArrowRight, onClick: () => openPaymentVerification(o) },
                                o.status === 'pending' && { label: 'Reject order', icon: X, danger: true, onClick: () => openOrderRejection(o) },
                              ]} />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <PaginationControls
              currentPage={ordersMeta.current_page}
              totalItems={ordersMeta.total}
              pageSize={ordersMeta.per_page}
              onPageChange={loadOrders}
              label="orders"
            />
          </div>
          {orderSummary && (
            <div className="flex flex-col gap-1 px-1 text-sm sm:flex-row sm:items-center sm:justify-between">
              <p className="text-ink-muted-strong">
                {orderSummary.purchased_users} of {orderSummary.total_users} users purchased ({orderSummary.purchase_rate}%).
              </p>
              <div className="flex flex-wrap gap-4">
                <button type="button" onClick={() => openOrderAnalytics("purchased", "Purchased users")} className={linkButton}>
                  View purchasers
                </button>
                <button type="button" onClick={() => openOrderAnalytics("not_purchased", "Users without purchases")} className={linkButton}>
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
        <GcashPaymentSettingsPage embedded showHeading={false} readOnly={role !== "ADMIN"} onBusyChange={setPaymentSettingsBusy} onSaved={setGcashSettings} />
      </Modal>

      <Drawer
        open={analyticsModal.open}
        title={formatDisplayText(analyticsModal.title)}
        description="Users and matching orders for the active filters."
        onClose={closeAnalytics}
        width="max-w-4xl"
      >
        <div className="space-y-4">
          <Button type="button" variant="secondary" leftIcon={Download} onClick={exportOrderAnalytics} disabled={exportingAnalytics || analyticsModal.loading}>
            {exportingAnalytics ? "Exporting..." : "Export Excel"}
          </Button>
          <DataTable
            caption="Users and orders"
            columns={analyticsColumns}
            rows={pagedAnalyticsRows}
            rowKey={(row) => `${row.user.school_id}-${row.order?.id ?? "none"}`}
            loading={analyticsModal.loading}
            error={analyticsModal.error || null}
            emptyState={<EmptyState title="No users match this drill-down" />}
            pagination={
              <>
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
            }
          />
        </div>
      </Drawer>

      {orderDetails && (
        <AccessibleOverlay label="Merchandise order details" onClose={closeOrderDetails} className="fixed inset-0 z-[80] flex items-center justify-center bg-navy-950/55 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-card border border-line bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold text-ink">
                ORD-{orderDetails.id} · {formatDisplayText(orderDetails.merchandise?.name)}
              </h2>
              <button
                type="button"
                aria-label="Close order details"
                onClick={closeOrderDetails}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-control text-ink-muted hover:bg-subtle"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="mt-4 space-y-4">
              <FlowStepper variant="full" steps={staffOrderFlow(orderDetails, role).steps} ariaLabel={`ORD-${orderDetails.id} progress`} />
              <NextStep {...staffNextStepProps(orderDetails, role, staffOrderFlow(orderDetails, role), () => openPaymentVerification(orderDetails))} />
            </div>
            <div className="mt-5"><ReceiptDocument order={orderDetails} onViewProof={handleViewPaymentProof} /></div>
            <section className="mt-5 border-t border-line pt-5" aria-label="Order fulfillment details">
              <dl className="grid gap-3 text-xs sm:grid-cols-2">
                {[
                  ["Buyer role", [(orderDetails.student?.role || "").replaceAll("_", " "), formatDisplayText(orderDetails.student?.position_title)].filter(Boolean).join(" · ") || "Not recorded"],
                  ["Item category", orderDetails.merchandise?.category || "Uncategorized"],
                  ["Claim token", orderDetails.claim_token || "Not issued"],
                  ["Released by", orderDetails.claim_verifier ? `${formatDisplayText(orderDetails.claim_verifier.first_name)} ${formatDisplayText(orderDetails.claim_verifier.last_name)}` : "Not released"],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="font-semibold text-ink-muted">{label}</dt>
                    <dd className="mt-0.5 break-words text-sm font-semibold text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
            {isFulfillmentRole && orderDetails.status === 'pending' && <div className="mt-5 flex flex-wrap justify-end gap-3 border-t border-line pt-4">
              <Button type="button" variant="secondary" className="text-danger-strong" onClick={() => openOrderRejection(orderDetails)}>Reject order</Button>
            </div>}
            <section className="mt-5 border-t border-line pt-5">
              <h3 className="text-base font-semibold text-ink">
                Order activity history
              </h3>
              {orderReviewTrail.loading ? (
                <div className="mt-4">
                  <SkeletonTable columns={2} rows={3} />
                </div>
              ) : orderReviewTrail.error ? (
                <p role="alert" className="mt-4 text-sm font-semibold text-danger-strong">
                  {orderReviewTrail.error}
                </p>
              ) : orderReviewTrail.entries.length === 0 ? (
                <p className="mt-4 text-sm text-ink-muted">
                  No review actions have been recorded yet.
                </p>
              ) : (
                <ol className="mt-3 divide-y divide-line">
                  {orderReviewTrail.entries.map((entry) => (
                    <li
                      key={entry.id}
                      className="py-3"
                    >
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-ink">
                            {reviewActionLabel(entry.action)}
                          </p>
                          <p className="mt-1 text-xs text-ink-muted">
                            {entry.user
                              ? `${formatDisplayText(entry.user.first_name)} ${formatDisplayText(entry.user.last_name)}`
                              : "System"}
                            {entry.user?.position_title
                              ? ` · ${formatDisplayText(entry.user.position_title)}`
                              : entry.user?.role
                                ? ` · ${entry.user.role.replaceAll("_", " ")}`
                                : ""}
                          </p>
                        </div>
                        <time className="text-xs text-ink-muted">
                          {fmtDateTime(entry.created_at)}
                        </time>
                      </div>
                      {entry.new_values?.review_remarks && (
                        <p className="mt-2 text-xs text-ink-muted-strong">
                          Remarks: {entry.new_values.review_remarks}
                        </p>
                      )}
                      {entry.old_values?.status && entry.old_values.status !== entry.new_values?.status && <p className="mt-1 text-xs text-ink-muted-strong">Status: {capitalize(entry.old_values.status)} → {capitalize(entry.new_values?.status)}</p>}
                      {entry.new_values?.variant_name && <p className="mt-1 text-xs text-ink-muted-strong">Variant: {entry.new_values.variant_name}</p>}
                      {entry.new_values?.total_price !== undefined && <p className="mt-1 text-xs text-ink-muted-strong">Order total: {fmt(entry.new_values.total_price)}</p>}
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
          <div className="rounded-card border border-line bg-white p-4 sm:p-5">
            <h2 className="text-base font-semibold text-ink">
              Release an order
            </h2>
            <p className="mt-1 text-sm text-ink-muted-strong">
              Enter the buyer's claim token, match the buyer and item, then confirm before releasing merchandise.
            </p>
            <form onSubmit={handleClaim} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              <Field label="16-character claim token" className="min-w-0 flex-1">
                <Input
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
                  className="font-mono"
                />
              </Field>
              <Button type="submit" disabled={claiming || !claimToken.trim()}>
                {claiming ? "Checking..." : "Claim"}
              </Button>
            </form>
          </div>

          <div className="rounded-card border border-line bg-white p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-ink">
                Claim desk register
              </h2>
              <div className="w-full sm:w-56">
                <HiusaSelect filter aria-label="Filter claim tokens by status" value={tokenStatusFilter} onChange={(event) => setTokenStatusFilter(event.target.value)}><option value="claimable">All claim tokens</option><option value="paid">Pending claim</option><option value="claimed">Claimed</option></HiusaSelect>
              </div>
            </div>
            <DataTable
              caption="Claim tokens"
              columns={tokenColumns}
              rows={tokenOrders}
              rowKey={(o) => o.id}
              loading={loading}
              pagination={
                <PaginationControls
                  currentPage={ordersMeta.current_page}
                  totalItems={ordersMeta.total}
                  pageSize={ordersMeta.per_page}
                  onPageChange={(page) => loadOrders(page, { ...EMPTY_ORDER_FILTERS, status: tokenStatusFilter, sort: "oldest" })}
                  label="paid orders"
                />
              }
              emptyState={tokenStatusFilter !== "claimed" ? (
                <EmptyState
                  icon={Ticket}
                  title={tokenStatusFilter === 'claimable' ? 'No claim tokens yet' : 'Nothing is waiting at the claim desk'}
                  description="Orders appear here once their payment is verified and the buyer has a claim token."
                  action={<Button variant="secondary" to="/dashboard/merchandise/manage-orders">Open orders</Button>}
                />
              ) : (
                <EmptyState
                  icon={Ticket}
                  title="No orders have been claimed yet"
                  description="Released orders are listed here after you confirm a claim."
                />
              )}
              actions={(o) => (
                <TableRowActions subject={`Order ${o.id}`} label="Order actions" actions={[{ label: 'Review order', icon: Search, onClick: () => openOrderDetails(o) }]} />
              )}
            />
          </div>
        </section>
      )}

      {claimPreview && (
        <AccessibleOverlay label="Verify claim before release" onClose={() => !claiming && setClaimPreview(null)} className="fixed inset-0 z-[80] flex items-center justify-center bg-navy-950/55 p-4">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-card border border-line bg-white p-5">
            <h2 className="text-lg font-semibold text-ink">Verify purchaser and release</h2>
            <p className="mt-1 text-sm text-ink-muted-strong">Check the school ID and items with the purchaser. Release finalizes this token.</p>
            <div className="mt-4"><ReceiptDocument order={claimPreview} onViewProof={handleViewPaymentProof} releasingOfficer={(() => { try { const user = JSON.parse(localStorage.getItem("user")); return [user?.first_name, user?.last_name].filter(Boolean).join(" ") || "Current officer"; } catch { return "Current officer"; } })()} /></div>
            {claimError && <p role="alert" className="mt-3 text-sm font-semibold text-danger-strong">{claimError}</p>}
            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <Button type="button" variant="secondary" disabled={claiming} onClick={() => setClaimPreview(null)}>Cancel</Button>
              <Button type="button" disabled={claiming} onClick={() => handleClaimByToken(claimPreview.claim_token)}>{claiming ? "Releasing..." : "Confirm release"}</Button>
            </div>
          </div>
        </AccessibleOverlay>
      )}

      {showForm && (
        <AccessibleOverlay label="Add merchandise product" onClose={closeAddForm} className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-card border border-line bg-white p-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-ink">Add product</h2>
              <button
                type="button"
                aria-label="Close add product form"
                onClick={() => {
                  setShowForm(false);
                  setImageFile(null);
                  setImagePreview(null);
                }}
                className="grid h-11 w-11 place-items-center rounded-control text-ink-muted hover:bg-subtle"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <ProductForm
              value={form}
              onChange={setForm}
              images={variantImages}
              onImagesChange={setVariantImages}
              preview={imagePreview}
              onImage={handleImageSelect}
              onSubmit={handleAddItem}
              onCancel={() => {
                setShowForm(false);
                setImageFile(null);
                setImagePreview(null);
              }}
              submitDisabled={
                formSubmitting ||
                !form.name ||
                !form.unit_price ||
                (!form.stock_quantity && !form.variants.length) || !form.category
              }
              submitLabel={formSubmitting ? "Adding..." : "Add product"}
            />
          </div>
        </AccessibleOverlay>
      )}

      <ProductImageViewer lightbox={lightbox} onChange={setLightbox} onClose={() => setLightbox(null)} />

      {auditModal && <AccessibleOverlay label={`${auditModal.item.name} audit history`} onClose={() => setAuditModal(null)} className="fixed inset-0 z-[70] flex items-center justify-center bg-navy-950/50 p-4">
        <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-card border border-line bg-white p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold text-ink">{formatDisplayText(auditModal.item.name)} history</h2>
            <button type="button" onClick={() => setAuditModal(null)} aria-label="Close audit history" className="grid h-11 w-11 place-items-center rounded-control text-ink-muted hover:bg-subtle"><X size={18} aria-hidden="true" /></button>
          </div>
          {auditModal.logs.length === 0 ? <p className="mt-4 text-sm text-ink-muted">No recorded changes yet.</p> : (
            <ol className="mt-3 divide-y divide-line">
              {auditModal.logs.map((log) => (
                <li key={log.id} className="py-3 text-xs">
                  <div className="flex flex-wrap justify-between gap-1">
                    <strong className="font-semibold capitalize text-ink">{log.action.replaceAll("_", " ")}</strong>
                    <time className="text-ink-muted">{fmtDateTime(log.created_at)}</time>
                  </div>
                  <p className="mt-1 text-ink-muted-strong">{log.user ? `${formatDisplayText(log.user.first_name)} ${formatDisplayText(log.user.last_name)}` : log.user_id || "System"} · {log.actor_role || log.user?.role || ""}</p>
                  {log.new_values?.note && <p className="mt-1">Note: {log.new_values.note}</p>}
                  {log.old_values?.stock_quantity !== undefined && <p className="mt-1">Stock: {log.old_values.stock_quantity} → {log.new_values?.stock_quantity}{log.new_values?.variant_name ? ` · ${log.new_values.variant_name}` : ""}</p>}
                  {log.old_values?.price !== undefined && log.old_values.price !== log.new_values?.price && <p className="mt-1">Price: {fmt(log.old_values.price)} → {fmt(log.new_values?.price)}</p>}
                </li>
              ))}
            </ol>
          )}
        </div>
      </AccessibleOverlay>}

      {showEditForm && (
        <AccessibleOverlay label="Edit merchandise product" onClose={() => !formSubmitting && closeEditForm()} className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-card border border-line bg-white p-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-ink">Edit product</h2>
              <button
                type="button"
                aria-label="Close edit product form"
                onClick={closeEditForm}
                className="grid h-11 w-11 place-items-center rounded-control text-ink-muted hover:bg-subtle"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <ProductForm
              editing
              value={editForm}
              onChange={setEditForm}
              images={variantImages}
              onImagesChange={setVariantImages}
              preview={editImagePreview}
              onImage={(e) => {
                const file = e.target.files[0];
                if (!file) return;
                setEditImageFile(file);
                setEditImagePreview(URL.createObjectURL(file));
              }}
              onSubmit={handleUpdateItem}
              onCancel={closeEditForm}
              submitDisabled={
                formSubmitting ||
                !editForm.name ||
                !editForm.unit_price ||
                (!editForm.stock_quantity && !editForm.variants.length) || !editForm.category
              }
              submitLabel={formSubmitting ? "Saving..." : "Save changes"}
            />
          </div>
        </AccessibleOverlay>
      )}

      {verificationModal.open && verificationModal.order && (
        <AccessibleOverlay label="Verify merchandise payment" onClose={() => !verificationModal.busy && setVerificationModal({ open: false, order: null, amount: "", busy: false, error: "" })} className="fixed inset-0 z-[65] flex items-center justify-center bg-navy-950/50 p-4">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-card border border-line bg-white p-6">
            <h3 className="text-lg font-semibold text-ink">
              {role === "ADMIN"
                ? "Approve payment directly"
                : "Verify payment amount"}
            </h3>
            <p className="mt-1 text-sm text-ink-muted-strong">
              {role === "ADMIN"
                ? "Approve this order without waiting for an SBO Officer review. "
                : ""}
              Confirm the payment for ORD-{verificationModal.order.id} matches{" "}
              {fmt(verificationModal.order.total_price)}.
            </p>
            <div className="mt-4"><ReceiptDocument order={verificationModal.order} onViewProof={handleViewPaymentProof} /></div>
            {verificationModal.order.payment_method === "gcash" && !verificationModal.order.payment_proof_url && (
              <p className="mt-3 text-xs font-semibold text-danger-strong">
                No payment proof is attached.
              </p>
            )}
            <div className="mt-4">
              <Field label="Amount verified" required>
                <Input
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
                />
              </Field>
            </div>
            {verificationModal.error && (
              <p role="alert" className="mt-2 text-xs font-semibold text-danger-strong">
                {verificationModal.error}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
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
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handlePaymentVerification}
                disabled={
                  verificationModal.busy ||
                  (verificationModal.order.payment_method === "gcash" &&
                    !verificationModal.order.payment_proof_url)
                }
              >
                {verificationModal.busy
                  ? "Submitting..."
                  : role === "ADMIN"
                    ? "Approve payment"
                    : "Verify and submit"}
              </Button>
            </div>
          </div>
        </AccessibleOverlay>
      )}

      {rejectionModal.open && rejectionModal.order && (
        <AccessibleOverlay label="Reject merchandise payment" onClose={() => !rejectionModal.busy && setRejectionModal({ open: false, order: null, remarks: "", busy: false })} className="fixed inset-0 z-[65] flex items-center justify-center bg-navy-950/50 p-4">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-card border border-line bg-white p-6">
            <h3 className="text-lg font-semibold text-ink">
              Reject payment
            </h3>
            <p className="mt-1 text-sm text-ink-muted-strong">
              Give the reason for rejecting order ORD-
              {rejectionModal.order.id}.
            </p>
            <div className="mt-4"><ReceiptDocument order={rejectionModal.order} onViewProof={handleViewPaymentProof} /></div>
            <div className="mt-4">
              <Field label="Rejection reason" required>
                <Textarea
                  id="rejection-reason"
                  rows={4}
                  maxLength={1000}
                  value={rejectionModal.remarks}
                  onChange={(e) =>
                    setRejectionModal((current) => ({
                      ...current,
                      remarks: e.target.value,
                      error: "",
                    }))
                  }
                  placeholder="Rejection reason"
                />
              </Field>
            </div>
            {rejectionModal.error && <p role="alert" className="mt-2 text-sm font-semibold text-danger-strong">{rejectionModal.error}</p>}
            <div className="mt-5 flex justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
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
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
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
              >
                {rejectionModal.busy ? "Rejecting..." : "Reject payment"}
              </Button>
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
