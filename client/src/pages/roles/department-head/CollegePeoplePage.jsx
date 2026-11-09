import { useEffect, useState } from 'react';
import { Search, Upload, UserPlus } from 'lucide-react';
import { Button, DataTable, Drawer, EmptyState, Input, PageHeader, Select, StatusBadge, Tabs } from '../../../components/ui';
import ConfirmModal from '../../../components/ConfirmModal';
import AddStaffModal from '../../../components/people/AddStaffModal';
import ApplicantGrantModal from '../../../components/org/ApplicantGrantModal';
import PaginationControls from '../../../components/PaginationControls';
import StudentRecordsUpload from '../../../components/students/StudentRecordsUpload';
import notify from '../../../lib/notify';
import { getCollegePeople } from '../../../services/collegePeopleService';
import { removeCollegeStaff } from '../../../services/collegeOrganizationService';
import { listMeta, unwrapList } from '../../../services/pagination';
import { getApiErrorMessage } from '../../../utils/apiError';
import { storedUser } from '../../../utils/collegeIdentity';
import { visibleSchoolId } from '../../../utils/schoolId';

const PAGE_SIZE = 20;

const TABS = [
  { key: 'students', label: 'Students' },
  { key: 'staff', label: 'Office staff' },
  { key: 'leaders', label: 'Leaders' },
];

const SHOW_OPTIONS = [
  { value: 'all', label: 'All students' },
  { value: 'signed_up', label: 'Signed up' },
  { value: 'not_signed_up', label: 'Not signed up' },
];

const EMPTY = {
  students: { title: 'No students yet', description: 'Students show up here once they sign up, or once the school records for your college are loaded.' },
  staff: { title: 'No office staff yet', description: 'People who can review applications for your college. Add them from the school records.' },
  leaders: { title: 'No organization leaders yet', description: 'Heads and officers appear here once an organization in your college has them.' },
};

const SEARCH_LABEL = {
  students: 'Search students',
  staff: 'Search office staff',
  leaders: 'Search organization leaders',
};

const joinDetail = (...parts) => parts.filter(Boolean).join(' · ');

// Year levels arrive as '4th Year' from the school records and as a bare number from older rows.
const yearLabel = (level) => (/^\d+$/.test(String(level ?? '').trim()) ? `Year ${String(level).trim()}` : level);

function PersonCell({ name, detail, status }) {
  return (
    <span className="block min-w-0">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium text-ink">{name}{status && <StatusBadge status={status} />}</span>
      {detail && <span className="block break-words text-xs font-normal text-ink-muted">{detail}</span>}
    </span>
  );
}

const studentColumns = [
  { key: 'name', header: 'Name', render: (row) => <PersonCell name={row.name} detail={joinDetail(row.email, `ID ${row.school_id}`)} status={row.status === 'signed_up' ? null : row.status} /> },
  { key: 'program', header: 'Program', render: (row) => joinDetail(row.program, yearLabel(row.year_level)) },
  {
    key: 'organizations',
    header: 'Organizations',
    render: (row) => (row.organizations.length === 0 ? null : (
      <ul className="flex flex-col gap-0.5 text-sm">
        {row.organizations.map((organization) => (
          <li key={organization.id} title={organization.name} className="max-w-[16rem] truncate">
            {organization.name}
            {organization.position_title && <span className="text-xs font-normal text-ink-muted"> · {organization.position_title}</span>}
          </li>
        ))}
      </ul>
    )),
  },
];

const leaderColumns = [
  { key: 'name', header: 'Name', render: (row) => <PersonCell name={row.name} detail={joinDetail(row.email, `ID ${row.school_id}`)} /> },
  { key: 'organization', header: 'Organization', render: (row) => row.organization.name },
  { key: 'position_title', header: 'Position', render: (row) => row.position_title },
  { key: 'role', header: 'Access', render: (row) => (row.role === 'ADMIN' ? 'Organization head' : 'Officer') },
];

const staffColumns = [
  { key: 'name', header: 'Name', render: (row) => <PersonCell name={row.is_you ? `${row.name} (you)` : row.name} detail={joinDetail(row.email, visibleSchoolId(row.school_id) !== null && `ID ${row.school_id}`)} /> },
  { key: 'position_title', header: 'Position', render: (row) => row.position_title },
];

export default function CollegePeoplePage() {
  const [tab, setTab] = useState('students');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [state, setState] = useState({ tab: 'students', loading: true, error: '', rows: [], meta: { total: 0, perPage: PAGE_SIZE } });
  const [inviting, setInviting] = useState(false);
  const [show, setShow] = useState('all');
  const [uploading, setUploading] = useState(false);
  const [granting, setGranting] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let current = true;
    setState((value) => ({ ...value, loading: true, error: '' }));
    getCollegePeople({ tab, q: query || undefined, show: tab === 'students' && show !== 'all' ? show : undefined, page, per_page: PAGE_SIZE })
      .then((response) => { if (current) setState({ tab, loading: false, error: '', rows: unwrapList(response.data), meta: listMeta(response.data) }); })
      .catch((cause) => { if (current) setState({ tab, loading: false, error: getApiErrorMessage(cause, 'Could not load this list.'), rows: [], meta: { total: 0, perPage: PAGE_SIZE } }); });
    return () => { current = false; };
  }, [tab, query, show, page, reload]);

  function recordsSaved() {
    setShow('all');
    setPage(1);
    setReload((value) => value + 1);
  }

  function changeTab(next) {
    setTab(next);
    clearSearch();
  }

  function clearSearch() {
    setSearch('');
    setQuery('');
    setShow('all');
    setPage(1);
  }

  async function removeStaff() {
    setRemoveBusy(true);
    try {
      await removeCollegeStaff(removing.school_id);
      notify.success(`${removing.name} was removed from the college office.`);
      setRemoving(null);
      setReload((value) => value + 1);
    } catch (cause) {
      notify.error(getApiErrorMessage(cause, 'Could not remove this person.'));
    } finally {
      setRemoveBusy(false);
    }
  }

  const collegeId = storedUser()?.organization?.college_id || null;
  const filtersActive = Boolean(query || (tab === 'students' && show !== 'all'));
  const columns = tab === 'students' ? studentColumns : tab === 'staff' ? staffColumns : leaderColumns;
  const rowKey = tab === 'leaders' ? (row) => `${row.school_id}:${row.organization.id}` : (row) => row.school_id;

  const staffActions = (row) => (row.is_lead_head || row.is_you ? null : (
    <Button variant="secondary" size="sm" onClick={() => setRemoving(row)} aria-label={`Remove ${row.name}`}>Remove</Button>
  ));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="People"
        primary={tab === 'students' ? (
          <Button leftIcon={UserPlus} onClick={() => setGranting(true)}>Allow a student to apply</Button>
        ) : tab === 'staff' ? <Button leftIcon={UserPlus} onClick={() => setInviting(true)}>Add staff</Button> : null}
      />

      <div className="flex flex-col gap-4">
        <Tabs tabs={TABS} value={tab} onChange={changeTab} />
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-sm">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" aria-hidden="true" />
            <Input
              type="search"
              aria-label={SEARCH_LABEL[tab]}
              placeholder="Name or email"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-9"
            />
          </div>
          {tab === 'students' && (
            <Select aria-label="Show" value={show} onChange={(event) => { setShow(event.target.value); setPage(1); }} className="w-full sm:w-44">
              {SHOW_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
          )}
          {(search || filtersActive) && (
            <button type="button" onClick={clearSearch} className="inline-flex min-h-11 items-center rounded-control text-sm font-medium text-brand-700 hover:underline">Clear</button>
          )}
          {tab === 'students' && collegeId && (
            <Button variant="secondary" leftIcon={Upload} className="sm:ml-auto" onClick={() => setUploading(true)}>Upload student records</Button>
          )}
        </div>
        <div role="tabpanel">
          <DataTable
            columns={columns}
            rows={state.tab === tab ? state.rows : []}
            rowKey={rowKey}
            loading={state.loading || state.tab !== tab}
            error={state.error}
            onRetry={() => setReload((value) => value + 1)}
            filtersActive={filtersActive}
            onClearFilters={clearSearch}
            emptyState={filtersActive ? (
              <EmptyState kind="filtered" query={query} description="Try a different name or email, or show all students." onClearFilters={clearSearch} />
            ) : (
              <EmptyState
                title={EMPTY[tab].title}
                description={EMPTY[tab].description}
                action={tab === 'students' && collegeId ? <Button variant="secondary" leftIcon={Upload} onClick={() => setUploading(true)}>Upload student records</Button> : undefined}
              />
            )}
            actions={tab === 'staff' ? staffActions : undefined}
            actionsHeader=""
            caption={TABS.find((item) => item.key === tab).label}
            pagination={state.error ? null : (
              <PaginationControls currentPage={page} totalItems={state.meta.total} pageSize={state.meta.perPage} onPageChange={setPage} label="people" />
            )}
          />
        </div>
      </div>

      <Drawer
        open={uploading}
        title="Upload student records"
        description="Students are matched against these records when they sign up, and office staff are picked from them when you invite them. Birth dates are only used for that check and are never shown."
        onClose={() => setUploading(false)}
        width="max-w-2xl"
      >
        <StudentRecordsUpload collegeId={collegeId} onSaved={recordsSaved} />
      </Drawer>
      <AddStaffModal open={inviting} onClose={() => setInviting(false)} />
      <ApplicantGrantModal open={granting} onClose={() => setGranting(false)} onGranted={() => setReload((value) => value + 1)} />
      <ConfirmModal
        open={Boolean(removing)}
        title="Remove from the college office"
        message={removing ? `${removing.name} will lose office access. Their account stays, and you can invite them again later.` : ''}
        confirmText="Remove"
        busy={removeBusy}
        onCancel={() => setRemoving(null)}
        onConfirm={removeStaff}
      />
    </div>
  );
}
