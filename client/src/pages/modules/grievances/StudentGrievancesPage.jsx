import { formatDisplayText } from '../../../utils/displayText.js';
import { useCallback, useEffect, useState } from 'react';
import { MessageSquareWarning, Trash2 } from 'lucide-react';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  FlowStepper,
  IconButton,
  Input,
  PageHeader,
  SegmentedControl,
  SkeletonCard,
  Tabs,
  Textarea,
} from '../../../components/ui';
import RulesDisclosure from '../../../components/ai/RulesDisclosure';
import ConfirmModal from '../../../components/ConfirmModal';
import { getGrievances, createGrievance, deleteGrievance } from '../../../services/grievanceService';
import { relativeTime } from '../../../lib/format';
import notify from '../../../lib/notify';
import { getApiErrorMessage } from '../../../utils/apiError';
import useRecordParam from '../../../lib/useRecordParam';
import { UrgencyCell } from './GrievanceCells';
import { addressedToLabel, grievanceStage, grievanceStageText } from './grievanceLabels';

const ADDRESSED_TO_OPTIONS = [
  { value: 'organization', label: 'My organization' },
  { value: 'sao', label: 'Student Affairs Office' },
];

function ClassificationAdvisory({ grievance }) {
  return (
    <div className="border-t border-line pt-3">
      <p className="text-xs font-medium text-ink-muted">Suggested classification</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <UrgencyCell urgency={grievance.urgency} suffix=" urgency" />
        <span className="text-sm text-ink-muted">{grievance.category}</span>
      </div>
      <RulesDisclosure label="Why this classification?" items={grievance.classification_reasoning ? [grievance.classification_reasoning] : []} />
    </div>
  );
}

export default function StudentGrievancesPage() {
  const [recordId, setRecordId] = useRecordParam();
  const [tab, setTab] = useState(recordId ? 'mine' : 'file');
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

  useEffect(() => {
    if (!recordId || tab !== 'mine' || loading || error) return;
    const card = document.getElementById(`grievance-${recordId}`);
    if (card) {
      card.scrollIntoView?.({ block: 'center' });
      return;
    }
    notify.error('That grievance is not in your list.');
    setRecordId(null);
  }, [recordId, loading, error, grievances, setRecordId, tab]);

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
      notify.success('Your grievance was filed.');
      setTitle('');
      setDescription('');
      setIsAnonymous(false);
      setTab('mine');
      load();
    } catch (err) {
      if (err.validationErrors) {
        setFieldErrors(err.validationErrors);
      } else {
        notify.error(err.response?.data?.message || 'Could not file your grievance. Try again.');
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
      setDeleteError(getApiErrorMessage(err, 'Could not delete this grievance. Try again.'));
      if ([404, 409].includes(err.response?.status)) load();
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader primary={tab === 'mine' && grievances.length > 0 && <Button onClick={() => setTab('file')}>File a grievance</Button>} />

      <Tabs
        tabs={[
          { key: 'file', label: 'File a grievance' },
          { key: 'mine', label: `Filed grievances${grievances.length ? ` (${grievances.length})` : ''}` },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'file' && (
        <Card>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Field label="What's this about?" required error={fieldErrors.title?.[0]}>
              <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={255} placeholder="A short, clear title" />
            </Field>

            <Field label="Tell us what happened" required hint="Include when and where this happened, and anyone involved." error={fieldErrors.description?.[0]}>
              <Textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={5000} rows={6} placeholder="Describe the situation in your own words" />
            </Field>

            <Field label="Who should this go to?" required>
              <SegmentedControl options={ADDRESSED_TO_OPTIONS} value={addressedTo} onChange={setAddressedTo} className="w-full" />
            </Field>

            {addressedTo === 'organization' ? (
              <label className="flex min-h-11 cursor-pointer items-start gap-3">
                <input type="checkbox" checked={isAnonymous} onChange={(event) => setIsAnonymous(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-brand-700" />
                <span className="text-sm text-ink">
                  <span className="block font-medium">File this anonymously to my organization</span>
                  <span className="mt-0.5 block text-xs leading-5 text-ink-muted">
                    Your organization's officers will not see your name. The Student Affairs Office can still see who filed it.
                  </span>
                </span>
              </label>
            ) : (
              <p className="text-xs leading-5 text-ink-muted">Only SAO staff see grievances sent to the Student Affairs Office. Your organization never sees them.</p>
            )}

            <div className="flex justify-end">
              <Button type="submit" loading={submitting} disabled={!title.trim() || !description.trim()}>File this grievance</Button>
            </div>
          </form>
        </Card>
      )}

      {tab === 'mine' && (
        <div className="flex flex-col gap-3">
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
              title="No grievances filed"
              description="File one here and follow its status on this page."
              action={<Button onClick={() => setTab('file')}>File a grievance</Button>}
            />
          )}

          {!loading && !error && grievances.map((grievance) => (
            <Card key={grievance.id} className={String(grievance.id) === recordId ? 'border-brand-600' : ''}>
              <div id={`grievance-${grievance.id}`} className="flex flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-base font-semibold text-ink">{formatDisplayText(grievance.title)}</p>
                    <p className="text-xs text-ink-muted">Addressed to {addressedToLabel(grievance)} · Filed {relativeTime(grievance.created_at)}</p>
                  </div>
                  {grievance.status === 'submitted' && <IconButton icon={Trash2} label={`Delete grievance ${formatDisplayText(grievance.title)}`} variant="danger" onClick={() => { setDeleteError(null); setDeleteTarget(grievance); }} />}
                </div>

                <FlowStepper steps={grievanceStage(grievance, 'STUDENT').steps} ariaLabel={`Progress of ${formatDisplayText(grievance.title)}`} />
                <p className="text-sm text-ink">{grievanceStageText(grievance)}</p>

                <ClassificationAdvisory grievance={grievance} />

                {grievance.remarks && (
                  <div className="border-t border-line pt-3">
                    <p className="text-xs font-medium text-ink-muted">Response</p>
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
        message="The grievance is removed for good and its notifications are cleared. This cannot be undone. A grievance that has already been reviewed cannot be deleted."
        recordName={deleteTarget?.title}
        confirmText="Delete grievance"
        variant="danger"
        busy={deleteBusy}
        error={deleteError}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
