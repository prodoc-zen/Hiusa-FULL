import { useCallback, useEffect, useState } from 'react';
import { Eye, FilePenLine, FolderOpen, Trash2 } from 'lucide-react';
import { Button, Drawer, EmptyState, ErrorState, Field, PageHeader, Select, SkeletonTable, StatusBadge } from '../../../components/ui';
import ConfirmModal from '../../../components/ConfirmModal';
import PaginationControls from '../../../components/PaginationControls';
import TableRowActions from '../../../components/TableRowActions';
import { getComplianceDocuments, replaceComplianceFile, deleteComplianceFile } from '../../../services/complianceService';
import { listMeta, unwrapList } from '../../../services/pagination';
import { openProtectedFile } from '../../../utils/openProtectedFile';
import { getApiErrorMessage } from '../../../utils/apiError';
import { manilaDate } from '../../../lib/format';
import { TABLE, TBODY, TD, TH, THEAD, TR } from './responsiveTable';

const TYPES = [
  ['registration', 'Registration'],
  ['semester_renewal', 'Semester renewal'],
  ['semestral_report', 'Semestral report'],
  ['event_requirement', 'Event proposal'],
  ['financial_report', 'Financial report'],
  ['financial_supporting_document', 'Report attachment'],
];
const LABELS = Object.fromEntries(TYPES);

export default function SubmittedFilesPage({ role }) {
  const canManage = role === 'ADMIN';
  const [family, setFamily] = useState('');
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ loading: true, error: null, rows: [], meta: { total: 0, currentPage: 1, perPage: 20 } });
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [actionError, setActionError] = useState('');

  const load = useCallback(() => {
    setState((current) => ({ ...current, loading: true, error: null }));
    getComplianceDocuments({ page, per_page: 20, family: family || undefined })
      .then((response) => setState({ loading: false, error: null, rows: unwrapList(response.data), meta: listMeta(response.data) }))
      .catch((error) => setState((current) => ({ ...current, loading: false, error: getApiErrorMessage(error, 'Could not load files.') })));
  }, [family, page]);

  useEffect(() => { load(); }, [load]);

  async function view(row) {
    setActionError('');
    try {
      await openProtectedFile(row.open_url);
    } catch (error) {
      setActionError(getApiErrorMessage(error, 'Could not open this file.'));
    }
  }

  async function replace() {
    if (!file || !editing) return;
    setBusy(true);
    setActionError('');
    try {
      await replaceComplianceFile(editing.id, file, editing.submitted_at);
      setEditing(null);
      setFile(null);
      setFeedback('Replacement submitted for SAO review. Reviewers have been notified.');
      load();
    } catch (error) {
      setActionError(getApiErrorMessage(error, 'Could not replace this file.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    setActionError('');
    try {
      await deleteComplianceFile(deleting.id, deleting.submitted_at);
      setDeleting(null);
      setFeedback('File deleted. Reviewers and organization admins have been notified.');
      load();
    } catch (error) {
      setActionError(getApiErrorMessage(error, 'Could not delete this file.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5 pb-8">
      <PageHeader title={canManage ? 'Submitted files' : 'College files'} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label="Document type">
          <Select filter value={family} onChange={(event) => { setFamily(event.target.value); setPage(1); }} className="min-w-48">
            <option value="">All document types</option>
            {TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </Field>
        <span className="text-xs tabular-nums text-ink-muted">{state.meta.total} submitted {state.meta.total === 1 ? 'file' : 'files'}</span>
      </div>
      {feedback && <p role="status" className="rounded-control border border-green-200 bg-green-50 p-3 text-sm text-green-800">{feedback}</p>}
      {actionError && !editing && !deleting && <p role="alert" className="rounded-control border border-danger/30 bg-danger-tint p-3 text-sm text-danger-strong">{actionError}</p>}
      {state.loading ? <SkeletonTable rows={5} columns={5} /> : state.error ? <div role="alert"><ErrorState title="Could not load files" description={state.error} onRetry={load} /></div> : state.rows.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          kind={family ? 'filtered' : 'first-run'}
          title={family ? 'No files of this type' : 'No submitted files yet'}
          description={family ? 'Try a different document type.' : 'Files submitted for registration, compliance, events and reports appear here.'}
          onClearFilters={family ? () => { setFamily(''); setPage(1); } : undefined}
        />
      ) : (
        <div>
          <table className={TABLE}>
            <caption className="sr-only">Submitted files and their review status</caption>
            <thead className={THEAD}><tr><th scope="col" className={TH}>File</th><th scope="col" className={TH}>Organization</th><th scope="col" className={TH}>Type</th><th scope="col" className={TH}>Submitted</th><th scope="col" className={TH}>Status</th><th scope="col" className={`${TH} text-right`}>Actions</th></tr></thead>
            <tbody className={TBODY}>
              {state.rows.map((row) => <tr key={`${row.source}-${row.id}`} className={TR}>
                <td data-label="File" className={`${TD} max-w-xs`}><div><span className="block break-words font-medium text-ink">{row.file_name}</span><span className="block text-xs text-ink-muted">{row.item}{row.parent_title ? ` · ${row.parent_title}` : ''}</span></div></td>
                <td data-label="Organization" className={`${TD} text-ink-muted-strong`}>{row.organization?.name}</td>
                <td data-label="Type" className={`${TD} text-ink-muted-strong`}>{LABELS[row.family] || row.family}</td>
                <td data-label="Submitted" className={`${TD} text-ink-muted-strong`}>{row.submitted_at ? manilaDate(row.submitted_at, 'long') : ''}</td>
                <td data-label="Status" className={TD}><StatusBadge status={row.status} /></td>
                <td data-label="Actions" className={`${TD} md:text-right`}><TableRowActions subject={row.file_name} actions={[
                  { label: 'View file', icon: Eye, onClick: () => view(row) },
                  canManage && row.source === 'compliance' && { label: 'Replace file', icon: FilePenLine, onClick: () => { setEditing(row); setFile(null); setActionError(''); } },
                  canManage && row.source === 'compliance' && { label: 'Delete file', icon: Trash2, danger: true, onClick: () => { setDeleting(row); setActionError(''); } },
                ]} /></td>
              </tr>)}
            </tbody>
          </table>
        </div>
      )}
      {!state.loading && !state.error && <PaginationControls currentPage={state.meta.currentPage} totalItems={state.meta.total} pageSize={state.meta.perPage} onPageChange={setPage} label="files" />}
      <Drawer open={Boolean(editing)} title="Replace submitted file" description={editing?.file_name} onClose={busy ? undefined : () => setEditing(null)} footer={<><Button variant="secondary" disabled={busy} onClick={() => setEditing(null)}>Cancel</Button><Button loading={busy} disabled={!file} onClick={replace}>Submit replacement</Button></>}>
        <p className="text-sm text-ink-muted-strong">The previous file is removed. The new file goes back to the SAO for review.</p>
        <Field label="New file" className="mt-4"><input type="file" className="block min-h-[42px] w-full rounded-control border border-line p-2 text-sm" accept={editing?.allowed_extensions?.map((extension) => `.${extension}`).join(',')} onChange={(event) => setFile(event.target.files?.[0] || null)} /></Field>
        {actionError && <p role="alert" className="mt-3 text-sm text-danger-strong">{actionError}</p>}
      </Drawer>
      <ConfirmModal open={Boolean(deleting)} title="Delete submitted file?" recordName={deleting?.file_name} message="This removes the file and notifies reviewers and organization admins. The requirement will be unsubmitted." confirmText="Delete file" busy={busy} error={actionError} onCancel={() => setDeleting(null)} onConfirm={remove} />
    </div>
  );
}
