import { formatDisplayText } from '../../utils/displayText.js';
import { ENTITY_LABEL } from './approvalStage';
import { STATUS_BADGE, formatDateTime, fullName, summaryLine } from './approvalFormat';

// `compact` leaves out the reviewer rows and the review remarks, for the drawer, which lists them
// under History instead.
export default function ApprovalReceipt({ request, organizationName, compact = false }) {
  const rows = [
    ['Request number', `#${request.id}`],
    ...(organizationName ? [['Organization', organizationName]] : []),
    ['Type', ENTITY_LABEL[request.entity_type] || request.entity_type],
    ['Status', <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold capitalize ${STATUS_BADGE[request.status] || 'bg-slate-100 text-slate-700'}`}>{request.status}</span>],
    ['Required role', request.required_role],
    ['Requester', fullName(request.requester) || '-'],
    ['School ID', request.requester?.school_id || '-'],
    ['Email', request.requester?.email],
    ['Role / position', [request.requester?.role, request.requester?.position_title].filter(Boolean).join(' · ')],
    ['Department', request.requester?.department],
    ['Academic profile', [request.requester?.program, request.requester?.year_level, request.requester?.section].filter(Boolean).join(' · ')],
    ['Submitted', formatDateTime(request.requested_at)],
    ['Record ID', request.entity_id],
    ...(compact ? [] : [
      ['Reviewer', fullName(request.reviewer) || '-'],
      ['Reviewed', formatDateTime(request.reviewed_at)],
    ]),
  ];

  return (
    <section className="border-y-2 border-[#0F2F62] bg-white py-3">
      <h4 className="pb-3 text-sm font-black text-[#0F2F62]">{formatDisplayText(request.title)}</h4>
      <dl className="border-t border-[#DDE7EF] sm:grid sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[110px_minmax(0,1fr)] gap-2 border-b border-[#DDE7EF] py-2 pr-2 text-xs">
            <dt className="font-bold text-[#64748B]">{label}</dt>
            <dd className="break-words font-semibold text-[#0F172A]">{value || '-'}</dd>
          </div>
        ))}
      </dl>
      <div className="py-3 text-xs leading-5 text-[#0F172A]">
        <strong className="block text-[#64748B]">Record summary</strong>
        {summaryLine(request.entity_type, request.summary) || 'No additional summary available.'}
      </div>
      {!compact && request.status !== 'pending' && <p className="border-t border-[#DDE7EF] pt-3 text-xs"><strong>Review remarks:</strong> {request.remarks || 'No remarks recorded.'}</p>}
    </section>
  );
}
