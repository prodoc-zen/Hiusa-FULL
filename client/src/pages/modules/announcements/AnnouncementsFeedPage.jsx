import { useState } from 'react';
import { Eye, Search } from 'lucide-react';
import { ANNOUNCEMENTS_DATA, Avatar, Badge, cn } from './announcementShared.jsx';

export default function AnnouncementsFeedPage() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [expandedId, setExpandedId] = useState(null);

  const filtered = ANNOUNCEMENTS_DATA.filter(
    (announcement) =>
      announcement.status === 'Published' &&
      (category === 'All' || announcement.category === category) &&
      announcement.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="max-w-2xl space-y-4">
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search announcements..."
          className="w-full rounded-xl border border-blue-100 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-700 shadow-sm transition focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {['All', 'General', 'Elections', 'Events', 'Finance', 'Merchandise', 'Training'].map((entry) => (
          <button
            key={entry}
            onClick={() => setCategory(entry)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-semibold shadow-sm transition',
              category === entry
                ? 'border-transparent bg-[#1E3A8A] text-white'
                : 'border-blue-100 bg-white text-slate-600 hover:bg-blue-50'
            )}
          >
            {entry}
          </button>
        ))}
      </div>

      {filtered.map((announcement) => (
        <div
          key={announcement.id}
          className="cursor-pointer rounded-xl border border-blue-100 bg-white p-5 shadow-sm transition-colors hover:border-blue-300"
          onClick={() => setExpandedId(expandedId === announcement.id ? null : announcement.id)}
        >
          <div className="mb-2 flex items-start justify-between gap-3">
            <h3 className="text-sm font-bold leading-tight text-slate-800" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              {announcement.title}
            </h3>
            <Badge color="blue">{announcement.category}</Badge>
          </div>
          <p className="text-xs leading-relaxed text-slate-500">
            {expandedId === announcement.id ? announcement.body : `${announcement.body.slice(0, 100)}...`}
          </p>
          <div className="mt-3 flex items-center justify-between border-t border-blue-50 pt-3">
            <div className="flex items-center gap-2">
              <Avatar name="HIUSA Admin" size="sm" color="bg-blue-600" />
              <div>
                <p className="text-[10px] font-semibold text-slate-700">HIUSA Executive Board</p>
                <p className="text-[10px] text-slate-400">{announcement.date}</p>
              </div>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-slate-400">
              <Eye size={11} />
              {announcement.views} views
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
