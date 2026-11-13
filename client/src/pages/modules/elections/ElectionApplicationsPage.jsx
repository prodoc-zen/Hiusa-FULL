import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Check, MessageSquareWarning, X } from 'lucide-react';
import ConfirmModal from '../../../components/ConfirmModal';
import Modal from '../../../components/Modal';
import TableRowActions from '../../../components/TableRowActions';
import Button from '../../../components/ui/Button';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';
import Field from '../../../components/ui/Field';
import HiusaSelect from '../../../components/ui/Select';
import StatusBadge from '../../../components/ui/StatusBadge';
import Textarea from '../../../components/ui/Textarea';
import { getApplications, reviewApplication } from '../../../services/electionService';
import { resolveAssetUrl } from '../../../utils/assetUrl';
import { getApiErrorMessage } from '../../../utils/apiError';
import { formatDateTime } from '../../../utils/dateTime';
import { formatDisplayText } from '../../../utils/displayText.js';
import { openFileErrorMessage } from '../../../utils/openFileError';
import { openProtectedFile } from '../../../utils/openProtectedFile';

const ALERT = 'rounded-control border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-strong';
const LINK = 'min-h-10 rounded-control text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800';

const STATUS = {
  draft: { label: 'Draft', tone: 'neutral' },
  pending_review: { label: 'Pending review', tone: 'warning' },
  for_revision: { label: 'For revision', tone: 'info' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};

// The two decisions that need words are written to the candidate; approving needs none.
const WRITTEN = {
  correction: { title: 'Ask for correction', label: 'Notes for the candidate', hint: 'Say which documents to replace.', confirm: 'Ask for correction' },
  reject: { title: 'Reject application', label: 'Reason for rejecting', hint: 'The candidate reads this reason.', confirm: 'Reject' },
};

function yearLevelText(application) {
  const level = application.user?.year_level;
  if (application.year_level_missing || level === null || level === undefined || level === '') return 'Year level not on record';
  return /^\d+$/.test(String(level)) ? `Year ${level}` : String(level);
}

export default function ElectionApplicationsPage() {
  const { election, role, refreshElection } = useOutletContext();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [statusFilter, setStatusFilter] = useState('all');
  const [pending, setPending] = useState(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fileError, setFileError] = useState('');

  const electionId = election?.id;

  const load = useCallback(async () => {
    const result = await getApplications(electionId);
    return Array.isArray(result?.data) ? result.data : [];
  }, [electionId]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setLoadError('');
      try {
        const list = await load();
        if (!cancelled) setRows(list);
      } catch {
        if (!cancelled) {
          setRows([]);
          setLoadError('Applications did not load.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (electionId) run();

    return () => {
      cancelled = true;
    };
  }, [electionId, load, retryKey]);

  const filtered = useMemo(() => (
    statusFilter === 'all' ? rows : rows.filter((application) => application.status === statusFilter)
  ), [rows, statusFilter]);

  if (!election) {
    return <EmptyState title="Election not found" description="Go back and choose an election." />;
  }

  const isAdmin = role === 'ADMIN';
  const screening = election.phase === 'screening';
  const canReview = isAdmin && screening;
  const filtersActive = statusFilter !== 'all';
  const clearFilters = () => setStatusFilter('all');

  const closeReview = () => {
    if (busy) return;
    setPending(null);
    setNotes('');
    setError('');
  };

  const openReview = (application, decision) => {
    setPending({ application, decision });
    setNotes('');
    setError('');
  };

  const submitReview = async () => {
    if (!pending) return;
    const { application, decision } = pending;
    setBusy(true);
    setError('');
    try {
      await reviewApplication(election.id, application.id, decision === 'approve' ? { decision } : { decision, notes: notes.trim() });
      setPending(null);
      setNotes('');
      setRows(await load());
      await refreshElection?.();
    } catch (reviewError) {
      setError(getApiErrorMessage(reviewError, 'Unable to save this decision.'));
    } finally {
      setBusy(false);
    }
  };

  const openFile = async (url) => {
    setFileError('');
    try {
      await openProtectedFile(url);
    } catch (openError) {
      setFileError(openFileErrorMessage(openError));
    }
  };

  const columns = [
    {
      key: 'candidate',
      header: 'Candidate',
      render: (application) => (
        <div className="text-left">
          <p className="font-medium">{formatDisplayText(application.user?.name) || 'Unknown candidate'}</p>
          <p className="text-xs text-ink-muted">
            <span>{application.user?.school_id}</span>
            {' '}
            <span>{yearLevelText(application)}</span>
          </p>
        </div>
      ),
    },
    { key: 'position', header: 'Position', render: (application) => formatDisplayText(application.position?.title) || 'Unknown' },
    {
      key: 'partylist',
      header: 'Party list',
      render: (application) => (application.partylist
        ? (
          <span className="inline-flex items-center gap-2">
            {application.partylist.color && <span aria-hidden="true" className="inline-block size-2.5 shrink-0 rounded-full" style={{ backgroundColor: application.partylist.color }} />}
            <span>{formatDisplayText(application.partylist.name)}</span>
          </span>
        )
        : 'Independent'),
    },
    // Documents are private to the candidate and the Admin; officers only follow the progress.
    ...(isAdmin ? [{
      key: 'documents',
      header: 'Documents',
      render: (application) => (
        <div className="flex flex-wrap gap-x-3 text-left">
          {application.photo_url && <a href={resolveAssetUrl(application.photo_url)} target="_blank" rel="noreferrer" className={`${LINK} leading-10`}>Photo</a>}
          {application.coc_open_url && <button type="button" className={LINK} onClick={() => openFile(application.coc_open_url)}>COC</button>}
          {application.credentials_open_url && <button type="button" className={LINK} onClick={() => openFile(application.credentials_open_url)}>Credentials</button>}
        </div>
      ),
    }] : []),
    {
      key: 'status',
      header: 'Status',
      render: (application) => {
        const status = STATUS[application.status] || { label: formatDisplayText(application.status), tone: 'neutral' };
        return (
          <div className="text-left">
            <StatusBadge label={status.label} tone={status.tone} />
            {application.review_notes && ['for_revision', 'rejected'].includes(application.status) && (
              <p className="mt-1 max-w-prose text-xs text-ink-muted-strong">{application.review_notes}</p>
            )}
          </div>
        );
      },
    },
  ];

  const filters = (rows.length > 0 || filtersActive) && (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <Field label="Status" className="w-full sm:w-64">
        <HiusaSelect value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="all">All</option>
          {Object.entries(STATUS).filter(([key]) => key !== 'draft').map(([key, status]) => <option key={key} value={key}>{status.label}</option>)}
        </HiusaSelect>
      </Field>
      {filtersActive && <button type="button" onClick={clearFilters} className={LINK}>Clear</button>}
    </div>
  );

  const emptyState = rows.length > 0
    ? <EmptyState kind="filtered" title="No applications with this status" description="Choose another status to see more." onClearFilters={clearFilters} />
    : <EmptyState title="No applications yet" description="Applications appear here once students file their candidacy." />;

  let line = null;
  if (!isAdmin) {
    line = 'The Admin screens the applications.';
  } else if (!screening) {
    line = election.screening_starts_at && election.screening_ends_at
      ? `Screening runs from ${formatDateTime(election.screening_starts_at)} to ${formatDateTime(election.screening_ends_at)}.`
      : 'Screening runs after filing closes.';
  }

  const written = pending ? WRITTEN[pending.decision] : null;
  const subject = pending ? `${formatDisplayText(pending.application.user?.name)}, ${formatDisplayText(pending.application.position?.title)}` : '';

  return (
    <div className="space-y-4">
      {line && <p className="text-sm text-ink-muted-strong">{line}</p>}
      {fileError && <p role="alert" className={ALERT}>{fileError}</p>}

      <DataTable
        caption={`Applications for ${formatDisplayText(election.title)}`}
        columns={columns}
        rows={filtered}
        loading={loading}
        error={loadError || null}
        onRetry={() => setRetryKey((key) => key + 1)}
        filters={filters || null}
        filtersActive={filtersActive}
        onClearFilters={clearFilters}
        emptyState={emptyState}
        actions={canReview ? (application) => (application.status === 'pending_review' ? (
          <TableRowActions subject={formatDisplayText(application.user?.name)} actions={[
            { label: 'Approve', icon: Check, onClick: () => openReview(application, 'approve') },
            { label: 'Ask for correction', icon: MessageSquareWarning, onClick: () => openReview(application, 'correction') },
            { label: 'Reject', icon: X, danger: true, onClick: () => openReview(application, 'reject') },
          ]} />
        ) : null) : undefined}
      />

      <ConfirmModal
        open={pending?.decision === 'approve'}
        title="Approve application"
        message={`${subject} joins the official list of candidates.`}
        confirmText="Approve"
        variant="primary"
        busy={busy}
        error={error}
        onCancel={closeReview}
        onConfirm={submitReview}
      />

      <Modal
        open={Boolean(written)}
        title={written?.title || ''}
        description={subject}
        onClose={busy ? undefined : closeReview}
        closeOnBackdrop={false}
        maxWidth="max-w-md"
        footer={(
          <>
            <Button variant="secondary" onClick={closeReview} disabled={busy}>Cancel</Button>
            <Button variant={pending?.decision === 'reject' ? 'danger' : 'primary'} onClick={submitReview} loading={busy} disabled={!notes.trim()}>{written?.confirm}</Button>
          </>
        )}
      >
        <div className="space-y-3">
          <Field label={written?.label || ''} required hint={written?.hint}>
            <Textarea rows={4} maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
          {error && <p role="alert" className={ALERT}>{error}</p>}
        </div>
      </Modal>
    </div>
  );
}
