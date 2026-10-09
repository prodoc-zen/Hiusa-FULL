import { formatDisplayText } from '../../../utils/displayText.js';
import { useCallback, useEffect, useState } from 'react';
import RichTextEditor from '../../../components/RichText';
import { CheckCircle2, Circle, MessageSquareWarning, ShieldCheck, Trash2 } from 'lucide-react';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  SegmentedControl,
  SkeletonCard,
  StatusBadge,
  Tabs,
} from '../../../components/ui';
import EngineBadge from '../../../components/ai/EngineBadge';
import RulesDisclosure from '../../../components/ai/RulesDisclosure';
import ConfirmModal from '../../../components/ConfirmModal';
import { getGrievances, createGrievance, deleteGrievance } from '../../../services/grievanceService';
import { relativeTime } from '../../../lib/format';
import notify from '../../../lib/notify';
import { getApiErrorMessage } from '../../../utils/apiError';
import { addressedToLabel, grievanceStatusTone, urgencyTone } from './grievanceLabels';

const ADDRESSED_TO_OPTIONS = [
  { value: 'organization', label: 'My organization' },
  { value: 'sao', label: 'Student Affairs Office' },
];

const TIMELINE_STEPS = (status) => [
  { key: 'submitted', label: 'Filed', done: true },
  { key: 'under_review', label: 'Under review', done: ['under_review', 'resolved', 'dismissed'].includes(status) },
  { key: 'final', label: status === 'dismissed' ? 'Dismissed' : 'Resolved', done: ['resolved', 'dismissed'].includes(status) },
];

function GrievanceTimeline({ status }) {
  const steps = TIMELINE_STEPS(status);

  return (
    <ol className="flex items-center gap-1.5">
      {steps.map((step, index) => (
        <li key={step.key} className="flex flex-1 items-center gap-1.5">
          <div className="flex flex-col items-center gap-1">
            {step.done ? (
              <CheckCircle2 size={16} className="text-brand-600" aria-hidden="true" />
            ) : (
              <Circle size={16} className="text-line" aria-hidden="true" />
            )}
            <span className={`whitespace-nowrap text-[11px] font-semibold ${step.done ? 'text-ink' : 'text-ink-soft'}`}>{step.label}</span>
          </div>
          {index < steps.length - 1 && <div className={`h-0.5 flex-1 ${step.done ? 'bg-brand-600' : 'bg-line'}`} aria-hidden="true" />}
        </li>
      ))}
    </ol>
  );
}

function ClassificationAdvisory({ grievance }) {
  return (
    <div className="rounded-card border border-line bg-subtle p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">AI classification (advisory)</p>
        <EngineBadge engine={grievance.classification_engine} />
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <StatusBadge tone={urgencyTone(grievance.urgency)} label={`${grievance.urgency} urgency`} />
        <StatusBadge tone="neutral" label={grievance.category} />
      </div>
      <RulesDisclosure label="Why this classification?" items={grievance.classification_reasoning ? [grievance.classification_reasoning] : []} />
    </div>
  );
}

export default function StudentGrievancesPage() {
  const [tab, setTab] = useState('file');
  const [grievances, setGrievances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [addressedTo, setAddressedTo] = useState('organization');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    return getGrievances()
      .then((res) => setGrievances(res.data?.data ?? []))
      .catch(() => setError('Failed to load your grievances.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!title.trim() || !description.trim()) return;

    setSubmitting(true);
    setFieldErrors({});
    try {
      await createGrievance({
        title: title.trim(),
        description: description.trim(),
        addressed_to: addressedTo,
        is_anonymous: addressedTo === 'organization' ? isAnonymous : false,
      });
      notify.success('Your grievance was filed. Thank you for speaking up.');
      setTitle('');
      setDescription('');
      setIsAnonymous(false);
      setTab('mine');
      load();
    } catch (err) {
      if (err.validationErrors) {
        setFieldErrors(err.validationErrors);
      } else {
        notify.error(err.response?.data?.message || 'Could not file your grievance. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmDelete() {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteGrievance(deleteTarget.id);
      notify.success('Your grievance was deleted.');
      setDeleteTarget(null);
      load();
    } catch (err) {
      setDeleteError(getApiErrorMessage(err, 'Could not delete this grievance. Please try again.'));
      setDeleteTarget(null);
      if ([404, 409].includes(err.response?.status)) load();
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[28px] font-extrabold leading-tight text-ink">My grievances</h1>
        <p className="mt-1 max-w-[65ch] text-sm font-medium text-ink-muted-strong">A safe, confidential way to raise a concern with your organization or directly with the Student Affairs Office.</p>
      </div>

      <Tabs
        tabs={[
          { key: 'file', label: 'File a grievance' },
          { key: 'mine', label: `My grievances${grievances.length ? ` (${grievances.length})` : ''}` },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'file' && (
        <Card>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex items-start gap-3 rounded-card border border-brand-100 bg-brand-50 p-3">
              <ShieldCheck size={18} className="mt-0.5 shrink-0 text-navy-800" aria-hidden="true" />
              <p className="text-xs font-medium leading-5 text-navy-800">
                What happens next: your grievance goes to the recipient you choose below. You will get a notification and can track its status and any remarks here at any time.
              </p>
            </div>

            <Field label="What's this about?" required error={fieldErrors.title?.[0]}>
              <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={255} placeholder="A short, clear title" />
            </Field>

            <Field label="Tell us what happened" required hint="Include when and where this happened, and anyone involved." error={fieldErrors.description?.[0]}>
              <RichTextEditor ariaLabel="Tell us what happened" value={description} onChange={setDescription} maxLength={5000} rows={6} placeholder="Describe the situation in your own words..." />
            </Field>

            <Field label="Who should this go to?" required>
              <SegmentedControl options={ADDRESSED_TO_OPTIONS} value={addressedTo} onChange={setAddressedTo} className="w-full" />
            </Field>

            {addressedTo === 'organization' ? (
              <label className="flex cursor-pointer items-start gap-3 rounded-card border border-line p-3">
                <input type="checkbox" checked={isAnonymous} onChange={(event) => setIsAnonymous(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-brand-700" />
                <span className="text-sm text-ink">
                  <span className="block font-semibold">File this anonymously to my organization</span>
                  <span className="mt-0.5 block text-xs font-medium leading-5 text-ink-muted">
                    This hides your name from your organization's officers only. The Student Affairs Office can still see who filed it, in case they need to check in with you directly for your safety. You can always see your own submissions here, anonymous or not.
                  </span>
                </span>
              </label>
            ) : (
              <p className="text-xs font-medium leading-5 text-ink-muted">Reports filed directly with the Student Affairs Office are handled by SAO staff only. Anonymity toward your organization does not apply here, since your organization never sees this report.</p>
            )}

            <div className="flex justify-end">
              <Button type="submit" loading={submitting} disabled={!title.trim() || !description.trim()}>File this grievance</Button>
            </div>
          </form>
        </Card>
      )}

      {tab === 'mine' && (
        <div className="flex flex-col gap-3">
          {deleteError && <p role="alert" className="rounded-control bg-danger-tint p-3 text-sm font-semibold text-danger-strong">{deleteError}</p>}

          {loading && (
            <>
              <SkeletonCard />
              <SkeletonCard />
            </>
          )}

          {!loading && error && <ErrorState description={error} onRetry={load} />}

          {!loading && !error && grievances.length === 0 && (
            <EmptyState
              kind="first-run"
              icon={MessageSquareWarning}
              title="No grievances filed yet"
              description="When you file a grievance, its status and any remarks from reviewers will show up here."
              action={<Button variant="primary" size="sm" onClick={() => setTab('file')}>File a grievance</Button>}
            />
          )}

          {!loading && !error && grievances.map((grievance) => (
            <Card key={grievance.id}>
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-base font-bold text-ink">{formatDisplayText(grievance.title)}</p>
                    <p className="text-xs font-medium text-ink-muted">Addressed to {addressedToLabel(grievance)} · Filed {relativeTime(grievance.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={grievance.status} tone={grievanceStatusTone(grievance.status)} />
                    {grievance.status === 'submitted' && <IconButton icon={Trash2} label={`Delete grievance ${formatDisplayText(grievance.title)}`} variant="danger" onClick={() => { setDeleteError(null); setDeleteTarget(grievance); }} />}
                  </div>
                </div>

                <GrievanceTimeline status={grievance.status} />

                <ClassificationAdvisory grievance={grievance} />

                {grievance.remarks && (
                  <div className="rounded-card border border-line bg-subtle p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">Response</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{grievance.remarks}</p>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Delete this grievance?"
        message="This cannot be undone. Only grievances that have not been reviewed can be deleted."
        recordName={deleteTarget?.title}
        confirmText="Delete grievance"
        variant="danger"
        busy={deleteBusy}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
