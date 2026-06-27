import { useState } from 'react';
import { AlignLeft, Bold, CheckCircle, Italic, Link, List, Send } from 'lucide-react';
import { SectionHeader } from './announcementShared.jsx';

export default function CreateAnnouncementPage() {
  const [title, setTitle] = useState('');
  const [audience, setAudience] = useState('All Members');
  const [category, setCategory] = useState('General');
  const [body, setBody] = useState('');
  const [posted, setPosted] = useState(false);

  if (posted) {
    return (
      <div className="max-w-md rounded-xl border border-green-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <CheckCircle size={32} className="text-green-500" />
        </div>
        <h2 className="mb-2 text-lg font-extrabold text-slate-800">Announcement Published!</h2>
        <p className="mb-6 text-sm text-slate-500">
          Sent to <strong>{audience}</strong>.
        </p>
        <button
          onClick={() => {
            setTitle('');
            setBody('');
            setPosted(false);
          }}
          className="rounded-lg bg-[#2563EB] px-6 py-2.5 text-sm font-bold text-white transition hover:bg-[#1D4ED8]"
        >
          Create Another
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl rounded-xl border border-blue-100 bg-white p-6 shadow-sm">
      <SectionHeader title="Create Announcement" />
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-slate-700">Title *</label>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. General Assembly - Second Semester"
            className="w-full rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5 text-sm text-slate-800 transition focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700">Audience</label>
            <select
              value={audience}
              onChange={(event) => setAudience(event.target.value)}
              className="w-full rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5 text-sm text-slate-700 transition focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option>All Members</option>
              <option>Officers Only</option>
              <option>Students Only</option>
              <option>Advisers Only</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700">Category</label>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="w-full rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5 text-sm text-slate-700 transition focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option>General</option>
              <option>Elections</option>
              <option>Events</option>
              <option>Finance</option>
              <option>Training</option>
              <option>Merchandise</option>
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold text-slate-700">Content *</label>
          <div className="overflow-hidden rounded-lg border border-blue-100">
            <div className="flex gap-1 border-b border-blue-100 bg-blue-50 px-3 py-2">
              {[
                { icon: Bold, label: 'Bold' },
                { icon: Italic, label: 'Italic' },
                { icon: List, label: 'List' },
                { icon: AlignLeft, label: 'Align' },
                { icon: Link, label: 'Link' },
              ].map(({ icon: Icon, label }) => (
                <button key={label} title={label} className="rounded p-1.5 text-slate-600 transition hover:bg-blue-200">
                  <Icon size={13} />
                </button>
              ))}
            </div>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={8}
              placeholder="Write your announcement content here..."
              className="w-full resize-none bg-white p-4 text-sm text-slate-700 focus:outline-none"
            />
          </div>
        </div>

        {(!title || !body) && <p className="text-xs text-red-500">Please fill in the title and content before publishing.</p>}

        <div className="flex gap-3">
          <button
            onClick={() => {
              if (!title || !body) return;
              setPosted(true);
            }}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#2563EB] py-2.5 text-sm font-bold text-white transition hover:bg-[#1D4ED8]"
          >
            <Send size={15} />
            Publish Now
          </button>
          <button className="rounded-lg border border-blue-200 bg-blue-50 px-5 py-2.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-100">
            Save Draft
          </button>
        </div>
      </div>
    </div>
  );
}
