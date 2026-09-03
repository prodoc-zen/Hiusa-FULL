import { useState } from 'react';
import { Bot, CheckCircle, ImagePlus, Megaphone, Send } from 'lucide-react';
import { createAnnouncement, generateAnnouncementDraft } from '../../../services/announcementService';
import { useNavigate } from 'react-router-dom';

const AUDIENCE_OPTIONS = [
  { label: 'All Members', value: 'all' },
  { label: 'Officers Only', value: 'SBO_OFFICER' },
  { label: 'Students Only', value: 'STUDENT' },
  { label: 'Admins Only', value: 'ADMIN' },
  { label: 'Department Heads Only', value: 'DEPARTMENT_HEAD' },
];

const CATEGORY_OPTIONS = [
  { label: 'General', value: 'general' },
  { label: 'Election', value: 'election' },
  { label: 'Training', value: 'training' },
  { label: 'Events', value: 'events' },
  { label: 'Merchandise', value: 'merchandise' },
];

function ConfirmModal({ open, title, message, confirmText, onCancel, onConfirm, busy }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-[#DDE7EF] bg-white p-6 shadow-2xl">
        <h3 className="text-lg font-bold text-[#0F172A]">{title}</h3>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
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

export default function CreateAnnouncementPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [targetRole, setTargetRole] = useState('all');
  const [category, setCategory] = useState('general');
  const [body, setBody] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [isPinned, setIsPinned] = useState(false);
  const [isImportant, setIsImportant] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [posted, setPosted] = useState(false);
  const [lastPublishState, setLastPublishState] = useState(true);
  const [confirmState, setConfirmState] = useState({ open: false, isPublished: true });

  async function handleSubmit(isPublished) {
    if (!title.trim() || !body.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createAnnouncement({ title, body, target_role: targetRole, category, is_published: isPublished, imageFile, is_pinned: isPinned, is_important: isImportant });
      setLastPublishState(isPublished);
      setPosted(true);
    } catch (err) {
      setError(err.response?.data?.message ?? 'Failed to post announcement. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGenerateDraft() {
    if (!title.trim()) {
      setError('Enter a title before generating a draft.');
      return;
    }

    setGenerating(true);
    setError(null);
    try {
      const res = await generateAnnouncementDraft({
        title,
        target_role: targetRole,
        category,
        details: body,
      });
      setBody(res.data?.output_text || '');
    } catch (err) {
      setError(err.response?.data?.message ?? 'Failed to generate announcement draft.');
    } finally {
      setGenerating(false);
    }
  }

  if (posted) {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-[#DDE7EF] bg-white p-6 text-center shadow-sm sm:p-8">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
          <CheckCircle size={32} className="text-emerald-500" />
        </div>
        <h2 className="mb-2 text-lg font-extrabold text-[#0F172A]">{lastPublishState ? 'Announcement Posted!' : 'Draft Saved!'}</h2>
        <p className="mb-6 text-sm text-slate-500">
          {lastPublishState
            ? <>Sent to <strong>{AUDIENCE_OPTIONS.find((o) => o.value === targetRole)?.label}</strong>.</>
            : 'You can publish this draft anytime from Manage Announcements.'}
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={() => { setTitle(''); setBody(''); setTargetRole('all'); setCategory('general'); setImageFile(null); setIsPinned(false); setIsImportant(false); setPosted(false); setLastPublishState(true); }}
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
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <section className="rounded-xl border border-[#DDE7EF] bg-white p-4 shadow-sm sm:p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-[#EEF6FB] text-[#0B8ED0]">
            <Megaphone size={21} />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#0B8ED0]">Communications</p>
            <h1 className="mt-1 text-xl font-black text-[#0F172A] sm:text-2xl">Create Announcement</h1>
            <p className="mt-1 text-sm text-slate-500">Write the message in the main workspace, then choose its audience and publishing options.</p>
          </div>
        </div>
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0 rounded-xl border border-[#DDE7EF] bg-white p-4 shadow-sm sm:p-5 lg:p-6">
          <div>
            <label htmlFor="announcement-title" className="mb-1.5 block text-[13px] font-semibold text-[#0F172A]">Title <span className="text-red-500">*</span></label>
            <input
              id="announcement-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. General Assembly - Second Semester"
              maxLength={255}
              className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm text-[#0F172A] outline-none transition focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
            />
          </div>

          <div className="mt-5">
            <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <label htmlFor="announcement-content" className="block text-[13px] font-semibold text-[#0F172A]">Content <span className="text-red-500">*</span></label>
                <p className="mt-0.5 text-xs text-slate-400">Use clear, concise language. Plain text formatting is preserved.</p>
              </div>
              <button
                type="button"
                onClick={handleGenerateDraft}
                disabled={generating || !title.trim()}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[#B9D9E9] bg-[#EEF6FB] px-3 text-xs font-bold text-[#0878B7] transition hover:bg-[#DDF2FB] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                <Bot size={15} />
                {generating ? 'Generating draft...' : 'Generate Draft'}
              </button>
            </div>
            <textarea
              id="announcement-content"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Write your announcement content here..."
              className="min-h-[320px] w-full resize-y rounded-lg border border-[#DDE7EF] bg-white p-4 text-sm leading-6 text-slate-700 outline-none transition focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 lg:min-h-[460px]"
            />
            <p className="mt-1.5 text-right text-[11px] font-medium text-slate-400">{body.length.toLocaleString()} characters</p>
          </div>
        </section>

        <aside className="space-y-4 lg:sticky lg:top-5">
          <section className="rounded-xl border border-[#DDE7EF] bg-white p-4 shadow-sm sm:p-5">
            <h2 className="text-sm font-bold text-[#0F172A]">Publishing settings</h2>
            <div className="mt-4 space-y-4">
              <div>
                <label htmlFor="announcement-audience" className="mb-1.5 block text-[13px] font-semibold text-[#0F172A]">Audience</label>
                <select id="announcement-audience" value={targetRole} onChange={(event) => setTargetRole(event.target.value)} className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm text-slate-700 outline-none transition focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15">
                  {AUDIENCE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="announcement-category" className="mb-1.5 block text-[13px] font-semibold text-[#0F172A]">Category</label>
                <select id="announcement-category" value={category} onChange={(event) => setCategory(event.target.value)} className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm text-slate-700 outline-none transition focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15">
                  {CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="announcement-image" className="mb-1.5 block text-[13px] font-semibold text-[#0F172A]">Poster or image <span className="font-medium text-slate-400">(optional)</span></label>
                <label htmlFor="announcement-image" className="flex min-h-20 cursor-pointer items-center gap-3 rounded-lg border border-dashed border-[#B9CBD8] bg-[#F8FBFD] p-3 hover:border-[#0B8ED0]">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#EEF6FB] text-[#0B8ED0]"><ImagePlus size={18} /></span>
                  <span className="min-w-0"><span className="block truncate text-xs font-bold text-[#0F172A]">{imageFile?.name || 'Choose an image'}</span><span className="mt-0.5 block text-[10px] text-slate-500">JPEG, PNG or WebP · up to 5 MB</span></span>
                </label>
                <input id="announcement-image" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => setImageFile(event.target.files?.[0] || null)} />
              </div>
              <div className="space-y-2 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-3">
                <label className="flex cursor-pointer items-start gap-2.5 text-xs font-semibold text-[#0F172A]"><input type="checkbox" checked={isPinned} onChange={(event) => setIsPinned(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-[#DDE7EF]" /><span>Pin to the top<span className="mt-0.5 block font-normal text-slate-500">Keeps this update ahead of regular posts.</span></span></label>
                <label className="flex cursor-pointer items-start gap-2.5 border-t border-[#DDE7EF] pt-2 text-xs font-semibold text-[#0F172A]"><input type="checkbox" checked={isImportant} onChange={(event) => setIsImportant(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-[#DDE7EF]" /><span>Mark as important<span className="mt-0.5 block font-normal text-slate-500">Adds a clear priority badge for students.</span></span></label>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-[#DDE7EF] bg-white p-4 shadow-sm sm:p-5">
            <h2 className="text-sm font-bold text-[#0F172A]">Ready to publish?</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">Title and content are required. You can save a draft without notifying members.</p>
            {(!title.trim() || !body.trim()) && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">Complete the title and content to enable these actions.</p>}
            {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p>}
            <div className="mt-4 flex flex-col gap-2.5">
              <button type="button" disabled={submitting || !title.trim() || !body.trim()} onClick={() => setConfirmState({ open: true, isPublished: true })} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#0B8ED0] px-4 text-sm font-bold text-white transition hover:bg-[#0878B7] disabled:cursor-not-allowed disabled:opacity-50">
                <Send size={15} />
                {submitting ? 'Posting...' : 'Publish Now'}
              </button>
              <button type="button" disabled={submitting || !title.trim() || !body.trim()} onClick={() => setConfirmState({ open: true, isPublished: false })} className="h-11 w-full rounded-lg border border-[#DDE7EF] bg-white px-4 text-sm font-bold text-[#0878B7] transition hover:bg-[#F8FBFD] disabled:cursor-not-allowed disabled:opacity-50">Save Draft</button>
            </div>
          </section>
        </aside>
      </div>

      <ConfirmModal
        open={confirmState.open}
        title={confirmState.isPublished ? 'Publish Announcement' : 'Save Draft'}
        message={confirmState.isPublished
          ? 'Are you sure you want to publish this announcement now?'
          : 'Save this announcement as draft for later publishing?'}
        confirmText={confirmState.isPublished ? 'Publish Now' : 'Save Draft'}
        busy={submitting}
        onCancel={() => setConfirmState({ open: false, isPublished: true })}
        onConfirm={async () => {
          setConfirmState((prev) => ({ ...prev, open: false }));
          await handleSubmit(confirmState.isPublished);
        }}
      />
    </div>
  );
}
