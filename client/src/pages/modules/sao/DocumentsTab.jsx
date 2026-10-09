import { formatDisplayText } from '../../../utils/displayText.js';
import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, FolderSearch } from 'lucide-react';
import { Button, Card, EmptyState, ErrorState, Field, Select, StatusBadge } from '../../../components/ui';
import { SkeletonTable } from '../../../components/ui/Skeleton';
import PaginationControls from '../../../components/PaginationControls';
import { manilaDate } from '../../../lib/format';
import { fetchAllPages, listMeta, unwrapList } from '../../../services/pagination';
import { getApiErrorMessage } from '../../../utils/apiError';
import { openProtectedFile } from '../../../utils/openProtectedFile';
import { getAcademicPeriods, getSystemOrganizations } from '../../../services/systemAdministrationService';
import { getComplianceDocuments } from '../../../services/complianceService';

const SOURCES = [
  { key: 'compliance', label: 'Renewal and semestral documents' },
  { key: 'event_requirement', label: 'Event requirement files' },
  { key: 'financial_report', label: 'Financial reports' },
  { key: 'financial_supporting_document', label: 'Financial supporting documents' },
];

const EMPTY_FILTERS = { organizationId: '', semesterId: '', source: '' };
const EMPTY_META = { total: 0, currentPage: 1, lastPage: 1, perPage: 20 };

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

export default function DocumentsTab() {
  const [organizations, setOrganizations] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [documents, setDocuments] = useState({ loading: true, error: null, items: [], meta: EMPTY_META });
  const [openingKey, setOpeningKey] = useState(null);
  const [openError, setOpenError] = useState(null);

  useEffect(() => {
    fetchAllPages(getSystemOrganizations).then(setOrganizations).catch(() => setOrganizations([]));
    getAcademicPeriods().then((data) => setPeriods(Array.isArray(data) ? data : [])).catch(() => setPeriods([]));
  }, []);

  const load = useCallback(() => {
    setDocuments((current) => ({ ...current, loading: true, error: null }));
    getComplianceDocuments({
      page,
      per_page: 20,
      organization_id: filters.organizationId || undefined,
      academic_semester_id: filters.semesterId || undefined,
      source: filters.source || undefined,
    })
      .then((response) => setDocuments({ loading: false, error: null, items: unwrapList(response.data), meta: listMeta(response.data) }))
      .catch((err) => setDocuments((current) => ({ ...current, loading: false, error: getApiErrorMessage(err, 'Could not load submitted documents.') })));
  }, [filters, page]);

  useEffect(() => { load(); }, [load]);

  function changeFilter(name, value) {
    setFilters((current) => ({ ...current, [name]: value }));
    setPage(1);
  }

  async function openDocument(row) {
    const key = `${row.source}:${row.open_url}`;
    setOpeningKey(key);
    setOpenError(null);
    try {
      await openProtectedFile(row.open_url);
    } catch (err) {
      setOpenError(getApiErrorMessage(err, 'Could not open this document.'));
    } finally {
      setOpeningKey(null);
    }
  }

  const filtersActive = Object.values(filters).some(Boolean);
  const groups = SOURCES
    .map((source) => ({ ...source, rows: documents.items.filter((row) => row.source === source.key) }))
    .filter((group) => group.rows.length > 0);

  return (
    <Card title="Track documents" description="Every file an organization has submitted, in one place.">
      <div className="grid gap-3 sm:grid-cols-3">
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
          <Select value={filters.source} onChange={(event) => changeFilter('source', event.target.value)}>
            <option value="">All document types</option>
            {SOURCES.map((source) => <option key={source.key} value={source.key}>{source.label}</option>)}
          </Select>
        </Field>
      </div>

      {filtersActive && (
        <div className="mt-3">
          <Button variant="ghost" size="sm" className="h-11! sm:h-9!" onClick={() => { setFilters(EMPTY_FILTERS); setPage(1); }}>Clear filters</Button>
        </div>
      )}

      {openError && (
        <p role="alert" className="mt-4 rounded-lg border border-danger/30 bg-danger-tint p-3 text-sm font-semibold text-danger-strong">{openError}</p>
      )}

      <div className="mt-5">
        {documents.loading ? (
          <SkeletonTable columns={4} />
        ) : documents.error ? (
          <ErrorState description={documents.error} onRetry={load} />
        ) : groups.length === 0 ? (
          filtersActive ? (
            <EmptyState
              kind="filtered"
              title="No documents match these filters"
              description="Try a different organization, semester or document type."
              onClearFilters={() => { setFilters(EMPTY_FILTERS); setPage(1); }}
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
          <div className="space-y-6">
            {groups.map((group) => (
              <section key={group.key} aria-labelledby={`documents-${group.key}`}>
                <h3 id={`documents-${group.key}`} className="border-b border-line pb-2 text-sm font-bold text-ink">{group.label}</h3>
                <ul className="divide-y divide-line">
                  {group.rows.map((row) => {
                    const key = `${row.source}:${row.open_url}`;
                    return (
                      <li key={key} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-sm font-bold text-ink">{formatDisplayText(row.item)}</p>
                          <p className="mt-0.5 break-words text-xs font-medium text-ink-muted">
                            {[row.organization?.acronym || formatDisplayText(row.organization?.name), row.parent_title && formatDisplayText(row.parent_title), row.file_name].filter(Boolean).join(' · ')}
                          </p>
                          <p className="mt-0.5 text-xs font-medium text-ink-muted">
                            {row.submitted_at ? `Submitted ${manilaDate(row.submitted_at, 'long')}` : 'Not submitted'}
                            {row.submitted_by_name ? ` by ${row.submitted_by_name}` : ''}
                          </p>
                        </div>
                        <StatusBadge status={row.status} />
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-11! sm:h-9!"
                          leftIcon={ExternalLink}
                          onClick={() => openDocument(row)}
                          disabled={openingKey === key}
                          aria-label={`Open ${formatDisplayText(row.item)}`}
                        >
                          Open
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      {!documents.loading && !documents.error && (
        <PaginationControls
          currentPage={documents.meta.currentPage}
          totalItems={documents.meta.total}
          pageSize={documents.meta.perPage}
          onPageChange={setPage}
          label="documents"
        />
      )}
    </Card>
  );
}
