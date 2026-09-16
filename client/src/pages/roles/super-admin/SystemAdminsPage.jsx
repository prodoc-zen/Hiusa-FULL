import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  PencilLine,
  Search,
  ShieldCheck,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import {
  createSystemAdmin,
  getSystemAdmins,
  getSystemOrganizations,
  initiateSystemAdminPasswordReset,
  updateSystemAdmin,
} from "../../../services/systemAdministrationService";
import { getApiErrorMessage } from "../../../utils/apiError";
import ConfirmModal from "../../../components/ConfirmModal";

const LEADERSHIP_TITLES = [
  "Adviser",
  "President",
  "Vice President – Internal",
  "Vice President – External",
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

function statusStyle(status) {
  if (status === "active") return "bg-emerald-50 text-emerald-700";
  if (status === "disabled") return "bg-red-50 text-red-700";
  return "bg-slate-100 text-slate-600";
}

export default function SystemAdminsPage() {
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

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [adminData, organizationData] = await Promise.all([
        getSystemAdmins({ per_page: 100 }),
        getSystemOrganizations({ per_page: 100, status: "all" }),
      ]);
      setAdmins(adminData.data || []);
      setOrganizations(organizationData.data || []);
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "Unable to load SAO administrator accounts.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
      const matchesOrganization =
        !organizationFilter ||
        String(admin.organization_id) === organizationFilter;
      const matchesStatus =
        statusFilter === "all" || admin.account_status === statusFilter;
      return matchesSearch && matchesOrganization && matchesStatus;
    });
  }, [admins, organizationFilter, search, statusFilter]);

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

  function openCreate() {
    setError("");
    setSuccess("");
    setForm(emptyForm());
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
    };

    if (isEditing) {
      payload.account_status = form.account_status;
    } else {
      payload.school_id = Number(form.school_id);
    }

    setBusy(true);
    setError("");
    try {
      if (isEditing) {
        await updateSystemAdmin(form.editing_school_id, payload);
        setSuccess("Administrator account updated successfully.");
      } else {
        await createSystemAdmin(payload);
        setSuccess(
          "New Admin user created. A secure password setup link was sent to their email address.",
        );
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

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-5 rounded-lg bg-[#0B1831] p-6 text-white shadow-sm sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#16C7F3]">
            SAO administration
          </p>
          <h2 className="mt-2 text-2xl font-black">Admin User Management</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-300">
            Create and manage the President, Vice President, Secretary,
            Adviser, and other authorized Admin users for each student
            organization. Adviser assignment is reserved for the SAO Director.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-[#0B8ED0] px-4 text-sm font-bold text-white transition hover:bg-[#0878B7]"
        >
          <UserPlus size={17} /> New Admin User
        </button>
      </section>

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
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#E6F6FD] text-[#0B8ED0]">
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
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_180px]">
          <label className="flex h-11 items-center gap-2 rounded-lg border border-[#DDE7EF] px-3 focus-within:border-[#0B8ED0] focus-within:ring-4 focus-within:ring-[#16C7F3]/15">
            <Search size={16} className="shrink-0 text-slate-400" />
            <span className="sr-only">Search administrators</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, School ID, email, or position"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </label>
          <select
            aria-label="Filter by organization"
            value={organizationFilter}
            onChange={(event) => setOrganizationFilter(event.target.value)}
            className="h-11 rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm font-semibold text-slate-600 outline-none focus:border-[#0B8ED0]"
          >
            <option value="">All organizations</option>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.acronym} — {organization.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by account status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="h-11 rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm font-semibold text-slate-600 outline-none focus:border-[#0B8ED0]"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="disabled">Disabled</option>
          </select>
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-[#F8FBFD] text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="p-4">Administrator</th>
                  <th className="p-4">Organization</th>
                  <th className="p-4">Position</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleAdmins.map((admin) => (
                  <tr key={admin.school_id} className="border-t border-[#E5EDF3] hover:bg-[#F8FBFD]">
                    <td className="p-4">
                      <p className="font-bold text-[#0F172A]">
                        {admin.first_name} {admin.last_name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {admin.email} · {admin.school_id}
                      </p>
                    </td>
                    <td className="p-4 font-semibold text-slate-600">
                      {admin.organization?.acronym || admin.organization?.name || "—"}
                    </td>
                    <td className="p-4 text-slate-600">
                      {admin.position_title || "Organization Admin"}
                    </td>
                    <td className="p-4">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${statusStyle(admin.account_status)}`}>
                        {admin.account_status}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setResetTarget(admin)}
                          disabled={admin.account_status !== "active"}
                          aria-label={`Initiate password reset for ${admin.first_name} ${admin.last_name}`}
                          className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#DDE7EF] px-3 text-xs font-bold text-slate-600 hover:bg-[#EEF6FB] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <KeyRound size={14} /> Reset access
                        </button>
                        <button
                          type="button"
                          onClick={() => openEdit(admin)}
                          aria-label={`Edit ${admin.first_name} ${admin.last_name}`}
                          className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#DDE7EF] px-3 text-xs font-bold text-[#0B8ED0] hover:bg-[#EEF6FB]"
                        >
                          <PencilLine size={14} /> Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 p-4 backdrop-blur-sm">
          <form
            onSubmit={save}
            className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-[#DDE7EF] bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between border-b border-[#DDE7EF] px-5 py-4">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#E6F6FD] text-[#0B8ED0]">
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
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-[#EEF6FB] hover:text-[#0F172A]"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid gap-4 p-5 sm:grid-cols-2">
              {!isEditing && (
                <label className="space-y-1.5 text-[13px] font-semibold text-[#0F172A]">
                  School ID *
                  <input required type="number" min="1" max="99999999" value={form.school_id} onChange={(event) => updateField("school_id", event.target.value)} className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm font-normal outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
                </label>
              )}
              {isEditing && (
                <div className="rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-3 py-2 sm:col-span-2">
                  <p className="text-[11px] font-bold uppercase text-slate-400">School ID</p>
                  <p className="mt-0.5 font-bold text-[#0F172A]">{form.school_id}</p>
                </div>
              )}
              <label className="space-y-1.5 text-[13px] font-semibold text-[#0F172A]">
                First name *
                <input required value={form.first_name} onChange={(event) => updateField("first_name", event.target.value)} className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm font-normal outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
              </label>
              <label className="space-y-1.5 text-[13px] font-semibold text-[#0F172A]">
                Last name *
                <input required value={form.last_name} onChange={(event) => updateField("last_name", event.target.value)} className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm font-normal outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
              </label>
              <label className="space-y-1.5 text-[13px] font-semibold text-[#0F172A] sm:col-span-2">
                Email address *
                <input required type="email" value={form.email} onChange={(event) => updateField("email", event.target.value)} className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm font-normal outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
              </label>
              <label className="space-y-1.5 text-[13px] font-semibold text-[#0F172A]">
                Contact number
                <input inputMode="tel" value={form.contact_number} onChange={(event) => updateField("contact_number", event.target.value)} placeholder="e.g. 0917 123 4567" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm font-normal outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
              </label>
              <label className="space-y-1.5 text-[13px] font-semibold text-[#0F172A]">
                Position title
                <input list="admin-leadership-titles" value={form.position_title} onChange={(event) => updateField("position_title", event.target.value)} placeholder="Select or enter a title" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm font-normal outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
                <datalist id="admin-leadership-titles">
                  {LEADERSHIP_TITLES.map((title) => <option key={title} value={title} />)}
                </datalist>
              </label>
              <label className="space-y-1.5 text-[13px] font-semibold text-[#0F172A] sm:col-span-2">
                Assigned organization *
                <select required value={form.organization_id} onChange={(event) => updateField("organization_id", event.target.value)} className="h-11 w-full rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm font-normal outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15">
                  <option value="">Select an active student organization</option>
                  {organizations
                    .filter((organization) => organization.is_active || String(organization.id) === form.organization_id)
                    .map((organization) => (
                      <option key={organization.id} value={organization.id}>
                        {organization.acronym} — {organization.name}{organization.is_active ? "" : " (inactive)"}
                      </option>
                    ))}
                </select>
              </label>
              {!isEditing && (
                <div className="rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-4 py-3 text-xs font-medium leading-5 text-slate-600 sm:col-span-2">
                  HIUSA generates an unusable temporary secret and emails this Admin a secure link to choose their own password. SAO cannot view or set it.
                </div>
              )}
              {isEditing && (
                <label className="space-y-1.5 text-[13px] font-semibold text-[#0F172A] sm:col-span-2">
                  Account status
                  <select value={form.account_status} onChange={(event) => updateField("account_status", event.target.value)} className="h-11 w-full rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm font-normal outline-none focus:border-[#0B8ED0]">
                    <option value="active">Active — can sign in</option>
                    <option value="inactive">Inactive — temporarily unavailable</option>
                    <option value="disabled">Disabled — access revoked</option>
                  </select>
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
              <button disabled={busy} className="h-11 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7] disabled:opacity-50">
                {busy ? "Saving..." : isEditing ? "Save Changes" : "Create Admin User"}
              </button>
            </div>
          </form>
        </div>
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
    </div>
  );
}
