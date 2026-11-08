import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, SegmentedControl, Select, SkeletonTable, StatusBadge } from '../../../components/ui';
import { getRecords } from '../../../services/recordsService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { openProtectedFile } from '../../../utils/openProtectedFile';
import { manilaDate } from '../../../lib/format';
import { getStoredRole } from '../../../lib/pageMeta';
import notify from '../../../lib/notify';

const ORDINAL = { 1: '1st semester', 2: '2nd semester' };

function Row({ title, detail, badge, children, action }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line-soft py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="break-words text-sm font-medium text-ink">{title}</p>
        {detail && <p className="mt-0.5 break-words text-xs text-ink-muted">{detail}</p>}
        {children}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {badge}
        {action}
      </div>
    </li>
  );
}

// One captioned section per record type. A type with nothing in the period collapses to one muted line.
function Section({ id, title, count, empty, children }) {
  if (count === 0) {
    return (
      <section aria-label={title} className="py-3 first:pt-0">
        <p className="text-sm text-ink-muted">{empty}</p>
      </section>
    );
  }
  return (
    <section aria-labelledby={id} className="py-4 first:pt-0">
      <h3 id={id} className="flex items-baseline gap-2 text-sm font-semibold text-ink">
        {title}
        <span className="text-xs font-normal text-ink-muted">{count}</span>
      </h3>
      <ul className="mt-1">{children}</ul>
    </section>
  );
}

function OpenButton({ url, name, onOpen }) {
  if (!url) return null;
  return (
    <Button variant="secondary" size="sm" leftIcon={ExternalLink} onClick={() => onOpen(url)} aria-label={`Open ${name}`}>
      Open
    </Button>
  );
}

function FileRows({ files, onOpen }) {
  return files.map((file) => (
    <Row
      key={`${file.source}-${file.id}`}
      title={file.item || file.file_name}
      detail={[file.file_name !== file.item ? file.file_name : null, file.parent_title, file.submitted_at ? manilaDate(file.submitted_at) : null].filter(Boolean).join(' · ')}
      badge={file.status ? <StatusBadge status={file.status} /> : null}
      action={<OpenButton url={file.open_url} name={file.file_name || file.item} onOpen={onOpen} />}
    />
  ));
}

function OrganizationRecords({ organization, onOpen }) {
  const { documents } = organization;
  return (
    <Card
      title={organization.name}
      description={[organization.acronym, organization.college].filter(Boolean).join(' · ')}
      actions={organization.status.lifecycle_status === 'active' ? null : <StatusBadge status={organization.status.lifecycle_status} />}
      className="min-w-0"
    >
      {!organization.status.recorded && (
        <p className="mb-4 rounded-control border border-line bg-subtle px-3 py-2 text-sm text-ink-muted">
          Status and officers were not recorded for this period. Files, events and elections below are complete.
        </p>
      )}
      <div className="divide-y divide-line">
        <Section id="records-officers" title="Officers" count={organization.officers.length} empty="No officers on record for this period.">
          {organization.officers.map((officer) => (
            <Row key={`${officer.school_id}-${officer.role}`} title={officer.name} detail={officer.position_title || (officer.role === 'ADMIN' ? 'Organization head' : 'Officer')} />
          ))}
        </Section>
        <Section id="records-applications" title="Applications" count={organization.applications.length} empty="No applications in this period.">
          {organization.applications.map((application) => (
            <Row
              key={application.id}
              title={application.name}
              detail={application.submitted_at ? `Filed ${manilaDate(application.submitted_at)}` : null}
              badge={<StatusBadge status={application.status} />}
            >
              {application.documents.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1.5">
                  {application.documents.map((document) => (
                    <li key={document.id} className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                      <span className="break-words">{document.item || document.file_name}</span>
                      <OpenButton url={document.open_url} name={document.file_name || document.item} onOpen={onOpen} />
                    </li>
                  ))}
                </ul>
              )}
            </Row>
          ))}
        </Section>
        <Section id="records-compliance" title="Compliance files" count={documents.compliance.length} empty="No compliance files in this period.">
          <FileRows files={documents.compliance} onOpen={onOpen} />
        </Section>
        <Section id="records-event-files" title="Event files" count={documents.event_files.length} empty="No event files in this period.">
          <FileRows files={documents.event_files} onOpen={onOpen} />
        </Section>
        <Section id="records-reports" title="Financial reports" count={documents.financial_reports.length} empty="No financial reports in this period.">
          <FileRows files={documents.financial_reports} onOpen={onOpen} />
        </Section>
        <Section id="records-events" title="Events" count={organization.events.length} empty="No events in this period.">
          {organization.events.map((event) => (
            <Row
              key={event.id}
              title={event.title}
              detail={[event.start_time ? manilaDate(event.start_time) : null, event.location].filter(Boolean).join(' · ')}
              badge={<StatusBadge status={event.status} />}
            />
          ))}
        </Section>
        <Section id="records-elections" title="Elections" count={organization.elections.length} empty="No elections in this period.">
          {organization.elections.map((election) => (
            <Row
              key={election.id}
              title={election.title}
              detail={election.end_time ? `Closed ${manilaDate(election.end_time)}` : null}
              badge={<StatusBadge status={election.status} />}
            >
              {election.winners && election.winners.some((position) => position.winners.length > 0) && (
                <ul className="mt-2 flex flex-col gap-1 text-xs text-ink-muted">
                  {election.winners.filter((position) => position.winners.length > 0).map((position) => (
                    <li key={position.position}>
                      <span className="font-medium text-ink">{position.position}:</span>{' '}
                      {position.winners.map((winner) => `${winner.name} (${winner.votes} ${winner.votes === 1 ? 'vote' : 'votes'})`).join(', ')}
                    </li>
                  ))}
                </ul>
              )}
            </Row>
          ))}
        </Section>
      </div>
    </Card>
  );
}

function OrganizationList({ organizations, selectedId, onSelect, search, onSearch }) {
  return (
    <Card className="min-w-0 lg:sticky lg:top-4 lg:self-start" bodyClassName="p-0">
      <div className="border-b border-line p-4">
        <Field label="Find an organization">
          <Input type="search" value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Name or acronym" />
        </Field>
      </div>
      {organizations.length === 0 ? (
        <EmptyState
          kind={search ? 'filtered' : 'first-run'}
          query={search}
          title="No organizations in this period"
          description="Organizations show up here once they are registered."
        />
      ) : (
        <ul className="max-h-[60vh] overflow-y-auto">
          {organizations.map((organization) => (
            <li key={organization.id} className="border-b border-line-soft last:border-b-0">
              <button
                type="button"
                onClick={() => onSelect(organization.id)}
                aria-current={organization.id === selectedId ? 'true' : undefined}
                className={`flex min-h-[52px] w-full flex-col items-start gap-1 px-4 py-3 text-left transition-colors duration-150 hover:bg-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600 ${organization.id === selectedId ? 'bg-brand-50' : ''}`}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="break-words text-sm font-medium text-ink">{organization.name}</span>
                  {organization.lifecycle_status !== 'active' && <StatusBadge status={organization.lifecycle_status} />}
                </span>
                <span className="text-xs text-ink-muted">
                  {[organization.college, `${organization.counts.events} events`, `${organization.counts.files} files`].filter(Boolean).join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function RecordsPage({ role = getStoredRole() }) {
  const picksOrganization = role === 'SUPER_ADMIN' || role === 'DEPARTMENT_HEAD';
  const [params, setParams] = useState({});
  const [search, setSearch] = useState('');
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const detailRef = useRef(null);

  const load = useCallback(() => {
    let cancelled = false;
    setState((current) => ({ ...current, loading: true, error: '' }));
    getRecords(params)
      .then((data) => { if (!cancelled) setState({ loading: false, error: '', data }); })
      .catch((error) => { if (!cancelled) setState((current) => ({ ...current, loading: false, error: getApiErrorMessage(error, 'Could not load the records.') })); });
    return () => { cancelled = true; };
  }, [params]);

  useEffect(() => load(), [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setParams((current) => (current.search === (search.trim() || undefined) ? current : { ...current, search: search.trim() || undefined }));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  async function openFile(url) {
    try {
      await openProtectedFile(url);
    } catch (error) {
      notify.error(getApiErrorMessage(error, 'Could not open this file.'));
    }
  }

  function chooseYear(yearId) {
    setParams((current) => ({ search: current.search, organization_id: current.organization_id, academic_year_id: yearId }));
  }

  function chooseSemester(semesterId) {
    setParams((current) => ({ search: current.search, organization_id: current.organization_id, academic_semester_id: semesterId }));
  }

  function chooseOrganization(id) {
    setParams((current) => ({ ...current, organization_id: id }));
    if (typeof detailRef.current?.scrollIntoView === 'function' && window.innerWidth < 1024) {
      detailRef.current.scrollIntoView({ block: 'start' });
    }
  }

  const { data, loading, error } = state;
  const semester = data?.semester;
  const year = data?.periods.find((candidate) => candidate.id === semester?.academic_year.id);
  const header = (
    <PageHeader
      title="Records"
      meta={semester?.read_only ? <StatusBadge tone="neutral" label="Read only" /> : null}
    />
  );

  if (!data && loading) {
    return <div className="flex flex-col gap-6">{header}<SkeletonTable rows={6} columns={3} /></div>;
  }
  if (!data && error) {
    return <div className="flex flex-col gap-6">{header}<ErrorState title="Records could not be loaded" description={error} onRetry={load} /></div>;
  }
  if (!semester) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <Card>
          <EmptyState title="No school year records yet" description="Records appear here once a semester has started." />
        </Card>
      </div>
    );
  }

  const organization = data.organization;

  return (
    <div className="flex flex-col gap-6">
      {header}
      <div className="flex flex-wrap items-end gap-4">
        <Field label="School year" className="w-full sm:w-56">
          <Select value={String(semester.academic_year.id)} onChange={(event) => chooseYear(Number(event.target.value))}>
            {data.periods.map((period) => <option key={period.id} value={period.id}>{period.label}</option>)}
          </Select>
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink" id="records-semester-label">Semester</span>
          <SegmentedControl
            options={(year?.semesters || []).map((item) => ({ value: item.id, label: ORDINAL[item.number] || `Semester ${item.number}` }))}
            value={semester.id}
            onChange={chooseSemester}
          />
        </div>
      </div>

      {error && <ErrorState title="Records could not be refreshed" description={error} onRetry={load} />}

      <div className={picksOrganization ? 'grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]' : ''}>
        {picksOrganization && (
          <OrganizationList organizations={data.organizations} selectedId={params.organization_id} onSelect={chooseOrganization} search={search} onSearch={setSearch} />
        )}
        <div ref={detailRef} className={`min-w-0 transition-opacity duration-150 ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
          {organization ? (
            <OrganizationRecords organization={organization} onOpen={openFile} />
          ) : (
            <Card><EmptyState title="Choose an organization" description="Pick one from the list to see its records for this period." /></Card>
          )}
        </div>
      </div>
    </div>
  );
}
