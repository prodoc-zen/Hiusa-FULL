import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { ANNOUNCEMENTS_DATA, Badge, SectionHeader, StatusBadge } from './announcementShared.jsx';

export default function ManageAnnouncementsPage() {
  const [items, setItems] = useState(ANNOUNCEMENTS_DATA);

  return (
    <div className="rounded-xl border border-blue-100 bg-white p-5 shadow-sm">
      <SectionHeader title="All Announcements" />
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-blue-100">
              {['Title', 'Audience', 'Category', 'Status', 'Date', 'Views', 'Actions'].map((header) => (
                <th key={header} className="px-3 py-2.5 text-left font-semibold text-slate-500">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((announcement) => (
              <tr key={announcement.id} className="border-b border-blue-50 transition-colors hover:bg-blue-50/40">
                <td className="max-w-xs truncate px-3 py-3 font-semibold text-slate-800">{announcement.title}</td>
                <td className="px-3 py-3 text-slate-500">{announcement.audience}</td>
                <td className="px-3 py-3">
                  <Badge color="blue">{announcement.category}</Badge>
                </td>
                <td className="px-3 py-3">
                  <StatusBadge status={announcement.status} />
                </td>
                <td className="px-3 py-3 text-slate-500">{announcement.date}</td>
                <td className="px-3 py-3 text-slate-600">{announcement.views > 0 ? announcement.views : '-'} </td>
                <td className="px-3 py-3">
                  <div className="flex gap-1.5">
                    {announcement.status === 'Draft' && (
                      <button
                        onClick={() =>
                          setItems((previous) =>
                            previous.map((entry) =>
                              entry.id === announcement.id ? { ...entry, status: 'Published' } : entry
                            )
                          )
                        }
                        className="rounded bg-green-100 px-2 py-1 text-[10px] font-semibold text-green-700 transition hover:bg-green-200"
                      >
                        Publish
                      </button>
                    )}
                    {announcement.status === 'Published' && (
                      <button
                        onClick={() =>
                          setItems((previous) =>
                            previous.map((entry) =>
                              entry.id === announcement.id ? { ...entry, status: 'Draft' } : entry
                            )
                          )
                        }
                        className="rounded bg-yellow-100 px-2 py-1 text-[10px] font-semibold text-yellow-700 transition hover:bg-yellow-200"
                      >
                        Unpublish
                      </button>
                    )}
                    <button
                      onClick={() => setItems((previous) => previous.filter((entry) => entry.id !== announcement.id))}
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
    </div>
  );
}
