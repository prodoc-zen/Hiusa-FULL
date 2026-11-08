import { useCallback, useEffect, useState } from 'react';
import { FolderOpen, Settings } from 'lucide-react';
import { Button, Card, DataTable, Drawer, EmptyState, ErrorState, Field, Input, PageHeader, ProgressMeter, SkeletonText } from '../../../components/ui';
import TableRowActions from '../../../components/TableRowActions';
import PaginationControls from '../../../components/PaginationControls';
import { getFileStorage, updateFileStorage } from '../../../services/complianceService';
import { getApiErrorMessage } from '../../../utils/apiError';

function size(bytes) {
  if (bytes === null || bytes === undefined) return 'Unavailable';
  if (bytes > 0 && bytes < 1024 ** 2 / 10) return `${Math.max(0.01, Number((bytes / 1024 ** 2).toFixed(2)))} MB`;
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export default function StorageOverview() {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [limits, setLimits] = useState({ max_file_mb: 10, max_organization_mb: 200 });
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const load = useCallback(() => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    getFileStorage().then((response) => {
      setState({ loading: false, error: '', data: response.data });
      setLimits({ max_file_mb: response.data.settings.max_file_mb, max_organization_mb: response.data.settings.max_organization_mb });
    }).catch((error) => setState((current) => ({ ...current, loading: false, error: getApiErrorMessage(error, 'Could not load storage usage.') })));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setFeedback('');
    try {
      await updateFileStorage({ max_file_mb: Number(limits.max_file_mb), max_organization_mb: Number(limits.max_organization_mb) });
      setFeedback('Storage limits saved. New uploads use these limits.');
      setEditing(false);
      load();
    } catch (error) {
      setFeedback(getApiErrorMessage(error, 'Could not save storage limits.'));
    } finally {
      setBusy(false);
    }
  }

  const data = state.data;
  const organizations = [...(data?.organizations || [])].filter((org) => `${org.name} ${org.acronym || ''}`.toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => b.stored_bytes - a.stored_bytes || a.name.localeCompare(b.name));
  const savedLimit = data?.settings.max_organization_mb || 200;
  return <div className="space-y-5 pb-8"><PageHeader title="Storage and limits" />
    {feedback && !editing && <p role="status" className="text-sm text-ink">{feedback}</p>}
    <Card title="File storage">
    {state.loading ? <SkeletonText lines={3} /> : state.error ? <div role="alert"><ErrorState title="Could not load storage" description={state.error} onRetry={load} /></div> : <>
      <dl className="grid gap-4 sm:grid-cols-3">
        <div><dt className="text-xs font-semibold text-ink-muted">Private files</dt><dd className="mt-1 text-lg font-semibold text-ink">{size(data.stored_bytes)}</dd><p className="text-xs text-ink-muted">{data.stored_files} files</p></div>
        <div><dt className="text-xs font-semibold text-ink-muted">Server disk free</dt><dd className="mt-1 text-lg font-semibold text-ink">{size(data.disk_free_bytes)}</dd></div>
        <div><dt className="text-xs font-semibold text-ink-muted">Server disk capacity</dt><dd className="mt-1 text-lg font-semibold text-ink">{size(data.disk_total_bytes)}</dd></div>
      </dl>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-4"><p className="text-xs text-ink-muted">Upload limits: {data.settings.max_file_mb} MB per file · {savedLimit} MB per organization</p><TableRowActions subject="Storage limits" actions={[{ label: 'Edit upload limits', icon: Settings, onClick: () => { setFeedback(''); setEditing(true); } }]} /></div>
    </>}
  </Card>
  <Card title="Storage by organization">
    <DataTable caption="Storage by organization, largest first" loading={state.loading} error={state.error} onRetry={load} stickyHeader={false} rows={organizations.slice((page - 1) * 20, page * 20)} rowKey={(org) => org.id} filtersActive={Boolean(search)}
      filters={<div className="mb-4"><Input type="search" aria-label="Search storage organizations" placeholder="Search organization or acronym" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></div>}
      columns={[
        { key: 'name', header: 'Organization', render: (org) => <span className="font-medium text-ink">{org.name}</span> },
        { key: 'stored_bytes', header: 'Stored', align: 'right', render: (org) => size(org.stored_bytes) },
        { key: 'remaining', header: 'Available', align: 'right', render: (org) => size(Math.max(0, savedLimit * 1024 ** 2 - org.stored_bytes)) },
        { key: 'usage', header: 'Quota used', render: (org) => <div className="min-w-32"><ProgressMeter value={org.stored_bytes} max={savedLimit * 1024 ** 2} valueLabel={`${Math.round(org.stored_bytes / (savedLimit * 1024 ** 2) * 100)}%`} /></div> },
      ]}
      actions={(org) => <TableRowActions subject={org.name} actions={[{ label: 'View submitted files', icon: FolderOpen, to: `/dashboard/super-admin/documents?organization=${org.id}&name=${encodeURIComponent(org.name)}` }]} />}
      emptyState={<EmptyState kind={search ? 'filtered' : 'first-run'} title={search ? 'No matching organizations' : 'No organizations yet'} description={search ? 'Try another name or acronym.' : 'Storage usage appears after organizations register.'} onClearFilters={search ? () => { setSearch(''); setPage(1); } : undefined} />}
      pagination={<PaginationControls currentPage={page} totalItems={organizations.length} pageSize={20} onPageChange={setPage} label="organizations" />}
    />
  </Card>
  <Drawer open={editing} title="Upload limits" onClose={busy ? undefined : () => setEditing(false)} footer={<><Button variant="secondary" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button><Button type="submit" form="storage-limits-form" loading={busy}>Save limits</Button></>}>
    <form id="storage-limits-form" onSubmit={save} className="space-y-4">
      <Field label="Maximum per file (MB)"><Input type="number" min="1" max="10" required value={limits.max_file_mb} onChange={(event) => setLimits((current) => ({ ...current, max_file_mb: event.target.value }))} /></Field>
      <Field label="Maximum per organization (MB)"><Input type="number" min="10" max="10240" required value={limits.max_organization_mb} onChange={(event) => setLimits((current) => ({ ...current, max_organization_mb: event.target.value }))} /></Field>
      <p className="text-xs text-ink-muted">Applies to new registration, compliance, event and financial report uploads. Existing files stay available.</p>
      {feedback && <p role="alert" className="text-sm text-danger-strong">{feedback}</p>}
    </form>
  </Drawer></div>;
}
