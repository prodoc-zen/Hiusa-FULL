import { formatDisplayText } from '../../../utils/displayText.js';
import DateTimeInput from '../../../components/ui/DateTimeInput.jsx';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Eye, Pencil, Plus, Send, Trash2, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Badge, StatusBadge } from './announcementShared.jsx';
import PaginationControls from '../../../components/PaginationControls';
import TableFilterBar from '../../../components/TableFilterBar';
import TableRowActions from '../../../components/TableRowActions';
import {
  getAnnouncements,
  updateAnnouncement,
  togglePublish,
  deleteAnnouncement,
} from '../../../services/announcementService';
import { fetchAllPages, listMeta, unwrapList } from '../../../services/pagination';
import AccessibleOverlay from '../../../components/AccessibleOverlay';
import { resolveAssetUrl } from '../../../utils/assetUrl';
import RichTextEditor, { RichTextBody } from '../../../components/RichText';

const ROLE_LABEL = { all: 'All Members', STUDENT: 'Students', SBO_OFFICER: 'SBO Officers', ADMIN: 'Admins', DEPARTMENT_HEAD: 'Department Heads', SUPER_ADMIN: 'Super Admin' };
const CATEGORY_LABEL = { general: 'General', election: 'Election', training: 'Training', events: 'Events', merchandise: 'Merchandise' };
const CATEGORY_OPTIONS = [
  { label: 'All Categories', value: 'all' },
  { label: 'General', value: 'general' },
  { label: 'Election', value: 'election' },
  { label: 'Training', value: 'training' },
  { label: 'Events', value: 'events' },
  { label: 'Merchandise', value: 'merchandise' },
];

function ConfirmModal({ open, title, message, confirmText, busy, error, onCancel, onConfirm }) {
  if (!open) return null;

  return (
    <AccessibleOverlay label={title} onClose={() => !busy && onCancel()} className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-lg border border-[#DDE7EF] bg-white p-6 shadow-2xl">
        <h3 className="text-lg font-bold text-[#0F172A]">{title}</h3>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
        {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={onCancel} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD]" disabled={busy}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className="h-11 rounded-lg bg-[#0878B7] px-5 text-sm font-bold text-white transition hover:bg-[#0F2F62] disabled:opacity-50" disabled={busy}>
            {busy ? 'Processing...' : confirmText}
          </button>
        </div>
      </div>
    </AccessibleOverlay>
  );
}

function formatDateTime(iso) {
  return iso ? new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '-';
}

function creatorName(item) {
  return item.creator ? `${item.creator.first_name} ${item.creator.last_name}` : 'Unknown';
}

function exportAnnouncements(items) {
  const headers = ['ID', 'Title', 'Audience', 'Category', 'Approval Status', 'Published', 'Views', 'Author ID', 'Author', 'Author Role', 'Created At', 'Published At', 'Reviewer', 'Review Remarks', 'Body'];
  const rows = items.map((item) => [item.id, item.title, item.target_role, item.category, item.approval_status, item.is_published ? 'Yes' : 'No', item.views_count || 0, item.creator?.school_id, creatorName(item), item.creator?.role, item.created_at, item.published_at, item.reviewer ? `${item.reviewer.first_name} ${item.reviewer.last_name}` : '', item.review_remarks, item.body]);
  const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `announcements-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
}

function getCurrentRole() {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}')?.role || '';
  } catch {
    return '';
  }
}

function getCurrentUserId() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    return user?.id ?? user?.school_id ?? null;
  } catch {
    return null;
  }
}

export default function ManageAnnouncementsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({ total: 0, currentPage: 1, lastPage: 1, perPage: 20 });
  const [summary, setSummary] = useState({ total: 0, published: 0, unpublished: 0, pending: 0, views: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [audienceFilter, setAudienceFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState('newest');
  const [details, setDetails] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [confirmState, setConfirmState] = useState({ open: false, title: '', message: '', confirmText: 'Confirm', action: null, busy: false });
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({ title: '', body: '', target_role: 'all', category: 'general' });
  const [exporting, setExporting] = useState(false);
  const currentRole = getCurrentRole();
  const currentUserId = getCurrentUserId();

  // Hoisted so the CSV export can reuse the exact same filter set as the
  // loaded page, without page/per_page, via fetchAllPages.
  const queryParams = useMemo(() => ({
    category: categoryFilter === 'all' ? undefined : categoryFilter,
    target_role: audienceFilter === 'all' ? undefined : audienceFilter,
    publication_status: statusFilter === 'all' ? undefined : statusFilter,
    search: search || undefined,
    from: from || undefined,
    to: to || undefined,
    sort,
  }), [categoryFilter, audienceFilter, statusFilter, search, from, to, sort]);

  const loadAnnouncements = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAnnouncements({ ...queryParams, page })
      .then((res) => {
        if (cancelled) return;
        setItems(unwrapList(res.data));
        setMeta(listMeta(res.data));
        setSummary(res.data?.summary ?? { total: 0, published: 0, unpublished: 0, pending: 0, views: 0 });
      })
      .catch(() => { if (!cancelled) setError('Failed to load announcements.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [queryParams, page]);

  async function handleExport() {
    setExporting(true);
    try {
      const all = await fetchAllPages((params) => getAnnouncements(params).then((res) => res.data), queryParams);
      exportAnnouncements(all);
    } catch {
      setActionError('Failed to export announcements. Please try again.');
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(loadAnnouncements, 250);
    return () => clearTimeout(timer);
  }, [loadAnnouncements]);

  useEffect(() => { setPage(1); }, [categoryFilter, audienceFilter, statusFilter, search, from, to, sort]);

  const activeAnnouncementFilters = [
    search.trim() && `Search: ${search.trim()}`,
    categoryFilter !== 'all' && `Category: ${CATEGORY_LABEL[categoryFilter] || categoryFilter}`,
    audienceFilter !== 'all' && `Audience: ${ROLE_LABEL[audienceFilter] || audienceFilter}`,
    statusFilter !== 'all' && `Status: ${statusFilter === 'draft' ? 'Unpublished / Draft' : 'Published'}`,
    from && `From: ${from}`,
    to && `To: ${to}`,
    sort !== 'newest' && `Sort: ${sort.replaceAll('_', ' ')}`,
  ].filter(Boolean);

  const clearAnnouncementFilters = () => {
    setSearch('');
    setCategoryFilter('all');
    setAudienceFilter('all');
    setStatusFilter('all');
    setFrom('');
    setTo('');
    setSort('newest');
  };

  async function handleToggle(id) {
    try {
      setActionError('');
      const res = await togglePublish(id);
      setItems((prev) => prev.map((a) => (a.id === id ? res.data : a)));
      setActionMessage('Announcement publication updated.');
      loadAnnouncements();
    } catch (err) {
      setActionError(err.response?.data?.message || 'Failed to update announcement. Please try again.');
      throw err;
    }
  }

  async function handleDelete(id) {
    try {
      setActionError('');
      await deleteAnnouncement(id);
      // Reload rather than splice locally so the pagination footer's total
      // (and this page's contents, if it was just emptied) stay in sync with
      // the server instead of drifting.
      setActionMessage('Announcement deleted.');
      loadAnnouncements();
    } catch (err) {
      setActionError(err.response?.data?.message || 'Failed to delete announcement. Please try again.');
      throw err;
    }
  }

  function openEdit(announcement) {
    setActionError('');
    setEditing(announcement);
    setEditForm({
      title: announcement.title || '',
      body: announcement.body || '',
      target_role: announcement.target_role || 'all',
      category: announcement.category || 'general',
    });
  }

  async function handleEdit(event) {
    event.preventDefault();
    if (!editing) return;

    try {
      const res = await updateAnnouncement(editing.id, editForm);
      setItems((prev) => prev.map((a) => (a.id === editing.id ? res.data : a)));
      setEditing(null);
      setActionMessage('Announcement updated.');
      loadAnnouncements();
    } catch (err) {
      setActionError(err.response?.data?.message || 'Failed to update announcement. Please try again.');
    }
  }

  if (loading) {
    return (
      <div className="space-y-3 rounded-lg border border-[#DDE7EF] bg-white p-5 shadow-sm">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-100 bg-red-50 p-6 text-center">
        <p className="text-sm font-semibold text-red-700">{error}</p>
        <button onClick={loadAnnouncements} className="mt-2 text-sm font-bold text-red-600 underline">Try again</button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[#DDE7EF] bg-white p-5">
      {actionError && !confirmState.open && !editing && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{actionError}</p>}
      {actionMessage && <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{actionMessage}</p>}
      <div className="mb-4 grid gap-px overflow-hidden rounded-lg border border-[#DDE7EF] bg-[#DDE7EF] sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Matching records', summary.total], ['Published', summary.published], ['Pending approval', summary.pending], ['Recorded views', summary.views],
        ].map(([label, value]) => <dl key={label} className="bg-white p-3.5"><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 text-xl font-black tabular-nums text-[#0F172A]">{value}</dd></dl>)}
      </div>
      <section className="mb-4 rounded-lg border border-[#DDE7EF] p-4" aria-label="Announcement interactions">
        <h2 className="text-sm font-bold text-[#0F172A]">Announcement interactions</h2>
        <p className="mt-1 text-xs text-[#64748B]">Views and reactions for announcements on this page.</p>
        {items.length === 0 ? <p className="mt-4 text-sm text-[#64748B]">No interaction data for the current selection.</p> : <div className="mt-4 space-y-3">{items.slice(0, 8).map((item) => {
          const views = Number(item.views_count || 0);
          const reactions = Number(item.reactions_count || 0);
          const maximum = Math.max(1, ...items.slice(0, 8).map((row) => Math.max(Number(row.views_count || 0), Number(row.reactions_count || 0))));
          return <div key={item.id} className="grid gap-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]"><p className="truncate text-xs font-semibold text-[#0F172A]" title={formatDisplayText(item.title)}>{formatDisplayText(item.title)}</p><div className="space-y-1"><div className="flex items-center gap-2"><span className="w-14 text-[11px] text-slate-500">Views</span><div className="h-3 flex-1 rounded bg-[#EEF6FB]"><div className="h-full rounded bg-[#0B8ED0]" style={{ width: `${views / maximum * 100}%` }} /></div><span className="w-8 text-right text-[11px] font-semibold tabular-nums">{views}</span></div><div className="flex items-center gap-2"><span className="w-14 text-[11px] text-slate-500">Likes</span><div className="h-3 flex-1 rounded bg-[#EEF6FB]"><div className="h-full rounded bg-[#0F2F62]" style={{ width: `${reactions / maximum * 100}%` }} /></div><span className="w-8 text-right text-[11px] font-semibold tabular-nums">{reactions}</span></div></div></div>;
        })}</div>}
      </section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#DDE7EF] pt-4"><h2 className="text-base font-black text-[#0F172A]">Announcement list</h2><div className="flex flex-wrap gap-2"><button type="button" onClick={() => navigate('/dashboard/announcements/create-announcement')} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#0878B7] px-4 text-xs font-bold text-white"><Plus size={14} /> Create announcement</button><button type="button" onClick={handleExport} disabled={!meta.total || exporting} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#DDE7EF] px-4 text-xs font-bold text-[#0F2F62] disabled:opacity-50"><Download size={14} /> {exporting ? 'Exporting...' : 'Export CSV'}</button></div></div>
      <div className="-mx-5 mb-4">
        <TableFilterBar searchValue={search} onSearchChange={setSearch} searchPlaceholder="Search title, content, or author" activeFilters={activeAnnouncementFilters} onClear={clearAnnouncementFilters} resultCount={meta.total} resultLabel={meta.total === 1 ? 'announcement' : 'announcements'} secondaryClassName="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-xs font-semibold text-slate-600">{CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
          <select value={audienceFilter} onChange={(e) => setAudienceFilter(e.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-xs font-semibold text-slate-600"><option value="all">All audiences</option>{Object.entries(ROLE_LABEL).filter(([value]) => value !== 'all').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-xs font-semibold text-slate-600"><option value="all">All publication states</option><option value="published">Published</option><option value="draft">Unpublished / Draft</option></select>
          <DateTimeInput type="date" aria-label="Created from" value={from} onChange={(e) => setFrom(e.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-xs" />
          <DateTimeInput type="date" aria-label="Created to" value={to} onChange={(e) => setTo(e.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-xs" />
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-xs font-semibold text-slate-600"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="title">Title A-Z</option><option value="most_viewed">Most viewed</option></select>
        </TableFilterBar>
      </div>
      {items.length === 0 ? <p className="py-8 text-center text-sm text-[#64748B]">No announcements match these filters.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[580px] text-left text-sm"><thead className="bg-[#F8FBFD]"><tr><th className="px-4 py-3">Title</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Audience</th><th className="px-4 py-3 text-right">Actions</th></tr></thead><tbody className="divide-y divide-[#DDE7EF]">{items.map((a) => {
        const canModify = a.announcement_source !== 'SAO' && (currentRole === 'ADMIN' || Number(a.created_by) === Number(currentUserId));
        const canPublish = canModify && currentRole === 'ADMIN';
        const isExpanded = expandedId === a.id;
        return <Fragment key={a.id}><tr className="hover:bg-[#F8FBFD]"><td className="px-4 py-3"><button type="button" aria-expanded={isExpanded} aria-controls={`announcement-details-${a.id}`} onClick={() => setExpandedId(isExpanded ? null : a.id)} className="min-h-10 text-left font-bold text-[#0F172A] hover:text-[#0878B7]">{formatDisplayText(a.title)}</button></td><td className="px-4 py-3">{a.approval_status === 'pending' ? <Badge color="yellow">Pending approval</Badge> : a.approval_status === 'rejected' ? <Badge color="red">Rejected</Badge> : <StatusBadge status={a.is_published ? 'Published' : 'Draft'} />}</td><td className="px-4 py-3 text-[#64748B]">{ROLE_LABEL[a.target_role] || a.target_role}</td><td className="px-4 py-3"><TableRowActions subject={a.title} label="Announcement actions" actions={[
          { label: 'View full record', icon: Eye, onClick: () => setDetails(a) },
          canModify && { label: 'Edit announcement', icon: Pencil, onClick: () => openEdit(a) },
          canPublish && { label: a.is_published ? 'Unpublish announcement' : a.approval_status === 'pending' ? 'Approve & publish' : 'Publish announcement', icon: Send, onClick: () => setConfirmState({ open: true, title: a.is_published ? 'Unpublish announcement' : 'Publish announcement', message: `${a.is_published ? 'Unpublish' : 'Publish'} ${a.title}?`, confirmText: a.is_published ? 'Unpublish' : 'Publish', action: async () => handleToggle(a.id), busy: false }) },
          canModify && { label: 'Delete announcement', icon: Trash2, danger: true, onClick: () => setConfirmState({ open: true, title: 'Delete announcement', message: `Delete ${a.title}?`, confirmText: 'Delete', action: async () => handleDelete(a.id), busy: false }) },
        ]} /></td></tr>{isExpanded && <tr id={`announcement-details-${a.id}`}><td colSpan={4} className="bg-[#F8FBFD] px-4 py-5"><article className="mx-auto max-w-2xl rounded-lg border border-[#DDE7EF] bg-white"><header className="border-b border-[#DDE7EF] p-4"><p className="text-sm font-bold text-[#0F172A]">{formatDisplayText(a.source_organization?.name) || formatDisplayText(a.organization?.name) || 'HIUSA'}</p><p className="text-xs text-[#64748B]">Published {formatDateTime(a.published_at)}</p></header><div className="p-4"><h3 className="text-lg font-black text-[#0F172A]">{formatDisplayText(a.title)}</h3><RichTextBody value={a.body} className="mt-2 text-sm leading-6 text-[#0F172A]" />{a.image_url && <img src={resolveAssetUrl(a.image_url)} alt="" className="mt-3 max-h-80 w-full object-contain" />}</div><dl className="grid gap-2 border-t border-[#DDE7EF] p-4 text-xs sm:grid-cols-2">{[['Posted by', creatorName(a)], ['Created', formatDateTime(a.created_at)], ['Updated', formatDateTime(a.updated_at)], ['Reviewer', a.reviewer ? `${a.reviewer.first_name} ${a.reviewer.last_name}` : '-'], ['Category', CATEGORY_LABEL[a.category] || a.category], ['Views', a.views_count || 0]].map(([label, value]) => <div key={label}><dt className="font-bold text-[#64748B]">{label}</dt><dd className="mt-1 text-[#0F172A]">{value || '-'}</dd></div>)}</dl></article></td></tr>}</Fragment>;
      })}</tbody></table></div>}
      <PaginationControls currentPage={meta.currentPage} totalItems={meta.total} pageSize={meta.perPage} onPageChange={setPage} label="announcements" />

      <ConfirmModal
        open={confirmState.open}
        title={confirmState.title}
        message={confirmState.message}
        confirmText={confirmState.confirmText}
        busy={confirmState.busy}
        error={actionError}
        onCancel={() => setConfirmState({ open: false, title: '', message: '', confirmText: 'Confirm', action: null, busy: false })}
        onConfirm={async () => {
          if (!confirmState.action) return;
          setConfirmState((prev) => ({ ...prev, busy: true }));
          try {
            await confirmState.action();
            setConfirmState({ open: false, title: '', message: '', confirmText: 'Confirm', action: null, busy: false });
          } catch {
            // Keep the confirmation open so the action can be retried.
          } finally {
            setConfirmState((prev) => ({ ...prev, busy: false }));
          }
        }}
      />

      {editing && (
        <AccessibleOverlay label="Edit announcement" onClose={() => setEditing(null)} className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 p-4 backdrop-blur-sm">
          <form onSubmit={handleEdit} className="w-full max-w-2xl rounded-lg border border-[#DDE7EF] bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-[#0F172A]">Edit Announcement</h3>
              <button type="button" onClick={() => setEditing(null)} className="rounded p-1 text-slate-500 hover:bg-red-50">Close</button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <input value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm" placeholder="Title" />
              <select value={editForm.target_role} onChange={(e) => setEditForm({ ...editForm, target_role: e.target.value })} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm">
                {Object.entries(ROLE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <select value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm sm:col-span-2">
                {CATEGORY_OPTIONS.filter((opt) => opt.value !== 'all').map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
              <div className="sm:col-span-2"><RichTextEditor ariaLabel="Announcement content" value={editForm.body} onChange={(body) => setEditForm({ ...editForm, body })} rows={8} placeholder="Announcement content" /></div>
            </div>
            {actionError && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{actionError}</p>}
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setEditing(null)} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD]">Cancel</button>
              <button type="submit" disabled={!editForm.title.trim() || !editForm.body.trim()} className="h-11 rounded-lg bg-[#0878B7] px-5 text-sm font-bold text-white hover:bg-[#0F2F62] disabled:opacity-50">Save Record</button>
            </div>
          </form>
        </AccessibleOverlay>
      )}
      {details && (
        <AccessibleOverlay label="Announcement details" onClose={() => setDetails(null)} closeOnBackdrop className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-[#DDE7EF] bg-white p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-widest text-[#0878B7]">Announcement #{details.id}</p><h3 className="mt-1 text-xl font-black text-[#0F172A]">{formatDisplayText(details.title)}</h3></div><button onClick={() => setDetails(null)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={18} /></button></div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[
              ['Audience', ROLE_LABEL[details.target_role] || details.target_role], ['Category', CATEGORY_LABEL[details.category] || details.category], ['Approval', details.approval_status], ['Publication', details.is_published ? 'Published' : 'Draft'],
              ['Unique Views', details.views_count || 0], ['Created', formatDateTime(details.created_at)], ['Updated', formatDateTime(details.updated_at)], ['Published', formatDateTime(details.published_at)],
            ].map(([label, value]) => <div key={label} className="rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 break-words text-sm font-semibold text-[#0F172A]">{value ?? '-'}</p></div>)}</div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-lg border border-[#DDE7EF] p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Author</p><p className="mt-2 text-sm font-bold text-[#0F172A]">{creatorName(details)}</p><p className="mt-1 text-xs text-slate-500">{[details.creator?.school_id, details.creator?.email, details.creator?.role, details.creator?.position_title, details.creator?.department, details.creator?.program, details.creator?.year_level, details.creator?.section].filter(Boolean).join(' · ') || '-'}</p></div><div className="rounded-lg border border-[#DDE7EF] p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Review trail</p><p className="mt-2 text-sm font-bold text-[#0F172A]">{details.reviewer ? `${formatDisplayText(details.reviewer.first_name)} ${formatDisplayText(details.reviewer.last_name)}` : 'Not reviewed'}</p><p className="mt-1 whitespace-pre-wrap text-xs text-slate-500">{details.review_remarks || 'No review remarks.'}</p></div></div>
            <div className="mt-4 rounded-lg border border-[#DDE7EF] p-5"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Full announcement</p><RichTextBody value={details.body} className="mt-3 text-sm leading-7 text-slate-700" /></div>
          </div>
        </AccessibleOverlay>
      )}
    </div>
  );
}
