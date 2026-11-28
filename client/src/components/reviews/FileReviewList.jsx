import { FileText } from 'lucide-react';
import { SelectAllCheckbox, StatusBadge } from '../ui';
import notify from '../../lib/notify';
import { getApiErrorMessage } from '../../utils/apiError';
import { openProtectedFile } from '../../utils/openProtectedFile';

// One column template for the header and every row, so Requirement, Status, File and Action line up
// on each row. Under 640px a row stacks: name and status, then the file, then the action.
const GRID = 'grid-cols-[minmax(0,1fr)_auto] gap-x-4 sm:grid-cols-[minmax(0,1.3fr)_9rem_minmax(0,1.7fr)_7rem]';
// For a row that carries two actions side by side, such as Review and Download PDF.
const GRID_WIDE = 'grid-cols-[minmax(0,1fr)_auto] gap-x-4 sm:grid-cols-[minmax(0,1.3fr)_9rem_minmax(0,1.7fr)_13rem]';

const LINK_BUTTON = 'inline-flex min-h-11 min-w-11 items-center text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-50';

async function open(url) {
  try {
    await openProtectedFile(url);
  } catch (error) {
    notify.error(getApiErrorMessage(error, 'Could not open this file.'));
  }
}

// A file name never wraps: it is cut with an ellipsis and the full name is in the title. A screen that
// has its own way of opening and reporting a failed open passes onOpen instead of a url.
export function FileLink({ url, name, icon: Icon = FileText, onOpen, disabled }) {
  return (
    <button type="button" title={name} disabled={disabled} onClick={() => (onOpen ? onOpen() : open(url))} className="inline-flex min-h-11 max-w-full items-center gap-2 text-left text-sm font-medium text-brand-700 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
      <Icon size={16} className="shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate">{name}</span>
    </button>
  );
}

// One aligned list of files to review. Every prop is plain data, so any review screen can use it:
//
//   <FileReviewList rows={[{
//     id: 7,
//     name: 'Letter of Intent',
//     status: { status: 'needs_changes', label: 'Needs changes' },   // StatusBadge props
//     file: { name: 'letter.pdf', url: '/organization-applications/8/documents/11' },   // null when none
//     emptyFile: 'No file attached.',
//     actions: [{ label: 'Review', ariaLabel: 'Review Letter of Intent', expanded: false, onClick: () => {} }],
//     expanded: false,
//     note: 'Ana Cruz: the seal is missing.',
//     detail: <p>Anything that opens under the row.</p>,
//   }]} />
//
// note and detail show under the row while expanded is true.
//
// A screen that reviews many files at once passes selection and gets a tick box on every row, a select all
// bar above the list, and room in that bar for its own action (Accept selected):
//
//   selection={{
//     label: 'Select',                  // each box reads "Select <row name>"
//     allLabel: 'Select all files',
//     checkedIds: new Set([7]),
//     selectableIds: [7, 9],            // what select all covers; a row left out is ticked on its own
//     disabledIds: new Set([11]),       // rows that cannot be ticked
//     onToggle: (id) => {},
//     onToggleAll: (checked) => {},
//     actions: <Button>Accept selected</Button>,
//   }}
export default function FileReviewList({ rows, labels = {}, wideAction = false, selection = null }) {
  const heads = { name: 'Requirement', status: 'Status', file: 'File', action: 'Action', ...labels };
  const grid = wideAction ? GRID_WIDE : GRID;
  const selectedCount = selection ? selection.selectableIds.filter((id) => selection.checkedIds.has(id)).length : 0;
  return (
    <>
      {selection && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 border-b border-line px-4">
          <div className="flex items-center gap-3">
            <SelectAllCheckbox label={selection.allLabel} selected={selectedCount} total={selection.selectableIds.length} onChange={selection.onToggleAll} />
            <span className="text-xs tabular-nums text-ink-muted-strong">{selection.checkedIds.size} selected</span>
          </div>
          {selection.actions}
        </div>
      )}
      <div aria-hidden="true" className={`${grid} hidden items-center border-b border-line bg-subtle px-4 py-2.5 text-xs font-semibold text-ink-muted sm:grid ${selection ? 'sm:pl-[4.25rem]' : ''}`}>
        <span>{heads.name}</span>
        <span>{heads.status}</span>
        <span>{heads.file}</span>
        <span className="text-right">{heads.action}</span>
      </div>
      <ul className="divide-y divide-line-soft border-b border-line-soft sm:border-b-0">
        {rows.map((row) => {
          const line = (
            <div className={`${grid} grid items-center gap-y-1 sm:gap-y-0`}>
              <p className="min-w-0 break-words text-sm font-semibold text-ink">{row.name}</p>
              <div>{row.status && <StatusBadge {...row.status} />}</div>
              <div className="col-span-2 min-w-0 sm:col-span-1">
                {row.file
                  ? <FileLink url={row.file.url} name={row.file.name} />
                  : <p className="text-sm text-ink-muted-strong">{row.emptyFile || 'No file.'}</p>}
              </div>
              <div className="col-span-2 flex flex-wrap items-center gap-x-4 sm:col-span-1 sm:justify-end">
                {(row.actions || []).map((action) => (
                  <button key={action.label} type="button" disabled={action.disabled} aria-expanded={action.expanded} aria-label={action.ariaLabel} onClick={action.onClick} className={LINK_BUTTON}>{action.label}</button>
                ))}
              </div>
            </div>
          );
          return (
            <li key={row.id} className="px-4 py-3 sm:min-h-[3.25rem] sm:py-2.5">
              {selection ? (
                <div className="flex items-center gap-2">
                  <label className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center">
                    <input
                      type="checkbox"
                      aria-label={`${selection.label} ${row.name}`}
                      checked={selection.checkedIds.has(row.id)}
                      disabled={selection.disabledIds?.has(row.id)}
                      onChange={() => selection.onToggle(row.id)}
                      className="h-5 w-5 accent-brand-700"
                    />
                  </label>
                  <div className="min-w-0 flex-1">{line}</div>
                </div>
              ) : line}
              {row.expanded && (row.note || row.detail) && (
                <div className={`mt-2 space-y-2 ${selection ? 'sm:pl-[3.25rem]' : ''}`}>
                  {row.note && <div className="min-w-0 whitespace-pre-wrap break-words text-sm text-ink">{row.note}</div>}
                  {row.detail}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
