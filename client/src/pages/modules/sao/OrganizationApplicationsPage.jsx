import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Card, DataTable, EmptyState, Input, PageHeader, StatusBadge } from '../../../components/ui';
import ResponsiveTabs from './ResponsiveTabs';
import PaginationControls from '../../../components/PaginationControls';
import ApplicationReview from '../../../components/org/ApplicationReview';
import { APPLICATION_LABELS } from '../../../components/org/applicationStatus';
import { getOrganizationApplications } from '../../../services/organizationApplicationService';
import { listMeta, unwrapList } from '../../../services/pagination';
import { getApiErrorMessage } from '../../../utils/apiError';
import { manilaDate } from '../../../lib/format';

const PANEL_ID = 'organization-applications-panel';
const LIST_PATH = '/dashboard/organization-applications';
const PAGE_SIZE = 20;

const TABS = {
  DEPARTMENT_HEAD: [['pending_dean', 'To review'], ['pending_sao', 'With the SAO'], ['returned', 'Returned'], ['approved', 'Approved'], ['rejected', 'Not approved']],
  SUPER_ADMIN: [['pending_sao', 'To review'], ['pending_dean', 'With the Department Head'], ['returned', 'Returned'], ['approved', 'Approved'], ['rejected', 'Not approved']],
};

function currentRole() {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}').role === 'DEPARTMENT_HEAD' ? 'DEPARTMENT_HEAD' : 'SUPER_ADMIN';
  } catch {
    return 'SUPER_ADMIN';
  }
}

// The queue. An application opens as its own page at ?record=<id>, so a notification link and the
// Back button both land where the reviewer expects, and the decision is never made in a drawer.
export default function OrganizationApplicationsPage() {
  const role = currentRole();
  const tabs = TABS[role];
  const [searchParams] = useSearchParams();
  const recordId = searchParams.get('record');
  const [status, setStatus] = useState(tabs[0][0]);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [state, setState] = useState({ loading: true, error: '', rows: [], meta: { currentPage: 1, perPage: PAGE_SIZE, total: 0 }, counts: {} });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(query.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const load = useCallback(() => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    return getOrganizationApplications({ status, page, per_page: PAGE_SIZE, ...(search ? { search } : {}) })
      .then((res) => setState({ loading: false, error: '', rows: unwrapList(res.data), meta: listMeta(res.data), counts: res.data.counts || {} }))
      .catch((error) => setState((current) => ({ ...current, loading: false, error: getApiErrorMessage(error, 'Could not load applications.') })));
  }, [status, page, search]);

  useEffect(() => {
    if (!recordId) load();
  }, [load, recordId]);

  const tabItems = useMemo(() => tabs.map(([key, label]) => ({ key, label: `${label} (${state.counts[key] ?? 0})`, panelId: PANEL_ID })), [tabs, state.counts]);

  if (recordId) return <ApplicationReview applicationId={recordId} viewerRole={role} />;

  function changeStatus(key) {
    setStatus(key);
    setPage(1);
  }

  const toReview = status === tabs[0][0];
  const emptyState = search
    ? <EmptyState kind="filtered" query={search} onClearFilters={() => setQuery('')} />
    : (
      <EmptyState
        title={toReview ? 'No applications to review' : 'No applications in this list'}
        description={role === 'DEPARTMENT_HEAD' ? 'Applications show here once a student you allowed to apply sends one.' : 'Applications show here once a Department Head endorses one.'}
      />
    );

  const columns = [
    {
      key: 'name',
      header: 'Organization',
      render: (row) => (
        <div className="min-w-0">
          <p className="break-words font-medium text-ink">{row.name}</p>
          <p className="text-xs text-ink-muted">{row.acronym} · {row.college?.name || 'No college'}</p>
        </div>
      ),
    },
    {
      key: 'applicant',
      header: 'Applicant',
      render: (row) => (
        <div className="min-w-0">
          <p className="break-words font-medium text-ink">{row.applicant?.name}</p>
          <p className="text-xs text-ink-muted">{row.position_title} · ID {row.applicant?.school_id}</p>
        </div>
      ),
    },
    { key: 'submitted', header: 'Sent', render: (row) => <span className="text-sm text-ink-muted-strong">{row.submitted_at ? manilaDate(row.submitted_at, 'long') : ''}</span> },
    // The status is the tab itself on the review list, so a badge appears only where it tells rows apart.
    ...(toReview ? [] : [{ key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} label={APPLICATION_LABELS[row.status]} /> }]),
  ];

  return (
    <div className="space-y-5 pb-8">
      <PageHeader />
      <Card bodyClassName="p-0">
        <div className="px-4 pt-2 max-sm:pb-2"><ResponsiveTabs label="Application status" tabs={tabItems} value={status} onChange={changeStatus} /></div>
        <div role="tabpanel" id={PANEL_ID} aria-label={APPLICATION_LABELS[status]}>
          <DataTable
            stickyHeader={false}
            caption="Organization applications"
            rows={state.rows}
            loading={state.loading}
            error={state.error || null}
            onRetry={() => load()}
            filtersActive={Boolean(search)}
            emptyState={emptyState}
            pageSize={PAGE_SIZE}
            filters={(
              <div className="flex flex-wrap items-end gap-3 p-4">
                <Input type="search" aria-label="Find an application" className="min-w-56" placeholder="Search organization or student" value={query} onChange={(event) => setQuery(event.target.value)} />
                {query && <button type="button" onClick={() => setQuery('')} className="inline-flex min-h-11 items-center rounded-control text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">Clear</button>}
              </div>
            )}
            columns={columns}
            actions={(row) => (
              <Button variant="secondary" size="sm" className="max-sm:h-[42px]" to={`${LIST_PATH}?record=${row.id}`} aria-label={`${toReview ? 'Review' : 'View'} application of ${row.name}`}>{toReview ? 'Review' : 'View'}</Button>
            )}
            pagination={<PaginationControls currentPage={state.meta.currentPage} totalItems={state.meta.total} pageSize={state.meta.perPage} onPageChange={setPage} label="applications" />}
          />
        </div>
      </Card>
    </div>
  );
}
