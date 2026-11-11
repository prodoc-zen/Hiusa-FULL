import HiusaSelect from '../../../components/ui/Select';
import { formatDisplayText } from '../../../utils/displayText.js';
import { manilaDateStamp } from '../../../utils/dateTime';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Megaphone, Pencil, Plus, Search, Send, Trash2 } from 'lucide-react';
import { AnnouncementStageChip, announcementStage, announcementVisibility } from './announcementShared.jsx';
import { Button, DataTable, Drawer, EmptyState, ErrorState, Field, Input, NextStep, PageHeader } from '../../../components/ui';
import PaginationControls from '../../../components/PaginationControls';
import TableRowActions from '../../../components/TableRowActions';
import {
  getAnnouncements,
  updateAnnouncement,
  togglePublish,
  deleteAnnouncement,
} from '../../../services/announcementService';
import { fetchAllPages, listMeta, unwrapList } from '../../../services/pagination';
import AccessibleOverlay from '../../../components/AccessibleOverlay';
import RichTextEditor, { RichTextBody } from '../../../components/RichText';
import { buildCsv } from '../../../utils/csv';

const ROLE_LABEL = { all: 'All Members', STUDENT: 'Students', SBO_OFFICER: 'SBO Officers', ADMIN: 'Admins', DEPARTMENT_HEAD: 'Department Heads', SUPER_ADMIN: 'Super Admin' };
const CATEGORY_LABEL = { general: 'General', election: 'Election', training: 'Training', events: 'Events', merchandise: 'Merchandise' };
const CATEGORY_OPTIONS = [
  { label: 'All categories', value: 'all' },
  { label: 'General', value: 'general' },
  { label: 'Election', value: 'election' },
  { label: 'Training', value: 'training' },
  { label: 'Events', value: 'events' },
  { label: 'Merchandise', value: 'merchandise' },
];

function ConfirmModal({ open, title, message, confirmText, busy, error, onCancel, onConfirm }) {
  if (!open) return null;

  return (
    <AccessibleOverlay label={title} onClose={() => !busy && onCancel()} className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/50 p-4">
      <div className="w-full max-w-md rounded-card border border-line bg-surface p-6">
        <h3 className="text-lg font-semibold text-ink">{title}</h3>
        <p className="mt-2 text-sm text-ink-muted-strong">{message}</p>
        {error && <p role="alert" className="mt-3 text-sm font-medium text-danger-strong">{error}</p>}
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button onClick={onConfirm} loading={busy}>{confirmText}</Button>
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
  const csv = buildCsv(headers, rows);
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `announcements-${manilaDateStamp()}.csv`; link.click(); URL.revokeObjectURL(url);
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

const CREATE_PATH = '/dashboard/announcements/create-announcement';

export default function ManageAnnouncementsPage() {
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({ total: 0, currentPage: 1, lastPage: 1, perPage: 20 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [details, setDetails] = useState(null);
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
    publication_status: statusFilter === 'all' ? undefined : statusFilter,
    search: search || undefined,
    sort: 'newest',
  }), [categoryFilter, statusFilter, search]);

  const loadAnnouncements = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAnnouncements({ ...queryParams, page })
      .then((res) => {
        if (cancelled) return;
        setItems(unwrapList(res.data));
        setMeta(listMeta(res.data));
      })
      .catch(() => { if (!cancelled) setError('Check your connection and try again.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [queryParams, page]);

  async function handleExport() {
    setExporting(true);
    try {
      const all = await fetchAllPages((params) => getAnnouncements(params).then((res) => res.data), queryParams);
      exportAnnouncements(all);
    } catch {
      setActionError('Could not export announcements. Try again.');
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(loadAnnouncements, 250);
    return () => clearTimeout(timer);
  }, [loadAnnouncements]);

  useEffect(() => { setPage(1); }, [categoryFilter, statusFilter, search]);

  const hasFilters = Boolean(search.trim()) || categoryFilter !== 'all' || statusFilter !== 'all';

  const clearAnnouncementFilters = () => {
    setSearch('');
    setCategoryFilter('all');
    setStatusFilter('all');
  };

  async function handleToggle(id) {
    try {
      setActionError('');
      const res = await togglePublish(id);
      setItems((prev) => prev.map((a) => (a.id === id ? res.data : a)));
      setActionMessage('Announcement publication updated.');
      loadAnnouncements();
    } catch (err) {
      setActionError(err.response?.data?.message || 'Could not update the announcement. Try again.');
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
      setActionError(err.response?.data?.message || 'Could not delete the announcement. Try again.');
      throw err;
    }
  }

  function openEdit(announcement) {
    setActionError('');
    setDetails(null);
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
      setActionError(err.response?.data?.message || 'Could not update the announcement. Try again.');
    }
  }

  function askPublish(announcement) {
    setDetails(null);
    setConfirmState({ open: true, title: announcement.is_published ? 'Unpublish announcement' : 'Publish announcement', message: `${announcement.is_published ? 'Unpublish' : 'Publish'} ${announcement.title}?`, confirmText: announcement.is_published ? 'Unpublish' : 'Publish', action: async () => handleToggle(announcement.id), busy: false });
  }

  function canModify(announcement) {
    return announcement.announcement_source !== 'SAO' && (currentRole === 'ADMIN' || Number(announcement.created_by) === Number(currentUserId));
  }

  function nextStepFor(announcement, canModify) {
    const stage = announcementStage(announcement);
    const isAdmin = currentRole === 'ADMIN';
    if (stage.key === 'pending') {
      return isAdmin
        ? { tone: 'action', title: 'An officer is waiting for your approval', body: 'Approve it to publish, or return it with remarks.', actorRole: 'Admin', primary: { label: 'Review this announcement', to: announcement.approval_id ? `/dashboard/approvals?record=${announcement.approval_id}` : '/dashboard/approvals' } }
        : { tone: 'waiting', title: 'Waiting for Admin approval', body: 'No action needed from you.', actorRole: 'Admin' };
    }
    if (stage.key === 'returned') {
      return canModify
        ? { tone: 'blocked', title: 'Returned by the Admin', body: `${announcement.review_remarks ? `${announcement.review_remarks} ` : ''}Edit it to send it for approval again.`, primary: { label: 'Edit announcement', onClick: () => openEdit(announcement) } }
        : { tone: 'waiting', title: 'Returned to the officer', body: 'The officer can edit it and send it again.' };
    }
    if (stage.key === 'draft') {
      return canModify && isAdmin
        ? { tone: 'action', title: 'Not published yet', body: 'Publish it when it is ready for its audience.', primary: { label: 'Publish announcement', onClick: () => askPublish(announcement) } }
        : { tone: 'waiting', title: 'Not published yet', body: 'Only the Admin can publish announcements.', actorRole: 'Admin' };
    }
    return {
      tone: 'done',
      title: 'Published',
      body: announcement.announcement_source === 'SAO' ? 'Only the SAO can change this announcement.' : canModify ? 'Its audience can see it now.' : 'Only its author or the Admin can change it.',
    };
  }

  const header = (
    <PageHeader
      purpose={currentRole === 'SBO_OFFICER' ? 'Each announcement goes to the Admin for approval before it is published.' : undefined}
      actions={<Button variant="secondary" leftIcon={Download} onClick={handleExport} disabled={!meta.total || exporting}>{exporting ? 'Exporting...' : 'Export CSV'}</Button>}
      primary={<Button to={CREATE_PATH} leftIcon={Plus}>New announcement</Button>}
    />
  );

  const filters = (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
      <label className="relative min-w-0 sm:max-w-sm sm:flex-1"><span className="sr-only">Search announcements</span><Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-3 text-ink-muted" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, content, or author" className="pl-9" /></label>
      <HiusaSelect filter aria-label="Category" className="sm:w-48" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>{CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</HiusaSelect>
      <HiusaSelect filter aria-label="Publication state" className="sm:w-48" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="all">All states</option><option value="published">Published</option><option value="draft">Not published</option></HiusaSelect>
      {hasFilters && items.length > 0 && <button type="button" onClick={clearAnnouncementFilters} className="inline-flex min-h-10 items-center rounded-control text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">Clear</button>}
    </div>
  );

  if (error) {
    return (
      <div className="space-y-5">
        {header}
        <ErrorState title="Could not load announcements" description={error} onRetry={loadAnnouncements} />
      </div>
    );
  }

  const columns = [
    {
      key: 'title',
      header: 'Title',
      render: (a) => (
        <div className="min-w-0">
          <button type="button" onClick={() => setDetails(a)} className="min-h-10 text-left font-medium text-ink hover:text-brand-700">{formatDisplayText(a.title)}</button>
          {(announcementStage(a).key !== 'published' || announcementVisibility(a)) && <div className="mt-0.5"><AnnouncementStageChip announcement={a} /></div>}
        </div>
      ),
    },
    { key: 'audience', header: 'Audience', render: (a) => ROLE_LABEL[a.target_role] || a.target_role },
    { key: 'date', header: 'Date', render: (a) => new Date(a.published_at || a.created_at).toLocaleDateString('en-PH', { dateStyle: 'medium' }) },
  ];

  const emptyState = hasFilters
    ? <EmptyState kind="filtered" title="No announcements match these filters" onClearFilters={clearAnnouncementFilters} />
    : (
      <EmptyState
        icon={Megaphone}
        title="No announcements yet"
        description={currentRole === 'SBO_OFFICER' ? 'Write your first announcement. It goes to the Admin for approval before it is published.' : 'Write your first announcement to tell members what is happening.'}
        action={<Button variant="secondary" to={CREATE_PATH} leftIcon={Plus}>New announcement</Button>}
      />
    );

  return (
    <div className="space-y-5">
      {header}
      {actionError && !confirmState.open && !editing && <p role="alert" className="text-sm font-medium text-danger-strong">{actionError}</p>}
      {actionMessage && <p role="status" className="text-sm font-medium text-success-strong">{actionMessage}</p>}
      <DataTable
        caption={`${meta.total} ${meta.total === 1 ? 'announcement' : 'announcements'}`}
        captionVisible
        stickyHeader={false}
        loading={loading}
        filters={filters}
        columns={columns}
        rows={items}
        emptyState={emptyState}
        actions={(a) => {
          const modify = canModify(a);
          const publish = modify && currentRole === 'ADMIN';
          const available = [
            modify && { label: 'Edit announcement', icon: Pencil, onClick: () => openEdit(a) },
            publish && { label: a.is_published ? 'Unpublish announcement' : a.approval_status === 'pending' ? 'Approve and publish' : 'Publish announcement', icon: Send, onClick: () => askPublish(a) },
            modify && { label: 'Delete announcement', icon: Trash2, danger: true, onClick: () => setConfirmState({ open: true, title: 'Delete announcement', message: `Delete ${a.title}?`, confirmText: 'Delete', action: async () => handleDelete(a.id), busy: false }) },
          ].filter(Boolean);
          return available.length ? <TableRowActions subject={a.title} label="Announcement actions" actions={available} /> : null;
        }}
        pagination={<PaginationControls currentPage={meta.currentPage} totalItems={meta.total} pageSize={meta.perPage} onPageChange={setPage} label="announcements" />}
      />

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

      <Drawer
        open={Boolean(editing)}
        title="Edit announcement"
        width="max-w-xl"
        onClose={() => setEditing(null)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="submit" form="edit-announcement-form" disabled={!editForm.title.trim() || !editForm.body.trim()}>Save changes</Button>
          </>
        )}
      >
        <form id="edit-announcement-form" onSubmit={handleEdit} className="grid gap-4">
          <Field label="Title" required>
            <Input value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} />
          </Field>
          <Field label="Audience">
            <HiusaSelect value={editForm.target_role} onChange={(e) => setEditForm({ ...editForm, target_role: e.target.value })}>
              {Object.entries(ROLE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </HiusaSelect>
          </Field>
          <Field label="Category">
            <HiusaSelect value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}>
              {CATEGORY_OPTIONS.filter((opt) => opt.value !== 'all').map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </HiusaSelect>
          </Field>
          <RichTextEditor ariaLabel="Announcement content" value={editForm.body} onChange={(body) => setEditForm({ ...editForm, body })} rows={8} placeholder="Announcement content" />
          {actionError && <p role="alert" className="text-sm font-medium text-danger-strong">{actionError}</p>}
        </form>
      </Drawer>

      <Drawer
        open={Boolean(details)}
        title={details ? formatDisplayText(details.title) : undefined}
        description={details ? `Announcement #${details.id}` : undefined}
        width="max-w-xl"
        onClose={() => setDetails(null)}
      >
        {details && (
          <div className="space-y-5">
            <NextStep {...nextStepFor(details, canModify(details))} />
            <dl className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2">{[
              ['Audience', ROLE_LABEL[details.target_role] || details.target_role], ['Category', CATEGORY_LABEL[details.category] || details.category], ['Stage', announcementStage(details).label], ['Publication', details.is_published ? 'Published' : 'Draft'],
              ['Unique views', details.views_count || 0], ['Created', formatDateTime(details.created_at)], ['Updated', formatDateTime(details.updated_at)], ['Published', formatDateTime(details.published_at)],
            ].map(([label, value]) => <div key={label}><dt className="text-xs text-ink-muted">{label}</dt><dd className="mt-0.5 break-words font-medium text-ink">{value ?? '-'}</dd></div>)}</dl>
            <div className="border-t border-line pt-4">
              <p className="text-xs text-ink-muted">Author</p>
              <p className="mt-1 text-sm font-medium text-ink">{creatorName(details)}</p>
              <p className="mt-1 text-xs text-ink-muted">{[details.creator?.school_id, details.creator?.email, details.creator?.role, details.creator?.position_title, details.creator?.department, details.creator?.program, details.creator?.year_level, details.creator?.section].filter(Boolean).join(' · ') || '-'}</p>
            </div>
            <div className="border-t border-line pt-4">
              <p className="text-xs text-ink-muted">Review trail</p>
              <p className="mt-1 text-sm font-medium text-ink">{details.reviewer ? `${formatDisplayText(details.reviewer.first_name)} ${formatDisplayText(details.reviewer.last_name)}` : 'Not reviewed'}</p>
              <p className="mt-1 whitespace-pre-wrap text-xs text-ink-muted">{details.review_remarks || 'No review remarks.'}</p>
            </div>
            <div className="border-t border-line pt-4">
              <p className="text-xs text-ink-muted">Full announcement</p>
              <RichTextBody value={details.body} className="mt-2 text-sm leading-6 text-ink" />
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
