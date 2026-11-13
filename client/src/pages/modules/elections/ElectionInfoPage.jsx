import { useCallback, useEffect, useId, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import CandidacyForm from '../../../components/elections/CandidacyForm';
import SlateForm from '../../../components/elections/SlateForm';
import { electionStatusChip } from '../../../components/elections/electionFlow';
import ConfirmModal from '../../../components/ConfirmModal';
import FeedbackToast from '../../../components/FeedbackToast';
import { RichTextBody } from '../../../components/RichText';
import Button from '../../../components/ui/Button';
import ErrorState from '../../../components/ui/ErrorState';
import StatusBadge from '../../../components/ui/StatusBadge';
import {
  addSlateMember,
  applicationFileUrl,
  createSlate,
  fileApplication,
  getElectionDetails,
  getMyApplications,
  submitApplication,
  submitSlate,
  updateApplication,
  withdrawApplication,
} from '../../../services/electionService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { resolveAssetUrl } from '../../../utils/assetUrl';
import { formatDateTime } from '../../../utils/dateTime';
import { formatDisplayText } from '../../../utils/displayText.js';
import { openFileErrorMessage } from '../../../utils/openFileError';
import { openProtectedFile } from '../../../utils/openProtectedFile';

const ALERT = 'rounded-control border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-strong';

const STATUS_WORDS = {
  draft: { label: 'Draft', tone: 'neutral' },
  pending_review: { label: 'Pending review', tone: 'warning' },
  for_revision: { label: 'For revision', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};
const WITHDRAWABLE = ['draft', 'pending_review', 'for_revision', 'approved'];
// A candidacy can be withdrawn until voting opens.
const WITHDRAW_PHASES = ['scheduled', 'filing', 'screening', 'campaign'];
const CANDIDATE_PHASES = ['campaign', 'voting', 'canvassing', 'runoff', 'tie_resolution', 'completed'];

const range = (start, end) => [start, end].filter(Boolean).map((value) => formatDateTime(value)).join(' to ');
// The server sends flat names (user_name, position_title); the nested shapes are read too.
const personName = (item) => item?.user?.name ?? item?.user_name ?? '';
const positionTitle = (item) => item?.position?.title ?? item?.position_title ?? '';
const candidateName = (candidate) => `${candidate.user?.first_name ?? ''} ${candidate.user?.last_name ?? ''}`.trim() || candidate.name || '';

function Section({ title, children }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-3 border-t border-line pt-5">
      <h2 id={id} className="text-base font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

function positionLine(position) {
  const seats = position.max_winners ?? 1;
  const levels = Array.isArray(position.eligible_year_levels) && position.eligible_year_levels.length > 0
    ? `Year levels: ${position.eligible_year_levels.join(', ')}`
    : 'All year levels';
  return [
    `${position.title}: ${seats} ${seats === 1 ? 'seat' : 'seats'}`,
    position.is_executive ? 'Executive' : 'Not executive',
    levels,
    position.other_qualifications,
  ].filter(Boolean).join(', ');
}

export default function ElectionInfoPage() {
  const outlet = useOutletContext();
  const [searchParams] = useSearchParams();
  const recordId = searchParams.get('record');
  const [fetched, setFetched] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [mine, setMine] = useState({ application: null, slate: null });
  const [accepted, setAccepted] = useState(false);
  const [choice, setChoice] = useState(null);
  const [withdrawing, setWithdrawing] = useState(null);
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const [withdrawError, setWithdrawError] = useState('');
  const [fileError, setFileError] = useState('');
  const [feedback, setFeedback] = useState({ open: false, type: 'success', message: '' });

  // The workspace supplies the election; opened on its own, the page loads it from the record in the URL.
  const election = outlet?.election ?? fetched;
  const electionId = election?.id;
  const refreshElection = outlet?.refreshElection;

  useEffect(() => {
    if (outlet?.election || !recordId) return undefined;
    let cancelled = false;
    setLoadFailed(false);
    getElectionDetails(recordId)
      .then((loaded) => { if (!cancelled) setFetched(loaded); })
      .catch(() => { if (!cancelled) setLoadFailed(true); });
    return () => { cancelled = true; };
  }, [outlet?.election, recordId, reloadKey]);

  const loadMine = useCallback(async () => {
    if (!electionId) return;
    try {
      const loaded = await getMyApplications(electionId);
      setMine({ application: loaded?.application ?? null, slate: loaded?.slate ?? null });
    } catch {
      setMine({ application: null, slate: null });
    }
  }, [electionId]);

  useEffect(() => { loadMine(); }, [loadMine]);

  // After a filing request: reload the person's own filing and the workspace counts.
  const afterChange = async (message) => {
    await loadMine();
    refreshElection?.();
    if (message) setFeedback({ open: true, type: 'success', message });
  };

  if (!election) {
    if (loadFailed) return <ErrorState title="Could not load this election" description="Check your connection and try again." onRetry={() => setReloadKey((key) => key + 1)} />;
    return <p role="status" className="text-sm text-ink-muted">Loading election information</p>;
  }

  const phase = election.phase;
  const chip = electionStatusChip(election);
  const positions = (election.positions ?? []).filter((position) => position.is_active !== false);
  const { application, slate } = mine;
  const filingOpen = phase === 'filing';
  const canFile = filingOpen && !slate && (!application || application.status === 'withdrawn');
  const canWithdraw = WITHDRAW_PHASES.includes(phase);
  const dates = [
    ['Filing', range(election.filing_starts_at, election.filing_ends_at)],
    ['Screening', range(election.screening_starts_at, election.screening_ends_at)],
    ['Campaign', range(election.campaign_starts_at, election.campaign_ends_at)],
    ['Voting', range(election.start_time, election.end_time)],
    ['Results', range(election.results_publish_at)],
  ].filter(([, value]) => value);

  const openDocument = async (applicationId, kind) => {
    setFileError('');
    try {
      await openProtectedFile(applicationFileUrl(electionId, applicationId, kind));
    } catch (failure) {
      setFileError(openFileErrorMessage(failure));
    }
  };

  const fileIndividual = async (payload) => {
    if (application?.status === 'draft') {
      const { submit, ...changes } = payload;
      await updateApplication(electionId, application.id, changes);
      if (submit) await submitApplication(electionId, application.id);
      await afterChange(submit ? 'Candidacy submitted for screening.' : 'Draft saved.');
      return;
    }
    await fileApplication(electionId, payload);
    setChoice(null);
    await afterChange(payload.submit ? 'Candidacy submitted for screening.' : 'Draft saved.');
  };

  const replaceDocuments = async (applicationId, payload) => {
    await updateApplication(electionId, applicationId, payload);
    await afterChange('Documents replaced. The application is back in screening.');
  };

  const confirmWithdraw = async () => {
    setWithdrawBusy(true);
    setWithdrawError('');
    try {
      await withdrawApplication(electionId, withdrawing.id);
      setWithdrawing(null);
      await afterChange('Candidacy withdrawn.');
    } catch (failure) {
      setWithdrawError(getApiErrorMessage(failure, 'Could not withdraw this candidacy.'));
    } finally {
      setWithdrawBusy(false);
    }
  };

  const withdrawButton = (item, name) => (
    canWithdraw && WITHDRAWABLE.includes(item.status)
      ? <Button variant="secondary" size="sm" onClick={() => { setWithdrawError(''); setWithdrawing({ id: item.id, name }); }}>Withdraw</Button>
      : null
  );

  const statusBlock = (item) => {
    const word = STATUS_WORDS[item.status] ?? { label: String(item.status ?? ''), tone: 'neutral' };
    const showNotes = ['for_revision', 'rejected'].includes(item.status) && item.review_notes;
    return (
      <>
        <StatusBadge label={word.label} tone={word.tone} />
        {showNotes && <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{item.review_notes}</p>}
      </>
    );
  };

  const candidates = election.candidates ?? [];
  const candidateGroups = positions
    .map((position) => ({ position, rows: candidates.filter((candidate) => (candidate.position_id ?? candidate.position?.id) === position.id) }))
    .filter((group) => group.rows.length > 0);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-ink">{formatDisplayText(election.title)}</h2>
          <StatusBadge label={chip.label} tone={chip.tone} />
        </div>
        {dates.length > 0 && (
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
            {dates.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="font-medium text-ink">{label}</dt>
                <dd className="text-ink-muted-strong">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <Section title="Qualifications">
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink">
          <li>Be a member of this organization.</li>
          {election.min_units != null && <li>Minimum units: {election.min_units}</li>}
          {election.min_gpa != null && <li>Minimum GPA: {election.min_gpa}</li>}
          <li>Be in good moral standing.</li>
          <li>Fourth year students cannot run for executive positions.</li>
          <li>Required documents: formal photo, Certificate of Candidacy and credentials.</li>
        </ul>
        <ul className="space-y-1 text-sm text-ink">
          {positions.map((position) => <li key={position.id}>{positionLine(position)}</li>)}
        </ul>
      </Section>

      <Section title="Official rules">
        <p className="text-xs text-ink-muted">Version {election.rules_version ?? 0}</p>
        <div tabIndex={0} className="max-h-60 overflow-y-auto whitespace-pre-wrap rounded-control border border-line bg-surface px-3 py-2 text-sm text-ink">
          {election.rules || 'No rules have been published for this election.'}
        </div>
        {(canFile || (filingOpen && slate)) && (
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} className="size-4 accent-brand-700" />
            I have read and accept the official rules
          </label>
        )}
      </Section>

      {(canFile || (filingOpen && slate)) && (
        <Section title="File your candidacy">
          {canFile && !choice && (
            <div className="flex flex-wrap gap-2">
              <Button disabled={!accepted} onClick={() => setChoice('individual')}>File as an individual</Button>
              <Button variant="secondary" disabled={!accepted} onClick={() => setChoice('slate')}>File a party list</Button>
            </div>
          )}
          {canFile && choice === 'individual' && (
            <>
              <CandidacyForm positions={positions} disabled={!accepted} onSave={fileIndividual} onSubmit={fileIndividual} />
              <Button variant="ghost" size="sm" onClick={() => setChoice(null)}>Cancel</Button>
            </>
          )}
          {(slate || (canFile && choice === 'slate')) && (
            <SlateForm
              positions={positions}
              slate={slate}
              disabled={!accepted}
              onCreate={async (payload) => {
                await createSlate(electionId, payload);
                setChoice(null);
                await afterChange('Party list created. Add a member to each position you want to fill.');
              }}
              onAddMember={async (payload) => {
                await addSlateMember(electionId, slate.id, payload);
                await afterChange('Member added.');
              }}
              onSubmitSlate={async () => {
                const result = await submitSlate(electionId, slate.id);
                await afterChange(result?.message || 'Party list submitted for screening.');
              }}
            />
          )}
        </Section>
      )}

      {(application || slate) && (
        <Section title="My candidacy">
          {fileError && <p role="alert" className={ALERT}>{fileError}</p>}
          {application && (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-ink">{positionTitle(application)}</p>
              <div>{statusBlock(application)}</div>
              <div className="flex flex-wrap gap-2">
                {application.has_coc && <Button variant="ghost" size="sm" onClick={() => openDocument(application.id, 'coc')}>Open Certificate of Candidacy</Button>}
                {application.has_credentials && <Button variant="ghost" size="sm" onClick={() => openDocument(application.id, 'credentials')}>Open Credentials</Button>}
              </div>
              {application.status === 'draft' && filingOpen && (
                <CandidacyForm positions={positions} initial={application} onSave={fileIndividual} onSubmit={fileIndividual} />
              )}
              {application.status === 'for_revision' && (
                <CandidacyForm mode="documents" onSubmit={(payload) => replaceDocuments(application.id, payload)} />
              )}
              {withdrawButton(application, personName(application) || positionTitle(application))}
            </div>
          )}
          {slate && (
            <ul className="space-y-4">
              {(slate.members ?? []).map((member) => (
                <li key={member.id} aria-label={personName(member)} className="space-y-2 border-b border-line pb-4 last:border-b-0">
                  <p className="text-sm text-ink"><span className="font-semibold">{personName(member)}</span>, {positionTitle(member)}</p>
                  <div>{statusBlock(member)}</div>
                  {member.status === 'for_revision' && (
                    <CandidacyForm mode="documents" onSubmit={(payload) => replaceDocuments(member.id, payload)} />
                  )}
                  {withdrawButton(member, personName(member))}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {CANDIDATE_PHASES.includes(phase) && (
        <Section title="Official candidates">
          {candidateGroups.length === 0 && <p className="text-sm text-ink-muted">No candidates have been approved yet.</p>}
          {candidateGroups.map(({ position, rows }) => (
            <div key={position.id} role="group" aria-label={position.title} className="space-y-3">
              <h3 className="text-sm font-semibold text-ink">{position.title}</h3>
              <ul className="space-y-4">
                {rows.map((candidate) => (
                  <li key={candidate.id} className="flex gap-3">
                    {candidate.image_url && <img src={resolveAssetUrl(candidate.image_url)} alt="" className="size-16 shrink-0 rounded-lg border border-line object-cover" />}
                    <div className="min-w-0 space-y-1 text-sm">
                      <p className="font-semibold text-ink">{candidateName(candidate)}</p>
                      <p className="flex items-center gap-2 text-ink-muted-strong">
                        {candidate.partylist?.color && <span aria-hidden="true" className="size-3 rounded-full border border-line" style={{ backgroundColor: candidate.partylist.color }} />}
                        <span>{candidate.partylist?.name || 'Independent'}</span>
                      </p>
                      {candidate.partylist?.motto && <p className="text-ink-muted-strong">{candidate.partylist.motto}</p>}
                      {candidate.partylist?.banner_url && <img src={resolveAssetUrl(candidate.partylist.banner_url)} alt={`${candidate.partylist.name} banner`} className="h-16 w-40 rounded-control border border-line object-cover" />}
                      {candidate.platform && <RichTextBody value={candidate.platform} className="text-ink" />}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Section>
      )}

      <ConfirmModal
        open={Boolean(withdrawing)}
        title="Withdraw candidacy"
        message={`Withdraw ${withdrawing?.name || 'this candidacy'} from the election? It leaves the official list.`}
        confirmText="Withdraw"
        busy={withdrawBusy}
        error={withdrawError}
        onCancel={() => setWithdrawing(null)}
        onConfirm={confirmWithdraw}
      />
      <FeedbackToast feedback={feedback} onClose={() => setFeedback((current) => ({ ...current, open: false }))} />
    </div>
  );
}
