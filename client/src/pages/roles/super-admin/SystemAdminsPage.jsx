import HiusaSelect from '../../../components/ui/Select';
import { matchesFilter } from '../../../utils/filterValues';
import { formatDisplayText } from '../../../utils/displayText.js';
import FieldIcon from '../../../components/FieldIcon.jsx';
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowRightLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  PencilLine,
  Search,
  Trash2,
  ShieldCheck,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import {
  createSystemAdmin,
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
import AccessibleOverlay from "../../../components/AccessibleOverlay";
import TableRowActions from "../../../components/TableRowActions";
import AdminHandoverDrawer from "./AdminHandoverDrawer";
import { organizationOverviewPath } from "./agencyStatus";
import { Button, NextStep, PageHeader } from "../../../components/ui";
import { RegistrationNextStep, RegistrationStepper } from "../../../components/organizations/RegistrationFlow";
import { useRefetchOnReturn } from '../../../hooks/useRefetchOnReturn';
import AddExistingUserModal from '../../../components/users/AddExistingUserModal';
import ManageAccountProfilesModal from '../../../components/users/ManageAccountProfilesModal';

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
  organization_locked: false,
  position_title: "",
  account_status: "active",
  password: "",
  password_confirmation: "",
});

function statusStyle(status) {
  if (status === "active") return "bg-emerald-50 text-emerald-700";
  if (status === "disabled") return "bg-red-50 text-red-700";
  return "bg-slate-100 text-slate-600";
}

const profileKey = (admin) => admin.profile_id ?? `${admin.school_id}-${admin.organization_id}`;
const isPrimaryProfile = (admin) => admin.is_primary_profile !== false;

function AdminIdentity({ admin }) {
  return (
    <div className="min-w-0">
      <p className="break-words font-bold text-ink">
        {formatDisplayText(admin.first_name)} {formatDisplayText(admin.last_name)}
      </p>
      <p className="break-words text-xs text-ink-muted">
        {admin.email} · {admin.school_id}
      </p>
      {!isPrimaryProfile(admin) && <p className="text-xs font-medium text-ink-muted">Added through a profile</p>}
    </div>
  );
}

function StatusPill({ status }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${statusStyle(status)}`}>
      {status}
    </span>
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
  const [success, setSuccess] = useState("");
  const [resetTarget, setResetTarget] = useState(null);
  const [handoverTarget, setHandoverTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [membershipUser, setMembershipUser] = useState(null);
  const [profileUser, setProfileUser] = useState(null);
  const [showPassword, setShowPassword] = useState(false);

  const loadEpoch = useRef(0);
  const load = useCallback(async ({ silent = false } = {}) => {
    // A silent refresh never touches the loading flag or the shared error, which the
    // open form and the action modals also use, and yields to any newer full load.
    if (!silent) {
      loadEpoch.current += 1;
      setLoading(true);
      setError("");
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
      setError(
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
      openCreate({ organization_id: String(organization.id), organization_locked: true });
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
        { label: 'Hand over role', icon: ArrowRightLeft, disabled: admin.account_status !== 'active', onClick: () => setHandoverTarget(admin) },
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
  const isEditing = Boolean(form?.editing_school_id);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setError("");
  }

  function openCreate(preset = {}) {
    setError("");
    setSuccess("");
    setShowPassword(false);
    setForm({ ...emptyForm(), ...preset });
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

    if (!isEditing && form.password !== form.password_confirmation) {
      setError("Password confirmation does not match.");
      return;
    }

    const payload = {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      email: form.email.trim().toLowerCase(),
      contact_number: form.contact_number.trim() || null,
      organization_id: Number(form.organization_id),
      position_title: form.position_title.trim() || null,
    };

    if (isEditing) {
      payload.account_status = form.account_status;
    } else {
      payload.school_id = Number(form.school_id);
      payload.password = form.password;
      payload.password_confirmation = form.password_confirmation;
    }

    setBusy(true);
    setError("");
    try {
      if (isEditing) {
        await updateSystemAdmin(form.editing_school_id, payload);
        setSuccess("Administrator account updated successfully.");
      } else {
        await createSystemAdmin(payload);
        setSuccess("New Admin user created with the password set by SAO.");
        const organization = organizations.find((item) => item.id === payload.organization_id);
        if (organization) setProvisioning({ organization: { ...organization, lifecycle_status: organization.lifecycle_status ?? "active", administrators_count: Math.max(1, Number(organization.administrators_count ?? 0) + 1) }, adminName: `${formatDisplayText(payload.first_name)} ${formatDisplayText(payload.last_name)}` });
      }
      setForm(null);
      await load();
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          isEditing
            ? "Could not update the administrator."
            : "Could not create the Admin user.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function initiatePasswordReset() {
    if (!resetTarget) return;
    setBusy(true);
    setError("");
    try {
      const response = await initiateSystemAdminPasswordReset(resetTarget.school_id);
      setSuccess(response.message || "Password reset instructions were sent.");
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
    <Button variant={awaiting ? "secondary" : "primary"} leftIcon={UserPlus} onClick={() => openCreate()}>New Admin User</Button>
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
            onPrimary={() => openCreate({ organization_id: String(awaiting.organization.id), organization_locked: true })}
          />
        )}
      />
      {profileUser && <ManageAccountProfilesModal user={profileUser} onClose={() => setProfileUser(null)} onDeleted={(result) => { setSuccess(result.message); load(); }} />}
      {membershipUser && <AddExistingUserModal actorRole="SUPER_ADMIN" initialUser={membershipUser} onClose={() => setMembershipUser(null)} onAdded={() => setSuccess('Organization profile added to the existing user.')} />}
      <section className="grid gap-3 sm:grid-cols-3">
        {[
          ["Total Admins", admins.length, Users],
          ["Active Accounts", activeCount, CheckCircle2],
          ["Organizations Covered", coveredOrganizations, ShieldCheck],
        ].map(([label, value, Icon]) => (
          <article
            key={label}
            className="rounded-lg border border-[#DDE7EF] bg-white p-4 shadow-sm"
          >
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#E6F6FD] text-[#0F2F62]">
              <Icon size={17} />
            </span>
            <p className="mt-3 text-xs font-semibold text-slate-500">{label}</p>
            <p className="mt-1 text-2xl font-black text-[#0F172A]">{value}</p>
          </article>
        ))}
      </section>

      {success && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          <span className="flex items-start gap-2">
            <CheckCircle2 size={17} className="mt-0.5 shrink-0" /> {success}
          </span>
          <button type="button" onClick={() => setSuccess("")}>
            Dismiss
          </button>
        </div>
      )}
      {error && !form && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          <AlertCircle size={17} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      <section className="rounded-lg border border-[#DDE7EF] bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_220px_180px]">
          <label className="flex h-11 items-center sm:col-span-2 lg:col-span-1 gap-2 rounded-lg border border-[#DDE7EF] px-3 focus-within:border-[#0B8ED0] focus-within:ring-4 focus-within:ring-[#16C7F3]/15">
            <Search size={16} className="shrink-0 text-slate-500" />
            <span className="sr-only">Search administrators</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, School ID, email, or position"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </label>
          <HiusaSelect filter
            aria-label="Filter by organization"
            value={organizationFilter}
            onChange={(event) => setOrganizationFilter(event.target.value)}
            className="h-11 w-full min-w-0 rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm font-semibold text-slate-600 outline-none focus:border-[#0B8ED0]"
          >
            <option value="">All organizations</option>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.acronym}: {formatDisplayText(organization.name)}
              </option>
            ))}
          </HiusaSelect>
          <HiusaSelect filter
            aria-label="Filter by account status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="h-11 w-full min-w-0 rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm font-semibold text-slate-600 outline-none focus:border-[#0B8ED0]"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="disabled">Disabled</option>
          </HiusaSelect>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-[#DDE7EF] bg-white shadow-sm">
        {loading ? (
          <div className="space-y-3 p-5">
            {[1, 2, 3].map((row) => (
              <div key={row} className="h-16 animate-pulse rounded-lg bg-slate-100" />
            ))}
          </div>
        ) : visibleAdmins.length === 0 ? (
          <div className="p-10 text-center">
            <Users size={38} className="mx-auto text-slate-200" />
            <p className="mt-3 text-sm font-bold text-[#0F172A]">
              No administrator accounts match this view.
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Change the filters or create a new Admin user.
            </p>
          </div>
        ) : (
          <>
            <div className="hidden md:block" data-view="table">
              <table className="w-full table-fixed border-collapse text-left text-sm">
                <colgroup>
                  <col className="w-[38%]" />
                  <col className="w-[16%]" />
                  <col className="w-[22%]" />
                  <col className="w-[14%]" />
                  <col className="w-[10%]" />
                </colgroup>
                <thead className="bg-subtle text-xs uppercase tracking-wide text-ink-muted">
                  <tr>
                    <th scope="col" className="border-b border-line px-4 py-3 font-bold">Administrator</th>
                    <th scope="col" className="border-b border-line px-4 py-3 font-bold">Organization</th>
                    <th scope="col" className="border-b border-line px-4 py-3 font-bold">Position</th>
                    <th scope="col" className="border-b border-line px-4 py-3 font-bold">Status</th>
                    <th scope="col" className="border-b border-line px-4 py-3 text-right font-bold">Actions</th>
                  </tr>
                </thead>
                {groups.map(([label, members]) => (
                  <tbody key={label}>
                    <tr className="bg-[#EEF6FB]"><th colSpan={5} scope="rowgroup" className="px-4 py-2 text-left text-xs font-bold text-[#0F2F62]">{label}</th></tr>
                    {members.map((admin) => (
                      <tr key={profileKey(admin)} className="border-b border-line-soft transition-colors duration-150 hover:bg-subtle">
                        <td className="px-4 py-3 align-middle"><AdminIdentity admin={admin} /></td>
                        <td className="break-words px-4 py-3 align-middle font-semibold text-ink-muted-strong">
                          {admin.organization?.acronym || formatDisplayText(admin.organization?.name) || "Not assigned"}
                        </td>
                        <td className="break-words px-4 py-3 align-middle text-ink-muted-strong">
                          {formatDisplayText(admin.position_title) || "Organization Admin"}
                        </td>
                        <td className="px-4 py-3 align-middle"><StatusPill status={admin.account_status} /></td>
                        <td className="px-4 py-3 text-right align-middle">{rowActions(admin)}</td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>

            <div className="md:hidden" data-view="cards">
              {groups.map(([label, members]) => (
                <div key={label}>
                  <p className="bg-[#EEF6FB] px-4 py-2 text-xs font-bold text-[#0F2F62]">{label}</p>
                  <ul className="flex flex-col divide-y divide-line-soft">
                    {members.map((admin) => (
                      <li key={profileKey(admin)} className="px-4 py-4">
                        <AdminIdentity admin={admin} />
                        <dl className="mt-3 flex flex-col gap-2">
                          <div className="flex items-start justify-between gap-3">
                            <dt className="text-xs font-bold uppercase tracking-wide text-ink-muted">Organization</dt>
                            <dd className="min-w-0 break-words text-right text-sm font-semibold text-ink">{admin.organization?.acronym || formatDisplayText(admin.organization?.name) || "Not assigned"}</dd>
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <dt className="text-xs font-bold uppercase tracking-wide text-ink-muted">Position</dt>
                            <dd className="min-w-0 break-words text-right text-sm font-semibold text-ink">{formatDisplayText(admin.position_title) || "Organization Admin"}</dd>
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <dt className="text-xs font-bold uppercase tracking-wide text-ink-muted">Status</dt>
                            <dd><StatusPill status={admin.account_status} /></dd>
                          </div>
                        </dl>
                        <div className="mt-3 flex items-center justify-end gap-2 border-t border-line-soft pt-3">{rowActions(admin)}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {form && (
        <AccessibleOverlay label={isEditing ? "Edit administrator" : "Create administrator"} onClose={() => !busy && setForm(null)} className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 p-4 backdrop-blur-sm">
          <form
            onSubmit={save}
            className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-[#DDE7EF] bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between border-b border-[#DDE7EF] px-5 py-4">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#E6F6FD] text-[#0F2F62]">
                  {isEditing ? <PencilLine size={18} /> : <UserPlus size={18} />}
                </span>
                <div>
                  <h3 className="text-lg font-black text-[#0F172A]">
                    {isEditing ? "Edit Admin User" : "Create New Admin User"}
                  </h3>
                  <p className="mt-0.5 text-xs font-medium text-slate-500">
                    SAO assigns this account to one student organization. Its system role is fixed to Admin.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setForm(null)}
                aria-label="Close administrator form"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-[#F8FBFD] hover:text-[#0F172A]"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid gap-4 p-5 sm:grid-cols-2">
              {!isEditing && (
                <label className="space-y-1.5 text-[13px] font-semibold text-[#0F172A]">
                 <FieldIcon label="School ID *" /> School ID *
                  <input required type="number" min="1" max="99999999" value={form.school_id} onChange={(event) => updateField("school_id", event.target.value)} className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm font-normal outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
                </label>
              )}
              {isEditing && (
                <div className="rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-3 py-2 sm:col-span-2">
                  <p className="text-[11px] font-bold uppercase text-slate-500">School ID</p>
                  <p className="mt-0.5 font-bold text-[#0F172A]">{form.school_id}</p>
                </div>
              )}
              <label className="space-y-1.5 text-[13px] font-semibold text-[#0F172A]">
               <FieldIcon label="First name *" /> First name *
                <input required value={form.first_name} onChange={(event) => updateField("first_name", event.target.value)} className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm font-normal outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
              </label>
              <label className="space-y-1.5 text-[13px] font-semibold text-[#0F172A]">
               <FieldIcon label="Last name *" /> Last name *
                <input required value={form.last_name} onChange={(event) => updateField("last_name", event.target.value)} className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm font-normal outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
              </label>
              <label className="space-y-1.5 text-[13px] font-semibold text-[#0F172A] sm:col-span-2">
               <FieldIcon label="Email address *" /> Email address *
                <input required type="email" value={form.email} onChange={(event) => updateField("email", event.target.value)} className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm font-normal outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
              </label>
              <label className="space-y-1.5 text-[13px] font-semibold text-[#0F172A]">
               <FieldIcon label="Contact number" /> Contact number
                <input inputMode="tel" value={form.contact_number} onChange={(event) => updateField("contact_number", event.target.value)} placeholder="e.g. 0917 123 4567" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm font-normal outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
              </label>
              <label className="space-y-1.5 text-[13px] font-semibold text-[#0F172A]">
               <FieldIcon label="Position title" /> Position title
                <input list="admin-leadership-titles" value={form.position_title} onChange={(event) => updateField("position_title", event.target.value)} placeholder="Select or enter a title" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm font-normal outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
                <datalist id="admin-leadership-titles">
                  {LEADERSHIP_TITLES.map((title) => <option key={title} value={title} />)}
                </datalist>
              </label>
              <label className="space-y-1.5 text-[13px] font-semibold text-[#0F172A] sm:col-span-2">
                <FieldIcon label="Assigned organization *" />Assigned organization *
                <HiusaSelect required disabled={form.organization_locked} value={form.organization_id} onChange={(event) => updateField("organization_id", event.target.value)} className="h-11 w-full rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm font-normal outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15">
                  <option value="">Select an active student organization</option>
                  {organizations
                    .filter((organization) => organization.is_active || String(organization.id) === form.organization_id)
                    .map((organization) => (
                      <option key={organization.id} value={organization.id}>
                        {organization.acronym}: {formatDisplayText(organization.name)}{organization.is_active ? "" : " (inactive)"}
                      </option>
                    ))}
                </HiusaSelect>
                {form.organization_locked && <span className="block text-xs font-medium text-slate-500">This Admin account belongs to the selected organization.</span>}
              </label>
              {!isEditing && (
                <>
                  <label className="space-y-1.5 text-[13px] font-semibold text-[#0F172A]">
                    <FieldIcon label="Password *" />Password *
                    <span className="relative block">
                      <input
                        required
                        type={showPassword ? "text" : "password"}
                        minLength={8}
                        autoComplete="new-password"
                        value={form.password}
                        onChange={(event) => updateField("password", event.target.value)}
                        placeholder="At least 8 characters"
                        className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 pr-11 text-sm font-normal outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                      />
                      <button
                        type="button"
                        aria-label={showPassword ? "Hide administrator password" : "Show administrator password"}
                        onClick={() => setShowPassword((visible) => !visible)}
                        className="absolute inset-y-0 right-0 grid w-11 place-items-center text-slate-500 transition hover:text-[#0878B7]"
                      >
                        {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                      </button>
                    </span>
                  </label>
                  <label className="space-y-1.5 text-[13px] font-semibold text-[#0F172A]">
                    <FieldIcon label="Confirm password *" />Confirm password *
                    <input
                      required
                      type={showPassword ? "text" : "password"}
                      minLength={8}
                      autoComplete="new-password"
                      value={form.password_confirmation}
                      onChange={(event) => updateField("password_confirmation", event.target.value)}
                      placeholder="Enter the password again"
                      className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm font-normal outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                    />
                  </label>
                  <div className="rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-4 py-3 text-xs font-medium leading-5 text-slate-600 sm:col-span-2">
                    SAO sets the initial password. It is securely hashed and is never shown again, so provide it to the Admin through an approved private channel.
                  </div>
                </>
              )}
              {isEditing && (
                <label className="space-y-1.5 text-[13px] font-semibold text-[#0F172A] sm:col-span-2">
                 <FieldIcon label="Account status" /> Account status
                  <HiusaSelect value={form.account_status} onChange={(event) => updateField("account_status", event.target.value)} className="h-11 w-full rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm font-normal outline-none focus:border-[#0B8ED0]">
                    <option value="active">Active: can sign in</option>
                    <option value="inactive">Inactive: temporarily unavailable</option>
                    <option value="disabled">Disabled: access revoked</option>
                  </HiusaSelect>
                </label>
              )}
              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-semibold text-red-700 sm:col-span-2">
                  <AlertCircle size={15} className="mt-0.5 shrink-0" /> {error}
                </div>
              )}
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-[#DDE7EF] px-5 py-4 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setForm(null)} disabled={busy} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD] disabled:opacity-50">
                Cancel
              </button>
              <button disabled={busy} className="h-11 rounded-lg bg-[#0878B7] px-5 text-sm font-bold text-white hover:bg-[#0F2F62] disabled:opacity-50">
                {busy ? "Saving..." : isEditing ? "Save Changes" : "Create Admin User"}
              </button>
            </div>
          </form>
        </AccessibleOverlay>
      )}
      <ConfirmModal
        open={Boolean(resetTarget)}
        title="Initiate password reset"
        message="A secure reset link will be sent to the administrator's registered email address. Their current password will not be shown."
        recordName={resetTarget ? `${resetTarget.first_name} ${resetTarget.last_name}` : ""}
        confirmText="Send reset link"
        busy={busy}
        onCancel={() => !busy && setResetTarget(null)}
        onConfirm={initiatePasswordReset}
      />
      <ConfirmModal open={Boolean(deleteTarget)} title="Delete administrator" message="This removes the administrator profile. Accounts with linked records cannot be deleted." recordName={deleteTarget ? `${deleteTarget.first_name} ${deleteTarget.last_name}` : ''} confirmText="Delete administrator" busy={busy} onCancel={() => !busy && setDeleteTarget(null)} onConfirm={removeAdmin} />
      <AdminHandoverDrawer admin={handoverTarget} onClose={() => setHandoverTarget(null)} onDone={() => load()} />
    </div>
  );
}
