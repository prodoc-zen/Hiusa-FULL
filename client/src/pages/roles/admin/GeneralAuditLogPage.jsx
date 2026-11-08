import { formatDisplayText } from '../../../utils/displayText.js';
import { useEffect, useMemo, useState } from "react";
import { Download, Eye, Search } from "lucide-react";
import { Button, DataTable, Drawer, EmptyState, Field, Input, PageHeader, Select } from "../../../components/ui";
import PaginationControls from "../../../components/PaginationControls";
import { exportAuditLogs, getAuditLogs } from "../../../services/financeService";
import downloadBlob from "../../../utils/downloadBlob";
import { getApiErrorMessage } from "../../../utils/apiError";
import notify from "../../../lib/notify";
import { displayAuditValue, humanizeIdentifier } from "../../../utils/displayText";
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
  { value: "STATUS_CHANGE", label: "Status change" },
];

// Role, department, program and sort stay in the request (the server and export accept them) but
// the page offers search, module, action and a date range only.
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

const CHANGE_COLUMNS = [
  { key: 'field', header: 'Field', render: (change) => <span className="font-medium">{change.field}</span> },
  { key: 'from', header: 'Before', render: (change) => (change.from === null || change.from === undefined ? "" : displayAuditValue(change.from)) },
  { key: 'to', header: 'After', render: (change) => displayAuditValue(change.to) },
];

export default function GeneralAuditLogPage() {
  const [logs, setLogs] = useState([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ total: 0, per_page: 10, current_page: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [selectedLog, setSelectedLog] = useState(null);
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
        if (!cancelled) setError("Unable to load the audit log.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [filters, page, reload]);

  const update = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };
  const filtersActive = Boolean(filters.search.trim() || filters.module || filters.category || filters.from || filters.to);

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

  const columns = [
    { key: 'time', header: 'Time', className: 'whitespace-nowrap text-ink-muted-strong', render: (log) => (log.created_at ? new Date(log.created_at).toLocaleString('en-PH') : '') },
    {
      key: 'actor',
      header: 'Actor',
      render: (log) => (
        <>
          <span className="font-medium">{formatDisplayText(log.actor?.name) || 'System'}</span>
          <span className="block text-xs text-ink-muted">{log.actor?.role_label || humanizeIdentifier(log.actor?.role)}{log.actor?.position_title ? ` / ${formatDisplayText(log.actor.position_title)}` : ''}</span>
        </>
      ),
    },
    ...(isSao ? [{ key: 'organization', header: 'Organization', render: (log) => formatDisplayText(log.organization?.name) }] : []),
    { key: 'module', header: 'Module', render: (log) => log.module_label || humanizeIdentifier(log.module) },
    { key: 'action', header: 'Action', render: (log) => log.action_category_label || humanizeIdentifier(log.action_category) },
    {
      key: 'record',
      header: 'Affected record',
      className: 'max-w-72',
      render: (log) => (
        <>
          <span className="font-medium">{log.subject || formatDisplayText(log.affected_user?.name)}</span>
          {log.record_id != null && <span className="ml-2 text-xs text-ink-muted">ID {log.record_id}</span>}
          <span className="mt-0.5 line-clamp-2 block text-xs text-ink-muted-strong">{log.description}</span>
        </>
      ),
    },
  ];

  const filterRow = (
    <div className="mb-4 grid grid-cols-2 gap-3 lg:flex lg:items-end">
      <div className="relative col-span-2 min-w-0 lg:max-w-sm lg:flex-1">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" aria-hidden="true" />
        <Input aria-label="Search audit log" value={filters.search} onChange={(event) => update('search', event.target.value)} placeholder="Search actor, module or record" className="pl-9" />
      </div>
      <Select aria-label="Module" value={filters.module} onChange={(event) => update("module", event.target.value)} className="lg:w-44">
        <option value="">All modules</option>
        {moduleOptions.map((module) => <option key={module} value={module}>{humanizeIdentifier(module)}</option>)}
      </Select>
      <Select aria-label="Action category" value={filters.category} onChange={(event) => update("category", event.target.value)} className="lg:w-40">
        <option value="">All actions</option>
        {ACTION_CATEGORY_OPTIONS.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
      </Select>
      <Field label="From date" className="lg:w-40">
        <Input type="date" aria-label="From date" value={filters.from} onChange={(event) => update("from", event.target.value)} />
      </Field>
      <Field label="To date" className="lg:w-40">
        <Input type="date" aria-label="To date" value={filters.to} onChange={(event) => update("to", event.target.value)} />
      </Field>
      {filtersActive && (
        <button type="button" onClick={clearAuditFilters} className="col-span-2 min-h-11 self-start rounded-control px-1 text-left text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800 lg:col-span-1 lg:self-auto">Clear</button>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        actions={<Button variant="secondary" leftIcon={Download} onClick={handleExport} disabled={exporting || meta.total === 0}>{exporting ? 'Exporting...' : 'Export CSV'}</Button>}
      />
      <section className="rounded-card border border-line bg-surface p-4 sm:p-5">
        <DataTable
          caption="Audit log"
          columns={columns}
          rows={logs}
          rowKey={(log) => log.id}
          loading={loading}
          error={error || null}
          onRetry={() => setReload((value) => value + 1)}
          filters={filterRow}
          filtersActive={filtersActive}
          onClearFilters={clearAuditFilters}
          emptyState={filtersActive ? (
            <EmptyState kind="filtered" title="No audit activity matches these filters" description="Try a wider date range or another module." onClearFilters={clearAuditFilters} />
          ) : (
            <EmptyState kind="first-run" title="No audit activity yet" description="Approvals, payments, events and setting changes are recorded here as people work." />
          )}
          actions={(log) => (
            <div className="flex justify-end">
              <TableRowActions subject={`Audit record ${log.id}`} label="Audit actions" actions={[{ label: 'View details', icon: Eye, onClick: () => setSelectedLog(log) }]} />
            </div>
          )}
          pagination={(
            <PaginationControls
              currentPage={meta.current_page}
              totalItems={meta.total}
              pageSize={meta.per_page}
              onPageChange={setPage}
              label="audit records"
            />
          )}
        />
      </section>

      <Drawer
        open={Boolean(selectedLog)}
        title={selectedLog ? `Audit record LOG-${selectedLog.id}` : 'Audit record'}
        description={selectedLog ? `${selectedLog.module_label || humanizeIdentifier(selectedLog.module)} · ${selectedLog.action_label || humanizeIdentifier(selectedLog.action)} · ${new Date(selectedLog.created_at).toLocaleString("en-PH")}` : undefined}
        width="max-w-xl"
        onClose={() => setSelectedLog(null)}
      >
        {selectedLog && (
          <div className="space-y-5">
            <p className="text-sm font-medium text-ink">{selectedLog.description}</p>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {[
                ["Actor", selectedLog.actor?.name],
                [
                  "Actor role and position",
                  [
                    selectedLog.actor?.role_label || humanizeIdentifier(selectedLog.actor?.role),
                    selectedLog.actor?.position_title,
                  ].filter(Boolean).join(" · "),
                ],
                [
                  "Actor academic profile",
                  [
                    selectedLog.actor?.department,
                    selectedLog.actor?.program,
                    selectedLog.actor?.major,
                    selectedLog.actor?.year_level,
                    selectedLog.actor?.section,
                  ].filter(Boolean).join(" · "),
                ],
                ["Affected record", selectedLog.subject],
                ["Record type", selectedLog.record_type_label || humanizeIdentifier(String(selectedLog.record_type || '').split('\\').pop())],
                ["Record ID", selectedLog.record_id],
                ["IP address", selectedLog.ip_address],
                ["Timestamp", new Date(selectedLog.created_at).toLocaleString("en-PH")],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-xs font-semibold text-ink-muted">{label}</dt>
                  <dd className="mt-0.5 break-words text-sm text-ink">{value}</dd>
                </div>
              ))}
            </dl>
            <section className="border-t border-line pt-4" aria-labelledby="audit-changes-title">
              <h3 id="audit-changes-title" className="text-sm font-semibold text-ink">Before and after</h3>
              {selectedLog.changes?.length ? (
                <div className="mt-2">
                  <DataTable caption="Field changes" columns={CHANGE_COLUMNS} rows={selectedLog.changes} rowKey={(change) => change.field} pageSize={10} />
                </div>
              ) : (
                <p className="mt-2 text-sm text-ink-muted">No field-level change was recorded for this action.</p>
              )}
            </section>
          </div>
        )}
      </Drawer>
    </div>
  );
}
