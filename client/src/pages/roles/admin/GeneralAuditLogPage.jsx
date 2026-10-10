import { formatDisplayText } from '../../../utils/displayText.js';
import DateTimeInput from '../../../components/ui/DateTimeInput.jsx';
import FieldIcon from '../../../components/FieldIcon.jsx';
import { useEffect, useMemo, useState } from "react";
import { Clock3, Download, Eye, X } from "lucide-react";
import { EmptyState, PageHeader } from "../../../components/ui";
import PaginationControls from "../../../components/PaginationControls";
import TableFilterBar from "../../../components/TableFilterBar";
import { exportAuditLogs, getAuditLogs } from "../../../services/financeService";
import downloadBlob from "../../../utils/downloadBlob";
import { getApiErrorMessage } from "../../../utils/apiError";
import notify from "../../../lib/notify";
import { displayAuditValue, humanizeIdentifier, ROLE_LABELS } from "../../../utils/displayText";
import AccessibleOverlay from "../../../components/AccessibleOverlay";
import TableRowActions from "../../../components/TableRowActions";

const MODULE_OPTIONS = [
  "academic_structure", "ai_workflows", "announcements", "approvals", "attendance", "biometrics", "budgets",
  "cash_advances", "clearances", "collections", "colleges", "compliance", "elections",
  "event_registrations", "events", "financial_forecasts", "financial_ledger", "financial_reports",
  "global_announcements", "grievances", "invoices", "merchandise", "orders", "positions", "remittances",
  "system_administration", "task_delegation", "tasks", "transactions", "users", "venue_bookings", "venues",
];

// Each role is offered only the modules its audit trail can contain: the SAO never
// sees ledger modules, and an organization admin never sees SAO-level or grievance rows.
const SAO_HIDDEN_MODULES = ["financial_ledger", "transactions", "collections", "remittances", "cash_advances", "invoices", "budgets", "orders"];
const ADMIN_HIDDEN_MODULES = ["grievances", "global_announcements", "system_administration", "colleges"];

function getCurrentRole() {
  try { return JSON.parse(localStorage.getItem("user") ?? "{}")?.role ?? ""; } catch { return ""; }
}

const ACTION_CATEGORY_OPTIONS = [
  { value: "CREATE", label: "Create" },
  { value: "UPDATE", label: "Update" },
  { value: "DELETE", label: "Delete" },
  { value: "APPROVE", label: "Approve" },
  { value: "REJECT", label: "Reject" },
  { value: "PAYMENT", label: "Payment" },
  { value: "COLLECTION", label: "Collection" },
  { value: "REMITTANCE", label: "Remittance" },
  { value: "ATTENDANCE", label: "Attendance" },
  { value: "STATUS_CHANGE", label: "Status Change" },
];

const EMPTY_FILTERS = {
  search: "",
  module: "",
  category: "",
  role: "",
  department: "",
  program: "",
  from: "",
  to: "",
  sort: "newest",
  per_page: 10,
};

export default function GeneralAuditLogPage() {
  const [logs, setLogs] = useState([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ total: 0, per_page: 10, current_page: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedLog, setSelectedLog] = useState(null);
  const [changesPage, setChangesPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const isSao = useMemo(() => getCurrentRole() === "SUPER_ADMIN", []);
  const moduleOptions = MODULE_OPTIONS.filter((module) => !(isSao ? SAO_HIDDEN_MODULES : ADMIN_HIDDEN_MODULES).includes(module));

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const response = await getAuditLogs({ ...filters, page });
        const payload = response.data;
        if (!cancelled) {
          setLogs(payload.data || []);
          setMeta({
            total: payload.total || 0,
            per_page: payload.per_page || filters.per_page,
            current_page: payload.current_page || page,
          });
        }
      } catch {
        if (!cancelled) setError("Unable to load the General Audit Log.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [filters, page]);

  const update = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };
  const departments = useMemo(
    () => [
      ...new Set(logs.map((log) => log.actor?.department).filter(Boolean)),
    ],
    [logs],
  );
  const programs = useMemo(
    () => [...new Set(logs.map((log) => log.actor?.program).filter(Boolean))],
    [logs],
  );
  const activeAuditFilters = [
    filters.search.trim() && `Search: ${filters.search.trim()}`,
    filters.module && `Module: ${humanizeIdentifier(filters.module)}`,
    filters.category && `Action: ${humanizeIdentifier(filters.category)}`,
    filters.role && `Role: ${ROLE_LABELS[filters.role] || filters.role}`,
    filters.department && `Department: ${filters.department}`,
    filters.program && `Program: ${filters.program}`,
    filters.from && `From: ${filters.from}`,
    filters.to && `To: ${filters.to}`,
    filters.sort !== 'newest' && `Sort: ${humanizeIdentifier(filters.sort)}`,
  ].filter(Boolean);

  async function handleExport() {
    setExporting(true);
    try {
      downloadBlob(await exportAuditLogs(filters), `audit-log-${Date.now()}.csv`);
      notify.success("Audit log exported.", { description: "Every entry matching your filters, not just this page." });
    } catch (cause) {
      notify.error(getApiErrorMessage(cause, "The audit log could not be exported. Try again."));
    } finally {
      setExporting(false);
    }
  }

  const clearAuditFilters = () => {
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };

  return (
    <div className="space-y-5">
      <PageHeader />
      <section className="overflow-hidden rounded-lg border border-[#DDE7EF] bg-white shadow-sm">
        <TableFilterBar
          searchValue={filters.search}
          onSearchChange={(value) => update('search', value)}
          searchPlaceholder="Search actor, action, module, or record ID"
          activeFilters={activeAuditFilters}
          onClear={clearAuditFilters}
          resultCount={meta.total}
          resultLabel={meta.total === 1 ? 'entry' : 'entries'}
          secondaryClassName="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
          actions={<button type="button" onClick={handleExport} disabled={exporting || meta.total === 0} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-[#DDE7EF] bg-white px-4 text-sm font-bold text-[#0878B7] transition hover:bg-[#F8FBFD] disabled:opacity-50"><Download size={16} aria-hidden="true" />{exporting ? 'Exporting...' : 'Export CSV'}</button>}
        >
          <select
            aria-label="Module"
            value={filters.module}
            onChange={(event) => update("module", event.target.value)}
            className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm"
          >
            <option value="">All modules</option>
            {moduleOptions.map((module) => (
              <option key={module} value={module}>
                {humanizeIdentifier(module)}
              </option>
            ))}
          </select>
          <select
            aria-label="Action category"
            value={filters.category}
            onChange={(event) => update("category", event.target.value)}
            className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm"
          >
            <option value="">All actions</option>
            {ACTION_CATEGORY_OPTIONS.map((category) => (
              <option key={category.value} value={category.value}>{category.label}</option>
            ))}
          </select>
          <select
            aria-label="Actor role"
            value={filters.role}
            onChange={(event) => update("role", event.target.value)}
            className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm"
          >
            <option value="">All actor roles</option>
            {Object.entries(ROLE_LABELS).map(
              ([role, label]) => (
                <option key={role} value={role}>{label}</option>
              ),
            )}
          </select>
          <select
            aria-label="Actor department"
            value={filters.department}
            onChange={(event) => update("department", event.target.value)}
            className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm"
          >
            <option value="">All departments</option>
            {departments.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <select
            aria-label="Actor program"
            value={filters.program}
            onChange={(event) => update("program", event.target.value)}
            className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm"
          >
            <option value="">All programs</option>
            {programs.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <label className="text-[10px] font-bold uppercase text-slate-500">
            <FieldIcon label="From" />From
            <DateTimeInput
              type="date"
              value={filters.from}
              onChange={(event) => update("from", event.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-[#DDE7EF] px-2 text-xs"
            />
          </label>
          <label className="text-[10px] font-bold uppercase text-slate-500">
            <FieldIcon label="To" />To
            <DateTimeInput
              type="date"
              value={filters.to}
              onChange={(event) => update("to", event.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-[#DDE7EF] px-2 text-xs"
            />
          </label>
          <select
            aria-label="Sort audit logs"
            value={filters.sort}
            onChange={(event) => update("sort", event.target.value)}
            className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="user">User name</option>
            <option value="role">User role</option>
            <option value="module">Module</option>
            <option value="action">Action</option>
          </select>
        </TableFilterBar>
      </section>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          {error}
        </p>
      )}
      <section className="overflow-hidden rounded-lg border border-[#DDE7EF] bg-white shadow-sm">
        {loading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }, (_, index) => (
              <div
                key={index}
                className="h-24 animate-pulse rounded-lg bg-slate-100"
              />
            ))}
          </div>
        ) : logs.length === 0 ? (
          activeAuditFilters.length > 0 ? (
            <EmptyState kind="filtered" title="No audit activity matches these filters" description="Try a wider date range or another module." onClearFilters={clearAuditFilters} />
          ) : (
            <EmptyState kind="first-run" icon={Clock3} title="No audit activity yet" description="Every approval, payment, event, and setting change is recorded here as people work in the system." />
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-left text-xs">
              <thead className="bg-[#F8FBFD] text-[#64748B]"><tr>
                {['Time', 'Actor', 'Role', ...(isSao ? ['Organization'] : []), 'Module', 'Action', 'Affected record', 'Record ID', 'Details'].map((heading) => <th key={heading} scope="col" className="px-3 py-3 font-bold">{heading}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-[#DDE7EF]">
                {logs.map((log) => <tr key={log.id} className="align-top hover:bg-[#F8FBFD]">
                  <td className="whitespace-nowrap px-3 py-3 text-[#64748B]">{log.created_at ? new Date(log.created_at).toLocaleString('en-PH') : 'Unknown'}</td>
                  <td className="px-3 py-3 font-semibold text-[#0F172A]">{formatDisplayText(log.actor?.name) || 'System'}</td>
                  <td className="px-3 py-3 text-[#64748B]">{log.actor?.role_label || humanizeIdentifier(log.actor?.role)}{log.actor?.position_title ? ` / ${formatDisplayText(log.actor.position_title)}` : ''}</td>
                  {isSao && <td className="px-3 py-3 text-[#0F172A]">{formatDisplayText(log.organization?.name) || '-'}</td>}
                  <td className="px-3 py-3">{log.module_label || humanizeIdentifier(log.module)}</td>
                  <td className="px-3 py-3">{log.action_category_label || humanizeIdentifier(log.action_category)}</td>
                  <td className="max-w-64 px-3 py-3"><p className="font-semibold text-[#0F172A]">{log.subject || formatDisplayText(log.affected_user?.name) || '-'}</p><p className="mt-1 line-clamp-2 text-[#64748B]">{log.description}</p></td>
                  <td className="px-3 py-3 font-mono text-[#64748B]">{log.record_id ?? '-'}</td>
                  <td className="px-3 py-3"><TableRowActions subject={`Audit record ${log.id}`} label="Audit actions" actions={[{ label: 'View details', icon: Eye, onClick: () => { setSelectedLog(log); setChangesPage(1); } }]} /></td>
                </tr>)}
              </tbody>
            </table>
          </div>
        )}
        <PaginationControls
          currentPage={meta.current_page}
          totalItems={meta.total}
          pageSize={meta.per_page}
          onPageChange={setPage}
          label="audit records"
        />
      </section>

      {selectedLog && (
        <AccessibleOverlay label="Audit record details" onClose={() => setSelectedLog(null)} className="fixed inset-0 z-[80] flex items-center justify-center bg-[#0B1831]/55 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-5 shadow-2xl">
            <div className="flex justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase text-[#0878B7]">
                  Audit record LOG-{selectedLog.id}
                </p>
                <h2 className="mt-1 text-xl font-black text-[#0F172A]">
                  {selectedLog.description}
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  {selectedLog.module_label || humanizeIdentifier(selectedLog.module)} · {selectedLog.action_label || humanizeIdentifier(selectedLog.action)} ·{" "}
                  {new Date(selectedLog.created_at).toLocaleString("en-PH")}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close audit details"
                onClick={() => setSelectedLog(null)}
                className="grid h-9 w-9 place-items-center rounded-lg hover:bg-[#F8FBFD]"
              >
                <X size={18} />
              </button>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {[
                ["Actor", selectedLog.actor?.name],
                [
                  "Actor role / position",
                  [
                    selectedLog.actor?.role_label || humanizeIdentifier(selectedLog.actor?.role),
                    selectedLog.actor?.position_title,
                  ]
                    .filter(Boolean)
                    .join(" · "),
                ],
                [
                  "Actor academic profile",
                  [
                    selectedLog.actor?.department,
                    selectedLog.actor?.program,
                    selectedLog.actor?.major,
                    selectedLog.actor?.year_level,
                    selectedLog.actor?.section,
                  ]
                    .filter(Boolean)
                    .join(" · "),
                ],
                ["Affected record", selectedLog.subject],
                ["Record type", selectedLog.record_type_label || humanizeIdentifier(String(selectedLog.record_type || '').split('\\').pop())],
                ["Record ID", selectedLog.record_id],
                ["IP address", selectedLog.ip_address],
                [
                  "Timestamp",
                  new Date(selectedLog.created_at).toLocaleString("en-PH"),
                ],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-3"
                >
                  <p className="text-[10px] font-bold uppercase text-slate-500">
                    {label}
                  </p>
                  <p className="mt-1 break-words text-sm font-semibold">
                    {value || "-"}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-4">
              <h3 className="text-sm font-bold">Before / after changes</h3>
              {selectedLog.changes?.length ? (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left text-xs">
                    <thead className="bg-[#F8FBFD]">
                      <tr>
                        <th className="px-3 py-2">Field</th>
                        <th className="px-3 py-2">Before</th>
                        <th className="px-3 py-2">After</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#DDE7EF]">
                      {selectedLog.changes
                        .slice((changesPage - 1) * 10, changesPage * 10)
                        .map((change) => (
                        <tr key={change.field}>
                          <td className="px-3 py-2 font-bold">
                            {change.field}
                          </td>
                          <td className="px-3 py-2 text-slate-500">
                            {change.from === null || change.from === undefined ? "-" : displayAuditValue(change.from)}
                          </td>
                          <td className="px-3 py-2 text-[#0F172A]">
                            {displayAuditValue(change.to)}
                          </td>
                        </tr>
                        ))}
                    </tbody>
                  </table>
                  <PaginationControls
                    currentPage={changesPage}
                    totalItems={selectedLog.changes.length}
                    pageSize={10}
                    onPageChange={setChangesPage}
                    label="field changes"
                  />
                </div>
              ) : (
                <p className="mt-2 text-xs text-slate-500">
                  No field-level change payload was recorded for this action.
                </p>
              )}
            </div>
          </div>
        </AccessibleOverlay>
      )}
    </div>
  );
}
