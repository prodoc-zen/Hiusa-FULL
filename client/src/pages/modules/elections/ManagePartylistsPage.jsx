import TableRowActions from '../../../components/TableRowActions';
import { formatDisplayText } from '../../../utils/displayText.js';
import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Edit2, Plus, Trash2 } from 'lucide-react';
import ConfirmModal from '../../../components/ConfirmModal';
import FeedbackToast from '../../../components/FeedbackToast';
import Button from '../../../components/ui/Button';
import DataTable from '../../../components/ui/DataTable';
import Drawer from '../../../components/ui/Drawer';
import EmptyState from '../../../components/ui/EmptyState';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import RichTextEditor, { RichTextBody } from '../../../components/RichText';
import { createPartylist, deletePartylist, getPartylists, updatePartylist } from '../../../services/electionService';
import { resolveAssetUrl } from '../../../utils/assetUrl';

const ALERT = 'rounded-control border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-strong';
const FILE_INPUT = 'block w-full text-sm text-ink file:mr-3 file:h-10 file:cursor-pointer file:rounded-control file:border file:border-line file:bg-surface file:px-4 file:text-sm file:font-semibold file:text-ink hover:file:bg-subtle';

function partylistImageError(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return 'Party banner must be a JPEG, PNG, or WebP image.';
  if (file.size > 5 * 1024 * 1024) return 'Party banner must be 5 MB or smaller.';
  return '';
}

function PartylistFields({ values, onChange, bannerPreview, onBannerChange }) {
  return (
    <div className="space-y-4">
      <Field label="Party list name" required>
        <Input data-autofocus value={values.name} onChange={(event) => onChange({ ...values, name: event.target.value })} placeholder="e.g. Alab" />
      </Field>
      <Field label="Acronym" optional>
        <Input value={values.acronym || ''} maxLength={30} onChange={(event) => onChange({ ...values, acronym: event.target.value.toUpperCase() })} placeholder="e.g. ALAB" />
      </Field>
      <Field label="Description" optional hint="Shown on candidate pages and election records.">
        <RichTextEditor value={values.description || ''} maxLength={2000} onChange={(description) => onChange({ ...values, description })} rows={3} placeholder="Mission or tagline" />
      </Field>
      <div className="space-y-2">
        {bannerPreview && <img src={bannerPreview} alt="Banner preview" className="h-16 w-32 rounded-control border border-line object-cover" />}
        <Field label="Party banner" optional hint="JPEG, PNG or WebP, up to 5 MB.">
          <input type="file" accept="image/jpeg,image/png,image/webp" className={FILE_INPUT} onChange={onBannerChange} />
        </Field>
      </div>
    </div>
  );
}

export default function ManagePartylistsPage() {
  const { election, refreshElection } = useOutletContext();
  const [partylistRows, setPartylistRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', acronym: '', description: '' });
  const [bannerFile, setBannerFile] = useState(null);
  const [bannerPreview, setBannerPreview] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editBannerFile, setEditBannerFile] = useState(null);
  const [editBannerPreview, setEditBannerPreview] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState('');
  const [workingId, setWorkingId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [feedback, setFeedback] = useState({ open: false, type: 'success', message: '' });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError('');
      try {
        const partylistData = await getPartylists();
        if (!cancelled) {
          const partylists = Array.isArray(partylistData) ? partylistData : [];
          setPartylistRows(partylists);
        }
      } catch {
        if (!cancelled) {
          setPartylistRows([]);
          setLoadError('Party lists did not load.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (election?.id) {
      load();
    }

    return () => {
      cancelled = true;
    };
  }, [election?.id, retryKey]);

  if (!election) {
    return <EmptyState title="Election not found" description="Go back and choose an election." />;
  }

  const candidates = election.candidates || [];
  const resolvePositionTitle = (candidate) => {
    if (candidate?.position?.title) {
      return candidate.position.title;
    }

    const match = (election.positions || []).find((position) => position.id === candidate?.position_id);
    return match?.title || 'Unassigned';
  };
  const filteredPartylists = partylistRows.filter((partylist) => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) {
      return true;
    }

    const name = String(partylist.name || '').toLowerCase();
    const acronym = String(partylist.acronym || '').toLowerCase();
    const description = String(partylist.description || '').toLowerCase();
    return name.includes(query) || acronym.includes(query) || description.includes(query);
  });
  const canEdit = election.status !== 'closed' && !election.finalized_at;
  const drawerOpen = showAdd || Boolean(editing);

  const getPartylistCandidates = (partylistId) =>
    candidates.filter((candidate) => candidate.partylist_id === partylistId);
  const candidateName = (candidate) => `${candidate.user?.first_name || ''} ${candidate.user?.last_name || ''}`.trim() || 'Unknown candidate';

  const resetAdd = () => {
    setForm({ name: '', acronym: '', description: '' });
    setBannerFile(null);
    setBannerPreview(null);
    setShowAdd(false);
  };

  const closeDrawer = () => {
    if (workingId) return;
    setError('');
    if (editing) {
      setEditBannerFile(null);
      setEditBannerPreview(null);
      setEditing(null);
    } else {
      setShowAdd(false);
    }
  };

  const handleAdd = async (event) => {
    event.preventDefault();
    setError('');
    setWorkingId('add');

    try {
      const created = await createPartylist({ ...form, bannerFile: bannerFile || null });
      setPartylistRows((current) => [...current, created]);
      resetAdd();
      setFeedback({ open: true, type: 'success', message: 'Party list registered.' });
    } catch (createError) {
      setError(createError?.response?.data?.message || 'Unable to add party list.');
    } finally {
      setWorkingId(null);
    }
  };

  const handleUpdate = async (event) => {
    event.preventDefault();
    if (!editing?.id) return;

    setError('');
    setWorkingId(editing.id);

    try {
      const updated = await updatePartylist(editing.id, {
        name: editing.name,
        acronym: editing.acronym || null,
        description: editing.description || null,
        bannerFile: editBannerFile || null,
      });

      setPartylistRows((current) => current.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)));
      setEditBannerFile(null);
      setEditBannerPreview(null);
      setEditing(null);
      setFeedback({ open: true, type: 'success', message: 'Party list updated.' });
    } catch (updateError) {
      setError(updateError?.response?.data?.message || 'Unable to update party list.');
    } finally {
      setWorkingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;

    setError('');
    setWorkingId(deleteTarget.id);

    try {
      await deletePartylist(deleteTarget.id);
      setPartylistRows((current) => current.filter((row) => row.id !== deleteTarget.id));
      await refreshElection();
      setFeedback({ open: true, type: 'success', message: `${deleteTarget.name} was removed.` });
      setDeleteTarget(null);
    } catch (deleteError) {
      setDeleteTarget(null);
      setError(deleteError?.response?.data?.message || 'Unable to delete party list.');
    } finally {
      setWorkingId(null);
    }
  };

  const bannerChange = (setFile, setPreview) => (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const imageError = partylistImageError(file);
    if (imageError) { setError(imageError); event.target.value = ''; return; }
    setError('');
    setFile(file);
    setPreview(URL.createObjectURL(file));
  };

  const openAdd = () => { setError(''); setShowAdd(true); };
  const openEdit = (partylist) => {
    setError('');
    setEditBannerFile(null);
    setEditBannerPreview(partylist.banner_url ? resolveAssetUrl(partylist.banner_url) : null);
    setEditing({ id: partylist.id, name: partylist.name || '', acronym: partylist.acronym || '', description: partylist.description || '' });
  };

  const columns = [
    {
      key: 'name',
      header: 'Party list',
      render: (partylist) => {
        const members = getPartylistCandidates(partylist.id);
        return (
          <div className="min-w-0 text-left">
            <p className="font-medium">
              {formatDisplayText(partylist.name)}
              {partylist.acronym && <span className="ml-2 text-xs font-normal text-ink-muted">{partylist.acronym}</span>}
            </p>
            {members.length > 0 && (
              <details>
                <summary className="min-h-10 cursor-pointer text-sm font-medium leading-10 text-brand-700 hover:text-brand-800">View candidates</summary>
                <ul className="mb-2 space-y-1 text-sm">
                  {members.map((candidate) => (
                    <li key={candidate.id}>
                      <span className="font-medium">{formatDisplayText(candidateName(candidate))}</span>
                      <span className="text-ink-muted">, {formatDisplayText(resolvePositionTitle(candidate))}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        );
      },
    },
    {
      key: 'description',
      header: 'Description',
      render: (partylist) => (partylist.description
        ? <RichTextBody value={partylist.description} className="line-clamp-2 max-w-prose text-left text-sm text-ink-muted-strong" />
        : null),
    },
    { key: 'candidates', header: 'Candidates', align: 'right', render: (partylist) => getPartylistCandidates(partylist.id).length },
  ];

  const registerButton = <Button leftIcon={Plus} onClick={openAdd}>Register party list</Button>;
  const filtersActive = Boolean(searchTerm.trim());
  const clearFilters = () => setSearchTerm('');

  const filters = partylistRows.length > 0 && (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <Field label="Search party lists" className="w-full sm:w-72">
        <Input type="search" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Name or acronym" />
      </Field>
      {canEdit && registerButton}
    </div>
  );

  const emptyState = partylistRows.length > 0
    ? <EmptyState kind="filtered" title="No party lists match" description="Try another name or acronym." onClearFilters={clearFilters} />
    : (
      <EmptyState
        title="No party lists yet"
        description={canEdit ? 'Register a party list so candidates can run under it.' : 'No party lists are registered for this election.'}
        action={canEdit ? registerButton : undefined}
      />
    );

  return (
    <div className="space-y-4">
      <FeedbackToast feedback={feedback} onClose={() => setFeedback({ open: false })} />

      {error && !drawerOpen && <p role="alert" className={ALERT}>{error}</p>}

      <DataTable
        caption={`Party lists for ${formatDisplayText(election.title)}`}
        columns={columns}
        rows={filteredPartylists}
        loading={loading}
        error={loadError || null}
        onRetry={() => setRetryKey((key) => key + 1)}
        filters={filters || null}
        filtersActive={filtersActive}
        onClearFilters={clearFilters}
        emptyState={emptyState}
        actions={canEdit ? (partylist) => (
          <TableRowActions subject={formatDisplayText(partylist.name)} actions={[
            { label: 'Edit', icon: Edit2, onClick: () => openEdit(partylist) },
            { label: 'Remove', icon: Trash2, danger: true, disabled: workingId === partylist.id, onClick: () => setDeleteTarget(partylist) },
          ]} />
        ) : undefined}
      />

      <Drawer
        open={drawerOpen}
        title={editing ? 'Edit party list' : 'Register party list'}
        onClose={closeDrawer}
        width="max-w-xl"
        footer={(
          <>
            <Button variant="secondary" onClick={closeDrawer} disabled={Boolean(workingId)}>Cancel</Button>
            {editing
              ? <Button type="submit" form="partylist-form" loading={workingId === editing.id} disabled={!editing.name?.trim()}>Save changes</Button>
              : <Button type="submit" form="partylist-form" loading={workingId === 'add'} disabled={!form.name.trim()}>Register party list</Button>}
          </>
        )}
      >
        <form id="partylist-form" onSubmit={editing ? handleUpdate : handleAdd} className="space-y-4">
          {editing ? (
            <PartylistFields values={editing} onChange={setEditing} bannerPreview={editBannerPreview} onBannerChange={bannerChange(setEditBannerFile, setEditBannerPreview)} />
          ) : (
            <PartylistFields values={form} onChange={setForm} bannerPreview={bannerPreview} onBannerChange={bannerChange(setBannerFile, setBannerPreview)} />
          )}
          {error && <p role="alert" className={ALERT}>{error}</p>}
        </form>
      </Drawer>

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Remove party list"
        message="This will remove the party list from the election workspace."
        recordName={deleteTarget?.name}
        confirmText="Remove"
        busy={Boolean(deleteTarget && workingId === deleteTarget.id)}
        onCancel={() => workingId !== deleteTarget?.id && setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
