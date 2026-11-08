import { useEffect, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { createAnnouncement, generateAnnouncementDraft, getAnnouncementGenerationQuota } from '../../../services/announcementService';
import AccessibleOverlay from '../../../components/AccessibleOverlay';
import RichTextEditor from '../../../components/RichText';
import { Button, Field, Input, PageHeader, Select, Textarea } from '../../../components/ui';
import { getBreadcrumbs, getPageMeta, getStoredRole } from '../../../lib/pageMeta';

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
      <div className="w-full max-w-md rounded-card border border-line bg-surface p-6">
        <h3 className="text-lg font-semibold text-ink">{title}</h3>
        <p className="mt-2 text-sm text-ink-muted-strong">{message}</p>
        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button onClick={onConfirm} loading={busy}>{confirmText}</Button>
        </div>
      </div>
    </AccessibleOverlay>
  );
}

const MANAGE_PATH = '/dashboard/announcements/manage-announcements';
const REQUEST_PATH = '/dashboard/approval-requests/new/announcement';

// The server publishes an Admin's announcement at once and holds an Officer's for the Admin to approve.
function sendsForApproval() {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}')?.role === 'SBO_OFFICER';
  } catch {
    return false;
  }
}

export default function CreateAnnouncementPage() {
  const forApproval = sendsForApproval();
  const { pathname } = useLocation();
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
  const [showMissing, setShowMissing] = useState(false);
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

  // The buttons stay usable. A click on an incomplete form shows what is missing beside each field.
  function askConfirm(isPublished) {
    if (!title.trim() || !body.trim()) {
      setShowMissing(true);
      return;
    }
    setConfirmState({ open: true, isPublished });
  }

  async function handleSubmit(isPublished) {
    if (!title.trim() || !body.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createAnnouncement({ title, body, target_role: targetRole, category, is_published: isPublished, imageFile, is_pinned: isPinned, is_important: isImportant, ai_output_id: aiOutputId });
      setLastPublishState(isPublished);
      setPosted(true);
    } catch (err) {
      setError(err.response?.data?.message ?? 'Could not post the announcement. Try again.');
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
      setError(err.response?.data?.message ?? 'Could not generate a draft. Try again.');
    } finally {
      setGenerating(false);
    }
  }

  // An Admin who opens the request route still publishes at once, so only an Officer sees "request".
  const onRequestRoute = pathname === REQUEST_PATH;
  const meta = getPageMeta(pathname, getStoredRole());
  const pageTitle = (onRequestRoute && !forApproval) || !meta.matched ? 'New announcement' : meta.title;
  const crumbs = getBreadcrumbs(pathname, getStoredRole()).map((crumb, index, all) => (index === all.length - 1 ? { label: pageTitle } : crumb));
  const titleMissing = showMissing && !title.trim();
  const bodyMissing = showMissing && !body.trim();

  if (posted) {
    const audienceLabel = AUDIENCE_OPTIONS.find((o) => o.value === targetRole)?.label;
    return (
      <div className="mx-auto max-w-xl rounded-card border border-line bg-surface p-6 sm:p-8">
        <h2 className="text-lg font-semibold text-ink">{forApproval ? 'Sent to your Admin for approval' : lastPublishState ? 'Announcement posted' : 'Draft saved'}</h2>
        <p className="mt-2 text-sm text-ink-muted-strong">
          {forApproval
            ? <>It goes to <strong>{audienceLabel}</strong> once the Admin approves it.</>
            : lastPublishState
              ? <>Sent to <strong>{audienceLabel}</strong>.</>
              : 'You can publish this draft anytime from Manage Announcements.'}
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button to={MANAGE_PATH}>View in announcements</Button>
          <Button
            variant="secondary"
            onClick={() => { setTitle(''); setBody(''); setAiInstructions(''); setAiOutputId(null); setTargetRole('all'); setCategory('general'); setImageFile(null); setIsPinned(false); setIsImportant(false); setPosted(false); setLastPublishState(true); }}
          >
            Create another
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <PageHeader title={pageTitle} breadcrumbs={crumbs} />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0 space-y-5 rounded-card border border-line bg-surface p-4 sm:p-5 lg:row-span-2 lg:p-6">
          <Field label="Title" required error={titleMissing ? 'Enter a title.' : undefined}>
            <Input
              id="announcement-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="General Assembly"
              maxLength={255}
            />
          </Field>

          <div>
            <label htmlFor="announcement-content" className="mb-1.5 block text-[13px] font-medium text-ink">Content</label>
            <RichTextEditor
              id="announcement-content"
              value={body}
              onChange={setBody}
              placeholder="Write your announcement here"
              rows={6}
              className="sm:min-h-64"
            />
            {bodyMissing && <p role="alert" className="mt-1.5 text-xs font-semibold text-danger-strong">Write the announcement text.</p>}
            <p className="mt-1.5 text-right text-xs tabular-nums text-ink-muted">{body.length.toLocaleString()} characters</p>
          </div>

          <details className="border-t border-line pt-3">
            <summary className="flex min-h-10 cursor-pointer items-center text-sm font-medium text-brand-700">Draft the text with AI</summary>
            <div className="mt-3 space-y-3">
              <Field label="Instructions for AI draft" optional hint={quotaLoading ? 'Checking daily limit...' : `${generationQuota.remaining} of ${generationQuota.limit} drafts left today`}>
                <Textarea id="announcement-ai-instructions" value={aiInstructions} onChange={(event) => setAiInstructions(event.target.value)} rows={3} placeholder="Formal tone. Assembly is on September 30 at 2:00 PM. Bring your ID." />
              </Field>
              <Button
                variant="secondary"
                onClick={handleGenerateDraft}
                disabled={generating || !title.trim() || generationQuota.remaining < 1}
                className="w-full sm:w-auto"
              >
                {generating ? 'Generating draft...' : generationQuota.remaining < 1 ? 'Daily limit reached' : 'Generate draft'}
              </Button>
            </div>
          </details>
        </section>

        <section className="rounded-card border border-line bg-surface p-4 sm:p-5 lg:col-start-2 lg:row-start-1">
          <h2 className="text-sm font-semibold text-ink">Publishing settings</h2>
          <div className="mt-4 space-y-4">
            <Field label="Audience">
              <Select id="announcement-audience" value={targetRole} onChange={(event) => setTargetRole(event.target.value)}>
                {AUDIENCE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </Select>
            </Field>
            <Field label="Category">
              <Select id="announcement-category" value={category} onChange={(event) => setCategory(event.target.value)}>
                {CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </Select>
            </Field>
            <div>
              <label htmlFor="announcement-image" className="mb-1.5 block text-[13px] font-medium text-ink">Poster or image <span className="font-normal text-ink-muted">(optional)</span></label>
              <label htmlFor="announcement-image" className="flex min-h-16 cursor-pointer items-center gap-3 rounded-control border border-dashed border-line p-3 hover:border-brand-600">
                <ImagePlus size={18} className="shrink-0 text-ink-muted" aria-hidden="true" />
                <span className="min-w-0"><span className="block truncate text-sm font-medium text-ink">{imageFile?.name || 'Choose an image'}</span><span className="mt-0.5 block text-xs text-ink-muted">JPEG, PNG or WebP, up to 5 MB</span></span>
              </label>
              <input id="announcement-image" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => setImageFile(event.target.files?.[0] || null)} />
            </div>
            <div className="space-y-1 border-t border-line pt-3">
              <label className="flex min-h-11 cursor-pointer items-start gap-2.5 text-sm font-medium text-ink"><input type="checkbox" checked={isPinned} onChange={(event) => setIsPinned(event.target.checked)} className="mt-1 h-4 w-4 accent-brand-700" /><span>Pin to the top<span className="block text-xs font-normal text-ink-muted">Keeps this update ahead of regular posts.</span></span></label>
              <label className="flex min-h-11 cursor-pointer items-start gap-2.5 text-sm font-medium text-ink"><input type="checkbox" checked={isImportant} onChange={(event) => setIsImportant(event.target.checked)} className="mt-1 h-4 w-4 accent-brand-700" /><span>Mark as important<span className="block text-xs font-normal text-ink-muted">Adds an Important label.</span></span></label>
            </div>
          </div>
        </section>

        <div className="sticky bottom-0 z-10 -mx-1 border-t border-line bg-page px-1 py-3 lg:static lg:col-start-2 lg:row-start-2 lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0">
          <p className="mb-2 hidden text-xs text-ink-muted lg:block">{forApproval ? 'The Admin approves it before members see it.' : 'A saved draft does not notify members.'}</p>
          {error && <p role="alert" className="mb-2 text-sm font-medium text-danger-strong">{error}</p>}
          <div className="flex gap-2 lg:flex-col [&>*]:flex-1">
            <Button disabled={submitting} onClick={() => askConfirm(true)}>
              {submitting ? (forApproval ? 'Sending...' : 'Posting...') : forApproval ? 'Submit for approval' : 'Publish now'}
            </Button>
            {!forApproval && <Button variant="secondary" disabled={submitting} onClick={() => askConfirm(false)}>Save draft</Button>}
          </div>
        </div>
      </div>

      <ConfirmModal
        open={confirmState.open}
        title={forApproval ? 'Submit for approval' : confirmState.isPublished ? 'Publish announcement' : 'Save draft'}
        message={forApproval
          ? 'The Admin approves it before members see it. You can follow it in Announcements.'
          : confirmState.isPublished
            ? 'Are you sure you want to publish this announcement now?'
            : 'Save this announcement as draft for later publishing?'}
        confirmText={forApproval ? 'Submit for approval' : confirmState.isPublished ? 'Publish now' : 'Save draft'}
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
