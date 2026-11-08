import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Building2, Plus, UserPlus, Users } from 'lucide-react';
import { Button, Card, DataTable, Drawer, EmptyState, ErrorState, Field, Input, OrgMark, PageHeader, Skeleton, StatusBadge, Tabs } from '../../../components/ui';
import Modal from '../../../components/Modal';
import PersonPicker from '../../../components/people/PersonPicker';
import ConfirmModal from '../../../components/ConfirmModal';
import ApplicantGrantList from '../../../components/org/ApplicantGrantList';
import ApplicantGrantModal from '../../../components/org/ApplicantGrantModal';
import notify from '../../../lib/notify';
import { manilaDate } from '../../../lib/format';
import { fetchAllPages } from '../../../services/pagination';
import { getCollegeOrganizations, getCollegeOverview, getCollegeStaff, addCollegeStaff, removeCollegeStaff } from '../../../services/collegeOrganizationService';
import { getApplicantGrants } from '../../../services/applicantGrantService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { formatDisplayText } from '../../../utils/displayText.js';
import { resolveAssetUrl } from '../../../utils/assetUrl';
import { headCollegeName, storedUser } from '../../../utils/collegeIdentity';
import { visibleSchoolId } from '../../../utils/schoolId';
import useRecordParam from '../../../lib/useRecordParam';
import { useRefetchOnReturn } from '../../../hooks/useRefetchOnReturn';
import { RegistrationStepper } from '../../../components/organizations/RegistrationFlow';
import { openProtectedFile } from '../../../utils/openProtectedFile';
import useActiveSubAccount from '../../../hooks/useActiveSubAccount';

async function viewRegistrationFile(submissionId) {
  try {
    await openProtectedFile(`/compliance/submissions/${submissionId}/document`);
  } catch (error) {
    notify.error(getApiErrorMessage(error, 'Could not open this document.'));
  }
}

// pending and returned only appear on registrations filed before applications moved to the grant flow.
const LIFECYCLE = {
  returned: { tone: 'danger', label: 'Returned' },
  pending: { tone: 'warning', label: 'Pending review' },
  active: { tone: 'success', label: 'Active' },
  archived: { tone: 'neutral', label: 'Archived' },
};

// Only filed before applications moved to the grant flow, so their tabs show only while some organization is in them.
const LEGACY_STATUSES = new Set(['returned', 'pending']);

const REQUIREMENT_STATUS = {
  submitted: { tone: 'info', label: 'Submitted' },
  approved: { tone: 'success', label: 'Approved' },
  returned: { tone: 'danger', label: 'Returned' },
  not_submitted: { tone: 'neutral', label: 'Not submitted' },
};

const LEADER_ROLE = { ADMIN: 'Admin', SBO_OFFICER: 'SBO Officer' };

const STATUS_PANEL_ID = 'organization-status-panel';

function roleCount(organization, key) {
  const count = organization.role_counts?.[key];
  return count ?? (key === 'admin' ? organization.administrators_count ?? 0 : 0);
}

// The status sits beside the organization name, not in a column of its own: most rows are active and carry
// no badge, and a phone prints every column label whether or not the row has a value for it.
function OrganizationStatus({ organization }) {
  const lifecycle = LIFECYCLE[organization.lifecycle_status] || LIFECYCLE.active;
  const badge = <StatusBadge status={organization.lifecycle_status} label={lifecycle.label} tone={lifecycle.tone} />;
  return organization.lifecycle_status === 'archived' ? <span role="group" aria-label="Archived, read only">{badge}</span> : badge;
}

function CollegeHeader({ overview, onManageStaff }) {
  const user = storedUser();
  const name = overview?.college?.name || headCollegeName(user);
  if (!name) return null;
  const headName = overview?.head?.name || `${user?.first_name || ''} ${user?.last_name || ''}`.trim();
  const logo = overview?.college?.logo_url;

  return (
    <section aria-label="Your college" className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-line bg-surface p-4">
      <div className="flex min-w-0 items-center gap-3">
        {logo && <img src={resolveAssetUrl(logo)} alt="" className="h-10 w-10 shrink-0 rounded-control object-cover" />}
        <div className="min-w-0">
          <h2 className="break-words text-base font-semibold text-ink">{formatDisplayText(name)}</h2>
          {headName && <p className="text-sm text-ink-muted">Department Head: {headName}</p>}
        </div>
      </div>
      {onManageStaff && (
        <Button variant="secondary" leftIcon={Users} onClick={onManageStaff}>Office staff</Button>
      )}
    </section>
  );
}

function CollegeStaffModal({ open, onClose }) {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [person, setPerson] = useState(null);
  const [positionTitle, setPositionTitle] = useState('Department Secretary');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    if (typeof getCollegeStaff === 'function') {
      getCollegeStaff()
        .then((res) => {
          setStaff(Array.isArray(res?.data) ? res.data : []);
          setLoading(false);
        })
        .catch((err) => {
          setError(getApiErrorMessage(err, 'Could not load office staff.'));
          setLoading(false);
        });
    } else {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const closeForm = () => {
    setAdding(false);
    setPerson(null);
    setFormError(null);
  };

  const handleCreateStaff = async (e) => {
    e.preventDefault();
    setFormError(null);
    if (!person || !positionTitle.trim()) {
      setFormError('Find the person and give their position.');
      return;
    }
    const words = person.name.trim().split(/\s+/);
    const lastName = words.length > 1 ? words.pop() : words[0];
    setSubmitting(true);
    try {
      await addCollegeStaff({
        school_id: person.school_id,
        first_name: words.join(' ') || lastName,
        last_name: lastName,
        email: person.email,
        position_title: positionTitle.trim(),
        role: 'ADMIN',
      });
      notify.success(`${person.name} was added as ${positionTitle.trim()}.`);
      closeForm();
      setPositionTitle('Department Secretary');
      load();
    } catch (err) {
      setFormError(getApiErrorMessage(err, 'Could not add this person.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveStaff = async () => {
    if (!removeTarget) return;
    setRemoveBusy(true);
    try {
      await removeCollegeStaff(removeTarget.school_id);
      notify.success(`${removeTarget.name} was removed from the college office.`);
      setRemoveTarget(null);
      load();
    } catch (err) {
      notify.error(getApiErrorMessage(err, 'Could not remove this person.'));
    } finally {
      setRemoveBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Office staff"
      description="People who can review applications for your college."
      onClose={onClose}
      maxWidth="max-w-[680px]"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-line pb-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">In the office ({staff.length})</h3>
          </div>
          {!adding && (
            <Button variant="secondary" size="sm" leftIcon={Plus} onClick={() => setAdding(true)}>Add staff</Button>
          )}
        </div>

        {adding && (
          <form onSubmit={handleCreateStaff} className="space-y-3 rounded-control border border-line p-4">
            {formError && <p role="alert" className="rounded-control border border-danger/30 bg-danger-tint p-2 text-sm font-medium text-danger-strong">{formError}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <PersonPicker
                  label="Person"
                  value={person}
                  onSelect={setPerson}
                  excludeIds={staff.map((member) => member.school_id)}
                  disabled={submitting}
                  hint="Someone without an account yet is invited by link instead."
                />
              </div>
              <div className="sm:col-span-2">
                <Field label="Position">
                  <Input required value={positionTitle} onChange={(e) => setPositionTitle(e.target.value)} placeholder="e.g. Department Secretary" />
                </Field>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" size="sm" type="button" onClick={closeForm}>Cancel</Button>
              <Button size="sm" type="submit" loading={submitting} disabled={!person}>Add to office staff</Button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="space-y-2 py-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : error ? (
          <ErrorState description={error} onRetry={load} />
        ) : staff.length === 0 ? (
          <p className="py-6 text-sm text-ink-muted">No other office staff yet.</p>
        ) : (
          <ul className="divide-y divide-line-soft rounded-control border border-line bg-surface">
            {staff.map((member) => (
              <li key={member.school_id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{member.name}</p>
                  <p className="text-xs text-ink-muted">{[member.is_lead_head ? 'Department Head' : member.position_title, visibleSchoolId(member.school_id)].filter(Boolean).join(' · ')}</p>
                </div>
                {!member.is_lead_head && (
                  <Button variant="secondary" size="sm" onClick={() => setRemoveTarget(member)} aria-label={`Remove ${member.name}`}>Remove</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmModal
        open={Boolean(removeTarget)}
        title="Remove from the office?"
        message={`${removeTarget?.name} will lose office access. Their account stays, and you can add them again later.`}
        confirmText="Remove"
        variant="danger"
        busy={removeBusy}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={handleRemoveStaff}
      />
    </Modal>
  );
}

function OrganizationDetails({ organization, onClose }) {
  if (!organization) return null;
  const lifecycle = LIFECYCLE[organization.lifecycle_status] || LIFECYCLE.active;
  const checklist = organization.registration_requirements || [];
  const leadership = organization.leadership || [];

  return (
    <div className="space-y-5">
      {(organization.lifecycle_status !== 'active' || organization.submitted_at) && (
        <div className="flex flex-wrap items-center gap-2">
          {organization.lifecycle_status !== 'active' && <StatusBadge status={organization.lifecycle_status} label={lifecycle.label} tone={lifecycle.tone} />}
          {organization.submitted_at && <span className="text-xs text-ink-muted">Submitted {manilaDate(organization.submitted_at, 'long')}</span>}
        </div>
      )}
      <RegistrationStepper organization={organization} viewerRole="DEPARTMENT_HEAD" />
      {organization.lifecycle_status === 'pending' && <p className="text-sm font-semibold text-ink-muted">Waiting for the SAO to decide.</p>}
      {organization.lifecycle_status === 'returned' && (
        <p className="rounded-control border border-line bg-subtle p-3 text-sm font-medium text-ink">
          {organization.review_remarks ? `The SAO returned this: ${organization.review_remarks} ` : 'The SAO returned this. '}
          New organizations start with an application now, so ask the SAO about this one.
        </p>
      )}
      {organization.lifecycle_status === 'archived' && <p className="text-sm font-semibold text-ink-muted">Archived by the SAO. Read only.</p>}
      <div>
        <h3 className="text-base font-semibold text-ink">Leadership</h3>
        {leadership.length === 0 ? (
          <p className="mt-2 text-sm font-medium text-ink-muted">No Admin or SBO Officer is assigned yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line-soft">
            {leadership.map((leader) => (
              <li key={`${leader.role}-${leader.name}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-sm font-medium text-ink">{leader.name}</span>
                <span className="text-xs text-ink-muted">{leader.position_title ? `${LEADER_ROLE[leader.role]}, ${leader.position_title}` : LEADER_ROLE[leader.role]}</span>
              </li>
            ))}
          </ul>
        )}
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          {[['Admins', 'admin'], ['SBO Officers', 'sbo_officer'], ['Students', 'student']].map(([label, key]) => (
            <div key={key} className="rounded-control bg-subtle p-2">
              <dd className="text-lg font-semibold tabular-nums text-ink">{roleCount(organization, key)}</dd>
              <dt className="text-xs font-medium text-ink-muted">{label}</dt>
            </div>
          ))}
        </dl>
      </div>
      <div>
        <h3 className="text-base font-semibold text-ink">Requirement checklist</h3>
        {checklist.length === 0 ? (
          <p className="mt-2 text-sm font-medium text-ink-muted">No registration documents are on file.</p>
        ) : (
          <DataTable
            caption="Requirement checklist"
            rows={checklist}
            rowKey={(item) => item.requirement_type_id}
            columns={[
              { key: 'name', header: 'Requirement', render: (item) => item.requirement_name },
              { key: 'file', header: 'File', render: (item) => <span className="break-all text-xs">{item.file_name || 'No file'}</span> },
              { key: 'status', header: 'Status', render: (item) => <StatusBadge status={item.status} label={(REQUIREMENT_STATUS[item.status] || REQUIREMENT_STATUS.not_submitted).label} tone={(REQUIREMENT_STATUS[item.status] || REQUIREMENT_STATUS.not_submitted).tone} /> },
            ]}
            actions={(item) => item.submission_id && <Button variant="secondary" size="sm" aria-label={`View file for ${item.requirement_name}`} onClick={() => viewRegistrationFile(item.submission_id)}>View file</Button>}
          />
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}

export default function CollegeOrganizationsPage() {
  const [state, setState] = useState({ loading: true, error: null, organizations: [] });
  const [grants, setGrants] = useState({ error: null, rows: [] });
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedStatus = searchParams.get('status');
  const tab = Object.hasOwn(LIFECYCLE, requestedStatus) ? requestedStatus : 'all';
  const [recordId, setRecordId] = useRecordParam();
  const [lastDetails, setLastDetails] = useState(null);
  const [missingRecord, setMissingRecord] = useState(false);
  const [overview, setOverview] = useState(null);
  const [staffModalOpen, setStaffModalOpen] = useState(false);
  const [grantModalOpen, setGrantModalOpen] = useState(false);

  function changeTab(key) {
    setSearchParams(key === 'all' ? {} : { status: key }, { replace: true });
  }

  const loadEpoch = useRef(0);
  const load = useCallback(({ silent = false } = {}) => {
    if (!silent) {
      loadEpoch.current += 1;
      setState((current) => ({ ...current, loading: true, error: null }));
    }
    const epoch = loadEpoch.current;
    return fetchAllPages((params) => getCollegeOrganizations(params).then((res) => res.data))
      .then((organizations) => {
        if (silent && epoch !== loadEpoch.current) return;
        setState((current) => (silent && !current.error && JSON.stringify(current.organizations) === JSON.stringify(organizations) ? current : { loading: false, error: null, organizations }));
      })
      .catch((err) => {
        if (silent) return;
        setState((current) => ({ ...current, loading: false, error: getApiErrorMessage(err, 'Could not load the organizations of your college.') }));
      });
  }, []);

  const loadGrants = useCallback(() => getApplicantGrants()
    .then((res) => setGrants({ error: null, rows: res.data.data }))
    .catch((err) => setGrants((current) => ({ ...current, error: getApiErrorMessage(err, 'Could not load the students allowed to apply.') }))), []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadGrants(); }, [loadGrants]);
  useRefetchOnReturn(() => load({ silent: true }));
  useEffect(() => {
    let cancelled = false;
    getCollegeOverview().then((res) => { if (!cancelled) setOverview(res.data); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const { subAccountId, enter: enterOrganizationSpace } = useActiveSubAccount();
  const navigate = useNavigate();
  const scopedOrganizations = useMemo(() => (subAccountId ? state.organizations.filter((organization) => Number(organization.id) === subAccountId) : state.organizations), [state.organizations, subAccountId]);
  const counts = useMemo(() => scopedOrganizations.reduce((totals, organization) => ({ ...totals, [organization.lifecycle_status]: (totals[organization.lifecycle_status] || 0) + 1 }), {}), [scopedOrganizations]);
  const rows = useMemo(() => (tab === 'all' ? scopedOrganizations : scopedOrganizations.filter((organization) => organization.lifecycle_status === tab)), [scopedOrganizations, tab]);
  const detailsTarget = recordId ? state.organizations.find((organization) => String(organization.id) === recordId) ?? null : null;
  if (detailsTarget && detailsTarget !== lastDetails) setLastDetails(detailsTarget);
  const shownDetails = detailsTarget ?? lastDetails;
  const noOrganizations = !state.loading && !state.error && state.organizations.length === 0;

  useEffect(() => {
    if (!recordId || state.loading || state.error) return;
    if (state.organizations.some((organization) => String(organization.id) === recordId)) return;
    setMissingRecord(true);
    setRecordId(null);
  }, [recordId, setRecordId, state.error, state.loading, state.organizations]);

  function openDetails(organization) {
    setMissingRecord(false);
    setRecordId(organization.id);
  }

  const tabs = [
    { key: 'all', label: `All (${state.organizations.length})`, panelId: STATUS_PANEL_ID },
    ...Object.entries(LIFECYCLE)
      .filter(([key]) => !LEGACY_STATUSES.has(key) || counts[key] > 0 || key === tab)
      .map(([key, value]) => ({ key, label: `${value.label} (${counts[key] || 0})`, panelId: STATUS_PANEL_ID })),
  ];

  const mutedIfArchived = (organization) => (organization.lifecycle_status === 'archived' ? 'text-ink-muted' : '');

  const columns = [
    {
      key: 'name',
      header: 'Organization',
      render: (organization) => (
        <div className="flex min-w-0 items-start gap-2.5">
          <span className={organization.lifecycle_status === 'archived' ? 'grayscale' : ''}><OrgMark name={organization.name} acronym={organization.acronym} size="sm" /></span>
          <div className="min-w-0 text-left">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className={`break-words font-medium ${organization.lifecycle_status === 'archived' ? 'text-ink-muted' : 'text-ink'}`}>{formatDisplayText(organization.name)}</p>
              {organization.lifecycle_status !== 'active' && <OrganizationStatus organization={organization} />}
            </div>
            <p className="text-xs text-ink-muted">{[organization.acronym, organization.submitted_at && `Submitted ${manilaDate(organization.submitted_at)}`].filter(Boolean).join(' · ')}</p>
            {organization.lifecycle_status === 'returned' && organization.review_remarks && <p className="mt-2 max-w-sm rounded-control border border-danger/30 bg-danger-tint p-2 text-sm text-danger-strong"><span className="block text-xs font-semibold">SAO remarks</span>{organization.review_remarks}</p>}
            {organization.lifecycle_status === 'archived' && <p className="mt-1 text-xs text-ink-muted">Archived by the SAO. Read only.</p>}
          </div>
        </div>
      ),
    },
    { key: 'admins', header: 'Admins', align: 'right', render: (organization) => <span className={mutedIfArchived(organization)}>{roleCount(organization, 'admin')}</span> },
    { key: 'officers', header: 'SBO Officers', align: 'right', render: (organization) => <span className={mutedIfArchived(organization)}>{roleCount(organization, 'sbo_officer')}</span> },
    { key: 'students', header: 'Students', align: 'right', render: (organization) => <span className={mutedIfArchived(organization)}>{roleCount(organization, 'student')}</span> },
  ];

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        primary={state.loading || noOrganizations ? undefined : <Button leftIcon={UserPlus} onClick={() => setGrantModalOpen(true)}>Allow a student to apply</Button>}
      />
      <CollegeHeader overview={overview} onManageStaff={() => setStaffModalOpen(true)} />
      {missingRecord && <p role="alert" className="rounded-control border border-danger/30 bg-danger-tint p-3 text-sm font-medium text-danger-strong">That organization is not in your college, so there is nothing to open.</p>}

      <Card bodyClassName="p-0">
        <div className="px-4 pt-2"><Tabs tabs={tabs} value={tab} onChange={changeTab} /></div>
        <div role="tabpanel" id={STATUS_PANEL_ID} aria-label={`${tab === 'all' ? 'All' : LIFECYCLE[tab].label} organizations`} className="p-4 pt-3">
          <DataTable
            stickyHeader={false}
            caption="Organizations of your college"
            rows={rows}
            columns={columns}
            loading={state.loading}
            error={state.error}
            onRetry={load}
            filtersActive={tab !== 'all'}
            emptyState={tab === 'all'
              ? <EmptyState icon={Building2} title="No organizations yet" description="Allow a student to apply. Their application comes to you for review." action={<Button onClick={() => setGrantModalOpen(true)}>Allow a student to apply</Button>} />
              : <EmptyState kind="filtered" title={`No ${LIFECYCLE[tab].label.toLowerCase()} organizations`} description="Choose another status to see the rest of your college." />}
            actions={(organization) => (
              <div className="flex flex-wrap items-center justify-end gap-2 md:flex-nowrap">
                <Button variant="secondary" size="sm" className="min-w-28 max-sm:h-[42px]" aria-label={`View checklist for ${organization.name}`} onClick={() => openDetails(organization)}>View checklist</Button>
                {organization.lifecycle_status !== 'archived' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="min-w-28 max-sm:h-[42px]"
                    aria-label={`Open organization space for ${organization.name}`}
                    onClick={() => {
                      enterOrganizationSpace(organization);
                      navigate(`/dashboard/department-head/org/${organization.id}`);
                    }}
                  >
                    Open space
                  </Button>
                )}
              </div>
            )}
          />
        </div>
      </Card>

      <ApplicantGrantList grants={grants.rows} error={grants.error} onRetry={loadGrants} onChanged={loadGrants} />

      <ApplicantGrantModal open={grantModalOpen} onClose={() => setGrantModalOpen(false)} onGranted={loadGrants} />

      <Drawer open={Boolean(detailsTarget)} title={shownDetails?.name} description={shownDetails?.acronym} onClose={() => setRecordId(null)} width="max-w-lg">
        <OrganizationDetails organization={shownDetails} onClose={() => setRecordId(null)} />
      </Drawer>

      <CollegeStaffModal open={staffModalOpen} onClose={() => setStaffModalOpen(false)} />
    </div>
  );
}
