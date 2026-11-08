import { useCallback, useEffect, useState } from 'react';
import { Search, UserPlus } from 'lucide-react';
import ConfirmModal from '../ConfirmModal';
import PaginationControls from '../PaginationControls';
import { Button, Card, DataTable, EmptyState, Input, StatusBadge } from '../ui';
import { deleteAccountProfile, getManagedAccountProfiles } from '../../services/authService';
import { listMeta, unwrapList } from '../../services/pagination';
import { getApiErrorMessage } from '../../utils/apiError';
import { visibleSchoolId } from '../../utils/schoolId';
import GiveAccessModal from './GiveAccessModal';
import { ACCESS_LEVELS, grantableLevels, modulesLabel } from './orgAccess';

const PER_PAGE = 20;

export default function OrgAccessPanel({ organizationId, actorRole }) {
  const canGrant = grantableLevels(actorRole).length > 0;
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0, currentPage: 1, lastPage: 1, perPage: PER_PAGE });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [giving, setGiving] = useState(false);
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [removeError, setRemoveError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => { setTerm(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let current = true;
    setLoading(true);
    getManagedAccountProfiles({ organization_id: organizationId, per_page: PER_PAGE, page, ...(term ? { search: term } : {}) })
      .then((response) => {
        if (!current) return;
        setRows(unwrapList(response.data));
        setMeta(listMeta(response.data));
        setError('');
      })
      .catch((cause) => { if (current) setError(getApiErrorMessage(cause, 'We could not load the people in this organization.')); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [organizationId, page, term, reload]);

  const refresh = useCallback(() => setReload((value) => value + 1), []);

  function saved(name, wasEdit) {
    setNotice(wasEdit ? `Access updated for ${name}.` : `${name} now has access.`);
    refresh();
  }

  async function remove() {
    setBusy(true);
    setRemoveError('');
    try {
      await deleteAccountProfile(removing.id);
      setNotice(`${removing.first_name} ${removing.last_name} no longer has access.`);
      setRemoving(null);
      refresh();
    } catch (cause) {
      setRemoveError(getApiErrorMessage(cause, 'We could not remove this access. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  const columns = [
    {
      key: 'person',
      header: 'Person',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">{`${row.first_name} ${row.last_name}`}</p>
          <p className="truncate text-xs font-normal text-ink-muted">{visibleSchoolId(row.school_id) !== null ? `${row.email} · ${visibleSchoolId(row.school_id)}` : row.email}</p>
        </div>
      ),
    },
    { key: 'position_title', header: 'Position', render: (row) => row.position_title || '' },
    {
      key: 'role',
      header: 'Access',
      render: (row) => <StatusBadge label={ACCESS_LEVELS[row.role]?.label || row.role} tone={ACCESS_LEVELS[row.role]?.tone || 'neutral'} />,
    },
    { key: 'modules', header: 'Can open', render: (row) => <span className="text-xs font-normal text-ink-muted">{modulesLabel(row)}</span> },
  ];

  const actions = canGrant ? (row) => (
    <div className="flex justify-end gap-2">
      <Button variant="secondary" size="sm" disabled={Boolean(row.deletion_block_reason)} title={row.deletion_block_reason || undefined} aria-label={`Change access for ${row.first_name} ${row.last_name}`} onClick={() => setEditing(row)}>Change</Button>
      <Button variant="secondary" size="sm" disabled={Boolean(row.deletion_block_reason)} title={row.deletion_block_reason || undefined} aria-label={`Remove ${row.first_name} ${row.last_name}`} onClick={() => { setRemoveError(''); setRemoving(row); }}>Remove</Button>
    </div>
  ) : undefined;

  const filtersActive = Boolean(term);
  const emptyState = filtersActive ? undefined : (
    <EmptyState
      kind="first-run"
      icon={UserPlus}
      title="No one has access yet"
      description="Give a student access so they can work in this organization."
    />
  );

  return (
    <Card
      title="People and access"
      description="Who can work in this organization, and what they can open."
      actions={canGrant && <Button variant="secondary" size="sm" onClick={() => setGiving(true)}><UserPlus size={16} aria-hidden="true" />Give access</Button>}
    >
      <div className="space-y-4">
        <div className="relative max-w-sm">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" aria-hidden="true" />
          <Input type="search" className="pl-9" aria-label="Search people with access" placeholder="Search by name or email" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        {notice && <p role="status" className="text-sm font-medium text-success-strong">{notice}</p>}
        <DataTable
          caption="People with access to this organization"
          columns={columns}
          rows={rows}
          loading={loading}
          error={error || null}
          onRetry={refresh}
          filtersActive={filtersActive}
          emptyState={emptyState}
          actions={actions}
          actionsHeader=""
        />
        {!loading && !error && (
          <PaginationControls currentPage={meta.currentPage} totalItems={meta.total} pageSize={meta.perPage} onPageChange={setPage} label="people" />
        )}
      </div>

      {giving && (
        <GiveAccessModal
          organizationId={organizationId}
          actorRole={actorRole}
          excludeIds={rows.map((row) => row.school_id)}
          onClose={() => setGiving(false)}
          onSaved={saved}
        />
      )}
      {editing && (
        <GiveAccessModal
          organizationId={organizationId}
          actorRole={actorRole}
          profile={editing}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      )}
      <ConfirmModal
        open={Boolean(removing)}
        title="Remove access"
        message={removing && removing.profiles_count > 1
          ? 'They lose access to this organization only. Their account and other access stay as they are.'
          : 'This is the only profile on their account, so removing it deletes the account.'}
        recordName={removing ? `${removing.first_name} ${removing.last_name}` : ''}
        confirmText="Remove access"
        variant="danger"
        busy={busy}
        error={removeError}
        onCancel={() => !busy && setRemoving(null)}
        onConfirm={remove}
      />
    </Card>
  );
}
