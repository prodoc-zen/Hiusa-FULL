import { useCallback, useEffect, useState } from 'react';
import { FolderOpen, Settings } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, Input, PageHeader, ProgressMeter } from '../../../components/ui';
import TableRowActions from '../../../components/TableRowActions';
import Modal from '../../../components/Modal';
import PaginationControls from '../../../components/PaginationControls';
import { getFileStorage, updateFileStorage } from '../../../services/complianceService';
import { getApiErrorMessage } from '../../../utils/apiError';

function size(bytes) {
  if (bytes === null || bytes === undefined) return 'Unavailable';
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
  return <div className="space-y-5 pb-8"><PageHeader title="Storage and limits" description="Track private files and set upload limits for organizations." />
    {feedback && !editing && <p role="status" className="text-sm font-semibold text-ink">{feedback}</p>}
    <Card title="File storage" description="Private submitted files on this server and the upload limits set by SAO.">
    {state.loading ? <p role="status" className="text-sm text-ink-muted">Checking storage…</p> : state.error ? <div><p role="alert" className="text-sm text-danger-strong">{state.error}</p><Button variant="secondary" onClick={load}>Try again</Button></div> : <>
      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-line bg-subtle p-3"><dt className="text-xs font-semibold text-ink-muted">Private files</dt><dd className="mt-1 text-lg font-bold text-ink">{size(data.stored_bytes)}</dd><p className="text-xs text-ink-muted">{data.stored_files} files</p></div>
        <div className="rounded-lg border border-line bg-subtle p-3"><dt className="text-xs font-semibold text-ink-muted">Server disk free</dt><dd className="mt-1 text-lg font-bold text-ink">{size(data.disk_free_bytes)}</dd></div>
        <div className="rounded-lg border border-line bg-subtle p-3"><dt className="text-xs font-semibold text-ink-muted">Server disk capacity</dt><dd className="mt-1 text-lg font-bold text-ink">{size(data.disk_total_bytes)}</dd></div>
      </dl>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-4"><p className="text-xs text-ink-muted">Upload limits: {data.settings.max_file_mb} MB per file · {savedLimit} MB per organization</p><TableRowActions subject="Storage limits" actions={[{ label: 'Edit upload limits', icon: Settings, onClick: () => { setFeedback(''); setEditing(true); } }]} /></div>
    </>}
  </Card>
  <Card title="Storage by organization" description="Largest usage first. Open an organization's files from its actions.">
    <DataTable loading={state.loading} error={state.error} onRetry={load} stickyHeader={false} rows={organizations.slice((page - 1) * 20, page * 20)} rowKey={(org) => org.id} filtersActive={Boolean(search)}
      filters={<div className="mb-4"><Input type="search" aria-label="Search storage organizations" placeholder="Search organization or acronym" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></div>}
      columns={[
        { key: 'name', header: 'Organization', render: (org) => <strong>{org.name}</strong> },
        { key: 'stored_bytes', header: 'Stored', render: (org) => size(org.stored_bytes) },
        { key: 'remaining', header: 'Available', render: (org) => size(Math.max(0, savedLimit * 1024 ** 2 - org.stored_bytes)) },
        { key: 'usage', header: 'Quota used', render: (org) => <div className="min-w-32"><ProgressMeter value={org.stored_bytes} max={savedLimit * 1024 ** 2} valueLabel={`${Math.round(org.stored_bytes / (savedLimit * 1024 ** 2) * 100)}%`} /></div> },
      ]}
      actions={(org) => <TableRowActions subject={org.name} actions={[{ label: 'View submitted files', icon: FolderOpen, to: `/dashboard/super-admin/documents?organization=${org.id}&name=${encodeURIComponent(org.name)}` }]} />}
      emptyState={<EmptyState kind={search ? 'filtered' : 'first-run'} title={search ? 'No matching organizations' : 'No organizations yet'} description={search ? 'Try another name or acronym.' : 'Storage usage appears after organizations register.'} />}
      pagination={<PaginationControls currentPage={page} totalItems={organizations.length} pageSize={20} onPageChange={setPage} label="organizations" />}
    />
  </Card>
  <Modal open={editing} title="Upload limits" onClose={busy ? undefined : () => setEditing(false)} closeOnBackdrop={!busy} closeOnEscape={!busy} maxWidth="max-w-lg">
    <form onSubmit={save} className="space-y-4">
      <label className="block text-sm font-semibold text-ink">Maximum per file (MB)<Input type="number" min="1" max="10" required className="mt-1" value={limits.max_file_mb} onChange={(event) => setLimits((current) => ({ ...current, max_file_mb: event.target.value }))} /></label>
      <label className="block text-sm font-semibold text-ink">Maximum per organization (MB)<Input type="number" min="10" max="10240" required className="mt-1" value={limits.max_organization_mb} onChange={(event) => setLimits((current) => ({ ...current, max_organization_mb: event.target.value }))} /></label>
      <p className="text-xs text-ink-muted">Applies to new registration, compliance, event, and financial-report uploads. Existing files stay available.</p>
      {feedback && <p role="alert" className="text-sm text-danger-strong">{feedback}</p>}
      <div className="flex justify-end gap-2"><Button variant="secondary" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button><Button type="submit" loading={busy}>Save limits</Button></div>
    </form>
  </Modal></div>;
}
