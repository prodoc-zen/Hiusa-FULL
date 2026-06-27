import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Badge, SectionHeader, StatusBadge } from './announcementShared.jsx';
import {
  getAnnouncements,
  togglePublish,
  deleteAnnouncement,
} from '../../../services/announcementService';

const ROLE_LABEL = { all: 'All Members', student: 'Students', officer: 'Officers', adviser: 'Advisers' };

function formatDate(iso) {
  return iso ? new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '-';
}

export default function ManageAnnouncementsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  function load() {
    setLoading(true);
    setError(null);
    getAnnouncements()
      .then((res) => setItems(Array.isArray(res.data) ? res.data : []))
      .catch(() => setError('Failed to load announcements.'))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleToggle(id) {
    try {
      const res = await togglePublish(id);
      setItems((prev) => prev.map((a) => (a.id === id ? res.data : a)));
    } catch {
      alert('Failed to update announcement. Please try again.');
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this announcement?')) return;
    try {
      await deleteAnnouncement(id);
      setItems((prev) => prev.filter((a) => a.id !== id));
    } catch {
      alert('Failed to delete announcement. Please try again.');
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
      {items.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">No announcements yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-xs">
            <thead>
              <tr className="border-b border-[#DDE7EF]">
                {['Title', 'Audience', 'Status', 'Date', 'Actions'].map((h) => (
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
                    <StatusBadge status={a.is_published ? 'Published' : 'Draft'} />
                  </td>
                  <td className="px-3 py-3 text-slate-500">{formatDate(a.created_at)}</td>
                  <td className="px-3 py-3">
                    <div className="flex gap-1.5">
                      {!a.is_published ? (
                        <button
                          onClick={() => handleToggle(a.id)}
                          className="rounded bg-emerald-100 px-2 py-1 text-[10px] font-semibold text-emerald-700 transition hover:bg-emerald-200"
                        >
                          Publish
                        </button>
                      ) : (
                        <button
                          onClick={() => handleToggle(a.id)}
                          className="rounded bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-700 transition hover:bg-amber-200"
                        >
                          Unpublish
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(a.id)}
                        className="rounded-md p-1.5 text-red-500 transition hover:bg-red-50"
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
    </div>
  );
}
