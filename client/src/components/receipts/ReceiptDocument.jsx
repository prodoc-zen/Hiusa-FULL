import { formatDisplayText } from '../../utils/displayText.js';
import { peso as money } from '../../lib/format';
import { Eye, Printer } from 'lucide-react';
import { Button, StatusBadge } from '../ui';

const dateTime = (value) => value ? new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }) : 'Not recorded';
const person = (value) => [value?.first_name, value?.last_name].filter(Boolean).join(' ') || 'Not recorded';
const sentence = (text) => text.charAt(0).toUpperCase() + text.slice(1);
// The methods an order can be paid with. A payment recorded by an admin carries none.
const PAYMENT_METHODS = [['cash', 'Cash'], ['gcash', 'GCash'], ['other', 'Other']];
const readable = (value) => value ? sentence(String(value).replaceAll('_', ' ').toLowerCase()) : 'Not recorded';
const paymentMethod = (value) => String(value).toLowerCase() === 'gcash' ? 'GCash' : readable(value);

function Line({ label, value }) {
  return <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-1 text-sm"><dt className="text-slate-500">{label}</dt><dd className="break-words text-right font-semibold text-ink">{value ?? 'Not recorded'}</dd></div>;
}

function Section({ title, children }) {
  return <section className="border-t border-line pt-4"><h3 className="mb-2 text-xs font-semibold text-brand-700">{title}</h3>{children}</section>;
}

export default function ReceiptDocument({ order, transaction, onViewProof, releasingOfficer }) {
  const isOrder = Boolean(order);
  const record = order || transaction;
  if (!record) return null;
  const organization = record.organization?.name || 'HIUSA';
  const number = isOrder ? `ORD-${order.id}` : transaction.receipt_reference || (transaction.receipt_number ? `Receipt #${transaction.receipt_number}` : `Receipt #${transaction.id}`);
  const amount = isOrder ? order.total_price : transaction.amount;
  const payer = isOrder ? order.student : transaction.payer;
  const receipt = isOrder ? order.transaction : transaction;
  const approver = isOrder ? order.approver : transaction.merchandise_order?.approver;
  const collector = isOrder ? order.processor : transaction.recorder;

  if (!isOrder) {
    const method = transaction.merchandise_order?.payment_method;
    return <><div data-receipt-document data-personal-receipt className="mx-auto max-w-2xl border border-slate-300 bg-white p-5 text-ink sm:p-8">
      <div className="flex items-end justify-between gap-3 border-y-2 border-ink py-2"><h2 className="font-serif text-3xl">Receipt</h2><p className="text-xs"><strong>Date:</strong> {dateTime(transaction.transaction_date)}</p></div>
      <p className="border-b border-slate-500 py-3 text-xs"><strong>Received from:</strong> {person(payer)} <span className="float-right"><strong>Number:</strong> {number}</span></p>
      <p className="border-b border-slate-500 py-3 text-xs"><strong>Amount:</strong> {money(amount)}</p>
      {method ? <div className="flex flex-wrap gap-x-5 gap-y-2 border-b border-slate-500 py-3 text-xs" aria-label="Mode of payment">{PAYMENT_METHODS.map(([value, label]) => <span key={value}>{method.toLowerCase() === value ? '☑' : '☐'} {label}</span>)}</div> : <p className="border-b border-slate-500 py-3 text-xs"><strong>Mode of payment:</strong> Not recorded</p>}
      <p className="border-b border-slate-500 py-3 text-xs"><strong>Payment for:</strong> {transaction.description || transaction.category || 'Not recorded'}</p>
      <div className="grid gap-3 border-b-2 border-ink py-3 text-xs sm:grid-cols-2"><p><strong>Received by:</strong> {person(collector)}</p><p><strong>Signature:</strong> ____________________</p></div>
      <p className="mt-3 text-xs text-slate-600">{organization}</p>
    </div><section className="mx-auto mt-4 max-w-2xl rounded-lg border border-line bg-subtle p-4 text-sm"><h3 className="font-semibold text-navy-800">Transaction details</h3><dl className="mt-2"><Line label="Event" value={transaction.event?.title || 'Not linked'} /><Line label="Budget" value={transaction.budget?.title || 'Not linked'} /><Line label="Category" value={transaction.category || 'Not recorded'} /></dl></section></>;
  }

  return <div className="rounded-lg border border-line bg-white p-5 text-ink sm:p-6" data-receipt-document>
    <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-navy-800 pb-5">
      <div><h2 className="text-xl font-semibold text-navy-800">{organization}</h2><p className="mt-1 text-xs text-slate-500">{isOrder ? 'Merchandise order' : 'Payment receipt'}</p></div>
      <div className="text-left sm:text-right"><p className="font-mono text-lg font-semibold">{number}</p><p className="mt-1 text-xs text-slate-500">{dateTime(isOrder ? order.created_at : transaction.transaction_date)}</p></div>
    </header>
    <div className="mt-4 space-y-4">
      <Section title="Purchaser"><dl><Line label="Name" value={person(payer)} />{isOrder && <><Line label="School ID" value={payer?.school_id} /><Line label="Department" value={payer?.department} /><Line label="Program / course" value={payer?.program} /><Line label="Year / section" value={[payer?.year_level, payer?.section].filter(Boolean).join(' · ') || 'Not recorded'} /></>}</dl></Section>
      {isOrder ? <Section title="Items"><div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2 border-b border-line pb-2 text-xs font-semibold text-slate-500"><span>Product / variant</span><span>Qty</span><span>Subtotal</span></div><div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2 py-3 text-sm"><div><p className="font-semibold">{formatDisplayText(order.merchandise?.name) || 'Merchandise'}</p><p className="text-xs text-slate-500">{order.variant_name || formatDisplayText(order.variant?.name) || 'Standard'} · {money(order.unit_price ?? Number(order.total_price) / Number(order.quantity || 1))} each</p></div><span>{order.quantity}</span><span className="font-semibold">{money(order.total_price)}</span></div></Section> : <Section title="Transaction"><dl><Line label="Purpose" value={transaction.description || transaction.category} /><Line label="Type / category" value={`${readable(transaction.type)} · ${transaction.category || 'Not recorded'}`} /><Line label="Event" value={transaction.event?.title || 'Not linked'} /><Line label="Budget" value={transaction.budget?.title || 'Not linked'} /></dl></Section>}
      <Section title="Payment"><dl><Line label="Receipt number" value={receipt?.receipt_reference || (receipt?.receipt_number ? `#${receipt.receipt_number}` : 'Not generated')} /><Line label="Payment date / time" value={dateTime(receipt?.transaction_date)} /><Line label="Method" value={paymentMethod(isOrder ? order.payment_method : transaction.merchandise_order?.payment_method)} />{isOrder && <><Line label="Reference" value={order.payment_reference || 'Not provided'} /><Line label="Payment status" value={order.status === 'cancelled' ? 'Cancelled' : order.status === 'paid' || order.status === 'claimed' ? 'Paid' : 'Pending'} /><Line label="Order status" value={readable(order.status)} /><Line label="Proof" value={order.payment_proof_url ? 'Attached' : 'No file attached'} /></>}</dl>{isOrder && order.payment_proof_url && onViewProof && (<Button variant="secondary" size="sm" className="mt-2.5" leftIcon={Eye} onClick={() => onViewProof(order.id)}>Open payment proof</Button>)}</Section>
      <Section title="Processing"><dl><Line label="Recorded / processed by" value={person(collector)} /><Line label="Approved by" value={person(approver)} />{isOrder && <><Line label="Officer review" value={readable(order.officer_review_status)} /><Line label="Admin review" value={readable(order.admin_review_status)} />{releasingOfficer && <Line label="Releasing officer" value={releasingOfficer} />}{order.claimed_at && <Line label="Claimed / released" value={dateTime(order.claimed_at)} />}</>}{!isOrder && <Line label="Status" value="Recorded" />}</dl></Section>
      {isOrder && order.review_remarks && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700"><strong>Review reason:</strong> {order.review_remarks}</p>}
      <div className="flex items-center justify-between border-t-2 border-navy-800 pt-4"><span className="text-sm font-semibold">Total</span><strong className="text-2xl font-semibold tabular-nums text-navy-800">{money(amount)}</strong></div>
    </div>
  </div>;
}

const escapeHtml = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function printReceiptElement(element) {
  if (!element) return;
  const frame = document.createElement('iframe');
  Object.assign(frame.style, { position: 'fixed', width: '0', height: '0', border: '0' });
  document.body.appendChild(frame);
  frame.contentDocument.open();
  const personalStyles = element.hasAttribute('data-personal-receipt') ? '[data-personal-receipt]{border:1px solid #555;padding:26px;font-size:12px}[data-personal-receipt] h2{font:32px Georgia,serif;margin:0}[data-personal-receipt] p{margin:0}[data-personal-receipt]>div:first-child{display:flex;align-items:end;justify-content:space-between;border-top:2px solid #111;border-bottom:2px solid #111;padding:8px 0}[data-personal-receipt]>p:not(:last-child),[data-personal-receipt]>div:nth-of-type(2){border-bottom:1px solid #777;padding:12px 0}[data-personal-receipt]>div:nth-of-type(2){display:flex;gap:18px}[data-personal-receipt]>div:nth-of-type(3){display:grid;grid-template-columns:1fr 1fr;gap:12px;border-bottom:2px solid #111;padding:12px 0}[data-personal-receipt] .float-right{float:right}' : '';
  frame.contentDocument.write(`<!doctype html><html><head><meta charset="utf-8"><title>HIUSA receipt</title><style>body{font:14px Arial,sans-serif;color:#0f172a;max-width:760px;margin:24px auto}header,.flex{display:flex;justify-content:space-between;gap:16px}header,section{border-bottom:1px solid #dde7ef;padding:14px 0}h2{font-size:22px}h3{;color:#0878b7;font-size:12px}dt{color:#64748b}dd{font-weight:bold}dl>div{display:flex;justify-content:space-between;gap:16px;padding:4px 0}button{display:none}.grid{display:grid;grid-template-columns:1fr auto auto;gap:12px}.text-2xl{font-size:24px}${personalStyles}</style></head><body>${element.outerHTML}</body></html>`);
  frame.contentDocument.close();
  setTimeout(() => { frame.contentWindow.focus(); frame.contentWindow.print(); setTimeout(() => frame.remove(), 1000); }, 200);
}

export function ClaimTicket({ order, onPrint }) {
  return <div className="mt-4 rounded-card border-2 border-dashed border-brand-700 bg-subtle p-4" data-claim-ticket>
    <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-semibold text-brand-700">{formatDisplayText(order.organization?.name) || 'HIUSA'} · Merchandise claim ticket</p><p className="mt-1 font-mono text-xs font-semibold">ORD-{order.id}</p></div><StatusBadge tone="success" label="Ready for pickup" /></div>
    <p className="mt-4 break-all text-center font-mono text-xl font-semibold text-navy-800 sm:text-2xl">{order.claim_token}</p>
    <p className="mt-2 text-center text-xs text-slate-600">{formatDisplayText(order.merchandise?.name)} · {order.quantity} item{order.quantity === 1 ? '' : 's'}</p>
    <div className="mt-3 flex justify-end"><Button variant="secondary" leftIcon={Printer} onClick={onPrint}>Print ticket</Button></div>
  </div>;
}

export function printClaimTicket(order) {
  const frame = document.createElement('iframe');
  Object.assign(frame.style, { position: 'fixed', width: '0', height: '0', border: '0' });
  document.body.appendChild(frame);
  frame.contentDocument.open();
  frame.contentDocument.write(`<!doctype html><html><head><meta charset="utf-8"><title>Claim ticket</title><style>body{font:14px Arial,sans-serif;color:#0f2f62;max-width:420px;margin:35px auto;border:2px dashed #0878b7;padding:26px;text-align:center}h1{font-size:16px;;letter-spacing:2px}strong{display:block;font:700 26px monospace;overflow-wrap:anywhere;margin:24px 0}p{font-size:13px}</style></head><body><h1>${escapeHtml(order.organization?.name || 'HIUSA')}</h1><p>Merchandise claim ticket · Order ORD-${escapeHtml(order.id)}</p><strong>${escapeHtml(order.claim_token)}</strong><p>${escapeHtml(order.merchandise?.name)} · ${escapeHtml(order.quantity)} item(s)</p><p>Present this ticket with your school ID.</p></body></html>`);
  frame.contentDocument.close();
  setTimeout(() => { frame.contentWindow.focus(); frame.contentWindow.print(); setTimeout(() => frame.remove(), 1000); }, 200);
}
