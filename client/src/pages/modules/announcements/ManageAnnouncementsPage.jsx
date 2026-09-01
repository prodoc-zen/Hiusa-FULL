import { useCallback, useEffect, useState } from 'react';
import { Download, Eye, Search, Trash2, X } from 'lucide-react';
import { Badge, SectionHeader, StatusBadge } from './announcementShared.jsx';
import PaginationControls from '../../../components/PaginationControls';
import {
  getAnnouncements,
  updateAnnouncement,
  togglePublish,
  deleteAnnouncement,
} from '../../../services/announcementService';

const ROLE_LABEL = { all: 'All Members', STUDENT: 'Students', SBO_OFFICER: 'SBO Officers', ADMIN: 'Admins', DEPARTMENT_HEAD: 'Department Heads' };
const CATEGORY_LABEL = { general: 'General', election: 'Election', training: 'Training', events: 'Events', merchandise: 'Merchandise' };
const CATEGORY_OPTIONS = [
  { label: 'All Categories', value: 'all' },
  { label: 'General', value: 'general' },
  { label: 'Election', value: 'election' },
  { label: 'Training', value: 'training' },
  { label: 'Events', value: 'events' },
  { label: 'Merchandise', value: 'merchandise' },
];
const PAGE_SIZE = 10;

function ConfirmModal({ open, title, message, confirmText, busy, onCancel, onConfirm }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-[#DDE7EF] bg-white p-6 shadow-2xl">
        <h3 className="text-lg font-bold text-[#0F172A]">{title}</h3>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={onCancel} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD]" disabled={busy}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className="h-11 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white transition hover:bg-[#0878B7] disabled:opacity-50" disabled={busy}>
            {busy ? 'Processing...' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatDate(iso) {
  return iso ? new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '-';
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
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [audienceFilter, setAudienceFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [details, setDetails] = useState(null);
  const [confirmState, setConfirmState] = useState({ open: false, title: '', message: '', confirmText: 'Confirm', action: null, busy: false });
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({ title: '', body: '', target_role: 'all', category: 'general' });
  const currentRole = getCurrentRole();
  const currentUserId = getCurrentUserId();

  const loadAnnouncements = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = {
      category: categoryFilter === 'all' ? undefined : categoryFilter,
      target_role: audienceFilter === 'all' ? undefined : audienceFilter,
      publication_status: statusFilter === 'all' ? undefined : statusFilter,
      search: search || undefined,
      from: from || undefined,
      to: to || undefined,
      sort,
    };
    getAnnouncements(params)
      .then((res) => { if (!cancelled) setItems(Array.isArray(res.data) ? res.data : []); })
      .catch(() => { if (!cancelled) setError('Failed to load announcements.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [categoryFilter, audienceFilter, statusFilter, search, from, to, sort]);

  useEffect(() => {
    const timer = setTimeout(loadAnnouncements, 250);
    return () => clearTimeout(timer);
  }, [loadAnnouncements]);

  useEffect(() => { setPage(1); }, [categoryFilter, audienceFilter, statusFilter, search, from, to, sort]);
  useEffect(() => {
    setPage((current) => Math.min(current, Math.max(1, Math.ceil(items.length / PAGE_SIZE))));
  }, [items.length]);
  const pagedItems = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  async function handleToggle(id) {
    try {
      const res = await togglePublish(id);
      setItems((prev) => prev.map((a) => (a.id === id ? res.data : a)));
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update announcement. Please try again.');
    }
  }

  async function handleDelete(id) {
    try {
      await deleteAnnouncement(id);
      setItems((prev) => prev.filter((a) => a.id !== id));
    } catch {
      setError('Failed to delete announcement. Please try again.');
    }
  }

  function openEdit(announcement) {
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
    } catch {
      setError('Failed to update announcement. Please try again.');
    }
  }

  if (loading) {
    return (
      <div className="space-y-3 rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-100 bg-red-50 p-6 text-center">
        <p className="text-sm font-semibold text-red-700">{error}</p>
        <button onClick={loadAnnouncements} className="mt-2 text-sm font-bold text-red-600 underline">Try again</button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3"><SectionHeader title="Announcement Intelligence" /><button onClick={() => exportAnnouncements(items)} disabled={!items.length} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#0B8ED0] px-4 text-xs font-bold text-white disabled:opacity-50"><Download size={14} /> Export CSV</button></div>
      <div className="mb-4 grid gap-2 md:grid-cols-2 xl:grid-cols-7">
        <label className="relative xl:col-span-2"><Search size={14} className="absolute left-3 top-3.5 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, content, author..." className="h-11 w-full rounded-lg border border-[#DDE7EF] pl-9 pr-3 text-xs outline-none focus:border-[#0B8ED0]" /></label>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-xs font-semibold text-slate-600 outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15">
          {CATEGORY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <select value={audienceFilter} onChange={(e) => setAudienceFilter(e.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-xs font-semibold text-slate-600"><option value="all">All audiences</option>{Object.entries(ROLE_LABEL).filter(([value]) => value !== 'all').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-xs font-semibold text-slate-600"><option value="all">All publication states</option><option value="published">Published</option><option value="draft">Unpublished / Draft</option></select>
        <input type="date" aria-label="Created from" value={from} onChange={(e) => setFrom(e.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-xs" />
        <input type="date" aria-label="Created to" value={to} onChange={(e) => setTo(e.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-xs" />
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-xs font-semibold text-slate-600"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="title">Title A–Z</option><option value="most_viewed">Most viewed</option></select>
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Matching records', items.length], ['Published', items.filter((item) => item.is_published).length], ['Pending approval', items.filter((item) => item.approval_status === 'pending').length], ['Recorded views', items.reduce((sum, item) => sum + Number(item.views_count || 0), 0)],
        ].map(([label, value]) => <div key={label} className="rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 text-xl font-black text-[#0F172A]">{value}</p></div>)}
      </div>
      <div className="mb-4 flex justify-end"><button type="button" onClick={() => { setSearch(''); setCategoryFilter('all'); setAudienceFilter('all'); setStatusFilter('all'); setFrom(''); setTo(''); setSort('newest'); }} className="rounded-lg border border-[#DDE7EF] px-3 py-2 text-xs font-bold text-slate-600">Reset filters</button></div>
      {items.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">No announcements yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] text-xs">
            <thead>
              <tr className="border-b border-[#DDE7EF]">
                {['ID / Title', 'Audience', 'Category', 'Status', 'Author', 'Reach', 'Created / Published', 'Reviewer', 'Actions'].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-left font-semibold text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagedItems.map((a) => {
                const canModify = currentRole === 'ADMIN' || Number(a.created_by) === Number(currentUserId);
                const canPublishOwnDraft = canModify && ['ADMIN', 'DEPARTMENT_HEAD'].includes(currentRole);

                return (
                  <tr key={a.id} className="border-b border-[#EEF6FB] transition-colors hover:bg-[#F8FBFD]">
                      <td className="max-w-xs px-3 py-3"><button onClick={() => setDetails(a)} className="text-left font-semibold text-[#0F172A] hover:text-[#0B8ED0]">#{a.id} · {a.title}</button><p className="mt-1 line-clamp-1 text-[10px] font-normal text-slate-400">{a.body}</p></td>
                      <td className="px-3 py-3 text-slate-500">{ROLE_LABEL[a.target_role] ?? a.target_role}</td>
                      <td className="px-3 py-3">
                        <Badge color="blue">{CATEGORY_LABEL[a.category] ?? 'General'}</Badge>
                      </td>
                      <td className="px-3 py-3">
                        {a.approval_status === 'pending'
                          ? <Badge color="yellow">Pending Approval</Badge>
                          : a.approval_status === 'rejected'
                            ? <Badge color="red">Rejected</Badge>
                            : <StatusBadge status={a.is_published ? 'Published' : 'Draft'} />}
                      </td>
                      <td className="px-3 py-3 text-slate-500"><p className="font-semibold text-slate-700">{creatorName(a)}</p><p className="text-[10px]">{[a.creator?.role, a.creator?.position_title].filter(Boolean).join(' · ') || '-'}</p></td>
                      <td className="px-3 py-3"><p className="font-bold text-[#0F172A]">{Number(a.views_count || 0).toLocaleString()}</p><p className="text-[10px] text-slate-400">unique views</p></td>
                      <td className="px-3 py-3 text-slate-500"><p>{formatDate(a.created_at)}</p><p className="text-[10px]">Published: {formatDate(a.published_at)}</p></td>
                      <td className="px-3 py-3 text-slate-500"><p>{a.reviewer ? `${a.reviewer.first_name} ${a.reviewer.last_name}` : '-'}</p><p className="max-w-[180px] truncate text-[10px]">{a.review_remarks || 'No remarks'}</p></td>
                      <td className="px-3 py-3">
                        <div className="flex gap-1.5">
                          <button onClick={() => setDetails(a)} title="View complete record" className="rounded-md p-2 text-slate-500 transition hover:bg-slate-100"><Eye size={13} /></button>
                          {canModify && (
                            <button
                              onClick={() => openEdit(a)}
                              className="rounded bg-[#EEF6FB] px-2 py-2 text-[10px] font-semibold text-[#0B8ED0] transition hover:bg-[#DDE7EF]"
                            >
                              Edit
                            </button>
                          )}
                          {!a.is_published && a.approval_status === 'pending' && currentRole === 'ADMIN' ? (
                            <button
                              onClick={() => setConfirmState({
                                open: true,
                                title: 'Approve and Publish',
                                message: `Approve and publish "${a.title}" now?`,
                                confirmText: 'Approve & Publish',
                                action: async () => handleToggle(a.id),
                                busy: false,
                              })}
                              className="rounded bg-emerald-100 px-2 py-2 text-[10px] font-semibold text-emerald-700 transition hover:bg-emerald-200"
                            >
                              Approve & Publish
                            </button>
                          ) : !a.is_published && !['pending', 'rejected'].includes(a.approval_status) && canPublishOwnDraft ? (
                            <button
                              onClick={() => setConfirmState({
                                open: true,
                                title: 'Publish Announcement',
                                message: `Publish "${a.title}" now?`,
                                confirmText: 'Publish',
                                action: async () => handleToggle(a.id),
                                busy: false,
                              })}
                              className="rounded bg-emerald-100 px-2 py-2 text-[10px] font-semibold text-emerald-700 transition hover:bg-emerald-200"
                            >
                              Publish
                            </button>
                          ) : a.is_published && canPublishOwnDraft ? (
                            <button
                              onClick={() => setConfirmState({
                                open: true,
                                title: 'Unpublish Announcement',
                                message: `Set "${a.title}" back to draft?`,
                                confirmText: 'Unpublish',
                                action: async () => handleToggle(a.id),
                                busy: false,
                              })}
                              className="rounded bg-amber-100 px-2 py-2 text-[10px] font-semibold text-amber-700 transition hover:bg-amber-200"
                            >
                              Unpublish
                            </button>
                          ) : null}
                          {canModify && (
                            <button
                              onClick={() => setConfirmState({
                                open: true,
                                title: 'Delete Announcement',
                                message: `Delete "${a.title}"? This cannot be undone.`,
                                confirmText: 'Delete',
                                action: async () => handleDelete(a.id),
                                busy: false,
                              })}
                              className="rounded-md p-2 text-red-500 transition hover:bg-red-50"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <PaginationControls currentPage={page} totalItems={items.length} pageSize={PAGE_SIZE} onPageChange={setPage} label="announcements" />

      <ConfirmModal
        open={confirmState.open}
        title={confirmState.title}
        message={confirmState.message}
        confirmText={confirmState.confirmText}
        busy={confirmState.busy}
        onCancel={() => setConfirmState({ open: false, title: '', message: '', confirmText: 'Confirm', action: null, busy: false })}
        onConfirm={async () => {
          if (!confirmState.action) return;
          setConfirmState((prev) => ({ ...prev, busy: true }));
          try {
            await confirmState.action();
            setConfirmState({ open: false, title: '', message: '', confirmText: 'Confirm', action: null, busy: false });
          } finally {
            setConfirmState((prev) => ({ ...prev, busy: false }));
          }
        }}
      />

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 p-4 backdrop-blur-sm">
          <form onSubmit={handleEdit} className="w-full max-w-2xl rounded-xl border border-[#DDE7EF] bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-[#0F172A]">Edit Announcement</h3>
              <button type="button" onClick={() => setEditing(null)} className="rounded p-1 text-slate-400 hover:bg-red-50">Close</button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <input value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm" placeholder="Title" />
              <select value={editForm.target_role} onChange={(e) => setEditForm({ ...editForm, target_role: e.target.value })} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm">
                {Object.entries(ROLE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <select value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm sm:col-span-2">
                {CATEGORY_OPTIONS.filter((opt) => opt.value !== 'all').map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
              <textarea value={editForm.body} onChange={(e) => setEditForm({ ...editForm, body: e.target.value })} rows={8} className="rounded-lg border border-[#DDE7EF] px-3 py-2.5 text-sm sm:col-span-2" placeholder="Announcement content" />
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setEditing(null)} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD]">Cancel</button>
              <button type="submit" disabled={!editForm.title.trim() || !editForm.body.trim()} className="h-11 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7] disabled:opacity-50">Save Record</button>
            </div>
          </form>
        </div>
      )}
      {details && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 p-4 backdrop-blur-sm" onMouseDown={() => setDetails(null)}>
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-[#DDE7EF] bg-white p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-widest text-[#0B8ED0]">Announcement #{details.id}</p><h3 className="mt-1 text-xl font-black text-[#0F172A]">{details.title}</h3></div><button onClick={() => setDetails(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button></div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[
              ['Audience', ROLE_LABEL[details.target_role] || details.target_role], ['Category', CATEGORY_LABEL[details.category] || details.category], ['Approval', details.approval_status], ['Publication', details.is_published ? 'Published' : 'Draft'],
              ['Unique Views', details.views_count || 0], ['Created', formatDateTime(details.created_at)], ['Updated', formatDateTime(details.updated_at)], ['Published', formatDateTime(details.published_at)],
            ].map(([label, value]) => <div key={label} className="rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 break-words text-sm font-semibold text-[#0F172A]">{value ?? '-'}</p></div>)}</div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-lg border border-[#DDE7EF] p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Author</p><p className="mt-2 text-sm font-bold text-[#0F172A]">{creatorName(details)}</p><p className="mt-1 text-xs text-slate-500">{[details.creator?.school_id, details.creator?.email, details.creator?.role, details.creator?.position_title, details.creator?.department, details.creator?.program, details.creator?.year_level, details.creator?.section].filter(Boolean).join(' · ') || '-'}</p></div><div className="rounded-lg border border-[#DDE7EF] p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Review trail</p><p className="mt-2 text-sm font-bold text-[#0F172A]">{details.reviewer ? `${details.reviewer.first_name} ${details.reviewer.last_name}` : 'Not reviewed'}</p><p className="mt-1 whitespace-pre-wrap text-xs text-slate-500">{details.review_remarks || 'No review remarks.'}</p></div></div>
            <div className="mt-4 rounded-lg border border-[#DDE7EF] p-5"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Full announcement</p><p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700">{details.body}</p></div>
          </div>
        </div>
      )}
    </div>
  );
}
