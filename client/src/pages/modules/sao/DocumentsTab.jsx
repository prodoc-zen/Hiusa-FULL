import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronRight, ExternalLink, FilePenLine, Folder, LayoutGrid, List, Trash2 } from 'lucide-react';
import { Button, Card, EmptyState, Input, PageHeader, Select, StatusBadge } from '../../../components/ui';
import ConfirmModal from '../../../components/ConfirmModal';
import Modal from '../../../components/Modal';
import PaginationControls from '../../../components/PaginationControls';
import TableRowActions from '../../../components/TableRowActions';
import { getAcademicPeriods } from '../../../services/systemAdministrationService';
import { deleteComplianceFile, getComplianceDocuments, replaceComplianceFile } from '../../../services/complianceService';
import { listMeta, unwrapList } from '../../../services/pagination';
import { getApiErrorMessage } from '../../../utils/apiError';
import { openProtectedFile } from '../../../utils/openProtectedFile';
import { manilaDate } from '../../../lib/format';

const FAMILIES = [
  ['registration', 'Registration'], ['semester_renewal', 'Semester renewal'],
  ['semestral_report', 'Semestral report'], ['event_requirement', 'Event requirements'],
  ['financial_report', 'Financial reports'], ['financial_supporting_document', 'Report attachments'],
];
const FAMILY_NAMES = Object.fromEntries(FAMILIES);
const EMPTY_META = { total: 0, currentPage: 1, perPage: 20 };

export default function DocumentsTab({ role = 'SUPER_ADMIN' }) {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [organization, setOrganization] = useState(() => /^\d+$/.test(params.get('organization') || '') ? { id: Number(params.get('organization')), name: params.get('name') || `Organization ${params.get('organization')}` } : null);
  const [fileQuery, setFileQuery] = useState('');
  const [fileSearch, setFileSearch] = useState('');
  const [folderPage, setFolderPage] = useState(1);
  const [filePage, setFilePage] = useState(1);
  const [filePageSize, setFilePageSize] = useState(10);
  const [family, setFamily] = useState('');
  const [semester, setSemester] = useState('');
  const [periods, setPeriods] = useState([]);
  const [view, setView] = useState('grid');
  const [folders, setFolders] = useState({ loading: true, error: '', rows: [], meta: EMPTY_META });
  const [files, setFiles] = useState({ loading: false, error: '', rows: [], meta: EMPTY_META });
  const [deleting, setDeleting] = useState(null);
  const [editing, setEditing] = useState(null);
  const [replacement, setReplacement] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    getAcademicPeriods().then((data) => setPeriods(Array.isArray(data) ? data : [])).catch(() => setPeriods([]));
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { setSearch(query.trim()); setFolderPage(1); }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const timer = window.setTimeout(() => { setFileSearch(fileQuery.trim()); setFilePage(1); }, 250);
    return () => window.clearTimeout(timer);
  }, [fileQuery]);

  const loadFolders = useCallback(() => {
    setFolders((current) => ({ ...current, loading: true, error: '' }));
    getComplianceDocuments({ group: 'organization', page: folderPage, per_page: 18, search: search || undefined })
      .then((response) => setFolders({ loading: false, error: '', rows: unwrapList(response.data), meta: listMeta(response.data) }))
      .catch((error) => setFolders((current) => ({ ...current, loading: false, error: getApiErrorMessage(error, 'Could not load organizations.') })));
  }, [folderPage, search]);
  useEffect(() => { loadFolders(); }, [loadFolders]);

  const loadFiles = useCallback(() => {
    if (!organization) return;
    setFiles((current) => ({ ...current, loading: true, error: '' }));
    let current = true;
    getComplianceDocuments({ organization_id: organization.id, page: filePage, per_page: filePageSize, family: family || undefined, academic_semester_id: semester || undefined, search: fileSearch || undefined })
      .then((response) => { if (current) setFiles({ loading: false, error: '', rows: unwrapList(response.data), meta: listMeta(response.data) }); })
      .catch((error) => { if (current) setFiles((state) => ({ ...state, loading: false, error: getApiErrorMessage(error, 'Could not load files.') })); });
    return () => { current = false; };
  }, [organization, filePage, filePageSize, family, semester, fileSearch]);
  useEffect(loadFiles, [loadFiles]);

  function openFolder(folder) {
    setOrganization(folder.organization);
    setFilePage(1);
    setFamily('');
    setSemester('');
    setFileQuery('');
    setFileSearch('');
    setActionError('');
  }

  async function openFile(row) {
    setActionError('');
    try {
      await openProtectedFile(row.open_url);
    } catch (error) {
      setActionError(getApiErrorMessage(error, 'Could not open this file.'));
    }
  }

  async function remove() {
    if (!deleting || busy) return;
    setBusy(true);
    setActionError('');
    try {
      await deleteComplianceFile(deleting.id, deleting.submitted_at);
      setNotice(`${deleting.file_name} deleted.`);
      setDeleting(null);
      loadFolders();
      if (filePage > 1 && files.rows.length === 1) setFilePage(filePage - 1);
      else loadFiles();
    } catch (error) {
      setActionError(getApiErrorMessage(error, 'Could not delete this file.'));
    } finally {
      setBusy(false);
    }
  }

  async function replace() {
    if (!editing || !replacement || busy) return;
    setBusy(true);
    setActionError('');
    try {
      await replaceComplianceFile(editing.id, replacement, editing.submitted_at);
      setEditing(null);
      setReplacement(null);
      setNotice('File replaced. SAO must review the new file; reviewers and organization admins were notified.');
      loadFiles();
      loadFolders();
    } catch (error) {
      setActionError(getApiErrorMessage(error, 'Could not replace this file.'));
    } finally { setBusy(false); }
  }

  return <div className="space-y-4 pb-8">
    <PageHeader title={role === 'DEPARTMENT_HEAD' ? 'College files' : 'Submitted files'} description={role === 'DEPARTMENT_HEAD' ? 'Browse documents from organizations in your college.' : 'Browse organization folders and open submitted documents.'} />
    <nav aria-label="File location" className="flex flex-wrap items-center gap-1 text-sm font-semibold">
      <button type="button" onClick={() => { setOrganization(null); setParams({}); }} className="min-h-10 rounded-lg px-2 text-brand-700 hover:bg-subtle">All organizations</button>
      {organization && <><ChevronRight size={15} className="text-ink-muted" aria-hidden="true" /><span className="break-words px-2 text-ink">{organization.name}</span></>}
    </nav>
    {notice && <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm font-semibold text-green-800">{notice}</p>}
    {actionError && !deleting && !editing && <p role="alert" className="rounded-lg border border-danger/30 bg-danger-tint p-3 text-sm font-semibold text-danger-strong">{actionError}</p>}
    {!organization ? <Card bodyClassName="p-0">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line p-4">
        <label className="block w-full max-w-md text-xs font-semibold text-ink">Find an organization<Input type="search" className="mt-1 w-full" placeholder="Name or acronym" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <div className="flex items-center gap-1" aria-label="Folder layout"><Button variant={view === 'grid' ? 'primary' : 'secondary'} size="sm" leftIcon={LayoutGrid} onClick={() => setView('grid')} aria-label="Grid view">Grid</Button><Button variant={view === 'list' ? 'primary' : 'secondary'} size="sm" leftIcon={List} onClick={() => setView('list')} aria-label="List view">List</Button></div>
      </div>
      {folders.loading ? <p role="status" className="p-6 text-sm text-ink-muted">Loading folders…</p> : folders.error ? <div className="p-6"><p role="alert" className="text-sm text-danger-strong">{folders.error}</p><Button variant="secondary" onClick={loadFolders}>Try again</Button></div> : folders.rows.length === 0 ? <div className="p-6"><EmptyState icon={Folder} title="No organizations found" description={search ? 'Try another name or acronym.' : 'Submitted files will appear in organization folders.'} /></div> : <div className={view === 'grid' ? 'grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3' : 'divide-y divide-line'}>
        {folders.rows.map((folder) => <button key={folder.organization.id} type="button" onClick={() => openFolder(folder)} className={`flex min-w-0 items-start gap-3 text-left transition-colors hover:bg-subtle focus-visible:outline-2 focus-visible:outline-brand-700 ${view === 'grid' ? 'rounded-lg border border-line p-4' : 'px-4 py-3'}`}>
          <Folder size={22} className="shrink-0 text-brand-700" aria-hidden="true" />
          <span className="min-w-0 flex-1"><span className="block break-words text-sm font-bold text-ink">{folder.organization.name}</span><span className="block text-xs text-ink-muted">{folder.organization.college || 'No college assigned'}</span><span className="mt-1 block text-xs font-semibold text-ink-muted">{folder.file_count} {folder.file_count === 1 ? 'file' : 'files'} · {folder.latest_submitted_at ? manilaDate(folder.latest_submitted_at, 'long') : 'No date'}</span></span>
        </button>)}
      </div>}
      {!folders.loading && !folders.error && <div className="border-t border-line p-4"><PaginationControls currentPage={folders.meta.currentPage} totalItems={folders.meta.total} pageSize={folders.meta.perPage} onPageChange={setFolderPage} label="organizations" /></div>}
    </Card> : <Card bodyClassName="p-0">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line p-4">
        <div><h2 className="text-base font-bold text-ink">{organization.name}</h2><p className="text-xs text-ink-muted">Submitted files</p></div>
        <div className="flex flex-wrap gap-3"><label className="text-xs font-semibold text-ink">Find a file<Input type="search" className="mt-1 min-w-48" value={fileQuery} onChange={(event) => setFileQuery(event.target.value)} placeholder="Name, event or report" /></label><label className="text-xs font-semibold text-ink">Type<Select filter className="mt-1 min-w-40" value={family} onChange={(event) => { setFamily(event.target.value); setFilePage(1); }}><option value="">All types</option>{FAMILIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></label><label className="text-xs font-semibold text-ink">Semester<Select filter className="mt-1 min-w-40" value={semester} onChange={(event) => { setSemester(event.target.value); setFilePage(1); }}><option value="">All semesters</option>{periods.map((period) => <option key={period.id} value={period.id}>{period.academic_year?.label} · Semester {period.number}</option>)}</Select></label></div>
      </div>
      {files.loading ? <p role="status" className="p-6 text-sm text-ink-muted">Loading files…</p> : files.error ? <div className="p-6"><p role="alert" className="text-sm text-danger-strong">{files.error}</p><Button variant="secondary" onClick={loadFiles}>Try again</Button></div> : files.rows.length === 0 ? <div className="p-6"><EmptyState title="No files in this view" description="Try another document type or semester." /></div> : <div className="overflow-x-auto"><table className="w-full min-w-[740px] text-left text-[13px]"><caption className="sr-only">Files submitted by {organization.name}</caption><thead className="bg-subtle text-xs font-bold uppercase text-ink-muted"><tr><th scope="col" className="px-4 py-3">Name</th><th scope="col" className="px-4 py-3">Type</th><th scope="col" className="px-4 py-3">Submitted</th><th scope="col" className="px-4 py-3">Status</th><th scope="col" className="px-4 py-3 text-right">Actions</th></tr></thead><tbody className="divide-y divide-line">{files.rows.map((row) => <tr key={`${row.source}-${row.open_url}`}><td className="max-w-xs px-4 py-3"><span className="block break-words font-semibold text-ink">{row.file_name || row.item}</span><span className="block text-xs text-ink-muted">{row.item}{row.parent_title ? ` · ${row.parent_title}` : ''}</span></td><td className="px-4 py-3 text-ink-muted-strong">{FAMILY_NAMES[row.family] || row.family}</td><td className="px-4 py-3 text-ink-muted-strong">{row.submitted_at ? manilaDate(row.submitted_at, 'long') : '—'}</td><td className="px-4 py-3"><StatusBadge status={row.status} /></td><td className="px-4 py-2"><TableRowActions subject={row.file_name || row.item} actions={[
        { label: 'View file', icon: ExternalLink, onClick: () => openFile(row) },
        role === 'SUPER_ADMIN' && row.family === 'registration' && row.organization_lifecycle_status === 'pending' && { label: 'Open registration review', icon: ExternalLink, to: `/dashboard/super-admin/organizations?status=pending&review=${organization.id}` },
        role === 'DEPARTMENT_HEAD' && row.source === 'compliance' && row.organization_lifecycle_status === 'active' && { label: 'Replace file', icon: FilePenLine, onClick: () => { setActionError(''); setReplacement(null); setEditing(row); } },
        ['SUPER_ADMIN', 'DEPARTMENT_HEAD'].includes(role) && row.source === 'compliance' && row.organization_lifecycle_status === 'active' && { label: 'Delete file', icon: Trash2, danger: true, onClick: () => { setActionError(''); setDeleting(row); } },
      ]} /></td></tr>)}</tbody></table></div>}
      {!files.loading && !files.error && <div className="border-t border-line p-4"><PaginationControls currentPage={files.meta.currentPage} totalItems={files.meta.total} pageSize={filePageSize} onPageChange={setFilePage} pageSizeOptions={[10, 20, 50]} onPageSizeChange={(size) => { setFilePageSize(size); setFilePage(1); }} label="files" /></div>}
    </Card>}
    <ConfirmModal open={Boolean(deleting)} title="Delete submitted file?" recordName={deleting?.file_name} message="The file and submission will be removed. Reviewers and organization admins will be notified." confirmText="Delete file" busy={busy} error={actionError} onCancel={() => setDeleting(null)} onConfirm={remove} />
    <Modal open={Boolean(editing)} title="Replace submitted file" description={editing?.file_name} onClose={busy ? undefined : () => setEditing(null)} closeOnEscape={!busy} footer={<><Button variant="secondary" disabled={busy} onClick={() => setEditing(null)}>Cancel</Button><Button loading={busy} disabled={!replacement} onClick={replace}>Submit replacement</Button></>}>
      <p className="text-sm text-ink-muted-strong">The new file replaces the previous upload and returns to SAO for review. Approved financial reports and event documents retain their separate workflows.</p>
      <label className="mt-4 block text-sm font-semibold text-ink">New file<input type="file" disabled={busy} accept={editing?.allowed_extensions?.map((extension) => `.${extension}`).join(',')} className="mt-2 block w-full rounded-lg border border-line p-2 text-sm" onChange={(event) => setReplacement(event.target.files?.[0] || null)} /></label>
      {actionError && <p role="alert" className="mt-3 text-sm text-danger-strong">{actionError}</p>}
    </Modal>
  </div>;
}
