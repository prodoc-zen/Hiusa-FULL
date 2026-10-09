import { ROLE_LABELS, formatDisplayText } from '../../../utils/displayText.js';
import { RichTextBody } from '../../../components/RichText';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Building2, ExternalLink, FileText } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import ConfirmModal from '../../../components/ConfirmModal';
import { Button, ErrorState, SkeletonCard, SkeletonStat, StatusBadge } from '../../../components/ui';
import { peso } from '../../../lib/format';
import { getComplianceDocuments } from '../../../services/complianceService';
import { getSystemOrganizationOverview, restoreSystemOrganization } from '../../../services/systemAdministrationService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { resolveAssetUrl } from '../../../utils/assetUrl';
import { formatDateTime } from '../../../utils/dateTime';
import { openProtectedFile } from '../../../utils/openProtectedFile';
import { accreditationBadge } from './agencyStatus';

const AGENCY_PATH = '/dashboard/super-admin/agency';

function Section({ id, title, children }) {
  return (
    <section aria-labelledby={id} className="rounded-card border border-line bg-surface p-4 sm:p-5">
      <h2 id={id} className="text-base font-bold text-ink">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Figure({ label, value }) {
  return <div><dt className="text-xs font-semibold text-ink-muted">{label}</dt><dd className="mt-1 text-lg font-extrabold tabular-nums text-ink">{value}</dd></div>;
}

function EventList({ title, events }) {
  return (
    <div>
      <h3 className="text-sm font-bold text-ink">{title}</h3>
      {events.length ? (
        <ul className="mt-2 divide-y divide-line-soft">
          {events.map((event) => (
            <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="min-w-0"><p className="break-words text-sm font-bold text-ink">{event.title}</p><p className="text-xs font-medium text-ink-muted">{formatDateTime(event.start_time)}{event.location ? ` · ${event.location}` : ''}</p></div>
              <StatusBadge status={event.status} />
            </li>
          ))}
        </ul>
      ) : <p className="mt-2 text-sm font-medium text-ink-muted">None.</p>}
    </div>
  );
}

function LatestDocuments({ organizationId }) {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openingUrl, setOpeningUrl] = useState(null);
  const [fileError, setFileError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getComplianceDocuments({ organization_id: organizationId, source: 'compliance', per_page: 10 });
      setDocuments(response.data?.data || []);
      setError('');
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Unable to load documents.'));
    } finally {
      setLoading(false);
    }
  }, [organizationId]);
  useEffect(() => { load(); }, [load]);

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

  if (loading) return <p role="status" className="text-sm text-ink-muted">Loading documents...</p>;
  if (error) return <ErrorState className="py-6" description={error} onRetry={load} />;
  if (!documents.length) return <p className="text-sm font-medium text-ink-muted">No documents have been submitted.</p>;

  return (
    <>
      {fileError && <p role="alert" className="mb-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">{fileError}</p>}
      <ul className="divide-y divide-line-soft">
        {documents.map((document) => (
          <li key={`${document.source}-${document.open_url}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 break-words text-sm font-bold text-ink"><FileText size={15} className="shrink-0 text-brand-700" aria-hidden="true" />{document.item}</p>
              <p className="mt-0.5 break-words text-xs font-medium text-ink-muted">{document.file_name || 'No file name'}{document.submitted_at ? ` · ${formatDateTime(document.submitted_at)}` : ''}</p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={document.status} />
              <Button variant="secondary" size="sm" leftIcon={ExternalLink} loading={openingUrl === document.open_url} disabled={!document.open_url} onClick={() => openFile(document)} aria-label={`Open ${document.file_name || document.item}`}>Open</Button>
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setOverview(await getSystemOrganizationOverview(organizationId));
      setError('');
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Unable to load this organization.'));
    } finally {
      setLoading(false);
    }
  }, [organizationId]);
  useEffect(() => { load(); }, [load]);

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

  const back = <Link to={AGENCY_PATH} className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-brand-700 hover:underline"><ArrowLeft size={16} aria-hidden="true" />Back to agency overview</Link>;

  if (loading && !overview) {
    return <div className="space-y-5" aria-busy="true">{back}<SkeletonCard /><div className="grid gap-4 sm:grid-cols-2"><SkeletonStat /><SkeletonStat /></div></div>;
  }

  if (error || !overview) {
    return <div className="space-y-3">{back}<ErrorState title="Organization unavailable" description={error} onRetry={load} /></div>;
  }

  const { organization, lifecycle, leadership = [], member_counts: members = {}, events = {}, budget = {}, compliance = {}, pending_approvals_count: pendingApprovals = 0 } = overview;
  const accreditation = accreditationBadge(compliance.accreditation_status);
  const name = formatDisplayText(organization.name);

  return (
    <div className="space-y-5">
      {back}

      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-[#E6F6FD] text-[#0F2F62]" style={{ borderLeft: `4px solid ${organization.color || '#0B8ED0'}` }}>
            {organization.logo_url ? <img src={resolveAssetUrl(organization.logo_url)} alt="" className="h-full w-full object-cover" /> : <Building2 size={22} aria-hidden="true" />}
          </span>
          <div className="min-w-0">
            <h1 className="break-words text-[28px] font-extrabold leading-tight text-ink">{name}</h1>
            <p className="mt-1 text-sm font-medium text-ink-muted">{organization.acronym} · {organization.college || 'No college assigned'}</p>
            <div className="mt-2"><StatusBadge status={lifecycle.status} /></div>
          </div>
        </div>
        {lifecycle.status === 'archived' && <Button onClick={() => setRestoreOpen(true)}>Restore organization</Button>}
      </header>

      {lifecycle.status === 'archived' && (
        <p role="note" className="rounded-lg border border-line bg-subtle p-3 text-sm font-semibold text-ink">
          Archived organizations are read-only. Restore to make changes.
          {lifecycle.archived_at && <span className="block text-xs font-medium text-ink-muted">Archived {formatDateTime(lifecycle.archived_at)}{lifecycle.archived_by ? ` by ${lifecycle.archived_by.name}` : ''}.</span>}
        </p>
      )}
      {lifecycle.status === 'pending' && (
        <p role="note" className="rounded-lg border border-line bg-warning-tint p-3 text-sm font-semibold text-ink">
          This registration is waiting for SAO review. <Link to="/dashboard/super-admin/organizations?status=pending" className="font-bold text-brand-700 underline">Open pending reviews</Link>
        </p>
      )}
      {lifecycle.status === 'returned' && (
        <p role="note" className="rounded-lg border border-line bg-subtle p-3 text-sm text-ink"><span className="block text-xs font-bold text-ink-muted">Returned with remarks</span>{lifecycle.review_remarks || 'No remarks were recorded.'}</p>
      )}
      {actionError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{actionError}</p>}
      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{notice}</p>}

      {organization.description && <RichTextBody value={organization.description} className="max-w-[75ch] text-sm text-ink-muted" />}

      <div className="grid gap-5 lg:grid-cols-2">
        <Section id="leadership" title="Leadership">
          {leadership.length ? (
            <ul className="divide-y divide-line-soft">
              {leadership.map((person) => (
                <li key={`${person.school_id}-${person.role}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0"><p className="break-words text-sm font-bold text-ink">{person.name}</p><p className="text-xs font-medium text-ink-muted">{person.position_title || ROLE_LABELS[person.role] || person.role}{person.position_title ? ` · ${ROLE_LABELS[person.role] || person.role}` : ''}</p></div>
                  <StatusBadge status={person.account_status} />
                </li>
              ))}
            </ul>
          ) : <p className="text-sm font-medium text-ink-muted">No administrators or officers yet.</p>}
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
          <div className="grid gap-4 sm:grid-cols-2">
            <EventList title="Upcoming" events={events.upcoming || []} />
            <EventList title="Recent" events={events.recent || []} />
          </div>
        </Section>

        <Section id="budgets" title="Approved budgets">
          <dl className="grid grid-cols-2 gap-4">
            <Figure label="Allocated" value={peso(budget.allocated)} />
            <Figure label="Spent" value={peso(budget.spent)} />
            <Figure label="Income" value={peso(budget.income)} />
            <Figure label="Remaining" value={peso(budget.remaining)} />
          </dl>
          <p className="mt-3 text-xs font-medium text-ink-muted">{budget.approved_budget_count ?? 0} approved {budget.approved_budget_count === 1 ? 'budget' : 'budgets'}. Only approved budgets are counted.</p>
        </Section>

        <Section id="compliance" title="Compliance">
          <dl className="grid grid-cols-2 gap-4">
            <div><dt className="text-xs font-semibold text-ink-muted">Accreditation</dt><dd className="mt-1"><StatusBadge label={accreditation.label} tone={accreditation.tone} /></dd></div>
            <Figure label="Documents awaiting review" value={compliance.pending_documents_count ?? 0} />
          </dl>
        </Section>

        <Section id="pending-approvals" title="Pending approvals">
          <p className="text-sm font-medium text-ink"><span className="text-lg font-extrabold tabular-nums">{pendingApprovals}</span> {pendingApprovals === 1 ? 'request is' : 'requests are'} waiting for a decision.</p>
        </Section>
      </div>

      <Section id="documents" title="Latest documents"><LatestDocuments organizationId={organization.id} /></Section>

      <ConfirmModal open={restoreOpen} title="Restore organization" message={`Restore ${name} so it can be edited and used again?`} recordName={`Restore ${name}?`} confirmText="Restore organization" variant="primary" busy={restoring} onCancel={() => setRestoreOpen(false)} onConfirm={restore} />
    </div>
  );
}
