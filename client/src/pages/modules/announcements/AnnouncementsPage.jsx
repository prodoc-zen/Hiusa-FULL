import { useEffect, useState } from 'react';
import {
  Edit3,
  Eye,
  FileText,
  Globe,
  Plus,
  Search,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import PaginationControls from '../../../components/PaginationControls';
import {
  getAnnouncements,
  createAnnouncement,
  togglePublish,
  deleteAnnouncement,
} from '../../../services/announcementService';

const ROLE_LABEL = { all: 'All Members', student: 'Students', officer: 'Officers', adviser: 'Advisers' };
const AUDIENCE_OPTIONS = [
  { label: 'All Members', value: 'all' },
  { label: 'Officers Only', value: 'officer' },
  { label: 'Students Only', value: 'student' },
  { label: 'Advisers Only', value: 'adviser' },
];

const statusBadge = {
  Published: 'bg-emerald-50 text-emerald-700',
  Draft: 'bg-amber-50 text-amber-700',
};

function formatDate(iso) {
  return iso ? new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '-';
}

export default function AnnouncementsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('feed');
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [formTitle, setFormTitle] = useState('');
  const [formBody, setFormBody] = useState('');
  const [formRole, setFormRole] = useState('all');
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

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

  async function handleCreate(e) {
    e.preventDefault();
    if (!formTitle.trim() || !formBody.trim()) return;
    setFormSubmitting(true);
    setFormError(null);
    try {
      await createAnnouncement({ title: formTitle, body: formBody, target_role: formRole, is_published: false });
      setShowForm(false);
      setFormTitle('');
      setFormBody('');
      setFormRole('all');
      load();
    } catch (err) {
      setFormError(err.response?.data?.message ?? 'Failed to post. Try again.');
    } finally {
      setFormSubmitting(false);
    }
  }

  async function handleToggle(id) {
    try {
      const res = await togglePublish(id);
      setItems((prev) => prev.map((a) => (a.id === id ? res.data : a)));
    } catch {
      alert('Failed to update. Try again.');
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this announcement?')) return;
    try {
      await deleteAnnouncement(id);
      setItems((prev) => prev.filter((a) => a.id !== id));
    } catch {
      alert('Failed to delete. Try again.');
    }
  }

  const published = items.filter((a) => a.is_published).length;
  const drafts = items.filter((a) => !a.is_published).length;

  const filtered = items.filter((a) =>
    a.title.toLowerCase().includes(search.toLowerCase())
  );

  const pagedAnnouncements = filtered.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    setPage(1);
  }, [search, items.length]);

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-center">
          <p className="text-sm font-semibold text-red-700">{error}</p>
          <button onClick={load} className="mt-2 text-sm font-bold text-red-600 underline">Try again</button>
        </div>
      )}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Total Posts', value: items.length, helper: 'All time', icon: FileText },
          { label: 'Published', value: published, helper: 'Currently visible', icon: Globe },
          { label: 'Drafts', value: drafts, helper: 'Unpublished', icon: Edit3 },
        ].map((stat) => (
          <article key={stat.label} className="group rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm transition hover:shadow-md hover:border-[#0B8ED0]/20">
            <div className="mb-3 grid h-10 w-10 place-items-center rounded-lg bg-sky-50 text-sky-600 group-hover:bg-sky-600 group-hover:text-white transition">
              <stat.icon size={19} />
            </div>
            <p className="text-sm font-semibold text-slate-500">{stat.label}</p>
            <p className="mt-1 text-2xl font-black text-[#0F172A]">{stat.value}</p>
            <p className="mt-1 text-xs font-medium text-slate-400">{stat.helper}</p>
          </article>
        ))}
      </section>

      <div className="flex flex-wrap gap-2">
        {['feed'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`rounded-lg px-4 py-2.5 text-[13px] font-bold capitalize transition-all ${
              activeTab === tab
                ? 'bg-[#0B8ED0] text-white shadow-lg shadow-[#0B8ED0]/20'
                : 'bg-white text-slate-600 border border-[#DDE7EF] hover:bg-[#EEF6FB]'
            }`}
          >
            Manage Feed
          </button>
        ))}
        <button
          onClick={() => setShowForm(true)}
          className="rounded-lg border border-[#DDE7EF] bg-white px-4 py-2.5 text-[13px] font-bold text-slate-600 transition hover:bg-[#EEF6FB]"
        >
          + Post Update
        </button>
      </div>

      {activeTab === 'feed' && (
        <section className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-[#DDE7EF] p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-[#0F172A]">Announcement Feed</h2>
              <p className="text-sm font-medium text-slate-500">Manage all posts and drafts</p>
            </div>
            <div className="flex w-full gap-2 sm:w-auto">
              <div className="flex h-10 flex-1 items-center gap-2 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-3 sm:flex-none">
                <Search size={15} className="text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  type="text"
                  placeholder="Search posts..."
                  className="w-full bg-transparent text-[13px] outline-none placeholder:text-slate-400 sm:w-[140px]"
                />
              </div>
              <button onClick={() => setShowForm(true)} className="flex h-10 items-center gap-2 rounded-lg bg-[#0B8ED0] px-4 text-[13px] font-bold text-white hover:bg-[#0878B7] transition">
                <Plus size={16} />
                <span className="hidden sm:inline">New Post</span>
              </button>
            </div>
          </div>

          {loading ? (
            <div className="space-y-2 p-5">
              {[1, 2, 3].map((i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100" />)}
            </div>
          ) : filtered.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-400">No announcements yet.</p>
          ) : (
            <div className="divide-y divide-[#E5EDF3]">
              {pagedAnnouncements.map((a) => (
                <div key={a.id} className="flex flex-col gap-3 p-5 transition hover:bg-[#F8FBFD] sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-[#0F172A]">{a.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-medium text-slate-400">
                      <span>{formatDate(a.created_at)}</span>
                      <span className="rounded-full border border-[#DDE7EF] bg-[#F8FBFD] px-2 py-0.5 text-[11px] font-bold text-slate-500">
                        {ROLE_LABEL[a.target_role] ?? a.target_role}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusBadge[a.is_published ? 'Published' : 'Draft']}`}>
                      {a.is_published ? 'Published' : 'Draft'}
                    </span>
                    <button onClick={() => handleToggle(a.id)} className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-[#EEF6FB] hover:text-[#0B8ED0]">
                      <Eye size={15} />
                    </button>
                    <button onClick={() => handleDelete(a.id)} className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-500">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <PaginationControls
            currentPage={page}
            totalItems={filtered.length}
            pageSize={pageSize}
            onPageChange={setPage}
            label="announcements"
          />
        </section>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#0F172A]">Post Announcement</h2>
              <button onClick={() => setShowForm(false)} className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-[#EEF6FB]"><X size={18} /></button>
            </div>
            <form className="space-y-4" onSubmit={handleCreate}>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Title</label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="Announcement title"
                  className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Content</label>
                <textarea
                  rows={5}
                  value={formBody}
                  onChange={(e) => setFormBody(e.target.value)}
                  placeholder="Write your announcement..."
                  className="w-full rounded-lg border border-[#DDE7EF] px-3 py-2.5 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 resize-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Target Audience</label>
                <select
                  value={formRole}
                  onChange={(e) => setFormRole(e.target.value)}
                  className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                >
                  {AUDIENCE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              {formError && <p className="text-xs text-red-600">{formError}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD]">Cancel</button>
                <button
                  type="submit"
                  disabled={formSubmitting || !formTitle.trim() || !formBody.trim()}
                  className="flex h-11 items-center gap-2 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7] transition disabled:opacity-50"
                >
                  <Send size={15} />
                  {formSubmitting ? 'Posting...' : 'Post as Draft'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
