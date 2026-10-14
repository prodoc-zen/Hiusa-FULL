import { useCallback, useEffect, useState } from 'react';
import { Eye } from 'lucide-react';
import TableRowActions from '../../../components/TableRowActions';
import { Button, Card, DataTable, Field, PageHeader, Select, StatusBadge, Textarea } from '../../../components/ui';
import Modal from '../../../components/Modal';
import PaginationControls from '../../../components/PaginationControls';
import { getOrganizationApplications, reviewOrganizationApplication } from '../../../services/organizationApplicationService';
import { listMeta, unwrapList } from '../../../services/pagination';
import { getApiErrorMessage } from '../../../utils/apiError';
import notify from '../../../lib/notify';
import { openProtectedFile } from '../../../utils/openProtectedFile';

const LABELS = { pending_endorsement: 'Pending endorsement', endorsed: 'Endorsed, for SAO review', approved: 'Approved', rejected: 'Rejected' };

export default function OrganizationApplicationsPage() {
  const head = JSON.parse(localStorage.getItem('user') || '{}').role === 'DEPARTMENT_HEAD';
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState(head ? 'pending_endorsement' : 'endorsed');
  const [meta, setMeta] = useState({ currentPage: 1, perPage: 10, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [target, setTarget] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    setLoading(true); setError('');
    getOrganizationApplications({ status: status || undefined, page, per_page: 10 }).then((res) => { setRows(unwrapList(res.data)); setMeta(listMeta(res.data)); }).catch((e) => setError(getApiErrorMessage(e, 'Could not load applications.'))).finally(() => setLoading(false));
  }, [status, page]);
  useEffect(() => { load(); }, [load]);
  async function review(action) {
    setBusy(true); setError('');
    try { const res = await reviewOrganizationApplication(target.id, { action, remarks: remarks || null }); setTarget(null); notify.success(res.data.email_sent === false ? (action === 'approve' ? 'Decision saved. Email delivery failed; the applicant can use account recovery to set their password.' : 'Decision saved, but the applicant email could not be delivered.') : 'Application updated and applicant notified.'); load(); }
    catch (e) { setError(getApiErrorMessage(e, 'Could not update this application.')); }
    finally { setBusy(false); }
  }
  async function openDocument(document) {
    try { await openProtectedFile(`/organization-applications/${target.id}/documents/${document.id}`); }
    catch (e) { setError(getApiErrorMessage(e, 'Could not open this document.')); }
  }
  const actionable = target?.status === (head ? 'pending_endorsement' : 'endorsed');
  return <div className="space-y-5"><PageHeader title="Organization applications" description={head ? 'Review verified applications from your college and endorse them for SAO evaluation.' : 'Evaluate department-endorsed applications. Approval creates the organization and its applicant’s administrator access.'} />
    <Card bodyClassName="p-0"><DataTable rows={rows} loading={loading} error={!target ? error : null} onRetry={load} columns={[
      { key: 'name', header: 'Organization', render: (row) => <div><p className="font-bold">{row.name}</p><p className="text-xs text-ink-muted">{row.acronym} · {row.college?.name}</p></div> },
      { key: 'applicant', header: 'Applicant', render: (row) => <div>{row.first_name} {row.last_name}<p className="text-xs text-ink-muted">{row.position_title}</p></div> },
      { key: 'status', header: 'Status', render: (row) => <StatusBadge label={LABELS[row.status]} tone={row.status === 'approved' ? 'success' : row.status === 'rejected' ? 'danger' : 'info'} /> },
    ]} filters={<div className="p-4"><Select aria-label="Application status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{Object.entries(LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></div>} actions={(row) => <TableRowActions subject={row.name} actions={[{ label: 'View application', icon: Eye, onClick: () => { setTarget(row); setRemarks(''); setError(''); } }]} />} pagination={<PaginationControls currentPage={meta.currentPage} totalItems={meta.total} pageSize={meta.perPage} onPageChange={setPage} label="applications" />} /></Card>
    <Modal open={Boolean(target)} title={target?.name || 'Application'} onClose={busy ? undefined : () => { setTarget(null); setError(''); }} maxWidth="max-w-xl" footer={actionable ? <><Button variant="danger" disabled={!remarks.trim() || busy} onClick={() => review('reject')}>Reject application</Button><Button loading={busy} onClick={() => review(head ? 'endorse' : 'approve')}>{head ? 'Endorse to SAO' : 'Approve registration'}</Button></> : <Button variant="secondary" onClick={() => setTarget(null)}>Close</Button>}>
      {target && <div className="space-y-4"><dl className="grid gap-3 text-sm sm:grid-cols-2">{[['Applicant', `${target.first_name} ${target.last_name}`], ['Email', target.email], ['School ID', target.school_id], ['Position', target.position_title], ['College', target.college?.name], ['Status', LABELS[target.status]]].map(([label, value]) => <div key={label}><dt className="font-semibold text-ink-muted">{label}</dt><dd className="break-words text-ink">{value}</dd></div>)}</dl><p className="whitespace-pre-wrap text-sm text-ink-muted">{target.description || 'No description provided.'}</p>
        <section aria-label="Registration documents" className="border-t border-[#DDE7EF] pt-4"><h3 className="text-sm font-bold text-[#0B1831]">Registration documents</h3>
          {target.documents?.length ? <ul className="mt-3 space-y-3">{target.documents.map((document) => <li key={document.id} className="rounded-lg border border-[#DDE7EF] p-3 text-sm"><p className="font-semibold text-[#0F172A]">{document.requirement_type?.name}</p><button type="button" onClick={() => openDocument(document)} className="mt-1 min-h-11 text-left font-semibold text-[#0878B7] underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B8ED0]">View {document.file_original_name}</button></li>)}</ul> : <p className="mt-2 text-sm text-[#475569]">{target.requires_documents ? 'Required documents are missing. Contact SAO before proceeding.' : 'This application was submitted before document uploads were required.'}</p>}
        </section>
        {target.remarks && <p className="text-sm">Remarks: {target.remarks}</p>}{actionable && <Field label="Review remarks" hint="Required when rejecting an application."><Textarea rows={3} maxLength={2000} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>}{error && <p role="alert" className="text-sm text-red-700">{error}</p>}</div>}
    </Modal>
  </div>;
}
