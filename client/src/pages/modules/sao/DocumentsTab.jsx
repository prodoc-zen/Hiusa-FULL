import { formatDisplayText } from '../../../utils/displayText.js';
import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, FolderSearch, Trash2 } from 'lucide-react';
import { Button, Card, EmptyState, ErrorState, Field, Input, Select, StatusBadge } from '../../../components/ui';
import { SkeletonTable } from '../../../components/ui/Skeleton';
import PaginationControls from '../../../components/PaginationControls';
import { manilaDate } from '../../../lib/format';
import { organizationRegistrationLifecycle } from '../../../lib/lifecycle';
import { fetchAllPages, listMeta, unwrapList } from '../../../services/pagination';
import { getApiErrorMessage } from '../../../utils/apiError';
import { openProtectedFile } from '../../../utils/openProtectedFile';
import { isFileGone, openFileErrorMessage } from '../../../utils/openFileError';
import { getAcademicPeriods, getSystemOrganizations } from '../../../services/systemAdministrationService';
import { deleteComplianceFile, getComplianceDocuments } from '../../../services/complianceService';
import TableRowActions from '../../../components/TableRowActions';
import ConfirmModal from '../../../components/ConfirmModal';
import StorageOverview from './StorageOverview';

const FAMILIES = [
  { key: 'event_requirement', label: 'Event requirements' },
  { key: 'semestral_report', label: 'Semestral report' },
  { key: 'semester_renewal', label: 'Semester renewal' },
  { key: 'financial_report', label: 'Financial reports' },
  { key: 'financial_supporting_document', label: 'Financial report supporting documents' },
  { key: 'registration', label: 'Registration documents' },
];

const STAGES = { department_head: 'the Department Head', sao: 'the SAO' };

const EMPTY_FILTERS = { organizationId: '', semesterId: '', family: '', search: '' };
const EMPTY_META = { total: 0, currentPage: 1, lastPage: 1, perPage: 20 };
const FILES_PER_PAGE = 50;

function statusText(value) {
  const text = String(value ?? '').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function periodLabel(period) {
  return `AY ${period.academic_year?.label} · ${period.number === 1 ? '1st' : '2nd'} Semester · ${statusText(period.status)}`;
}

function organizationLabel(organization) {
  const lifecycle = organization.lifecycle_status && organization.lifecycle_status !== 'active' ? ` (${statusText(organization.lifecycle_status)})` : '';
  return `${organization.acronym} - ${formatDisplayText(organization.name)}${lifecycle}`;
}

function stageText(row) {
  if (!row.stage || !STAGES[row.stage]) return null;
  return row.status === 'returned' ? `Returned by ${STAGES[row.stage]}` : `With ${STAGES[row.stage]}`;
}

function fileCount(count) {
  return `${count} ${count === 1 ? 'file' : 'files'}`;
}

export default function DocumentsTab() {
  const [organizations, setOrganizations] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [summaries, setSummaries] = useState({ loading: true, error: null, items: [], meta: EMPTY_META });
  const [expanded, setExpanded] = useState({});
  const [files, setFiles] = useState({});
  const [openingKey, setOpeningKey] = useState(null);
  const [openError, setOpenError] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  useEffect(() => {
    fetchAllPages(getSystemOrganizations).then(setOrganizations).catch(() => setOrganizations([]));
    getAcademicPeriods().then((data) => setPeriods(Array.isArray(data) ? data : [])).catch(() => setPeriods([]));
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setFilters((current) => (current.search === search.trim() ? current : { ...current, search: search.trim() }));
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const load = useCallback(() => {
    setSummaries((current) => ({ ...current, loading: true, error: null }));
    getComplianceDocuments({
      group: 'organization',
      page,
      per_page: 20,
      organization_id: filters.organizationId || undefined,
      academic_semester_id: filters.semesterId || undefined,
      family: filters.family || undefined,
      search: filters.search || undefined,
    })
      .then((response) => setSummaries({ loading: false, error: null, items: unwrapList(response.data), meta: listMeta(response.data) }))
      .catch((err) => setSummaries((current) => ({ ...current, loading: false, error: getApiErrorMessage(err, 'Could not load submitted documents.') })));
  }, [filters, page]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    setExpanded({});
    setFiles({});
  }, [filters.semesterId, filters.family]);

  function changeFilter(name, value) {
    setFilters((current) => ({ ...current, [name]: value }));
    setPage(1);
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
    setSearch('');
    setPage(1);
  }

  const loadFiles = useCallback((organizationId, target = 1) => {
    setFiles((current) => ({ ...current, [organizationId]: { ...(current[organizationId] ?? { items: [], meta: EMPTY_META }), loading: true, error: null } }));
    getComplianceDocuments({
      organization_id: organizationId,
      page: target,
      per_page: FILES_PER_PAGE,
      academic_semester_id: filters.semesterId || undefined,
      family: filters.family || undefined,
    })
      .then((response) => setFiles((current) => ({
        ...current,
        [organizationId]: {
          loading: false,
          error: null,
          items: target === 1 ? unwrapList(response.data) : [...(current[organizationId]?.items ?? []), ...unwrapList(response.data)],
          meta: listMeta(response.data),
        },
      })))
      .catch((err) => setFiles((current) => ({
        ...current,
        [organizationId]: { ...(current[organizationId] ?? { items: [], meta: EMPTY_META }), loading: false, error: getApiErrorMessage(err, 'Could not load this organization\'s files.') },
      })));
  }, [filters.semesterId, filters.family]);

  function toggle(organizationId) {
    const open = !expanded[organizationId];
    setExpanded((current) => ({ ...current, [organizationId]: open }));
    if (open && !files[organizationId]) loadFiles(organizationId);
  }

  async function openDocument(row, organizationId) {
    const key = `${row.source}:${row.open_url}`;
    setOpeningKey(key);
    setOpenError(null);
    try {
      await openProtectedFile(row.open_url);
    } catch (err) {
      setOpenError(openFileErrorMessage(err, { registration: row.family === 'registration' }));
      if (isFileGone(err)) {
        load();
        loadFiles(organizationId);
      }
    } finally {
      setOpeningKey(null);
    }
  }

  async function removeDocument() {
    if (!deleting) return;
    setDeletingBusy(true);
    setOpenError(null);
    try {
      await deleteComplianceFile(deleting.row.id, deleting.row.submitted_at);
      load();
      loadFiles(deleting.organizationId);
      setDeleting(null);
    } catch (error) {
      setOpenError(getApiErrorMessage(error, 'Could not delete this file.'));
    } finally {
      setDeletingBusy(false);
    }
  }

  const filtersActive = Object.values(filters).some(Boolean) || Boolean(search);

  function renderFiles(organizationId) {
    const state = files[organizationId];
    if (!state || (state.loading && state.items.length === 0)) return <SkeletonTable columns={3} rows={3} />;
    if (state.error && state.items.length === 0) return <ErrorState description={state.error} onRetry={() => loadFiles(organizationId)} />;

    const groups = FAMILIES
      .map((family) => ({ ...family, rows: state.items.filter((row) => row.family === family.key) }))
      .filter((group) => group.rows.length > 0);

    return (
      <div className="space-y-5">
        {groups.map((group) => (
          <section key={group.key} aria-labelledby={`documents-${organizationId}-${group.key}`}>
            <h4 id={`documents-${organizationId}-${group.key}`} className="border-b border-line pb-2 text-sm font-bold text-ink">{group.label}</h4>
            <ul className="divide-y divide-line">
              {group.rows.map((row) => {
                const key = `${row.source}:${row.open_url}`;
                const stage = stageText(row);
                const reviewHref = row.family === 'registration' && row.organization_lifecycle_status === 'pending'
                  ? organizationRegistrationLifecycle({ id: organizationId, lifecycle_status: 'pending' }, 'SUPER_ADMIN').href
                  : null;
                return (
                  <li key={key} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-bold text-ink">{formatDisplayText(row.item)}</p>
                      <p className="mt-0.5 break-words text-xs font-medium text-ink-muted">
                        {[row.parent_title && formatDisplayText(row.parent_title), row.file_name].filter(Boolean).join(' · ')}
                      </p>
                      <p className="mt-0.5 text-xs font-medium text-ink-muted">
                        {row.submitted_at ? `Submitted ${manilaDate(row.submitted_at, 'long')}` : 'Not submitted'}
                        {row.submitted_by_name ? ` by ${row.submitted_by_name}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-col items-start gap-1 sm:items-end">
                      <StatusBadge status={row.status} />
                      {stage && <span className="text-xs font-semibold text-ink-muted-strong">{stage}</span>}
                    </div>
                    <TableRowActions subject={formatDisplayText(row.item)} actions={[
                      { label: 'View file', icon: ExternalLink, disabled: openingKey === key, onClick: () => openDocument(row, organizationId) },
                      reviewHref && { label: 'Open organization review', icon: ExternalLink, to: reviewHref },
                      row.source === 'compliance' && row.organization_lifecycle_status === 'active' && { label: 'Delete file', icon: Trash2, danger: true, onClick: () => { setOpenError(null); setDeleting({ row, organizationId }); } },
                    ]} />
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        {groups.length === 0 && <p className="text-sm font-medium text-ink-muted">No files match these filters.</p>}
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs font-semibold tabular-nums text-ink-muted">Showing {state.items.length} of {state.meta.total} {state.meta.total === 1 ? 'file' : 'files'}</p>
          {state.items.length < state.meta.total && (
            <Button size="sm" variant="secondary" className="h-11! sm:h-9!" loading={state.loading} onClick={() => loadFiles(organizationId, state.meta.currentPage + 1)}>Load more files</Button>
          )}
          {state.error && <p role="alert" className="text-xs font-semibold text-danger-strong">{state.error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
    <StorageOverview />
    <Card title="Track documents" description="Registration, compliance, event, and financial files submitted for review. Open an organization to see its files.">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Search organizations">
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or acronym" maxLength={100} />
        </Field>
        <Field label="Organization">
          <Select value={filters.organizationId} onChange={(event) => changeFilter('organizationId', event.target.value)}>
            <option value="">All organizations</option>
            {organizations.map((organization) => <option key={organization.id} value={organization.id}>{organizationLabel(organization)}</option>)}
          </Select>
        </Field>
        <Field label="Semester">
          <Select value={filters.semesterId} onChange={(event) => changeFilter('semesterId', event.target.value)}>
            <option value="">All semesters</option>
            {periods.map((period) => <option key={period.id} value={period.id}>{periodLabel(period)}</option>)}
          </Select>
        </Field>
        <Field label="Document type">
          <Select value={filters.family} onChange={(event) => changeFilter('family', event.target.value)}>
            <option value="">All document types</option>
            {FAMILIES.map((family) => <option key={family.key} value={family.key}>{family.label}</option>)}
          </Select>
        </Field>
      </div>

      {filtersActive && (
        <div className="mt-3">
          <Button variant="ghost" size="sm" className="h-11! sm:h-9!" onClick={clearFilters}>Clear filters</Button>
        </div>
      )}

      {openError && (
        <p role="alert" className="mt-4 rounded-lg border border-danger/30 bg-danger-tint p-3 text-sm font-semibold text-danger-strong">{openError}</p>
      )}

      <div className="mt-5">
        {summaries.loading ? (
          <SkeletonTable columns={4} />
        ) : summaries.error ? (
          <ErrorState description={summaries.error} onRetry={load} />
        ) : summaries.items.length === 0 ? (
          filtersActive ? (
            <EmptyState
              kind="filtered"
              title="No documents match these filters"
              description="Try a different organization, semester or document type."
              onClearFilters={clearFilters}
            />
          ) : (
            <EmptyState
              kind="first-run"
              icon={FolderSearch}
              title="No documents submitted yet."
              description="Files that organizations submit will be listed here."
            />
          )
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {summaries.items.map((summary) => {
              const organization = summary.organization;
              const open = Boolean(expanded[organization.id]);
              const panelId = `documents-panel-${organization.id}`;
              return (
                <li key={organization.id}>
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={() => toggle(organization.id)}
                    className="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left hover:bg-subtle"
                  >
                    {open ? <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-ink-muted" /> : <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-ink-muted" />}
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-sm font-bold text-ink">{organization.acronym ? `${organization.acronym} - ` : ''}{formatDisplayText(organization.name)}</span>
                      <span className="mt-0.5 block text-xs font-medium text-ink-muted">{organization.college || 'No college assigned'}</span>
                    </span>
                    <span className="text-right">
                      <span className="block text-sm font-bold tabular-nums text-ink">{fileCount(summary.file_count)}</span>
                      <span className="mt-0.5 block text-xs font-medium text-ink-muted">{summary.latest_submitted_at ? `Latest ${manilaDate(summary.latest_submitted_at, 'long')}` : 'No submission date'}</span>
                    </span>
                  </button>
                  {open && (
                    <div id={panelId} className="border-t border-line bg-subtle px-4 py-4">
                      {renderFiles(organization.id)}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {!summaries.loading && !summaries.error && (
        <PaginationControls
          currentPage={summaries.meta.currentPage}
          totalItems={summaries.meta.total}
          pageSize={summaries.meta.perPage}
          onPageChange={setPage}
          label="organizations"
        />
      )}
    </Card>
    <ConfirmModal open={Boolean(deleting)} title="Delete submitted file?" recordName={deleting?.row.file_name} message="This removes the file and notifies the organization Admin and college Head." confirmText="Delete file" busy={deletingBusy} error={openError} onCancel={() => setDeleting(null)} onConfirm={removeDocument} />
    </div>
  );
}
