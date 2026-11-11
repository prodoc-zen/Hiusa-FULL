import { matchesFilter } from '../../../utils/filterValues';
import { formatDisplayText } from '../../../utils/displayText.js';
import RichTextEditor, { RichTextBody } from '../../../components/RichText';
import { useEffect, useMemo, useState } from 'react';
import { PencilLine, Plus, Search, Trash2 } from 'lucide-react';
import ConfirmModal from '../../../components/ConfirmModal';
import FeedbackToast from '../../../components/FeedbackToast';
import TableRowActions from '../../../components/TableRowActions';
import { Button, DataTable, Drawer, EmptyState, Field, Input, PageHeader, Select, StatusBadge } from '../../../components/ui';
import { createSboPosition, deleteSboPosition, getSboPositions, updateSboPosition } from '../../../services/userService';

const EMPTY_FORM = { role: 'ADMIN', title: '', description: '', is_active: true };
const ROLE_LABELS = { ADMIN: 'Admin', SBO_OFFICER: 'SBO officer' };
const ADMIN_TITLES = ['President', 'Department Secretary', 'Secretary', 'Vice President', 'Treasurer', 'Auditor', 'Co-Administrator', 'Executive Secretary', 'Chief of Developer'];

function firstError(error, fallback) {
  const errors = error.response?.data?.errors;
  if (errors) return Object.values(errors).flat()[0] || fallback;
  return error.response?.data?.message || fallback;
}

export default function ManageSboPositionsPage() {
  const [positions, setPositions] = useState([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [customTitle, setCustomTitle] = useState(false);
  const [formMode, setFormMode] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [feedback, setFeedback] = useState({ open: false, type: 'success', message: '' });

  const load = async () => {
    setLoading(true); setError('');
    try { setPositions(await getSboPositions()); }
    catch { setError('Unable to load organization positions.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const filtersActive = Boolean(search.trim() || roleFilter);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return positions.filter((position) => matchesFilter(roleFilter, position.role)
      && (!query || `${position.title} ${position.description || ''}`.toLowerCase().includes(query)));
  }, [positions, roleFilter, search]);
  const clearFilters = () => { setSearch(''); setRoleFilter(''); };

  const openCreate = () => { setForm(EMPTY_FORM); setCustomTitle(false); setEditingId(null); setFormError(''); setFormMode('create'); };
  const openEdit = (position) => {
    setForm({ role: position.role, title: position.title, description: position.description || '', is_active: Boolean(position.is_active) });
    setCustomTitle(position.role === 'ADMIN' && !ADMIN_TITLES.includes(position.title));
    setEditingId(position.id); setFormError(''); setFormMode('edit');
  };
  const closeForm = () => { if (!busy) { setFormMode(null); setEditingId(null); setFormError(''); } };

  const submit = async (event) => {
    event.preventDefault();
    const title = form.title.trim();
    if (title.length < 2) { setFormError('Position title must contain at least 2 characters.'); return; }
    setBusy(true); setFormError('');
    const payload = { ...form, title, description: form.description.trim() || null };
    try {
      if (formMode === 'edit') await updateSboPosition(editingId, payload);
      else await createSboPosition(payload);
      await load();
      setFormMode(null); setEditingId(null);
      setFeedback({ open: true, type: 'success', message: `Position ${formMode === 'edit' ? 'updated' : 'created'}.` });
    } catch (requestError) { setFormError(firstError(requestError, 'Unable to save this position.')); }
    finally { setBusy(false); }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await deleteSboPosition(deleteTarget.id);
      await load();
      setDeleteTarget(null);
      setFeedback({ open: true, type: 'success', message: `${deleteTarget.title} was deleted. Assigned users were unassigned.` });
    } catch (requestError) {
      setDeleteTarget(null);
      setFeedback({ open: true, type: 'error', message: firstError(requestError, 'Unable to delete this position.') });
    } finally { setBusy(false); }
  };

  // Responsibilities and the inactive flag sit under the title so a row has no empty cells; the account
  // role gets a column only while the list holds more than one role.
  const mixedRoles = new Set(filtered.map((position) => position.role)).size > 1;
  const columns = [
    {
      key: 'title',
      header: 'Position',
      render: (position) => (
        <>
          <span className="font-medium">{formatDisplayText(position.title)}</span>
          {!position.is_active && <span className="ml-2 align-middle"><StatusBadge tone="neutral" label="Inactive" /></span>}
          {position.description && <RichTextBody as="span" value={position.description} className="mt-0.5 line-clamp-2 block max-w-md text-xs text-ink-muted-strong" />}
        </>
      ),
    },
    ...(mixedRoles ? [{ key: 'role', header: 'Account role', render: (position) => ROLE_LABELS[position.role] || position.role }] : []),
  ];

  const filters = (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative min-w-0 flex-1 sm:max-w-sm">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" aria-hidden="true" />
        <Input aria-label="Search positions" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title or responsibilities" className="pl-9" />
      </div>
      <Select aria-label="Filter positions by account role" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className="sm:w-52">
        <option value="">All account roles</option>
        <option value="ADMIN">Admin</option>
        <option value="SBO_OFFICER">SBO officer</option>
      </Select>
      {filtersActive && (
        <button type="button" onClick={clearFilters} className="min-h-11 self-start rounded-control px-1 text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800 sm:self-auto">Clear</button>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      <FeedbackToast feedback={feedback} onClose={() => setFeedback({ open: false, type: 'success', message: '' })} />
      <PageHeader primary={<Button leftIcon={Plus} onClick={openCreate}>Add position</Button>} />

      <section className="rounded-card border border-line bg-surface p-4 sm:p-5">
        <DataTable
          caption="Organization positions"
          columns={columns}
          rows={filtered}
          loading={loading}
          error={error || null}
          onRetry={load}
          filters={filters}
          filtersActive={filtersActive}
          onClearFilters={clearFilters}
          emptyState={positions.length === 0 && !filtersActive ? (
            <EmptyState
              title="No positions yet"
              description="Add the titles your admins and officers can hold."
              action={<Button variant="secondary" onClick={openCreate}>Add position</Button>}
            />
          ) : undefined}
          actions={(position) => (position.role === 'ADMIN' && /^(organization )?advis(e|o)r$/i.test(position.title)
            ? <span className="text-xs text-ink-muted">SAO managed</span>
            : <TableRowActions subject={position.title} label="Position actions" actions={[{ label: 'Edit position', icon: PencilLine, onClick: () => openEdit(position) }, { label: 'Delete position', icon: Trash2, danger: true, onClick: () => setDeleteTarget(position) }]} />)}
        />
      </section>

      <Drawer
        open={Boolean(formMode)}
        title={formMode === 'edit' ? 'Edit position' : 'Add position'}
        description="Positions decide which titles can be assigned in People."
        onClose={closeForm}
        footer={(
          <>
            <Button variant="secondary" onClick={closeForm} disabled={busy}>Cancel</Button>
            <Button type="submit" form="position-form" disabled={busy || !form.title.trim()} loading={busy}>Save position</Button>
          </>
        )}
      >
        <form id="position-form" onSubmit={submit} noValidate className="space-y-4">
          <Field label="Account role" hint="Students and department heads cannot hold a position.">
            <Select value={form.role} onChange={(event) => { setForm({ ...form, role: event.target.value, title: '' }); setCustomTitle(false); }}>
              <option value="ADMIN">Admin</option>
              <option value="SBO_OFFICER">SBO officer</option>
            </Select>
          </Field>
          {form.role === 'ADMIN' ? (
            <>
              <Field label="Position title">
                <Select data-autofocus value={customTitle ? '__other__' : form.title} onChange={(event) => { setCustomTitle(event.target.value === '__other__'); setForm({ ...form, title: event.target.value === '__other__' ? '' : event.target.value }); }}>
                  <option value="">Choose a title</option>
                  <option value="Adviser" disabled>Adviser (SAO only)</option>
                  {ADMIN_TITLES.map((title) => <option key={title} value={title}>{title}</option>)}
                  <option value="__other__">Other position</option>
                </Select>
              </Field>
              {customTitle && (
                <Field label="Other position title">
                  <Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required minLength={2} maxLength={100} />
                </Field>
              )}
            </>
          ) : (
            <Field label="Position title">
              <Input data-autofocus value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required minLength={2} maxLength={100} placeholder="e.g. President" />
            </Field>
          )}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="position-responsibilities" className="text-[13px] font-medium text-ink">Responsibilities <span className="font-normal text-ink-muted">(optional)</span></label>
            <RichTextEditor id="position-responsibilities" value={form.description} onChange={(description) => setForm({ ...form, description })} maxLength={2000} rows={4} placeholder="Describe this position's responsibilities." />
          </div>
          <label className="flex min-h-11 items-center gap-3 text-sm font-medium text-ink"><input type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} className="h-4 w-4 accent-brand-600" />Available for assignment</label>
          {formError && <p role="alert" className="text-sm font-semibold text-danger-strong">{formError}</p>}
        </form>
      </Drawer>
      <ConfirmModal open={Boolean(deleteTarget)} title="Delete position" message="Assigned users will have this position cleared before deletion." recordName={deleteTarget ? `${deleteTarget.title} · ${ROLE_LABELS[deleteTarget.role]}` : ''} confirmationText={deleteTarget?.title} confirmText="Delete position" busy={busy} onCancel={() => !busy && setDeleteTarget(null)} onConfirm={confirmDelete} />
    </div>
  );
}
