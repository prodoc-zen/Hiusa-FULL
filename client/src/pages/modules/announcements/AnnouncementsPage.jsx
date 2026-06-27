import { useState } from 'react';
import {
  Bell,
  Calendar,
  Edit3,
  Eye,
  FileText,
  Filter,
  Globe,
  Pin,
  Plus,
  Search,
  Send,
  Trash2,
  Users,
  X,
} from 'lucide-react';

const stats = [
  { label: 'Total Posts', value: '48', helper: 'All time', icon: FileText },
  { label: 'Published', value: '36', helper: 'Currently visible', icon: Globe },
  { label: 'Drafts', value: '7', helper: 'Unpublished', icon: Edit3 },
  { label: 'Scheduled', value: '5', helper: 'Upcoming releases', icon: Calendar },
];

const announcements = [
  { title: 'SSC Elections 2026 — Voting Now Open!', date: '2026-06-22', audience: 'All Students', status: 'Published', pinned: true },
  { title: 'Annual General Assembly — Save the Date', date: '2026-06-21', audience: 'All Students', status: 'Published', pinned: false },
  { title: 'Merchandise Pre-Order Now Available', date: '2026-06-20', audience: 'All Students', status: 'Published', pinned: false },
  { title: 'Leadership Summit Registration', date: '2026-06-25', audience: '3rd Year, 4th Year', status: 'Scheduled', pinned: false },
  { title: 'Financial Report — 1st Semester', date: '', audience: 'Officers Only', status: 'Draft', pinned: false },
  { title: 'Freshmen Welcome Package Info', date: '2026-06-18', audience: '1st Year', status: 'Published', pinned: false },
];

const statusBadge = {
  Published: 'bg-emerald-50 text-emerald-700',
  Draft: 'bg-amber-50 text-amber-700',
  Scheduled: 'bg-[#E6F6FD] text-[#0B8ED0]',
};

const audienceOptions = [
  'All Students',
  '1st Year',
  '2nd Year',
  '3rd Year',
  '4th Year',
  'Officers Only',
];

export default function AnnouncementsPage() {
  const [activeTab, setActiveTab] = useState('feed');
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-6">
      {/* Stats */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
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

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {['feed', 'create', 'audience'].map((tab) => (
          <button
            key={tab}
            onClick={() => tab === 'create' ? setShowForm(true) : setActiveTab(tab)}
            className={`rounded-lg px-4 py-2.5 text-[13px] font-bold capitalize transition-all ${
              activeTab === tab && tab !== 'create'
                ? 'bg-[#0B8ED0] text-white shadow-lg shadow-[#0B8ED0]/20'
                : 'bg-white text-slate-600 border border-[#DDE7EF] hover:bg-[#EEF6FB]'
            }`}
          >
            {tab === 'feed' ? 'Manage Feed' : tab === 'create' ? '+ Post Update' : 'Target Audience'}
          </button>
        ))}
      </div>

      {/* Feed */}
      {activeTab === 'feed' && (
        <section className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-[#DDE7EF] p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-[#0F172A]">Announcement Feed</h2>
              <p className="text-sm font-medium text-slate-500">Manage all posts, drafts, and scheduled announcements</p>
            </div>
            <div className="flex gap-2">
              <div className="flex h-10 items-center gap-2 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-3">
                <Search size={15} className="text-slate-400" />
                <input type="text" placeholder="Search posts..." className="w-[140px] bg-transparent text-[13px] outline-none placeholder:text-slate-400" />
              </div>
              <button type="button" className="grid h-10 w-10 place-items-center rounded-lg border border-[#DDE7EF] text-slate-500 hover:bg-[#EEF6FB]"><Filter size={16} /></button>
              <button onClick={() => setShowForm(true)} className="flex h-10 items-center gap-2 rounded-lg bg-[#0B8ED0] px-4 text-[13px] font-bold text-white hover:bg-[#0878B7] transition">
                <Plus size={16} />
                <span className="hidden sm:inline">New Post</span>
              </button>
            </div>
          </div>

          <div className="divide-y divide-[#E5EDF3]">
            {announcements.map((post) => (
              <div key={post.title} className="flex flex-col gap-3 p-5 transition hover:bg-[#F8FBFD] sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  {post.pinned && <Pin size={14} className="mt-1 shrink-0 text-[#0B8ED0]" />}
                  <div className="min-w-0">
                    <p className="font-bold text-[#0F172A]">{post.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-medium text-slate-400">
                      {post.date && <span>{post.date}</span>}
                      <span className="rounded-full bg-[#F8FBFD] border border-[#DDE7EF] px-2 py-0.5 text-[11px] font-bold text-slate-500">
                        <Users size={10} className="inline mr-1" />
                        {post.audience}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusBadge[post.status]}`}>{post.status}</span>
                  <button className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-[#EEF6FB] hover:text-[#0B8ED0]"><Eye size={15} /></button>
                  <button className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-[#EEF6FB] hover:text-[#0B8ED0]"><Edit3 size={15} /></button>
                  <button className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-500"><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Target audience */}
      {activeTab === 'audience' && (
        <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
          <div className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-[#0F172A] mb-4">Audience Segments</h2>
            <div className="space-y-3">
              {audienceOptions.map((aud) => {
                const count = announcements.filter(a => a.audience.includes(aud) || a.audience === 'All Students').length;
                return (
                  <div key={aud} className="flex items-center justify-between rounded-lg bg-[#F8FBFD] p-4">
                    <div className="flex items-center gap-3">
                      <Users size={16} className="text-[#0B8ED0]" />
                      <span className="text-sm font-bold text-[#0F172A]">{aud}</span>
                    </div>
                    <span className="text-sm font-bold text-[#0B8ED0]">{count} posts</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-[#0F172A] mb-4">Notification Scheduling</h2>
            <div className="space-y-3">
              {announcements.filter(a => a.status === 'Scheduled').map((post) => (
                <div key={post.title} className="rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Bell size={14} className="text-[#0B8ED0]" />
                    <span className="text-[11px] font-bold text-[#0B8ED0]">Scheduled for {post.date}</span>
                  </div>
                  <p className="text-sm font-bold text-[#0F172A]">{post.title}</p>
                  <p className="text-xs font-medium text-slate-400 mt-1">Audience: {post.audience}</p>
                </div>
              ))}
              {announcements.filter(a => a.status === 'Scheduled').length === 0 && (
                <p className="text-sm font-medium text-slate-400 text-center py-6">No scheduled announcements</p>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Create Post Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#0F172A]">Post Announcement</h2>
              <button onClick={() => setShowForm(false)} className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-[#EEF6FB]"><X size={18} /></button>
            </div>
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setShowForm(false); }}>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Title</label>
                <input type="text" placeholder="Announcement title" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Content</label>
                <textarea rows={5} placeholder="Write your announcement..." className="w-full rounded-lg border border-[#DDE7EF] px-3 py-2.5 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 resize-none" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Target Audience</label>
                <div className="flex flex-wrap gap-2">
                  {audienceOptions.map((opt) => (
                    <label key={opt} className="flex items-center gap-2 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-3 py-2 cursor-pointer hover:border-[#0B8ED0]/30 transition">
                      <input type="checkbox" defaultChecked={opt === 'All Students'} className="rounded border-slate-300 text-[#0B8ED0]" />
                      <span className="text-xs font-bold text-slate-600">{opt}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Schedule Date (optional)</label>
                  <input type="date" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Publish As</label>
                  <select className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]">
                    <option>Publish Now</option>
                    <option>Save as Draft</option>
                    <option>Schedule</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD]">Cancel</button>
                <button type="submit" className="flex h-11 items-center gap-2 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7] transition">
                  <Send size={15} />
                  Post
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
