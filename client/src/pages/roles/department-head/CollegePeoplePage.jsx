import { useEffect, useState } from 'react';
import { Check, Copy, Search, UserPlus } from 'lucide-react';
import { Button, DataTable, EmptyState, Field, Input, PageHeader, StatusBadge, Tabs } from '../../../components/ui';
import ConfirmModal from '../../../components/ConfirmModal';
import Modal from '../../../components/Modal';
import ApplicantGrantModal from '../../../components/org/ApplicantGrantModal';
import PaginationControls from '../../../components/PaginationControls';
import StudentRecordsPanel from '../../../components/students/StudentRecordsPanel';
import notify from '../../../lib/notify';
import { getCollegePeople } from '../../../services/collegePeopleService';
import { inviteCollegeStaff, removeCollegeStaff } from '../../../services/collegeOrganizationService';
import { listMeta, unwrapList } from '../../../services/pagination';
import { getApiErrorMessage } from '../../../utils/apiError';
import { storedUser } from '../../../utils/collegeIdentity';

const TABS = [
  { key: 'students', label: 'Students' },
  { key: 'staff', label: 'Office staff' },
  { key: 'leaders', label: 'Organization leaders' },
];

const EMPTY = {
  students: { title: 'No students yet', description: 'Students show up here once they sign up, or once the school records for your college are loaded.' },
  staff: { title: 'No office staff yet', description: 'Invite your secretary or other office staff with a link. They set up their own account.' },
  leaders: { title: 'No organization leaders yet', description: 'Heads and officers appear here once an organization in your college has them.' },
};

const SEARCH_LABEL = {
  students: 'Search students',
  staff: 'Search office staff',
  leaders: 'Search organization leaders',
};

const joinDetail = (...parts) => parts.filter(Boolean).join(' · ');

function PersonCell({ name, detail }) {
  return (
    <span className="block min-w-0">
      <span className="block font-semibold text-ink">{name}</span>
      {detail && <span className="block break-words text-xs font-medium text-ink-muted">{detail}</span>}
    </span>
  );
}

const studentColumns = [
  { key: 'name', header: 'Name', render: (row) => <PersonCell name={row.name} detail={joinDetail(row.email, `ID ${row.school_id}`)} /> },
  { key: 'program', header: 'Program', render: (row) => joinDetail(row.program, row.year_level && `Year ${row.year_level}`) || '-' },
  {
    key: 'organizations',
    header: 'Organizations',
    render: (row) => (row.organizations.length === 0 ? <span className="text-ink-muted">None</span> : (
      <ul className="flex flex-col gap-0.5 text-sm">
        {row.organizations.map((organization) => (
          <li key={organization.id}>
            {organization.name}
            {organization.position_title && <span className="text-xs font-medium text-ink-muted"> · {organization.position_title}</span>}
          </li>
        ))}
      </ul>
    )),
  },
  { key: 'status', header: 'Account', render: (row) => <StatusBadge status={row.status} /> },
];

const leaderColumns = [
  { key: 'name', header: 'Name', render: (row) => <PersonCell name={row.name} detail={joinDetail(row.email, `ID ${row.school_id}`)} /> },
  { key: 'organization', header: 'Organization', render: (row) => row.organization.name },
  { key: 'position_title', header: 'Position', render: (row) => row.position_title || '-' },
  { key: 'role', header: 'Access', render: (row) => (row.role === 'ADMIN' ? 'Organization head' : 'Officer') },
];

const staffColumns = [
  { key: 'name', header: 'Name', render: (row) => <PersonCell name={row.is_you ? `${row.name} (you)` : row.name} detail={row.email} /> },
  { key: 'position_title', header: 'Position', render: (row) => row.position_title },
];

function InviteStaffModal({ open, onClose }) {
  const [position, setPosition] = useState('');
  const [email, setEmail] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setPosition('');
      setEmail('');
      setLink('');
      setError('');
      setCopied(false);
    }
  }, [open]);

  async function createLink(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await inviteCollegeStaff({ position_title: position.trim(), ...(email.trim() && { email: email.trim() }) });
      setLink(response.data.magic_link);
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Could not create the link. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      notify.error('Could not copy the link. Select it and copy it by hand.');
    }
  }

  return (
    <Modal
      open={open}
      title="Invite office staff"
      description="The link works once and expires in 48 hours. They set up their own account and sign in with their email."
      onClose={onClose}
      maxWidth="max-w-lg"
    >
      {link ? (
        <div className="flex flex-col gap-4">
          <Field label="Invite link">
            <Input readOnly value={link} onFocus={(event) => event.target.select()} />
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Close</Button>
            <Button onClick={copyLink} leftIcon={copied ? Check : Copy}>{copied ? 'Copied' : 'Copy link'}</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={createLink} className="flex flex-col gap-4">
          <Field label="Position" required hint="For example, College Secretary.">
            <Input value={position} onChange={(event) => setPosition(event.target.value)} maxLength={100} autoComplete="off" />
          </Field>
          <Field label="Send it to (optional)" hint="Leave this empty to share the link yourself.">
            <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="off" />
          </Field>
          {error && <p role="alert" className="text-sm font-semibold text-danger-strong">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={busy} disabled={!position.trim()}>Create link</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export default function CollegePeoplePage() {
  const [tab, setTab] = useState('students');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [state, setState] = useState({ tab: 'students', loading: true, error: '', rows: [], meta: { total: 0, perPage: 25 } });
  const [inviting, setInviting] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(false);
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
    getCollegePeople({ tab, q: query || undefined, page })
      .then((response) => { if (current) setState({ tab, loading: false, error: '', rows: unwrapList(response.data), meta: listMeta(response.data) }); })
      .catch((cause) => { if (current) setState({ tab, loading: false, error: getApiErrorMessage(cause, 'Could not load this list.'), rows: [], meta: { total: 0, perPage: 25 } }); });
    return () => { current = false; };
  }, [tab, query, page, reload]);

  function toggleRecords() {
    if (recordsOpen) setReload((value) => value + 1);
    setRecordsOpen(!recordsOpen);
  }

  function changeTab(next) {
    setTab(next);
    setSearch('');
    setQuery('');
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
  const filtersActive = Boolean(query);
  const columns = tab === 'students' ? studentColumns : tab === 'staff' ? staffColumns : leaderColumns;
  const rowKey = tab === 'leaders' ? (row) => `${row.school_id}:${row.organization.id}` : (row) => row.school_id;

  const staffActions = (row) => (row.is_lead_head || row.is_you ? null : (
    <Button variant="secondary" size="sm" onClick={() => setRemoving(row)} aria-label={`Remove ${row.name}`}>Remove</Button>
  ));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="People"
        actions={tab === 'students' ? (
          <>
            <Button variant="secondary" onClick={() => setGranting(true)}>Allow a student to apply</Button>
            {collegeId && <Button variant="secondary" aria-expanded={recordsOpen} onClick={toggleRecords}>{recordsOpen ? 'Hide student records' : 'Student records'}</Button>}
          </>
        ) : null}
        primary={tab === 'staff' ? <Button leftIcon={UserPlus} onClick={() => setInviting(true)}>Invite staff</Button> : null}
      />

      {tab === 'students' && collegeId && recordsOpen && <StudentRecordsPanel collegeId={collegeId} />}

      <div className="rounded-card border border-line bg-surface shadow-card">
        <div className="px-5">
          <Tabs tabs={TABS} value={tab} onChange={changeTab} />
        </div>
        <div className="px-5 pt-4">
          <div className="relative max-w-sm">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" aria-hidden="true" />
            <Input
              type="search"
              aria-label={SEARCH_LABEL[tab]}
              placeholder="Name, email or school ID"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        <div className="p-5" role="tabpanel">
          <DataTable
            columns={columns}
            rows={state.tab === tab ? state.rows : []}
            rowKey={rowKey}
            loading={state.loading || state.tab !== tab}
            error={state.error}
            onRetry={() => setReload((value) => value + 1)}
            filtersActive={filtersActive}
            emptyState={filtersActive ? (
              <EmptyState kind="filtered" query={query} description="Try a different name, email or school ID." />
            ) : (
              <EmptyState
                title={EMPTY[tab].title}
                description={EMPTY[tab].description}
                action={tab === 'students' && collegeId && !recordsOpen ? <Button onClick={toggleRecords}>Load student records</Button> : undefined}
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

      <InviteStaffModal open={inviting} onClose={() => setInviting(false)} />
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
