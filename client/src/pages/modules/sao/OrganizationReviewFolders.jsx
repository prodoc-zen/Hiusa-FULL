import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FolderOpen } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, Input, StatusBadge } from '../../../components/ui';
import TableRowActions from '../../../components/TableRowActions';
import { waitingFirst } from './waiting';

// `waiting` reads how many items an organization has waiting for the SAO; without it the list keeps the server's alphabetical order.
export default function OrganizationReviewFolders({ overview, onRetry, title, waiting, children }) {
  const [params, setParams] = useSearchParams();
  const organizationId = params.get('organization') || '';
  const [search, setSearch] = useState('');
  function choose(id) {
    setParams((current) => { const next = new URLSearchParams(current); if (id) next.set('organization', String(id)); else next.delete('organization'); return next; });
  }
  if (organizationId) {
    const chosen = overview.organizations.find((org) => String(org.organization_id) === organizationId);
    return <div className="space-y-4"><Button variant="secondary" size="sm" onClick={() => choose('')}>All organizations</Button>{children(organizationId, chosen && waiting ? waiting(chosen) : 0)}</div>;
  }
  const rows = overview.organizations.filter((org) => org.organization_name.toLowerCase().includes(search.trim().toLowerCase()));
  if (waiting) rows.sort(waitingFirst(waiting));
  const columns = [{ key: 'organization_name', header: 'Organization', render: (org) => <button type="button" onClick={() => choose(org.organization_id)} className="inline-flex min-h-11 items-center gap-2 text-left font-medium text-brand-700"><FolderOpen size={18} aria-hidden="true" />{org.organization_name}</button> }];
  if (waiting) columns.push({ key: 'waiting', header: 'Awaiting review', render: (org) => (waiting(org) > 0 ? <StatusBadge tone="warning" label={`${waiting(org)} waiting`} /> : <span className="text-ink-muted">None</span>) });
  return <Card title={title}>
    <DataTable caption={`${title} by organization`} rows={rows} rowKey={(org) => org.organization_id} loading={overview.loading} error={overview.error} onRetry={onRetry} stickyHeader={false}
      filters={<div className="mb-4"><Input type="search" aria-label={`Search ${title.toLowerCase()} organizations`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search organizations" /></div>}
      columns={columns}
      actions={(org) => <TableRowActions subject={org.organization_name} actions={[{ label: 'Open organization', icon: FolderOpen, onClick: () => choose(org.organization_id) }]} />}
      emptyState={<EmptyState kind={search ? 'filtered' : 'first-run'} title={search ? 'No matching organizations' : 'No active organizations yet'} description={search ? 'Try another organization name.' : 'Approved organizations appear here.'} onClearFilters={search ? () => setSearch('') : undefined} />}
    />
  </Card>;
}
