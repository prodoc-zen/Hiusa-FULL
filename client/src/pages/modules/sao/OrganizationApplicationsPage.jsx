import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, Input, PageHeader, StatusBadge, Tabs } from '../../../components/ui';
import PaginationControls from '../../../components/PaginationControls';
import ApplicationReviewDrawer from '../../../components/org/ApplicationReviewDrawer';
import { APPLICATION_LABELS } from '../../../components/org/applicationStatus';
import { getOrganizationApplications } from '../../../services/organizationApplicationService';
import { listMeta, unwrapList } from '../../../services/pagination';
import { getApiErrorMessage } from '../../../utils/apiError';
import useRecordParam from '../../../lib/useRecordParam';
import { manilaDate } from '../../../lib/format';

const PANEL_ID = 'organization-applications-panel';

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

export default function OrganizationApplicationsPage() {
  const role = currentRole();
  const tabs = TABS[role];
  const [status, setStatus] = useState(tabs[0][0]);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [recordId, setRecordId] = useRecordParam();
  const [state, setState] = useState({ loading: true, error: '', rows: [], meta: { currentPage: 1, perPage: 10, total: 0 }, counts: {} });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(query.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const load = useCallback(({ silent = false } = {}) => {
    if (!silent) setState((current) => ({ ...current, loading: true, error: '' }));
    return getOrganizationApplications({ status, page, per_page: 10, ...(search ? { search } : {}) })
      .then((res) => setState({ loading: false, error: '', rows: unwrapList(res.data), meta: listMeta(res.data), counts: res.data.counts || {} }))
      .catch((error) => setState((current) => ({ ...current, loading: false, error: getApiErrorMessage(error, 'Could not load applications.') })));
  }, [status, page, search]);

  useEffect(() => { load(); }, [load]);

  const tabItems = useMemo(() => tabs.map(([key, label]) => ({ key, label: `${label} (${state.counts[key] ?? 0})`, panelId: PANEL_ID })), [tabs, state.counts]);

  function changeStatus(key) {
    setStatus(key);
    setPage(1);
  }

  function decided() {
    setRecordId(null);
    load({ silent: true });
  }

  const emptyState = search
    ? <EmptyState kind="filtered" query={search} onClearFilters={() => setQuery('')} />
    : (
      <EmptyState
        icon={ClipboardCheck}
        title={status === tabs[0][0] ? 'Nothing waiting for you' : 'Nothing here'}
        description={role === 'DEPARTMENT_HEAD' ? 'Applications show here once a student you allowed to apply sends one.' : 'Applications show here once a Department Head endorses one.'}
      />
    );

  return (
    <div className="space-y-5 pb-8">
      <PageHeader description={role === 'DEPARTMENT_HEAD' ? 'Check each requirement, then endorse the application to the SAO or return it to the student.' : 'Check each requirement, then approve the application, return it, or reject it. Approving creates the organization.'} />
      <Card bodyClassName="p-0">
        <div className="px-4 pt-2"><Tabs tabs={tabItems} value={status} onChange={changeStatus} /></div>
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
            filters={(
              <div className="flex flex-wrap items-end gap-3 p-4">
                <label className="text-xs font-semibold text-ink">
                  Find an application
                  <Input type="search" className="mt-1 min-w-56" placeholder="Organization or student" value={query} onChange={(event) => setQuery(event.target.value)} />
                </label>
              </div>
            )}
            columns={[
              {
                key: 'name',
                header: 'Organization',
                render: (row) => (
                  <div className="min-w-0">
                    <p className="break-words font-semibold text-ink">{row.name}</p>
                    <p className="text-xs font-medium text-ink-muted">{row.acronym} · {row.college?.name || 'No college'}</p>
                  </div>
                ),
              },
              {
                key: 'applicant',
                header: 'Applicant',
                render: (row) => (
                  <div className="min-w-0">
                    <p className="break-words font-semibold text-ink">{row.applicant?.name}</p>
                    <p className="text-xs font-medium text-ink-muted">{row.position_title} · ID {row.applicant?.school_id}</p>
                  </div>
                ),
              },
              { key: 'submitted', header: 'Sent', render: (row) => <span className="text-xs font-medium text-ink-muted">{row.submitted_at ? manilaDate(row.submitted_at, 'long') : '-'}</span> },
              { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} label={APPLICATION_LABELS[row.status]} /> },
            ]}
            actions={(row) => (
              <Button variant="secondary" size="sm" className="max-sm:h-[42px]" aria-label={`Open application of ${row.name}`} onClick={() => setRecordId(row.id)}>Open</Button>
            )}
            pagination={<PaginationControls currentPage={state.meta.currentPage} totalItems={state.meta.total} pageSize={state.meta.perPage} onPageChange={setPage} label="applications" />}
          />
        </div>
      </Card>
      {recordId && <ApplicationReviewDrawer applicationId={recordId} viewerRole={role} onClose={() => setRecordId(null)} onDecided={decided} />}
    </div>
  );
}
