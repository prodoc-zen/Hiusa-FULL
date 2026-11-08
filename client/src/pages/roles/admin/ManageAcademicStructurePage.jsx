import { formatDisplayText } from '../../../utils/displayText.js';
import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { createAcademicProgram, deleteAcademicProgram, getAcademicStructure, updateAcademicProgram } from '../../../services/userService';
import ConfirmModal from '../../../components/ConfirmModal';
import ClassListImportPanel from '../../../components/users/ClassListImportPanel';
import { Button, Drawer, EmptyState, ErrorState, Field, Input, PageHeader, Skeleton } from '../../../components/ui';

const yearLabel = (year) => `${year}${year % 100 >= 11 && year % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[year % 10] || 'th')} Year`;
const yearsFor = (durationYears = 4) => Array.from({ length: Number(durationYears) || 4 }, (_, index) => index + 1);
const emptyForm = (durationYears = 4) => ({ name: '', duration_years: durationYears, sections: Object.fromEntries(yearsFor(durationYears).map((year) => [year, 0])) });

function programForm(program) {
  return {
    ...emptyForm(program.duration_years || 4),
    name: program.name,
    duration_years: program.duration_years || 4,
    sections: Object.fromEntries(yearsFor(program.duration_years || 4).map((year) => [year, program.sections?.filter((section) => Number(section.year_level) === year && !section.name.includes('Non Block')).length || 0])),
  };
}

function firstError(error, fallback) {
  const errors = error?.response?.data?.errors;
  return (errors && Object.values(errors).flat()[0]) || error?.response?.data?.message || fallback;
}

function SectionCountFields({ form, setForm }) {
  const updateDuration = (durationYears) => setForm({ ...form, duration_years: durationYears, sections: Object.fromEntries(yearsFor(durationYears).map((year) => [year, form.sections[year] ?? 0])) });
  return (
    <fieldset className="space-y-3">
      <legend className="text-[13px] font-medium text-ink">Program duration and block sections</legend>
      <p className="text-xs text-ink-muted">A Non Block section is included in every year and does not count toward these totals.</p>
      <Field label="Years in this program" className="max-w-48">
        <Input aria-label="Program duration in years" type="number" min="1" max="8" value={form.duration_years} onChange={(event) => updateDuration(Math.min(8, Math.max(1, Number(event.target.value) || 1)))} />
      </Field>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {yearsFor(form.duration_years).map((year) => (
          <Field key={year} label={yearLabel(year)}>
            <Input aria-label={`${yearLabel(year)} sections`} type="number" min="0" max="26" value={form.sections[year]} onChange={(event) => setForm({ ...form, sections: { ...form.sections, [year]: Number(event.target.value) } })} />
          </Field>
        ))}
      </div>
    </fieldset>
  );
}

export default function ManageAcademicStructurePage() {
  const [structure, setStructure] = useState({ department: '', programs: [] });
  // One drawer adds and edits: `editing` is the program being edited, or null while adding.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState(emptyForm());
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const [success, setSuccess] = useState('');

  const load = async () => {
    try { setStructure(await getAcademicStructure()); setError(''); setLoadFailed(false); } catch { setError('Unable to load program and section settings.'); setLoadFailed(true); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const beginAdd = () => { setEditing(null); setEditForm(emptyForm()); setError(''); setSuccess(''); setDrawerOpen(true); };
  const beginEdit = (program) => { setEditing(program); setEditForm(programForm(program)); setError(''); setSuccess(''); setDrawerOpen(true); };
  const closeDrawer = () => { if (!busy) { setDrawerOpen(false); setEditing(null); } };
  const saveProgram = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setSuccess('');
    const payload = { name: editForm.name.trim(), duration_years: editForm.duration_years, sections: editForm.sections };
    try {
      if (editing) {
        await updateAcademicProgram(editing.id, payload);
        setSuccess('Program and section settings were updated.');
      } else {
        await createAcademicProgram(payload);
        setSuccess('Program and its required Non Block sections were created.');
      }
      setDrawerOpen(false); setEditing(null); await load();
    } catch (requestError) { setError(firstError(requestError, editing ? 'Unable to update the program.' : 'Unable to save the program.')); } finally { setBusy(false); }
  };
  const confirmDelete = async () => {
    setBusy(true); setError(''); setSuccess('');
    try {
      await deleteAcademicProgram(deleteTarget.id); setDeleteTarget(null); setSuccess('Program and its sections were deleted.'); await load();
    } catch (requestError) { setError(firstError(requestError, 'Unable to delete the program.')); setDeleteTarget(null); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-5">
      <PageHeader primary={<Button leftIcon={Plus} onClick={beginAdd}>Add program</Button>} />

      {error && !loadFailed && !drawerOpen && <p role="alert" className="text-sm font-semibold text-danger-strong">{error}</p>}
      {success && <p role="status" className="text-sm font-medium text-success-strong">{success}</p>}

      <section className="rounded-card border border-line bg-surface" aria-labelledby="configured-programs-title">
        <div className="border-b border-line px-5 py-4">
          <h2 id="configured-programs-title" className="text-base font-semibold text-ink">Programs</h2>
          <p className="mt-1 text-sm text-ink-muted">Department: <span className="font-medium text-ink">{structure.department || 'Not assigned'}</span>. Block sections use letter labels. Each year keeps its Non Block section.</p>
        </div>
        {loading ? (
          <div role="status" className="space-y-3 p-5"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-5/6" /><span className="sr-only">Loading programs</span></div>
        ) : loadFailed ? (
          <div className="px-5"><ErrorState title={error} description="Check your connection and try again." onRetry={() => { setLoading(true); load(); }} /></div>
        ) : structure.programs?.length ? (
          <ul className="divide-y divide-line-soft">
            {structure.programs.map((program) => (
              <li key={program.id} className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-ink">{formatDisplayText(program.name)}</h3>
                    <p className="text-xs text-ink-muted">{program.duration_years || 4}-year program</p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="secondary" aria-label={`Edit ${formatDisplayText(program.name)}`} onClick={() => beginEdit(program)}>Edit</Button>
                    <Button variant="secondary" aria-label={`Delete ${formatDisplayText(program.name)}`} className="text-danger-strong" onClick={() => setDeleteTarget(program)}>Delete</Button>
                  </div>
                </div>
                <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
                  {yearsFor(program.duration_years || 4).map((year) => {
                    const sections = program.sections?.filter((section) => Number(section.year_level) === year) || [];
                    return (
                      <div key={year}>
                        <dt className="text-xs font-semibold text-ink-muted">{yearLabel(year)}</dt>
                        <dd className="mt-0.5 text-sm text-ink">{sections.map((section) => section.name).join(', ')}</dd>
                      </div>
                    );
                  })}
                </dl>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-5"><EmptyState title="No programs yet" description="Add a program to set up its years and sections." action={<Button variant="secondary" leftIcon={Plus} onClick={beginAdd}>Add program</Button>} /></div>
        )}
      </section>

      <details className="group">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center rounded-control text-sm font-medium text-brand-700 underline underline-offset-2 marker:content-none hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">Import a class list from CSV</summary>
        <div className="mt-3"><ClassListImportPanel /></div>
      </details>

      <Drawer
        open={drawerOpen}
        title={editing ? 'Edit program' : 'Add program'}
        description={editing ? 'A section cannot be removed while user accounts are assigned to it. Renaming a program updates assigned user profiles.' : 'Each year also gets a Non Block section.'}
        width="max-w-xl"
        onClose={closeDrawer}
        footer={(
          <>
            <Button variant="secondary" onClick={closeDrawer} disabled={busy}>Cancel</Button>
            <Button type="submit" form="program-form" disabled={busy || !editForm.name.trim()}>{busy ? 'Saving...' : editing ? 'Save changes' : 'Add program'}</Button>
          </>
        )}
      >
        <form id="program-form" onSubmit={saveProgram} className="space-y-4">
          <Field label="Program name">
            <Input data-autofocus value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} required placeholder="e.g. BS Information Technology" />
          </Field>
          <SectionCountFields form={editForm} setForm={setEditForm} />
          {error && !loadFailed && <p role="alert" className="text-sm font-semibold text-danger-strong">{error}</p>}
        </form>
      </Drawer>

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Delete program"
        message="This permanently removes the program and all its sections. Programs assigned to users cannot be deleted."
        recordName={deleteTarget ? formatDisplayText(deleteTarget.name) : ''}
        confirmText="Delete program"
        busy={busy}
        onCancel={() => !busy && setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
