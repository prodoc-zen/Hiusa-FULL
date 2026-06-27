import { useState } from 'react';
import { AlignLeft, Bold, CheckCircle, Italic, Link, List, Send } from 'lucide-react';
import { SectionHeader } from './announcementShared.jsx';
import { createAnnouncement } from '../../../services/announcementService';
import { useNavigate } from 'react-router-dom';

const AUDIENCE_OPTIONS = [
  { label: 'All Members', value: 'all' },
  { label: 'Officers Only', value: 'officer' },
  { label: 'Students Only', value: 'student' },
  { label: 'Advisers Only', value: 'adviser' },
];

export default function CreateAnnouncementPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [targetRole, setTargetRole] = useState('all');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [posted, setPosted] = useState(false);

  async function handleSubmit(isPublished) {
    if (!title.trim() || !body.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createAnnouncement({ title, body, target_role: targetRole, is_published: isPublished });
      setPosted(true);
    } catch (err) {
      setError(err.response?.data?.message ?? 'Failed to post announcement. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (posted) {
    return (
      <div className="max-w-md rounded-xl border border-[#DDE7EF] bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
          <CheckCircle size={32} className="text-emerald-500" />
        </div>
        <h2 className="mb-2 text-lg font-extrabold text-[#0F172A]">Announcement Posted!</h2>
        <p className="mb-6 text-sm text-slate-500">
          Sent to <strong>{AUDIENCE_OPTIONS.find((o) => o.value === targetRole)?.label}</strong>.
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={() => { setTitle(''); setBody(''); setTargetRole('all'); setPosted(false); }}
            className="rounded-lg bg-[#0B8ED0] px-6 py-2.5 text-sm font-bold text-white transition hover:bg-[#0878B7]"
          >
            Create Another
          </button>
          <button
            onClick={() => navigate(-1)}
            className="rounded-lg border border-[#DDE7EF] px-6 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-[#F8FBFD]"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl rounded-xl border border-[#DDE7EF] bg-white p-6 shadow-sm">
      <SectionHeader title="Create Announcement" />
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-[13px] font-semibold text-[#0F172A]">Title *</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. General Assembly - Second Semester"
            className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm text-[#0F172A] outline-none transition focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[13px] font-semibold text-[#0F172A]">Audience</label>
          <select
            value={targetRole}
            onChange={(e) => setTargetRole(e.target.value)}
            className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm text-slate-700 outline-none transition focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
          >
            {AUDIENCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-[13px] font-semibold text-[#0F172A]">Content *</label>
          <div className="overflow-hidden rounded-lg border border-[#DDE7EF]">
            <div className="flex gap-1 border-b border-[#DDE7EF] bg-[#F8FBFD] px-3 py-2">
              {[Bold, Italic, List, AlignLeft, Link].map((Icon, i) => (
                <button key={i} type="button" className="rounded p-1.5 text-slate-500 transition hover:bg-[#EEF6FB]">
                  <Icon size={13} />
                </button>
              ))}
            </div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              placeholder="Write your announcement content here..."
              className="w-full resize-none bg-white p-4 text-sm text-slate-700 outline-none"
            />
          </div>
        </div>

        {(!title.trim() || !body.trim()) && (
          <p className="text-xs text-red-500">Please fill in the title and content before posting.</p>
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex gap-3">
          <button
            type="button"
            disabled={submitting || !title.trim() || !body.trim()}
            onClick={() => handleSubmit(true)}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#0B8ED0] py-2.5 text-sm font-bold text-white transition hover:bg-[#0878B7] disabled:opacity-50"
          >
            <Send size={15} />
            {submitting ? 'Posting...' : 'Publish Now'}
          </button>
          <button
            type="button"
            disabled={submitting || !title.trim() || !body.trim()}
            onClick={() => handleSubmit(false)}
            className="rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-5 py-2.5 text-sm font-semibold text-[#0B8ED0] transition hover:bg-[#EEF6FB] disabled:opacity-50"
          >
            Save Draft
          </button>
        </div>
      </div>
    </div>
  );
}
