import { useCallback, useEffect, useState } from 'react';
import { peso as money } from '../../../lib/format';
import { HandCoins, Plus } from 'lucide-react';
import CashAdvancesSection from '../../../components/finance/CashAdvancesSection';
import ConfirmModal from '../../../components/ConfirmModal';
import { createCollection, getCollections, getFinancialDashboard, recordRemittance, verifyCollection } from '../../../services/financeService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { Button, DataTable, Drawer, EmptyState, Field, Input, PageHeader, Select, StatusBadge, Textarea } from '../../../components/ui';

const EMPTY_COLLECTION = { source: '', amount_collected: '', expected_amount: '', notes: '' };

export default function FinancialCollectionsPage() {
  const [dashboard, setDashboard] = useState(null);
  const [collections, setCollections] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_COLLECTION);
  const [remit, setRemit] = useState(null);
  const [remitAmount, setRemitAmount] = useState('');
  const [verifyTarget, setVerifyTarget] = useState(null);
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dashboardResponse, collectionsResponse] = await Promise.all([
        getFinancialDashboard(), getCollections(filter === 'all' ? {} : { status: filter }),
      ]);
      setDashboard(dashboardResponse.data);
      setCollections(collectionsResponse.data || []);
      setLoadError('');
    } catch (cause) {
      setLoadError(getApiErrorMessage(cause, 'Could not load collections.'));
    } finally {
      setLoading(false);
    }
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  async function saveCollection(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await createCollection({ ...createForm, expected_amount: createForm.expected_amount === '' ? null : createForm.expected_amount });
      setCreateOpen(false);
      setCreateForm(EMPTY_COLLECTION);
      setNotice('Collection recorded. Another admin must verify it before it appears in the ledger.');
      await load();
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Could not record the collection.'));
    } finally {
      setBusy(false);
    }
  }

  async function verify(collection) {
    setBusy(true);
    try {
      await verifyCollection(collection.id);
      setVerifyTarget(null);
      setNotice('Collection verified and added to the ledger.');
      await load();
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Could not verify the collection.'));
    } finally {
      setBusy(false);
    }
  }

  async function saveRemittance(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await recordRemittance(remit.id, { amount: remitAmount });
      setRemit(null);
      setRemitAmount('');
      setNotice('Remittance recorded. Ledger income remains unchanged.');
      await load();
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Could not record the remittance.'));
    } finally {
      setBusy(false);
    }
  }

  const columns = [
    {
      key: 'source',
      header: 'Collection',
      render: (collection) => (
        <div className="min-w-0 text-left">
          <p className="break-words font-semibold text-ink">{collection.source}</p>
          <p className="text-xs text-ink-muted">{collection.reference} · {String(collection.collected_at || '').slice(0, 10)}</p>
          {collection.notes && <p className="break-words text-xs text-ink-muted">{collection.notes}</p>}
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (collection) => <StatusBadge status={collection.status} /> },
    { key: 'amount_collected', header: 'Collected', align: 'right', render: (collection) => money(collection.amount_collected) },
    { key: 'total_remitted', header: 'Remitted', align: 'right', render: (collection) => money(collection.total_remitted) },
    { key: 'unremitted_balance', header: 'Remaining', align: 'right', render: (collection) => money(collection.unremitted_balance) },
  ];

  const rowActions = (collection) => (
    <>
      {collection.status === 'pending' && Number(collection.collected_by) !== Number(user.school_id) && (
        <Button variant="secondary" disabled={busy} onClick={() => { setError(''); setVerifyTarget(collection); }}>Verify</Button>
      )}
      {collection.status === 'verified' && Number(collection.unremitted_balance) > 0 && (
        <Button variant="secondary" disabled={busy} onClick={() => { setError(''); setRemit(collection); setRemitAmount(''); }}>Remit</Button>
      )}
    </>
  );

  const emptyState = filter === 'all' ? (
    <EmptyState
      icon={HandCoins}
      title="No collections recorded yet"
      description="A collection is money the organization received, such as dues or sales. Choose Record collection above; another admin then verifies it and it posts to the ledger as income."
    />
  ) : (
    <EmptyState kind="filtered" title="No collections match this status" description="Show every collection to see the rest." onClearFilters={() => setFilter('all')} />
  );

  return <div className="space-y-6 pb-8">
    <PageHeader primary={createOpen || remit ? null : <Button leftIcon={Plus} onClick={() => { setError(''); setCreateOpen(true); }}>Record collection</Button>} />
    {error && !createOpen && !remit && !verifyTarget && <p role="alert" className="rounded-card border border-line bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="rounded-card border border-line bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
    {!loading && dashboard && (
      <dl className="grid grid-cols-1 divide-y divide-line rounded-card border border-line bg-surface sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {[['Available funds', dashboard.available_funds], ['Awaiting remittance', dashboard.unremitted_collections], ['Remitted', dashboard.total_remitted]].map(([label, value]) => (
          <div key={label} className="p-4">
            <dt className="text-xs font-medium text-ink-muted">{label}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums text-ink">{money(value)}</dd>
          </div>
        ))}
      </dl>
    )}
    <section aria-labelledby="collection-records-title">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="collection-records-title" className="text-base font-semibold text-ink">Collections</h2>
        <label htmlFor="collection-status" className="sr-only">Status</label>
        <Select filter id="collection-status" value={filter} onChange={(event) => setFilter(event.target.value)} className="w-44 max-w-[55%]">
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="verified">Verified</option>
        </Select>
      </div>
      <DataTable
        caption="Collection records"
        columns={columns}
        rows={collections}
        loading={loading}
        error={loadError}
        onRetry={load}
        emptyState={emptyState}
        actions={rowActions}
        actionsHeader="Action"
        stickyHeader={false}
      />
    </section>
    <CashAdvancesSection onLedgerChange={load} />
    <ConfirmModal
      open={Boolean(verifyTarget)}
      title="Verify this collection?"
      message="Verifying adds the amount to the ledger as income."
      recordName={verifyTarget ? `${verifyTarget.reference} for ${money(verifyTarget.amount_collected)}` : ''}
      confirmText="Verify collection"
      variant="primary"
      busy={busy}
      error={error}
      onCancel={() => setVerifyTarget(null)}
      onConfirm={() => verify(verifyTarget)}
    />
    {createOpen && (
      <Drawer
        open
        title="Record collection"
        description="Another admin must verify it before the ledger records income."
        onClose={() => !busy && setCreateOpen(false)}
        footer={(
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button type="submit" form="collection-form" loading={busy}>Record collection</Button>
          </>
        )}
      >
        <form id="collection-form" onSubmit={saveCollection} className="space-y-4">
          {error && <p role="alert" className="text-sm font-semibold text-danger-strong">{error}</p>}
          <Field label="Source" required>
            <Input maxLength={100} value={createForm.source} onChange={(event) => setCreateForm({ ...createForm, source: event.target.value })} />
          </Field>
          <Field label="Amount collected" required>
            <Input type="number" min="0.01" step="0.01" value={createForm.amount_collected} onChange={(event) => setCreateForm({ ...createForm, amount_collected: event.target.value })} />
          </Field>
          <Field label="Expected amount" optional>
            <Input type="number" min="0" step="0.01" value={createForm.expected_amount} onChange={(event) => setCreateForm({ ...createForm, expected_amount: event.target.value })} />
          </Field>
          <Field label="Notes" optional>
            <Textarea rows={3} maxLength={2000} value={createForm.notes} onChange={(event) => setCreateForm({ ...createForm, notes: event.target.value })} />
          </Field>
        </form>
      </Drawer>
    )}
    {remit && (
      <Drawer
        open
        title="Record remittance"
        description={`${remit.reference} · Available ${money(remit.unremitted_balance)}`}
        onClose={() => !busy && setRemit(null)}
        footer={(
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setRemit(null)}>Cancel</Button>
            <Button type="submit" form="remittance-form" loading={busy}>Record remittance</Button>
          </>
        )}
      >
        <form id="remittance-form" onSubmit={saveRemittance} className="space-y-4">
          {error && <p role="alert" className="text-sm font-semibold text-danger-strong">{error}</p>}
          <Field label="Amount" required>
            <Input type="number" min="0.01" max={remit.unremitted_balance} step="0.01" value={remitAmount} onChange={(event) => setRemitAmount(event.target.value)} />
          </Field>
        </form>
      </Drawer>
    )}
  </div>;
}
