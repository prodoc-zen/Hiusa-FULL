import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Badge, SectionHeader, StatusBadge } from './announcementShared.jsx';
import {
  getAnnouncements,
  togglePublish,
  deleteAnnouncement,
} from '../../../services/announcementService';

const ROLE_LABEL = { all: 'All Members', student: 'Students', officer: 'Officers', adviser: 'Advisers' };
const CATEGORY_LABEL = { general: 'General', election: 'Election', training: 'Training', events: 'Events', merchandise: 'Merchandise' };
const CATEGORY_OPTIONS = [
  { label: 'All Categories', value: 'all' },
  { label: 'General', value: 'general' },
  { label: 'Election', value: 'election' },
  { label: 'Training', value: 'training' },
  { label: 'Events', value: 'events' },
  { label: 'Merchandise', value: 'merchandise' },
];

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

export default function ManageAnnouncementsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [confirmState, setConfirmState] = useState({ open: false, title: '', message: '', confirmText: 'Confirm', action: null, busy: false });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = categoryFilter === 'all' ? undefined : { category: categoryFilter };
    getAnnouncements(params)
      .then((res) => { if (!cancelled) setItems(Array.isArray(res.data) ? res.data : []); })
      .catch(() => { if (!cancelled) setError('Failed to load announcements.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [categoryFilter]);

  async function handleToggle(id) {
    try {
      const res = await togglePublish(id);
      setItems((prev) => prev.map((a) => (a.id === id ? res.data : a)));
    } catch {
      alert('Failed to update announcement. Please try again.');
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
        <button onClick={load} className="mt-2 text-sm font-bold text-red-600 underline">Try again</button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
      <SectionHeader title="All Announcements" />
      <div className="mb-4 flex items-center gap-2">
        <label className="text-xs font-semibold text-slate-500">Category:</label>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-xs font-semibold text-slate-600 outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15">
          {CATEGORY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
      {items.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">No announcements yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-xs">
            <thead>
              <tr className="border-b border-[#DDE7EF]">
                {['Title', 'Audience', 'Category', 'Status', 'Date', 'Actions'].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-left font-semibold text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id} className="border-b border-[#EEF6FB] transition-colors hover:bg-[#F8FBFD]">
                  <td className="max-w-xs truncate px-3 py-3 font-semibold text-[#0F172A]">{a.title}</td>
                  <td className="px-3 py-3 text-slate-500">{ROLE_LABEL[a.target_role] ?? a.target_role}</td>
                  <td className="px-3 py-3">
                    <Badge color="blue">{CATEGORY_LABEL[a.category] ?? 'General'}</Badge>
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge status={a.is_published ? 'Published' : 'Draft'} />
                  </td>
                  <td className="px-3 py-3 text-slate-500">{formatDate(a.created_at)}</td>
                  <td className="px-3 py-3">
                    <div className="flex gap-1.5">
                      {!a.is_published ? (
                        <button
                          onClick={() => setConfirmState({
                            open: true,
                            title: 'Publish Announcement',
                            message: `Publish \"${a.title}\" now?`,
                            confirmText: 'Publish',
                            action: async () => handleToggle(a.id),
                            busy: false,
                          })}
                          className="rounded bg-emerald-100 px-2 py-2 text-[10px] font-semibold text-emerald-700 transition hover:bg-emerald-200"
                        >
                          Publish
                        </button>
                      ) : (
                        <button
                          onClick={() => setConfirmState({
                            open: true,
                            title: 'Unpublish Announcement',
                            message: `Set \"${a.title}\" back to draft?`,
                            confirmText: 'Unpublish',
                            action: async () => handleToggle(a.id),
                            busy: false,
                          })}
                          className="rounded bg-amber-100 px-2 py-2 text-[10px] font-semibold text-amber-700 transition hover:bg-amber-200"
                        >
                          Unpublish
                        </button>
                      )}
                      <button
                        onClick={() => setConfirmState({
                          open: true,
                          title: 'Delete Announcement',
                          message: `Delete \"${a.title}\"? This cannot be undone.`,
                          confirmText: 'Delete',
                          action: async () => handleDelete(a.id),
                          busy: false,
                        })}
                        className="rounded-md p-2 text-red-500 transition hover:bg-red-50"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
    </div>
  );
}
