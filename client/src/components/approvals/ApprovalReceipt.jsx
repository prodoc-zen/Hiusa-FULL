import { formatDisplayText } from '../../utils/displayText.js';
import { ENTITY_LABEL } from './approvalStage';
import { StatusBadge } from '../ui';
import { formatDateTime, fullName, summaryLine } from './approvalFormat';

// `compact` leaves out the reviewer rows and the review remarks, for the drawer, which lists them
// under History instead.
export default function ApprovalReceipt({ request, organizationName, compact = false }) {
  const rows = [
    ['Request number', `#${request.id}`],
    ...(organizationName ? [['Organization', organizationName]] : []),
    ['Type', ENTITY_LABEL[request.entity_type] || request.entity_type],
    ['Status', <StatusBadge status={request.status} />],
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
    <section className="border-y border-line bg-white py-3">
      <h4 className="pb-3 text-sm font-semibold text-ink">{formatDisplayText(request.title)}</h4>
      <dl className="border-t border-line sm:grid sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[110px_minmax(0,1fr)] gap-2 border-b border-line py-2 pr-2 text-xs">
            <dt className="font-medium text-ink-muted">{label}</dt>
            <dd className="break-words font-normal text-ink">{value || '-'}</dd>
          </div>
        ))}
      </dl>
      <div className="py-3 text-xs leading-5 text-ink">
        <strong className="block font-medium text-ink-muted">Record summary</strong>
        {summaryLine(request.entity_type, request.summary) || 'No additional summary available.'}
      </div>
      {!compact && request.status !== 'pending' && <p className="border-t border-line pt-3 text-xs"><strong>Review remarks:</strong> {request.remarks || 'No remarks recorded.'}</p>}
    </section>
  );
}
