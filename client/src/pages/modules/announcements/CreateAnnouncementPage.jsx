import HiusaSelect from '../../../components/ui/Select';
import { useEffect, useState } from 'react';
import { Bot, CheckCircle, ImagePlus, Send } from 'lucide-react';
import { createAnnouncement, generateAnnouncementDraft, getAnnouncementGenerationQuota } from '../../../services/announcementService';
import { Link, useNavigate } from 'react-router-dom';
import AccessibleOverlay from '../../../components/AccessibleOverlay';
import RichTextEditor from '../../../components/RichText';

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
    <AccessibleOverlay label={title} onClose={() => !busy && onCancel()} className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/50 p-4">
      <div className="w-full max-w-md rounded-lg border border-line bg-white p-6">
        <h3 className="text-lg font-bold text-ink">{title}</h3>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} className="h-11 rounded-lg border border-line px-5 text-sm font-bold text-slate-600 hover:bg-subtle" disabled={busy}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className="h-11 rounded-lg bg-brand-700 px-5 text-sm font-bold text-white transition hover:bg-navy-800 disabled:opacity-50" disabled={busy}>
            {busy ? 'Processing...' : confirmText}
          </button>
        </div>
      </div>
    </AccessibleOverlay>
  );
}

const MANAGE_PATH = '/dashboard/announcements/manage-announcements';

// The server publishes an Admin's announcement at once and holds an Officer's for the Admin to approve.
function sendsForApproval() {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}')?.role === 'SBO_OFFICER';
  } catch {
    return false;
  }
}

export default function CreateAnnouncementPage() {
  const navigate = useNavigate();
  const forApproval = sendsForApproval();
  const [title, setTitle] = useState('');
  const [targetRole, setTargetRole] = useState('all');
  const [category, setCategory] = useState('general');
  const [body, setBody] = useState('');
  const [aiInstructions, setAiInstructions] = useState('');
  const [aiOutputId, setAiOutputId] = useState(null);
  const [generationQuota, setGenerationQuota] = useState({ limit: 20, used: 0, remaining: 20 });
  const [quotaLoading, setQuotaLoading] = useState(true);
  const [imageFile, setImageFile] = useState(null);
  const [isPinned, setIsPinned] = useState(false);
  const [isImportant, setIsImportant] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [posted, setPosted] = useState(false);
  const [lastPublishState, setLastPublishState] = useState(true);
  const [confirmState, setConfirmState] = useState({ open: false, isPublished: true });

  useEffect(() => {
    let cancelled = false;
    getAnnouncementGenerationQuota()
      .then((response) => { if (!cancelled) setGenerationQuota(response.data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setQuotaLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function handleSubmit(isPublished) {
    if (!title.trim() || !body.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createAnnouncement({ title, body, target_role: targetRole, category, is_published: isPublished, imageFile, is_pinned: isPinned, is_important: isImportant, ai_output_id: aiOutputId });
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
        details: aiInstructions,
      });
      setBody(res.data?.output_text || '');
      setAiOutputId(res.data?.ai_output_id || null);
      if (res.data?.quota) setGenerationQuota(res.data.quota);
    } catch (err) {
      if (err.response?.data?.quota) setGenerationQuota(err.response.data.quota);
      setError(err.response?.data?.message ?? 'Failed to generate announcement draft.');
    } finally {
      setGenerating(false);
    }
  }

  if (posted) {
    return (
      <div className="mx-auto max-w-xl rounded-lg border border-line bg-white p-6 text-center shadow-sm sm:p-8">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-success-tint">
          <CheckCircle size={32} className="text-success-strong" />
        </div>
        <h2 className="mb-2 text-lg font-semibold text-ink">{forApproval ? 'Sent to your Admin for approval' : lastPublishState ? 'Announcement Posted!' : 'Draft Saved!'}</h2>
        <p className="mb-6 text-sm text-slate-500">
          {forApproval
            ? <>It goes to <strong>{AUDIENCE_OPTIONS.find((o) => o.value === targetRole)?.label}</strong> once the Admin approves it.</>
            : lastPublishState
              ? <>Sent to <strong>{AUDIENCE_OPTIONS.find((o) => o.value === targetRole)?.label}</strong>.</>
              : 'You can publish this draft anytime from Manage Announcements.'}
        </p>
        <div className="flex flex-col gap-2">
          <Link to={MANAGE_PATH} className="inline-flex items-center justify-center rounded-lg bg-brand-700 px-6 py-2.5 text-sm font-bold text-white transition hover:bg-navy-800">
            View in Announcements
          </Link>
          <button
            onClick={() => { setTitle(''); setBody(''); setAiInstructions(''); setAiOutputId(null); setTargetRole('all'); setCategory('general'); setImageFile(null); setIsPinned(false); setIsImportant(false); setPosted(false); setLastPublishState(true); }}
            className="rounded-lg border border-line px-6 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-subtle"
          >
            Create Another
          </button>
          <button
            onClick={() => navigate(-1)}
            className="rounded-lg border border-line px-6 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-subtle"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0 rounded-lg border border-line bg-white p-4 shadow-sm sm:p-5 lg:p-6">
          <div>
            <label htmlFor="announcement-title" className="mb-1.5 block text-[13px] font-semibold text-ink">Title <span className="text-red-500">*</span></label>
            <input
              id="announcement-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. General Assembly - Second Semester"
              maxLength={255}
              className="h-11 w-full rounded-lg border border-line px-3 text-sm text-ink outline-none transition focus:border-brand-600 focus:ring-4 focus:ring-accent/15"
            />
          </div>

          <div className="mt-5">
            <div className="mb-4 rounded-lg border border-line bg-subtle p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div><label htmlFor="announcement-ai-instructions" className="block text-[13px] font-semibold text-ink">Instructions for AI draft <span className="font-medium text-slate-500">(optional)</span></label><p className="mt-0.5 text-xs leading-5 text-slate-500">Add known dates, venue, tone, required action, or facts the draft must include. This stays separate from the editable announcement.</p></div>
                <p className="shrink-0 text-xs font-bold text-brand-700">{quotaLoading ? 'Checking daily limit…' : `${generationQuota.remaining} of ${generationQuota.limit} drafts left today`}</p>
              </div>
              <textarea id="announcement-ai-instructions" value={aiInstructions} onChange={(event) => setAiInstructions(event.target.value)} rows={3} placeholder="Example: Formal tone. Assembly is on September 30 at 2:00 PM. Ask students to bring their ID." className="mt-3 w-full resize-y rounded-lg border border-line bg-white p-3 text-sm leading-6 text-slate-700 outline-none transition focus:border-brand-600 focus:ring-4 focus:ring-accent/15" />
            </div>
            <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <label htmlFor="announcement-content" className="block text-[13px] font-semibold text-ink">Content <span className="text-red-500">*</span></label>
                <p className="mt-0.5 text-xs text-slate-500">Use clear, concise language. Plain text formatting is preserved.</p>
              </div>
              <button
                type="button"
                onClick={handleGenerateDraft}
                disabled={generating || !title.trim() || generationQuota.remaining < 1}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-line bg-page px-3 text-xs font-bold text-navy-800 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                <Bot size={15} />
                {generating ? 'Generating draft...' : generationQuota.remaining < 1 ? 'Daily limit reached' : 'Generate Draft'}
              </button>
            </div>
            <RichTextEditor
              id="announcement-content"
              value={body}
              onChange={setBody}
              placeholder="Write your announcement content here..."
              rows={12}
            />
            <p className="mt-1.5 text-right text-xs font-medium text-slate-500">{body.length.toLocaleString()} characters</p>
          </div>
        </section>

        <aside className="space-y-4 lg:sticky lg:top-5">
          <section className="rounded-lg border border-line bg-white p-4 shadow-sm sm:p-5">
            <h2 className="text-sm font-bold text-ink">Publishing settings</h2>
            <div className="mt-4 space-y-4">
              <div>
                <label htmlFor="announcement-audience" className="mb-1.5 block text-[13px] font-semibold text-ink">Audience</label>
                <HiusaSelect id="announcement-audience" value={targetRole} onChange={(event) => setTargetRole(event.target.value)} className="h-11 w-full rounded-lg border border-line px-3 text-sm text-slate-700 outline-none transition focus:border-brand-600 focus:ring-4 focus:ring-accent/15">
                  {AUDIENCE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </HiusaSelect>
              </div>
              <div>
                <label htmlFor="announcement-category" className="mb-1.5 block text-[13px] font-semibold text-ink">Category</label>
                <HiusaSelect id="announcement-category" value={category} onChange={(event) => setCategory(event.target.value)} className="h-11 w-full rounded-lg border border-line px-3 text-sm text-slate-700 outline-none transition focus:border-brand-600 focus:ring-4 focus:ring-accent/15">
                  {CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </HiusaSelect>
              </div>
              <div>
                <label htmlFor="announcement-image" className="mb-1.5 block text-[13px] font-semibold text-ink">Poster or image <span className="font-medium text-slate-500">(optional)</span></label>
                <label htmlFor="announcement-image" className="flex min-h-20 cursor-pointer items-center gap-3 rounded-lg border border-dashed border-line bg-subtle p-3 hover:border-brand-600">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-page text-navy-800"><ImagePlus size={18} /></span>
                  <span className="min-w-0"><span className="block truncate text-xs font-bold text-ink">{imageFile?.name || 'Choose an image'}</span><span className="mt-0.5 block text-xs text-slate-500">JPEG, PNG or WebP · up to 5 MB</span></span>
                </label>
                <input id="announcement-image" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => setImageFile(event.target.files?.[0] || null)} />
              </div>
              <div className="space-y-2 rounded-lg border border-line bg-subtle p-3">
                <label className="flex cursor-pointer items-start gap-2.5 text-xs font-semibold text-ink"><input type="checkbox" checked={isPinned} onChange={(event) => setIsPinned(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-line" /><span>Pin to the top<span className="mt-0.5 block font-normal text-slate-500">Keeps this update ahead of regular posts.</span></span></label>
                <label className="flex cursor-pointer items-start gap-2.5 border-t border-line pt-2 text-xs font-semibold text-ink"><input type="checkbox" checked={isImportant} onChange={(event) => setIsImportant(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-line" /><span>Mark as important<span className="mt-0.5 block font-normal text-slate-500">Adds a clear priority badge for students.</span></span></label>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-line bg-white p-4 shadow-sm sm:p-5">
            <h2 className="text-sm font-bold text-ink">{forApproval ? 'Ready to send?' : 'Ready to publish?'}</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">{forApproval ? 'Title and content are required. The Admin approves it before members see it.' : 'Title and content are required. You can save a draft without notifying members.'}</p>
            {(!title.trim() || !body.trim()) && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">Complete the title and content to enable these actions.</p>}
            {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p>}
            <div className="mt-4 flex flex-col gap-2.5">
              <button type="button" disabled={submitting || !title.trim() || !body.trim()} onClick={() => setConfirmState({ open: true, isPublished: true })} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand-700 px-4 text-sm font-bold text-white transition hover:bg-navy-800 disabled:cursor-not-allowed disabled:opacity-50">
                <Send size={15} />
                {submitting ? (forApproval ? 'Sending...' : 'Posting...') : forApproval ? 'Submit for approval' : 'Publish Now'}
              </button>
              {!forApproval && <button type="button" disabled={submitting || !title.trim() || !body.trim()} onClick={() => setConfirmState({ open: true, isPublished: false })} className="h-11 w-full rounded-lg border border-line bg-white px-4 text-sm font-bold text-brand-700 transition hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-50">Save Draft</button>}
            </div>
          </section>
        </aside>
      </div>

      <ConfirmModal
        open={confirmState.open}
        title={forApproval ? 'Submit for approval' : confirmState.isPublished ? 'Publish Announcement' : 'Save Draft'}
        message={forApproval
          ? 'The Admin approves it before members see it. You can follow it in Announcements.'
          : confirmState.isPublished
            ? 'Are you sure you want to publish this announcement now?'
            : 'Save this announcement as draft for later publishing?'}
        confirmText={forApproval ? 'Submit for approval' : confirmState.isPublished ? 'Publish Now' : 'Save Draft'}
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
