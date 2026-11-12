import { ROLE_LABELS, formatDisplayText } from '../../../utils/displayText.js';
import { RichTextBody } from '../../../components/RichText';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import ConfirmModal from '../../../components/ConfirmModal';
import { RegistrationNextStep, RegistrationStepper } from '../../../components/organizations/RegistrationFlow';
import { Button, ErrorState, PageHeader, SkeletonCard, SkeletonStat, SkeletonText, StatusBadge } from '../../../components/ui';
import { peso } from '../../../lib/format';
import { getComplianceDocuments } from '../../../services/complianceService';
import { getSystemOrganizationOverview, restoreSystemOrganization } from '../../../services/systemAdministrationService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { formatDateTime } from '../../../utils/dateTime';
import { openProtectedFile } from '../../../utils/openProtectedFile';
import { useRefetchOnReturn } from '../../../hooks/useRefetchOnReturn';
import { accreditationBadge } from './agencyStatus';

const COLLEGES_PATH = '/dashboard/super-admin/colleges';
const LINK_CLASS = 'mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 hover:underline';

function Section({ id, title, children }) {
  return (
    <section aria-labelledby={id} className="border-t border-line pt-5">
      <h2 id={id} className="text-base font-semibold text-ink">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Figure({ label, value }) {
  return <div><dt className="text-xs font-semibold text-ink-muted">{label}</dt><dd className="mt-1 text-lg font-semibold tabular-nums text-ink">{value}</dd></div>;
}

function EventList({ title, events }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {events.length ? (
        <ul className="mt-2 divide-y divide-line-soft">
          {events.map((event) => (
            <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="min-w-0"><p className="break-words text-sm font-semibold text-ink">{event.title}</p><p className="text-xs font-medium text-ink-muted">{formatDateTime(event.start_time)}{event.location ? ` · ${event.location}` : ''}</p></div>
              <StatusBadge status={event.status} />
            </li>
          ))}
        </ul>
      ) : <p className="mt-2 text-sm text-ink-muted">None.</p>}
    </div>
  );
}

function LatestDocuments({ organizationId, refreshTick }) {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openingUrl, setOpeningUrl] = useState(null);
  const [fileError, setFileError] = useState('');

  const loadEpoch = useRef(0);
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      loadEpoch.current += 1;
      setLoading(true);
    }
    const epoch = loadEpoch.current;
    try {
      const response = await getComplianceDocuments({ organization_id: organizationId, source: 'compliance', per_page: 10 });
      if (silent && epoch !== loadEpoch.current) return;
      const next = response.data?.data || [];
      setDocuments((current) => (silent && JSON.stringify(current) === JSON.stringify(next) ? current : next));
      setError('');
    } catch (cause) {
      if (silent) return;
      setError(getApiErrorMessage(cause, 'Unable to load documents.'));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [organizationId]);
  useEffect(() => { load(); }, [load]);

  const handledTick = useRef(refreshTick);
  useEffect(() => {
    if (handledTick.current === refreshTick) return;
    handledTick.current = refreshTick;
    load({ silent: true });
  }, [refreshTick, load]);

  async function openFile(document) {
    setOpeningUrl(document.open_url);
    setFileError('');
    try {
      await openProtectedFile(document.open_url);
    } catch (cause) {
      setFileError(getApiErrorMessage(cause, 'Could not open the file.'));
    } finally {
      setOpeningUrl(null);
    }
  }

  if (loading) return <SkeletonText lines={3} />;
  if (error) return <ErrorState className="py-6" description={error} onRetry={() => load()} />;
  if (!documents.length) return <p className="text-sm text-ink-muted">No documents have been submitted.</p>;

  return (
    <>
      {fileError && <p role="alert" className="mb-2 rounded-control bg-danger-tint p-3 text-sm font-medium text-danger-strong">{fileError}</p>}
      <ul className="divide-y divide-line-soft">
        {documents.map((document) => (
          <li key={`${document.source}-${document.open_url}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 break-words text-sm font-semibold text-ink">{document.item}</p>
              <p className="mt-0.5 break-words text-xs font-medium text-ink-muted">{document.file_name || 'No file name'}{document.submitted_at ? ` · ${formatDateTime(document.submitted_at)}` : ''}</p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={document.status} />
              <Button variant="secondary" size="sm" className="max-md:min-h-[42px]" leftIcon={ExternalLink} loading={openingUrl === document.open_url} disabled={!document.open_url} onClick={() => openFile(document)} aria-label={`Open ${document.file_name || document.item}`}>Open</Button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function SaoOrganizationOverviewPage() {
  const { organizationId } = useParams();
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [documentsTick, setDocumentsTick] = useState(0);

  const loadEpoch = useRef(0);
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      loadEpoch.current += 1;
      setLoading(true);
    }
    const epoch = loadEpoch.current;
    try {
      const next = await getSystemOrganizationOverview(organizationId);
      if (silent && epoch !== loadEpoch.current) return;
      setOverview((current) => (silent && JSON.stringify(current) === JSON.stringify(next) ? current : next));
      setError('');
    } catch (cause) {
      if (silent) return;
      setError(getApiErrorMessage(cause, 'Unable to load this organization.'));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [organizationId]);
  useEffect(() => { load(); }, [load]);
  useRefetchOnReturn(() => {
    setDocumentsTick((tick) => tick + 1);
    return load({ silent: true });
  });

  async function restore() {
    setRestoring(true);
    try {
      await restoreSystemOrganization(organizationId);
      setRestoreOpen(false);
      setActionError('');
      setNotice('Organization restored.');
      await load();
    } catch (cause) {
      setRestoreOpen(false);
      setNotice('');
      setActionError(getApiErrorMessage(cause, 'Could not restore the organization.'));
      if (cause?.response?.status === 409) await load();
    } finally {
      setRestoring(false);
    }
  }

  const crumbs = (label) => [{ label: 'Colleges', to: COLLEGES_PATH }, { label }];

  if (loading && !overview) {
    return <div className="space-y-5" aria-busy="true"><PageHeader title="Organization" breadcrumbs={crumbs('Organization')} /><SkeletonCard /><div className="grid gap-4 sm:grid-cols-2"><SkeletonStat /><SkeletonStat /></div></div>;
  }

  if (error || !overview) {
    return <div className="space-y-3"><PageHeader title="Organization" breadcrumbs={crumbs('Organization')} /><ErrorState title="Organization unavailable" description={error} onRetry={() => load()} /></div>;
  }

  const { organization, lifecycle, leadership = [], member_counts: members = {}, events = {}, budget = {}, compliance = {}, pending_approvals_count: pendingApprovals = 0 } = overview;
  const accreditation = accreditationBadge(compliance.accreditation_status);
  const name = formatDisplayText(organization.name);
  const universityWide = Boolean(organization.is_university_wide);
  const registration = { id: organization.id, name, lifecycle_status: lifecycle.status, review_remarks: lifecycle.review_remarks, administrators_count: members.ADMIN ?? 0, is_university_wide: universityWide };
  const registrationFinished = lifecycle.status === 'active' && (members.ADMIN ?? 0) > 0;
  const hasEvents = (events.upcoming || []).length + (events.recent || []).length > 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title={name}
        breadcrumbs={crumbs(name)}
        description={`${organization.acronym} · ${organization.college || 'No college assigned'}`}
        meta={lifecycle.status === 'active' ? undefined : <StatusBadge status={lifecycle.status} />}
        primary={lifecycle.status === 'archived' ? <Button onClick={() => setRestoreOpen(true)}>Restore organization</Button> : undefined}
      />

      {lifecycle.status === 'archived' && (
        <p role="note" className="rounded-control border border-line bg-subtle p-3 text-sm font-medium text-ink">
          Archived organizations are read-only. Restore to make changes.
          {lifecycle.archived_at && <span className="block text-xs font-medium text-ink-muted">Archived {formatDateTime(lifecycle.archived_at)}{lifecycle.archived_by ? ` by ${lifecycle.archived_by.name}` : ''}.</span>}
        </p>
      )}
      {!registrationFinished && (
        <section aria-label="Registration progress" className="space-y-3">
          <RegistrationStepper organization={registration} viewerRole="SUPER_ADMIN" />
          {lifecycle.status !== 'archived' && <RegistrationNextStep organization={registration} viewerRole="SUPER_ADMIN" />}
        </section>
      )}
      {actionError && <p role="alert" className="rounded-control bg-danger-tint p-3 text-sm font-medium text-danger-strong">{actionError}</p>}
      {notice && <p role="status" className="rounded-control bg-success-tint p-3 text-sm font-medium text-success-strong">{notice}</p>}

      {organization.description && <RichTextBody value={organization.description} className="max-w-[75ch] text-sm text-ink-muted" />}

      <div className="grid gap-5 lg:grid-cols-2">
        <Section id="leadership" title="Leadership">
          {leadership.length ? (
            <ul className="divide-y divide-line-soft">
              {leadership.map((person) => (
                <li key={`${person.school_id}-${person.role}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0"><p className="break-words text-sm font-semibold text-ink">{person.name}</p><p className="text-xs font-medium text-ink-muted">{person.position_title || ROLE_LABELS[person.role] || person.role}{person.position_title ? ` · ${ROLE_LABELS[person.role] || person.role}` : ''}</p></div>
                  {person.account_status !== 'active' && <StatusBadge status={person.account_status} />}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm font-medium text-ink-muted">{lifecycle.status === 'active' ? `No administrators or officers yet. ${universityWide ? 'Add the Admin account so the organization can sign in.' : 'The Department Head names the organization head with Give access.'}` : 'No administrators or officers yet. The first Admin account is added after SAO approves the registration.'}</p>}
        </Section>

        <Section id="members" title="Members by role">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Figure label="Students" value={members.STUDENT ?? 0} />
            <Figure label="SBO officers" value={members.SBO_OFFICER ?? 0} />
            <Figure label="Admins" value={members.ADMIN ?? 0} />
            <Figure label="Total" value={members.total ?? 0} />
          </dl>
        </Section>

        <Section id="events" title="Events">
          {hasEvents ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <EventList title="Upcoming" events={events.upcoming || []} />
              <EventList title="Recent" events={events.recent || []} />
            </div>
          ) : <p className="text-sm text-ink-muted">No events yet.</p>}
        </Section>

        <Section id="budgets" title="Approved budgets">
          {(budget.approved_budget_count ?? 0) > 0 ? (
            <>
              <dl className="grid grid-cols-2 gap-4">
                <Figure label="Allocated" value={peso(budget.allocated)} />
                <Figure label="Spent" value={peso(budget.spent)} />
                <Figure label="Income" value={peso(budget.income)} />
                <Figure label="Remaining" value={peso(budget.remaining)} />
              </dl>
              <p className="mt-3 text-xs text-ink-muted">{budget.approved_budget_count} approved {budget.approved_budget_count === 1 ? 'budget' : 'budgets'}. Only approved budgets are counted.</p>
            </>
          ) : <p className="text-sm text-ink-muted">No approved budgets yet.</p>}
        </Section>

        <Section id="compliance" title="Compliance">
          <dl className="grid grid-cols-2 gap-4">
            <div><dt className="text-xs font-semibold text-ink-muted">Accreditation</dt><dd className="mt-1"><StatusBadge label={accreditation.label} tone={accreditation.tone} /></dd></div>
            <Figure label="Documents awaiting review" value={compliance.pending_documents_count ?? 0} />
          </dl>
          <Link to="/dashboard/super-admin/compliance?tab=review" className={LINK_CLASS}>Open the review queue</Link>
        </Section>

        {pendingApprovals > 0 && (
          <Section id="pending-approvals" title="Pending approvals">
            <p className="text-sm text-ink"><span className="text-lg font-semibold tabular-nums">{pendingApprovals}</span> {pendingApprovals === 1 ? 'request is' : 'requests are'} waiting for a decision.</p>
          </Section>
        )}
      </div>

      <Section id="documents" title="Latest documents">
        <LatestDocuments organizationId={organization.id} refreshTick={documentsTick} />
        <Link to="/dashboard/super-admin/documents" className={LINK_CLASS}>View all documents</Link>
      </Section>

      <ConfirmModal open={restoreOpen} title="Restore organization" message={`Restore ${name} so it can be edited and used again?`} recordName={`Restore ${name}?`} confirmText="Restore organization" variant="primary" busy={restoring} onCancel={() => setRestoreOpen(false)} onConfirm={restore} />
    </div>
  );
}
