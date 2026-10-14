import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FolderOpen } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, Input } from '../../../components/ui';
import TableRowActions from '../../../components/TableRowActions';

export default function OrganizationReviewFolders({ overview, onRetry, title, children }) {
  const [params, setParams] = useSearchParams();
  const organizationId = params.get('organization') || '';
  const [search, setSearch] = useState('');
  function choose(id) {
    setParams((current) => { const next = new URLSearchParams(current); if (id) next.set('organization', String(id)); else next.delete('organization'); return next; });
  }
  if (organizationId) return <div className="space-y-4"><Button variant="secondary" size="sm" onClick={() => choose('')}>All organizations</Button>{children(organizationId)}</div>;
  const rows = overview.organizations.filter((org) => org.organization_name.toLowerCase().includes(search.trim().toLowerCase()));
  return <Card title={title} description="Choose an organization to open its review records.">
    <DataTable rows={rows} rowKey={(org) => org.organization_id} loading={overview.loading} error={overview.error} onRetry={onRetry} stickyHeader={false}
      filters={<div className="mb-4"><Input type="search" aria-label={`Search ${title.toLowerCase()} organizations`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search organizations" /></div>}
      columns={[{ key: 'organization_name', header: 'Organization', render: (org) => <button type="button" onClick={() => choose(org.organization_id)} className="inline-flex min-h-11 items-center gap-2 text-left font-bold text-brand-700"><FolderOpen size={18} aria-hidden="true" />{org.organization_name}</button> }]}
      actions={(org) => <TableRowActions subject={org.organization_name} actions={[{ label: 'Open organization', icon: FolderOpen, onClick: () => choose(org.organization_id) }]} />}
      emptyState={<EmptyState kind={search ? 'filtered' : 'first-run'} title={search ? 'No matching organizations' : 'No active organizations'} description={search ? 'Try another organization name.' : 'Approved organizations appear here.'} />}
    />
  </Card>;
}
