import HiusaSelect from '../../../components/ui/Select';
import { matchesFilter } from '../../../utils/filterValues';
import { formatDisplayText } from '../../../utils/displayText.js';
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  KeyRound,
  PencilLine,
  Trash2,
  UserPlus,
} from "lucide-react";
import {
  deleteSystemAdmin,
  getSystemAdmins,
  getSystemOrganizationOverview,
  getSystemOrganizations,
  initiateSystemAdminPasswordReset,
  updateSystemAdmin,
} from "../../../services/systemAdministrationService";
import { getApiErrorMessage } from "../../../utils/apiError";
import { fetchAllPages } from "../../../services/pagination";
import ConfirmModal from "../../../components/ConfirmModal";
import TableRowActions from "../../../components/TableRowActions";
import { organizationOverviewPath } from "./agencyStatus";
import { Button, Drawer, EmptyState, ErrorState, Field, Input, NextStep, PageHeader, SkeletonTable, StatusBadge } from "../../../components/ui";
import { RegistrationNextStep, RegistrationStepper } from "../../../components/organizations/RegistrationFlow";
import { useRefetchOnReturn } from '../../../hooks/useRefetchOnReturn';
import AddExistingUserModal from '../../../components/users/AddExistingUserModal';
import { visibleSchoolId } from '../../../utils/schoolId';
import ManageAccountProfilesModal from '../../../components/users/ManageAccountProfilesModal';
import OneTimeLinkModal from '../../../components/users/OneTimeLinkModal';

const LEADERSHIP_TITLES = [
  "Adviser",
  "President",
  "Vice President - Internal",
  "Vice President - External",
  "Secretary",
];

const emptyForm = () => ({
  editing_school_id: null,
  school_id: "",
  first_name: "",
  last_name: "",
  email: "",
  contact_number: "",
  organization_id: "",
  position_title: "",
  account_status: "active",
});

const profileKey = (admin) => admin.profile_id ?? `${admin.school_id}-${admin.organization_id}`;
const isPrimaryProfile = (admin) => admin.is_primary_profile !== false;

function AdminIdentity({ admin }) {
  return (
    <div className="min-w-0">
      <p className="break-words font-medium text-ink">
        {formatDisplayText(admin.first_name)} {formatDisplayText(admin.last_name)}
      </p>
      <p className="break-words text-xs text-ink-muted">{admin.email}</p>
      <p className="text-xs text-ink-muted">
        {[visibleSchoolId(admin.school_id) && `ID ${visibleSchoolId(admin.school_id)}`, admin.contact_number].filter(Boolean).join(', ')}
      </p>
      {!isPrimaryProfile(admin) && <p className="text-xs font-medium text-ink-muted">Added through a profile</p>}
    </div>
  );
}

export default function SystemAdminsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const handledLink = useRef(null);
  const [provisioning, setProvisioning] = useState(null);
  const [admins, setAdmins] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [form, setForm] = useState(null);
  const [search, setSearch] = useState("");
  const [organizationFilter, setOrganizationFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [success, setSuccess] = useState("");
  const [resetTarget, setResetTarget] = useState(null);
  const [resetLink, setResetLink] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [membershipUser, setMembershipUser] = useState(null);
  const [profileUser, setProfileUser] = useState(null);
  const [addingAdmin, setAddingAdmin] = useState(null);

  const loadEpoch = useRef(0);
  const load = useCallback(async ({ silent = false } = {}) => {
    // A silent refresh never touches the loading flag or the shared error, which the
    // open form and the action modals also use, and yields to any newer full load.
    if (!silent) {
      loadEpoch.current += 1;
      setLoading(true);
      setError("");
      setLoadError("");
    }
    const epoch = loadEpoch.current;
    try {
      const [adminData, organizationData] = await Promise.all([
        fetchAllPages(getSystemAdmins),
        fetchAllPages((params) => getSystemOrganizations({ ...params, status: "all" })),
      ]);
      if (silent && epoch !== loadEpoch.current) return;
      setAdmins((current) => (silent && JSON.stringify(current) === JSON.stringify(adminData) ? current : adminData));
      setOrganizations((current) => (silent && JSON.stringify(current) === JSON.stringify(organizationData) ? current : organizationData));
    } catch (requestError) {
      if (silent) return;
      setLoadError(
        getApiErrorMessage(
          requestError,
          "Unable to load SAO administrator accounts.",
        ),
      );
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useRefetchOnReturn(() => load({ silent: true }));

  const linkedOrganizationId = searchParams.get("organization");
  const createRequested = searchParams.get("create") === "1";

  useEffect(() => {
    if (loading || !linkedOrganizationId) return;
    const key = `${linkedOrganizationId}:${createRequested}`;
    if (handledLink.current === key) return;
    handledLink.current = key;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("organization");
      next.delete("create");
      return next;
    }, { replace: true });

    async function resolveOrganization() {
      const listed = organizations.find((item) => String(item.id) === linkedOrganizationId);
      if (listed) return listed;
      const { organization, lifecycle, member_counts: members } = await getSystemOrganizationOverview(linkedOrganizationId);
      const fetched = { ...organization, lifecycle_status: lifecycle?.status ?? organization.lifecycle_status, administrators_count: members?.ADMIN ?? 0 };
      setOrganizations((current) => [...current, fetched]);
      return fetched;
    }

    resolveOrganization().then((organization) => {
      if (!createRequested) {
        setOrganizationFilter(String(organization.id));
        return;
      }
      if (organization.lifecycle_status !== "active") {
        setError(`${formatDisplayText(organization.name)} is not active yet. Approve its registration before assigning an administrator.`);
        return;
      }
      setProvisioning({ organization, adminName: null });
      openCreate(organization);
    }).catch((cause) => setError(getApiErrorMessage(cause, "Could not open that organization to assign an administrator.")));
  }, [loading, linkedOrganizationId, createRequested, organizations, setSearchParams]);

  async function removeAdmin() {
    if (!deleteTarget) return;
    setBusy(true);
    setError('');
    try {
      await deleteSystemAdmin(deleteTarget.school_id);
      setDeleteTarget(null);
      setSuccess('Administrator account removed.');
      await load();
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Could not delete this administrator.'));
      setDeleteTarget(null);
    } finally {
      setBusy(false);
    }
  }

  const visibleAdmins = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return admins.filter((admin) => {
      const matchesSearch =
        !needle ||
        [
          admin.first_name,
          admin.last_name,
          admin.email,
          String(admin.school_id),
          admin.position_title,
          admin.organization?.name,
          admin.organization?.acronym,
        ].some((value) => (value || "").toLowerCase().includes(needle));
      const matchesOrganization = matchesFilter(organizationFilter, admin.organization_id);
      const matchesStatus = matchesFilter(statusFilter, admin.account_status);
      return matchesSearch && matchesOrganization && matchesStatus;
    }).sort((left, right) => Number(Boolean(left.organization?.parent_organization_id)) - Number(Boolean(right.organization?.parent_organization_id)));
  }, [admins, organizationFilter, search, statusFilter]);

  const filtersActive = Boolean(search.trim() || organizationFilter || statusFilter !== "all");
  function clearFilters() {
    setSearch("");
    setOrganizationFilter("");
    setStatusFilter("all");
  }

  const groups = [
    ["Main organizations", visibleAdmins.filter((admin) => !admin.organization?.parent_organization_id)],
    ["Sub organizations", visibleAdmins.filter((admin) => admin.organization?.parent_organization_id)],
  ].filter(([, members]) => members.length > 0);

  function rowActions(admin) {
    const manageProfiles = { label: 'Manage profiles', icon: UserPlus, onClick: () => setProfileUser(admin) };
    return (
      <TableRowActions subject={`${admin.first_name} ${admin.last_name}`} label="Administrator actions" actions={isPrimaryProfile(admin) ? [
        { label: 'Add to organization', icon: UserPlus, onClick: () => setMembershipUser(admin) },
        manageProfiles,
        { label: 'Reset access', icon: KeyRound, disabled: admin.account_status !== 'active', onClick: () => setResetTarget(admin) },
        { label: 'Edit administrator', icon: PencilLine, onClick: () => openEdit(admin) },
        { label: 'Delete administrator', icon: Trash2, danger: true, onClick: () => setDeleteTarget(admin) },
      ] : [manageProfiles]} />
    );
  }

  const activeCount = admins.filter(
    (admin) => admin.account_status === "active",
  ).length;
  const coveredOrganizations = new Set(
    admins
      .filter((admin) => admin.account_status === "active")
      .map((admin) => admin.organization_id),
  ).size;

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setError("");
  }

  function openCreate(organization = null) {
    setError("");
    setSuccess("");
    setAddingAdmin({ organization });
  }

  function openEdit(admin) {
    setError("");
    setSuccess("");
    setForm({
      ...emptyForm(),
      editing_school_id: admin.school_id,
      school_id: String(admin.school_id),
      first_name: admin.first_name || "",
      last_name: admin.last_name || "",
      email: admin.email || "",
      contact_number: admin.contact_number || "",
      organization_id: String(admin.organization_id),
      position_title: admin.position_title || "",
      account_status: admin.account_status || "active",
    });
  }

  async function save(event) {
    event.preventDefault();
    if (!form) return;

    const payload = {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      email: form.email.trim().toLowerCase(),
      contact_number: form.contact_number.trim() || null,
      organization_id: Number(form.organization_id),
      position_title: form.position_title.trim() || null,
      account_status: form.account_status,
    };

    setBusy(true);
    setError("");
    try {
      await updateSystemAdmin(form.editing_school_id, payload);
      setSuccess("Administrator account updated successfully.");
      setForm(null);
      await load();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not update the administrator."));
    } finally {
      setBusy(false);
    }
  }

  function adminAdded(profile, person) {
    setSuccess("Administrator added.");
    const organization = organizations.find((item) => item.id === profile?.organization_id);
    if (organization && person) {
      setProvisioning({
        organization: { ...organization, lifecycle_status: organization.lifecycle_status ?? "active", administrators_count: Math.max(1, Number(organization.administrators_count ?? 0) + 1) },
        adminName: formatDisplayText(person.name),
      });
    }
    load();
  }

  async function initiatePasswordReset() {
    if (!resetTarget) return;
    setBusy(true);
    setError("");
    try {
      const response = await initiateSystemAdminPasswordReset(resetTarget.school_id);
      if (response.reset_link) {
        setResetLink({ link: response.reset_link, name: `${resetTarget.first_name} ${resetTarget.last_name}` });
      } else {
        setSuccess(response.message || "Password reset instructions were sent.");
      }
      setResetTarget(null);
    } catch (requestError) {
      setResetTarget(null);
      setError(getApiErrorMessage(requestError, "Could not initiate the password reset."));
    } finally {
      setBusy(false);
    }
  }

  const provisioned = provisioning?.adminName ? provisioning : null;
  const awaiting = provisioning && !provisioned ? provisioning : null;
  const newAdminButton = (
    <Button variant={awaiting ? "secondary" : "primary"} leftIcon={UserPlus} onClick={() => openCreate()}>Add administrator</Button>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        primary={awaiting ? undefined : newAdminButton}
        actions={awaiting ? newAdminButton : undefined}
        stepper={provisioning && <RegistrationStepper organization={provisioning.organization} viewerRole="SUPER_ADMIN" />}
        nextStep={provisioned ? (
          <NextStep
            tone="done"
            title={`Done: ${provisioned.adminName} can sign in`}
            body={`${formatDisplayText(provisioned.organization.name)} now has an administrator.`}
            primary={{ label: "Open organization", to: organizationOverviewPath(provisioned.organization.id) }}
          />
        ) : awaiting && (
          <RegistrationNextStep
            organization={awaiting.organization}
            viewerRole="SUPER_ADMIN"
            onPrimary={() => openCreate(awaiting.organization)}
          />
        )}
      />
      {profileUser && <ManageAccountProfilesModal user={profileUser} onClose={() => setProfileUser(null)} onDeleted={(result) => { setSuccess(result.message); load(); }} />}
      {addingAdmin && <AddExistingUserModal actorRole="SUPER_ADMIN" initialRole="ADMIN" organization={addingAdmin.organization} onClose={() => setAddingAdmin(null)} onAdded={adminAdded} />}
      {membershipUser && <AddExistingUserModal actorRole="SUPER_ADMIN" initialUser={membershipUser} onClose={() => setMembershipUser(null)} onAdded={() => setSuccess('Organization profile added to the existing user.')} />}
      <p className="text-sm text-ink-muted">
        {admins.length} {admins.length === 1 ? "administrator" : "administrators"}, {activeCount} active, covering {coveredOrganizations} {coveredOrganizations === 1 ? "organization" : "organizations"}
      </p>

      {success && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-card border border-success-strong/20 bg-success-tint px-4 py-3 text-sm font-medium text-success-strong">
          <span>{success}</span>
          <button type="button" onClick={() => setSuccess("")} className="min-h-10 shrink-0 font-medium underline underline-offset-2">
            Dismiss
          </button>
        </div>
      )}
      {error && !form && (
        <div role="alert" className="rounded-card border border-danger-strong/20 bg-danger-tint px-4 py-3 text-sm font-medium text-danger-strong">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="Search" className="sm:flex-1">
          <Input
            type="search"
            aria-label="Search administrators"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, email, or position"
          />
        </Field>
        <Field label="Organization" className="sm:w-56">
          <HiusaSelect filter
            aria-label="Filter by organization"
            value={organizationFilter}
            onChange={(event) => setOrganizationFilter(event.target.value)}
          >
            <option value="">All organizations</option>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.acronym}: {formatDisplayText(organization.name)}
              </option>
            ))}
          </HiusaSelect>
        </Field>
        <Field label="Status" className="sm:w-44">
          <HiusaSelect filter
            aria-label="Filter by account status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="disabled">Disabled</option>
          </HiusaSelect>
        </Field>
        {filtersActive && (
          <button type="button" onClick={clearFilters} className="inline-flex min-h-11 items-center rounded-control text-sm font-medium text-brand-700 hover:underline sm:self-end">Clear</button>
        )}
      </div>

      <section>
        {loading ? (
          <SkeletonTable columns={4} rows={5} />
        ) : loadError ? (
          <ErrorState title="Administrators could not load" description={loadError} onRetry={() => load()} />
        ) : visibleAdmins.length === 0 ? (
          filtersActive ? (
            <EmptyState kind="filtered" description="Try a different name or clear the filters." onClearFilters={clearFilters} />
          ) : (
            <EmptyState title="No administrators yet" description="Add an administrator so an organization has someone who can sign in." />
          )
        ) : (
          <>
            <div className="hidden md:block" data-view="table">
              <table className="w-full table-fixed border-collapse text-left text-sm">
                <caption className="sr-only">Administrator accounts</caption>
                <colgroup>
                  <col className="w-[38%]" />
                  <col className="w-[16%]" />
                  <col className="w-[22%]" />
                  <col className="w-[14%]" />
                  <col className="w-[10%]" />
                </colgroup>
                <thead className="bg-subtle text-xs text-ink-muted">
                  <tr>
                    <th scope="col" className="border-b border-line px-4 py-2.5 font-semibold">Administrator</th>
                    <th scope="col" className="border-b border-line px-4 py-2.5 font-semibold">Organization</th>
                    <th scope="col" className="border-b border-line px-4 py-2.5 font-semibold">Position</th>
                    <th scope="col" className="border-b border-line px-4 py-2.5 font-semibold">Status</th>
                    <th scope="col" className="border-b border-line px-4 py-2.5 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                {groups.map(([label, members]) => (
                  <tbody key={label}>
                    <tr><th colSpan={5} scope="rowgroup" className="px-4 pb-1 pt-4 text-left text-xs font-semibold text-ink-muted">{label}</th></tr>
                    {members.map((admin) => (
                      <tr key={profileKey(admin)} className="border-b border-line-soft transition-colors duration-150 hover:bg-subtle">
                        <td className="px-4 py-2.5 align-middle"><AdminIdentity admin={admin} /></td>
                        <td className="break-words px-4 py-2.5 align-middle text-ink">
                          {admin.organization?.acronym || formatDisplayText(admin.organization?.name)}
                        </td>
                        <td className="break-words px-4 py-2.5 align-middle text-ink">
                          {formatDisplayText(admin.position_title)}
                        </td>
                        <td className="px-4 py-2.5 align-middle">{admin.account_status !== "active" && <StatusBadge status={admin.account_status} />}</td>
                        <td className="px-4 py-2.5 text-right align-middle">{rowActions(admin)}</td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>

            <div className="md:hidden" data-view="cards">
              {groups.map(([label, members]) => (
                <div key={label}>
                  <p className="pb-1 pt-3 text-xs font-semibold text-ink-muted">{label}</p>
                  <ul className="flex flex-col divide-y divide-line-soft border-y border-line-soft">
                    {members.map((admin) => (
                      <li key={profileKey(admin)} className="flex items-start justify-between gap-3 py-3">
                        <div className="min-w-0 flex-1">
                          <AdminIdentity admin={admin} />
                          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-ink-muted-strong">
                            <span>{[admin.organization?.acronym || formatDisplayText(admin.organization?.name), formatDisplayText(admin.position_title)].filter(Boolean).join(", ")}</span>
                            {admin.account_status !== "active" && <StatusBadge status={admin.account_status} />}
                          </p>
                        </div>
                        {rowActions(admin)}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <Drawer
        open={Boolean(form)}
        title="Edit administrator"
        description="Change the contact details or status of this account."
        onClose={() => !busy && setForm(null)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setForm(null)} disabled={busy}>Cancel</Button>
            <Button type="submit" form="edit-administrator-form" loading={busy}>Save changes</Button>
          </>
        )}
      >
        {form && (
          <form id="edit-administrator-form" onSubmit={save} className="flex flex-col gap-4">
            <Field label="First name" required>
              <Input value={form.first_name} onChange={(event) => updateField("first_name", event.target.value)} />
            </Field>
            <Field label="Last name" required>
              <Input value={form.last_name} onChange={(event) => updateField("last_name", event.target.value)} />
            </Field>
            <Field label="Email address" required>
              <Input type="email" value={form.email} onChange={(event) => updateField("email", event.target.value)} />
            </Field>
            <Field label="Contact number" optional>
              <Input inputMode="tel" value={form.contact_number} onChange={(event) => updateField("contact_number", event.target.value)} placeholder="0917 123 4567" />
            </Field>
            <Field label="Position title" optional>
              <Input list="admin-leadership-titles" value={form.position_title} onChange={(event) => updateField("position_title", event.target.value)} placeholder="Adviser, President" />
            </Field>
            <datalist id="admin-leadership-titles">
              {LEADERSHIP_TITLES.map((title) => <option key={title} value={title} />)}
            </datalist>
            <Field label="Assigned organization" required>
              <HiusaSelect value={form.organization_id} onChange={(event) => updateField("organization_id", event.target.value)}>
                <option value="">Select an active student organization</option>
                {organizations
                  .filter((organization) => organization.is_active || String(organization.id) === form.organization_id)
                  .map((organization) => (
                    <option key={organization.id} value={organization.id}>
                      {organization.acronym}: {formatDisplayText(organization.name)}{organization.is_active ? "" : " (inactive)"}
                    </option>
                  ))}
              </HiusaSelect>
            </Field>
            <Field label="Account status">
              <HiusaSelect value={form.account_status} onChange={(event) => updateField("account_status", event.target.value)}>
                <option value="active">Active: can sign in</option>
                <option value="inactive">Inactive: temporarily unavailable</option>
                <option value="disabled">Disabled: access revoked</option>
              </HiusaSelect>
            </Field>
            {error && <p role="alert" className="text-sm font-medium text-danger-strong">{error}</p>}
          </form>
        )}
      </Drawer>
      <ConfirmModal
        open={Boolean(resetTarget)}
        title="Initiate password reset"
        message="This creates a one-time reset link. It is shown to you once to hand over, and it is emailed only when email is turned on. Their current password is not shown."
        recordName={resetTarget ? `${resetTarget.first_name} ${resetTarget.last_name}` : ""}
        confirmText="Create reset link"
        busy={busy}
        onCancel={() => !busy && setResetTarget(null)}
        onConfirm={initiatePasswordReset}
      />
      {resetLink && (
        <OneTimeLinkModal
          title="Reset link ready"
          description={`Send this to ${resetLink.name}. It lets them choose a new password.`}
          label="Reset link"
          hint="Works once and expires in 60 minutes. It is not shown again."
          link={resetLink.link}
          onClose={() => { setSuccess(`Reset link created for ${resetLink.name}.`); setResetLink(null); }}
        />
      )}
      <ConfirmModal open={Boolean(deleteTarget)} title="Delete administrator" message="This removes the administrator profile. Accounts with linked records cannot be deleted." recordName={deleteTarget ? `${deleteTarget.first_name} ${deleteTarget.last_name}` : ''} confirmText="Delete administrator" busy={busy} onCancel={() => !busy && setDeleteTarget(null)} onConfirm={removeAdmin} />
    </div>
  );
}
