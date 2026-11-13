import TableRowActions from '../../../components/TableRowActions';
import HiusaSelect from '../../../components/ui/Select';
import { formatDisplayText } from '../../../utils/displayText.js';
import { useEffect, useId, useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import {
  createElectionCandidate,
  deleteElectionCandidate,
  getPartylists,
  getUsers,
  updateElectionCandidate,
} from '../../../services/electionService';
import ConfirmModal from '../../../components/ConfirmModal';
import Avatar from '../../../components/ui/Avatar';
import Button from '../../../components/ui/Button';
import DataTable from '../../../components/ui/DataTable';
import Drawer from '../../../components/ui/Drawer';
import EmptyState from '../../../components/ui/EmptyState';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import RichTextEditor, { RichTextBody } from '../../../components/RichText';
import { fetchAllPages } from '../../../services/pagination';
import { resolveAssetUrl } from '../../../utils/assetUrl';

const ALERT = 'rounded-control border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-strong';
// Officers hold only an officer profile in their own organization, so they are candidates too.
const CANDIDATE_ROLES = ['STUDENT', 'SBO_OFFICER'];
const FILE_INPUT = 'block w-full text-sm text-ink file:mr-3 file:h-10 file:cursor-pointer file:rounded-control file:border file:border-line file:bg-surface file:px-4 file:text-sm file:font-semibold file:text-ink hover:file:bg-subtle';

function studentName(user) {
  return `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email || 'Unnamed student';
}

function studentKey(user) {
  return String(user.school_id ?? user.id);
}

function candidateImageError(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return 'Candidate photo must be a JPEG, PNG, or WebP image.';
  if (file.size > 2 * 1024 * 1024) return 'Candidate photo must be 2 MB or smaller.';
  return '';
}

// A combobox: type a name, see the name with the school ID and email under it, pick. The school ID
// is read, never typed.
function StudentSearchDropdown({ users, value, onChange, ...controlProps }) {
  const listboxId = useId();
  const selectedUser = useMemo(
    () => users.find((user) => studentKey(user) === String(value)),
    [users, value]
  );
  const selectedLabel = selectedUser ? studentName(selectedUser) : '';
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(selectedLabel);

  useEffect(() => {
    if (!open) {
      setQuery(selectedLabel);
    }
  }, [open, selectedLabel]);

  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return users;
    }

    return users.filter((user) => {
      const searchable = [
        user.first_name,
        user.last_name,
        user.school_id,
        user.email,
        studentName(user),
      ].filter(Boolean).join(' ').toLowerCase();

      return searchable.includes(normalizedQuery);
    });
  }, [query, users]);

  const selectUser = (user) => {
    onChange(studentKey(user));
    setQuery(studentName(user));
    setOpen(false);
  };

  return (
    <div className="relative">
      <Input
        {...controlProps}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        autoComplete="off"
        value={query}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setTimeout(() => {
            setOpen(false);
            setQuery(selectedLabel);
          }, 120);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          if (value) {
            onChange('');
          }
        }}
        placeholder="Type a student name"
      />

      {open && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+0.25rem)] z-30 max-h-64 overflow-y-auto rounded-control border border-line bg-surface py-1 shadow-lg"
        >
          {filteredUsers.length === 0 ? (
            <div className="px-3 py-3 text-sm text-ink-muted">No students found.</div>
          ) : (
            filteredUsers.map((user) => (
              <button
                key={studentKey(user)}
                type="button"
                role="option"
                aria-selected={studentKey(user) === String(value)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectUser(user)}
                className={`flex min-h-11 w-full flex-col items-start justify-center px-3 py-2 text-left transition-colors duration-150 hover:bg-subtle ${
                  studentKey(user) === String(value) ? 'bg-brand-50' : ''
                }`}
              >
                <span className="text-sm font-medium text-ink">{studentName(user)}</span>
                <span className="text-xs text-ink-muted">{[user.school_id, user.email].filter(Boolean).join(', ')}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function CandidateForm({
  formId,
  form,
  setForm,
  positions,
  partylists,
  users,
  imagePreview,
  imageError,
  onImageChange,
  error,
  onSubmit,
}) {
  return (
    <form id={formId} onSubmit={onSubmit} className="space-y-4">
      <Field label="Student" required>
        <StudentSearchDropdown
          users={users}
          value={form.user_id}
          onChange={(userId) => setForm({ ...form, user_id: userId })}
        />
      </Field>

      <Field label="Position" required>
        <HiusaSelect
          value={form.position_id}
          onChange={(event) => setForm({ ...form, position_id: event.target.value })}
        >
          <option value="">Choose a position</option>
          {positions.map((position) => (
            <option key={position.id} value={position.id}>{formatDisplayText(position.title)}</option>
          ))}
        </HiusaSelect>
      </Field>

      <Field label="Party list" optional>
        <HiusaSelect
          value={form.partylist_id}
          onChange={(event) => setForm({ ...form, partylist_id: event.target.value })}
        >
          <option value="">Independent</option>
          {partylists.map((partylist) => (
            <option key={partylist.id} value={partylist.id}>{formatDisplayText(partylist.name)}{partylist.acronym ? ` (${partylist.acronym})` : ''}</option>
          ))}
        </HiusaSelect>
      </Field>

      <div className="space-y-2">
        {imagePreview && <Avatar name="Candidate photo preview" src={resolveAssetUrl(imagePreview)} size="lg" />}
        <Field label="Candidate photo" optional hint="JPEG, PNG or WebP, up to 2 MB." error={imageError}>
          <input type="file" accept="image/jpeg,image/png,image/webp" className={FILE_INPUT} onChange={onImageChange} />
        </Field>
      </div>

      <Field label="Platform statement" optional>
        <RichTextEditor
          value={form.platform}
          maxLength={2000}
          onChange={(platform) => setForm({ ...form, platform })}
          rows={3}
          placeholder="What this candidate stands for"
        />
      </Field>

      {error && <p role="alert" className={ALERT}>{error}</p>}
    </form>
  );
}

export default function ManageCandidatesPage() {
  const { election, role, refreshElection } = useOutletContext();
  // Only the Admin writes, and only on an election without filing; a filing election takes its candidates from approved applications.
  const filing = Boolean(election?.filing_starts_at);
  const canManage = role === 'ADMIN' && !filing;

  const [users, setUsers] = useState([]);
  const [partylists, setPartylists] = useState([]);
  const [resourcesLoading, setResourcesLoading] = useState(canManage);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [posFilter, setPosFilter] = useState('All');
  const [form, setForm] = useState({ user_id: '', position_id: '', partylist_id: '', platform: '' });
  const [editForm, setEditForm] = useState({ user_id: '', position_id: '', partylist_id: '', platform: '' });
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [editImageFile, setEditImageFile] = useState(null);
  const [editImagePreview, setEditImagePreview] = useState(null);
  const [error, setError] = useState('');
  const [imageError, setImageError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [workingId, setWorkingId] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // The student list and party list options feed only the add and edit forms.
      if (!canManage) {
        setResourcesLoading(false);
        return;
      }
      setResourcesLoading(true);
      try {
        // /users is paginated - the candidate-assignment dropdown needs the full
        // active roster of students and officers, not just its first page, so it is walked in full.
        const [allUsers, partylistData] = await Promise.all([
          fetchAllPages(getUsers, { role: JSON.stringify(CANDIDATE_ROLES), account_status: 'active' }),
          getPartylists(),
        ]);
        if (!cancelled) {
          setUsers(allUsers.filter((user) => CANDIDATE_ROLES.includes(user.role)));
          setPartylists(Array.isArray(partylistData) ? partylistData : []);
        }
      } catch {
        if (!cancelled) {
          setUsers([]);
          setPartylists([]);
          setError('Student and party list options did not load. Reload the page to try again.');
        }
      } finally {
        if (!cancelled) setResourcesLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [canManage]);

  const positions = useMemo(() => election?.positions || [], [election?.positions]);
  const candidates = useMemo(() => election?.candidates || [], [election?.candidates]);
  const ballotLocked = Boolean(election?.finalized_at) || (election?.votes || []).length > 0;

  const assignedUserIds = useMemo(() => new Set(candidates.map((candidate) => candidate.user_id)), [candidates]);

  const filtered = useMemo(() => (
    posFilter === 'All' ? candidates : candidates.filter((candidate) => candidate.position_id === Number(posFilter))
  ), [candidates, posFilter]);

  const availableAddUsers = users.filter((user) => !assignedUserIds.has(Number(studentKey(user))));
  const availableEditUsers = users.filter((user) => studentKey(user) === String(editForm.user_id) || !assignedUserIds.has(Number(studentKey(user))));

  if (!election) {
    return <EmptyState title="Election not found" description="Go back and choose an election." />;
  }

  const canEdit = canManage && election.status !== 'closed' && !ballotLocked;
  const drawerOpen = showAdd || Boolean(editId);

  const resetAddForm = () => {
    setForm({ user_id: '', position_id: '', partylist_id: '', platform: '' });
    setImageFile(null);
    setImagePreview(null);
    setImageError('');
    setShowAdd(false);
  };

  const resetEditForm = () => {
    setEditId(null);
    setEditForm({ user_id: '', position_id: '', partylist_id: '', platform: '' });
    setEditImageFile(null);
    setEditImagePreview(null);
    setImageError('');
  };

  const openEdit = (candidate) => {
    setEditId(candidate.id);
    setEditForm({
      user_id: candidate.user_id ? String(candidate.user_id) : '',
      position_id: candidate.position_id ? String(candidate.position_id) : '',
      partylist_id: candidate.partylist_id ? String(candidate.partylist_id) : '',
      platform: candidate.platform || '',
    });
    setEditImageFile(null);
    setEditImagePreview(candidate.image_url || null);
    setError('');
  };

  const openAdd = () => {
    setError('');
    setShowAdd(true);
    resetEditForm();
  };

  const closeDrawer = () => {
    if (submitting) return;
    if (editId) resetEditForm();
    else resetAddForm();
  };

  const handleAdd = async (event) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);

    const payload = {
      user_id: Number(form.user_id),
      position_id: Number(form.position_id),
      partylist_id: form.partylist_id ? Number(form.partylist_id) : null,
      platform: form.platform || null,
      imageFile: imageFile || null,
    };

    try {
      await createElectionCandidate(election.id, payload);
      await refreshElection();
      resetAddForm();
    } catch (createError) {
      setError(createError?.response?.data?.message || 'Unable to add candidate.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async (event) => {
    event.preventDefault();
    if (!editId) {
      return;
    }

    setError('');
    setSubmitting(true);

    const payload = {
      user_id: Number(editForm.user_id),
      position_id: Number(editForm.position_id),
      partylist_id: editForm.partylist_id ? Number(editForm.partylist_id) : null,
      platform: editForm.platform || null,
      imageFile: editImageFile || null,
    };

    try {
      await updateElectionCandidate(election.id, editId, payload);
      await refreshElection();
      resetEditForm();
    } catch (updateError) {
      setError(updateError?.response?.data?.message || 'Unable to update candidate.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemove = async (candidateId) => {
    setError('');
    setWorkingId(candidateId);

    try {
      await deleteElectionCandidate(election.id, candidateId);
      await refreshElection();
      setConfirmDeleteId(null);
    } catch (deleteError) {
      setConfirmDeleteId(null);
      setError(deleteError?.response?.data?.message || 'Unable to remove candidate.');
    } finally {
      setWorkingId(null);
    }
  };

  const imageChange = (setFile, setPreview) => (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const problem = candidateImageError(file);
    if (problem) { setImageError(problem); event.target.value = ''; return; }
    setImageError('');
    setFile(file);
    setPreview(URL.createObjectURL(file));
  };

  const candidateUserOf = (candidate) => candidate.user || users.find((user) => studentKey(user) === String(candidate.user_id));
  const candidateName = (candidate) => {
    const candidateUser = candidateUserOf(candidate);
    return `${candidateUser?.first_name || ''} ${candidateUser?.last_name || ''}`.trim();
  };

  const columns = [
    {
      key: 'name',
      header: 'Candidate',
      render: (candidate) => {
        const name = formatDisplayText(candidateName(candidate)) || 'Unknown candidate';
        return (
          <div className="flex items-center gap-3 text-left">
            <Avatar name={name} src={candidate.image_url ? resolveAssetUrl(candidate.image_url) : undefined} size="sm" />
            <span className="font-medium">{name}</span>
          </div>
        );
      },
    },
    { key: 'position', header: 'Position', render: (candidate) => formatDisplayText(positions.find((value) => value.id === candidate.position_id)?.title) || 'Unknown' },
    { key: 'partylist', header: 'Party list', render: (candidate) => candidate.partylist?.name || 'Independent' },
    {
      key: 'platform',
      header: 'Platform',
      render: (candidate) => (
        <details className="text-left">
          <summary className="min-h-10 cursor-pointer text-sm font-medium leading-10 text-brand-700 hover:text-brand-800">Read platform</summary>
          <RichTextBody value={candidate.platform || 'No campaign platform has been added.'} className="mb-2 max-w-prose text-sm text-ink-muted-strong" />
        </details>
      ),
    },
  ];

  const addButton = <Button leftIcon={Plus} disabled={resourcesLoading} onClick={openAdd}>Add candidate</Button>;
  const filtersActive = posFilter !== 'All';

  const filters = candidates.length > 0 && (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Position" className="w-full sm:w-64">
          <HiusaSelect value={posFilter} onChange={(event) => setPosFilter(event.target.value)}>
            <option value="All">All positions</option>
            {positions.map((position) => <option key={position.id} value={String(position.id)}>{formatDisplayText(position.title)}</option>)}
          </HiusaSelect>
        </Field>
        {filtersActive && <button type="button" onClick={() => setPosFilter('All')} className="min-h-10 rounded-control text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">Clear</button>}
      </div>
      {canEdit && addButton}
    </div>
  );

  const emptyState = candidates.length > 0
    ? <EmptyState kind="filtered" title="No candidates for this position" description="Choose another position to see its candidates." onClearFilters={() => setPosFilter('All')} />
    : (
      <EmptyState
        title="No candidates yet"
        description={canEdit ? 'Add a candidate for each position on the ballot.' : (filing ? 'No application has been approved yet.' : 'Nobody is registered for this election.')}
        action={canEdit ? addButton : undefined}
      />
    );

  const formProps = showAdd || !editId
    ? { formId: 'candidate-form', form, setForm, users: availableAddUsers, imagePreview, onImageChange: imageChange(setImageFile, setImagePreview), onSubmit: handleAdd }
    : { formId: 'candidate-form', form: editForm, setForm: setEditForm, users: availableEditUsers, imagePreview: editImagePreview, onImageChange: imageChange(setEditImageFile, setEditImagePreview), onSubmit: handleEdit };
  const activeForm = editId ? editForm : form;

  return (
    <div className="space-y-4">
      {filing && (
        <p className="text-sm text-ink-muted-strong">
          Candidates of this election come from approved applications.{' '}
          <Link to={`/dashboard/elections/applications?record=${election.id}`} className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">Applications</Link>
        </p>
      )}

      {ballotLocked && (
        <p className="rounded-control bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {(election.votes || []).length > 0 ? 'Candidate setup is locked because votes have already been cast.' : 'Candidate setup is locked because the ballot has been finalized.'}
        </p>
      )}

      {error && !drawerOpen && <p role="alert" className={ALERT}>{error}</p>}

      <DataTable
        caption={`Candidates for ${formatDisplayText(election.title)}`}
        columns={columns}
        rows={filtered}
        loading={resourcesLoading}
        filters={filters || null}
        filtersActive={filtersActive}
        onClearFilters={() => setPosFilter('All')}
        emptyState={emptyState}
        actions={canEdit ? (candidate) => (
          <TableRowActions subject={formatDisplayText(candidateName(candidate))} actions={[
            { label: 'Edit', icon: Pencil, onClick: () => openEdit(candidate) },
            { label: 'Remove', icon: Trash2, danger: true, disabled: workingId === candidate.id, onClick: () => setConfirmDeleteId(candidate.id) },
          ]} />
        ) : undefined}
      />

      <Drawer
        open={drawerOpen}
        title={editId ? 'Edit candidate' : 'Add candidate'}
        onClose={closeDrawer}
        width="max-w-xl"
        footer={(
          <>
            <Button variant="secondary" onClick={closeDrawer} disabled={submitting}>Cancel</Button>
            <Button type="submit" form="candidate-form" loading={submitting} disabled={!activeForm.user_id || !activeForm.position_id || Boolean(imageError)}>{editId ? 'Save changes' : 'Add candidate'}</Button>
          </>
        )}
      >
        <CandidateForm
          {...formProps}
          positions={positions}
          partylists={partylists}
          imageError={imageError}
          error={error}
        />
      </Drawer>

      <ConfirmModal
        open={Boolean(confirmDeleteId)}
        title="Remove candidate"
        message="This removes the candidate from the election."
        confirmText="Remove"
        busy={workingId === confirmDeleteId}
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={() => {
          if (!confirmDeleteId) return;
          handleRemove(confirmDeleteId);
        }}
      />
    </div>
  );
}
