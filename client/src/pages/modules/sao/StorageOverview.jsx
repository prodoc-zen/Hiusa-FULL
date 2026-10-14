import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input, PageHeader } from '../../../components/ui';
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
      load();
    } catch (error) {
      setFeedback(getApiErrorMessage(error, 'Could not save storage limits.'));
    } finally {
      setBusy(false);
    }
  }

  const data = state.data;
  const organizations = [...(data?.organizations || [])].sort((a, b) => b.stored_bytes - a.stored_bytes || a.name.localeCompare(b.name));
  return <div className="space-y-5 pb-8"><PageHeader title="Storage and limits" description="Track private files and set upload limits for organizations." /><Card title="File storage" description="Private submitted files on this server and the upload limits set by SAO.">
    {state.loading ? <p role="status" className="text-sm text-ink-muted">Checking storage…</p> : state.error ? <div><p role="alert" className="text-sm text-danger-strong">{state.error}</p><Button variant="secondary" onClick={load}>Try again</Button></div> : <>
      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-line bg-subtle p-3"><dt className="text-xs font-semibold text-ink-muted">Private files</dt><dd className="mt-1 text-lg font-bold text-ink">{size(data.stored_bytes)}</dd><p className="text-xs text-ink-muted">{data.stored_files} files</p></div>
        <div className="rounded-lg border border-line bg-subtle p-3"><dt className="text-xs font-semibold text-ink-muted">Server disk free</dt><dd className="mt-1 text-lg font-bold text-ink">{size(data.disk_free_bytes)}</dd></div>
        <div className="rounded-lg border border-line bg-subtle p-3"><dt className="text-xs font-semibold text-ink-muted">Server disk capacity</dt><dd className="mt-1 text-lg font-bold text-ink">{size(data.disk_total_bytes)}</dd></div>
      </dl>
      <form onSubmit={save} className="mt-5 flex flex-wrap items-end gap-3 border-t border-line pt-4">
        <label className="text-xs font-semibold text-ink">Maximum per file (MB)<Input type="number" min="1" max="10" required className="mt-1 w-36" value={limits.max_file_mb} onChange={(event) => setLimits((current) => ({ ...current, max_file_mb: event.target.value }))} /></label>
        <label className="text-xs font-semibold text-ink">Maximum per organization (MB)<Input type="number" min="10" max="10240" required className="mt-1 w-44" value={limits.max_organization_mb} onChange={(event) => setLimits((current) => ({ ...current, max_organization_mb: event.target.value }))} /></label>
        <Button type="submit" loading={busy}>Save limits</Button>
        <p className="w-full text-xs text-ink-muted">The per-file limit stays within the server's 10 MB upload cap. The organization limit covers registration, compliance, event proposals, and financial-report attachments.</p>
        {feedback && <p role="status" className="w-full text-xs font-semibold text-ink">{feedback}</p>}
      </form>
      <div className="mt-5 border-t border-line pt-4">
        <h3 className="text-sm font-bold text-ink">Storage by organization</h3>
        <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-line">
          {organizations.length === 0 ? <p className="p-3 text-sm text-ink-muted">No organizations yet.</p> : <table className="w-full text-left text-xs"><thead className="sticky top-0 bg-subtle text-ink-muted"><tr><th scope="col" className="px-3 py-2">Organization</th><th scope="col" className="px-3 py-2 text-right">Files stored</th></tr></thead><tbody className="divide-y divide-line">{organizations.map((organization) => <tr key={organization.id}><td className="px-3 py-2 font-semibold text-ink">{organization.name}</td><td className="px-3 py-2 text-right tabular-nums text-ink-muted-strong">{size(organization.stored_bytes)} / {limits.max_organization_mb} MB</td></tr>)}</tbody></table>}
        </div>
      </div>
    </>}
  </Card></div>;
}
