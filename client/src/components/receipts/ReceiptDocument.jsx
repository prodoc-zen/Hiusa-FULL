import { formatDisplayText } from '../../utils/displayText.js';
import { Printer } from 'lucide-react';

const money = (value) => `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateTime = (value) => value ? new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }) : 'Not recorded';
const person = (value) => [value?.first_name, value?.last_name].filter(Boolean).join(' ') || 'Not recorded';
const readable = (value) => value ? String(value).replaceAll('_', ' ').toUpperCase() : 'Not recorded';

function Line({ label, value }) {
  return <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-1 text-sm"><dt className="text-slate-500">{label}</dt><dd className="break-words text-right font-semibold text-[#0F172A]">{value ?? 'Not recorded'}</dd></div>;
}

function Section({ title, children }) {
  return <section className="border-t border-[#DDE7EF] pt-4"><h3 className="mb-2 text-[11px] font-black uppercase tracking-widest text-[#0878B7]">{title}</h3>{children}</section>;
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
    return <><div data-receipt-document data-personal-receipt className="mx-auto max-w-2xl border border-slate-300 bg-white p-5 text-[#0F172A] sm:p-8">
      <div className="flex items-end justify-between gap-3 border-y-2 border-[#0F172A] py-2"><h2 className="font-serif text-3xl uppercase">Receipt</h2><p className="text-xs"><strong>Date:</strong> {dateTime(transaction.transaction_date)}</p></div>
      <p className="border-b border-slate-500 py-3 text-xs"><strong>Received from:</strong> {person(payer)} <span className="float-right"><strong>Number:</strong> {number}</span></p>
      <p className="border-b border-slate-500 py-3 text-xs"><strong>Amount:</strong> {money(amount)}</p>
      <div className="flex flex-wrap gap-x-5 gap-y-2 border-b border-slate-500 py-3 text-xs" aria-label="Mode of payment">{['cash', 'check', 'credit/debit card', 'bank transfer', 'gcash'].map((option) => <span key={option}>{method?.toLowerCase() === option ? '☑' : '☐'} {option.toUpperCase()}</span>)}</div>
      <p className="border-b border-slate-500 py-3 text-xs"><strong>Payment for:</strong> {transaction.description || transaction.category || 'Not recorded'}</p>
      <div className="grid gap-3 border-b-2 border-[#0F172A] py-3 text-xs sm:grid-cols-2"><p><strong>Received by:</strong> {person(collector)}</p><p><strong>Signature:</strong> ____________________</p></div>
      <p className="mt-3 text-[11px] text-slate-600">{organization}</p>
    </div><section className="mx-auto mt-4 max-w-2xl rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-4 text-sm"><h3 className="font-bold text-[#0F2F62]">Transaction details</h3><dl className="mt-2"><Line label="Event" value={transaction.event?.title || 'Not linked'} /><Line label="Budget" value={transaction.budget?.title || 'Not linked'} /><Line label="Category" value={transaction.category || 'Not recorded'} /></dl></section></>;
  }

  return <div className="rounded-lg border border-[#DDE7EF] bg-white p-5 text-[#0F172A] sm:p-6" data-receipt-document>
    <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-[#0F2F62] pb-5">
      <div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#0878B7]">Official organization record</p><h2 className="mt-1 text-xl font-black text-[#0F2F62]">{organization}</h2><p className="mt-1 text-xs text-slate-500">{isOrder ? 'Merchandise order' : 'Payment receipt'}</p></div>
      <div className="text-left sm:text-right"><p className="font-mono text-lg font-black">{number}</p><p className="mt-1 text-xs text-slate-500">{dateTime(isOrder ? order.created_at : transaction.transaction_date)}</p></div>
    </header>
    <div className="mt-4 space-y-4">
      <Section title="Purchaser"><dl><Line label="Name" value={person(payer)} />{isOrder && <><Line label="School ID" value={payer?.school_id} /><Line label="Department" value={payer?.department} /><Line label="Program / course" value={payer?.program} /><Line label="Year / section" value={[payer?.year_level, payer?.section].filter(Boolean).join(' · ') || 'Not recorded'} /></>}</dl></Section>
      {isOrder ? <Section title="Items"><div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2 border-b border-[#DDE7EF] pb-2 text-[11px] font-bold uppercase text-slate-500"><span>Product / variant</span><span>Qty</span><span>Subtotal</span></div><div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2 py-3 text-sm"><div><p className="font-bold">{formatDisplayText(order.merchandise?.name) || 'Merchandise'}</p><p className="text-xs text-slate-500">{order.variant_name || formatDisplayText(order.variant?.name) || 'Standard'} · {money(order.unit_price ?? Number(order.total_price) / Number(order.quantity || 1))} each</p></div><span>{order.quantity}</span><span className="font-bold">{money(order.total_price)}</span></div></Section> : <Section title="Transaction"><dl><Line label="Purpose" value={transaction.description || transaction.category} /><Line label="Type / category" value={`${readable(transaction.type)} · ${transaction.category || 'Not recorded'}`} /><Line label="Event" value={transaction.event?.title || 'Not linked'} /><Line label="Budget" value={transaction.budget?.title || 'Not linked'} /></dl></Section>}
      <Section title="Payment"><dl><Line label="Receipt number" value={receipt?.receipt_reference || (receipt?.receipt_number ? `#${receipt.receipt_number}` : 'Not generated')} /><Line label="Payment date / time" value={dateTime(receipt?.transaction_date)} /><Line label="Method" value={readable(isOrder ? order.payment_method : transaction.merchandise_order?.payment_method)} />{isOrder && <><Line label="Reference" value={order.payment_reference || 'Not provided'} /><Line label="Payment status" value={order.status === 'cancelled' ? 'CANCELLED' : order.status === 'paid' || order.status === 'claimed' ? 'PAID' : 'PENDING'} /><Line label="Order status" value={readable(order.status)} /><Line label="Proof" value={order.payment_proof_url ? 'Attached' : 'No file attached'} /></>}</dl>{isOrder && order.payment_proof_url && onViewProof && <button type="button" onClick={() => onViewProof(order.id)} className="mt-2 min-h-11 rounded-lg border border-[#0878B7] px-3 text-xs font-bold text-[#0878B7]">Open payment proof</button>}</Section>
      <Section title="Processing"><dl><Line label="Recorded / processed by" value={person(collector)} /><Line label="Approved by" value={person(approver)} />{isOrder && <><Line label="Officer review" value={readable(order.officer_review_status)} /><Line label="Admin review" value={readable(order.admin_review_status)} />{releasingOfficer && <Line label="Releasing officer" value={releasingOfficer} />}{order.claimed_at && <Line label="Claimed / released" value={dateTime(order.claimed_at)} />}</>}{!isOrder && <Line label="Status" value="RECORDED" />}</dl></Section>
      {isOrder && order.review_remarks && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700"><strong>Review reason:</strong> {order.review_remarks}</p>}
      <div className="flex items-center justify-between border-t-2 border-[#0F2F62] pt-4"><span className="text-sm font-bold uppercase tracking-wider">Total</span><strong className="text-2xl font-black tabular-nums text-[#0F2F62]">{money(amount)}</strong></div>
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
  frame.contentDocument.write(`<!doctype html><html><head><meta charset="utf-8"><title>HIUSA receipt</title><style>body{font:14px Arial,sans-serif;color:#0f172a;max-width:760px;margin:24px auto}header,.flex{display:flex;justify-content:space-between;gap:16px}header,section{border-bottom:1px solid #dde7ef;padding:14px 0}h2{font-size:22px}h3{text-transform:uppercase;color:#0878b7;font-size:12px}dt{color:#64748b}dd{font-weight:bold}dl>div{display:flex;justify-content:space-between;gap:16px;padding:4px 0}button{display:none}.grid{display:grid;grid-template-columns:1fr auto auto;gap:12px}.text-2xl{font-size:24px}${personalStyles}</style></head><body>${element.outerHTML}</body></html>`);
  frame.contentDocument.close();
  setTimeout(() => { frame.contentWindow.focus(); frame.contentWindow.print(); setTimeout(() => frame.remove(), 1000); }, 200);
}

export function ClaimTicket({ order, onPrint }) {
  return <div className="mt-4 rounded-xl border-2 border-dashed border-[#0878B7] bg-[#F8FBFD] p-4" data-claim-ticket>
    <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-[10px] font-black uppercase tracking-widest text-[#0878B7]">{formatDisplayText(order.organization?.name) || 'HIUSA'} · Merchandise claim ticket</p><p className="mt-1 font-mono text-xs font-bold">ORD-{order.id}</p></div><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">READY FOR PICKUP</span></div>
    <p className="mt-4 break-all text-center font-mono text-xl font-black tracking-wider text-[#0F2F62] sm:text-2xl">{order.claim_token}</p>
    <p className="mt-2 text-center text-xs text-slate-600">{formatDisplayText(order.merchandise?.name)} · {order.quantity} item{order.quantity === 1 ? '' : 's'}</p>
    <div className="mt-3 flex justify-end"><button type="button" onClick={onPrint} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#0878B7] px-3 text-xs font-bold text-[#0878B7]"><Printer size={14} /> Print ticket</button></div>
  </div>;
}

export function printClaimTicket(order) {
  const frame = document.createElement('iframe');
  Object.assign(frame.style, { position: 'fixed', width: '0', height: '0', border: '0' });
  document.body.appendChild(frame);
  frame.contentDocument.open();
  frame.contentDocument.write(`<!doctype html><html><head><meta charset="utf-8"><title>Claim ticket</title><style>body{font:14px Arial,sans-serif;color:#0f2f62;max-width:420px;margin:35px auto;border:2px dashed #0878b7;padding:26px;text-align:center}h1{font-size:16px;text-transform:uppercase;letter-spacing:2px}strong{display:block;font:700 26px monospace;overflow-wrap:anywhere;margin:24px 0}p{font-size:13px}</style></head><body><h1>${escapeHtml(order.organization?.name || 'HIUSA')}</h1><p>Merchandise claim ticket · Order ORD-${escapeHtml(order.id)}</p><strong>${escapeHtml(order.claim_token)}</strong><p>${escapeHtml(order.merchandise?.name)} · ${escapeHtml(order.quantity)} item(s)</p><p>Present this ticket with your school ID.</p></body></html>`);
  frame.contentDocument.close();
  setTimeout(() => { frame.contentWindow.focus(); frame.contentWindow.print(); setTimeout(() => frame.remove(), 1000); }, 200);
}
