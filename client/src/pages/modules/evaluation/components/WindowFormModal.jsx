import { useEffect, useState } from 'react';
import Modal from '../../../../components/Modal';
import { Button, Field, Input, SegmentedControl, Textarea } from '../../../../components/ui';

function toDateTimeLocal(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft (not visible yet)' },
  { value: 'open', label: 'Open now' },
];

const emptyForm = { title: '', description: '', opens_at: '', closes_at: '', status: 'draft' };

export default function WindowFormModal({ open, window: editingWindow, busy, error, onCancel, onSubmit }) {
  const [form, setForm] = useState(emptyForm);
  const [localError, setLocalError] = useState('');
  const isEdit = Boolean(editingWindow);

  useEffect(() => {
    if (!open) return;
    setLocalError('');
    setForm(editingWindow
      ? {
        title: editingWindow.title || '',
        description: editingWindow.description || '',
        opens_at: toDateTimeLocal(editingWindow.opens_at),
        closes_at: toDateTimeLocal(editingWindow.closes_at),
        status: editingWindow.status,
      }
      : emptyForm);
  }, [open, editingWindow]);

  function handleSubmit(event) {
    event.preventDefault();
    if (!form.title.trim()) {
      setLocalError('Give this evaluation window a title.');
      return;
    }
    if (form.opens_at && form.closes_at && new Date(form.closes_at) < new Date(form.opens_at)) {
      setLocalError('The close date must be on or after the open date.');
      return;
    }
    setLocalError('');

    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      opens_at: form.opens_at || null,
      closes_at: form.closes_at || null,
    };
    if (!isEdit) {
      payload.status = form.status;
    }
    onSubmit(payload);
  }

  return (
    <Modal
      open={open}
      title={isEdit ? 'Edit evaluation window' : 'New evaluation window'}
      description={isEdit ? 'Title, description and dates can be changed at any time, even after the window closes.' : 'This creates the window respondents will answer against.'}
      onClose={busy ? undefined : onCancel}
      closeOnEscape={!busy}
      footer={(
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit} loading={busy}>
            {isEdit ? 'Save changes' : 'Create window'}
          </Button>
        </>
      )}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Title" required>
          <Input
            data-autofocus
            value={form.title}
            onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
            placeholder="e.g. AY 2026-2027 First Semester Evaluation"
          />
        </Field>

        <Field label="Description" hint="Shown to respondents above the questionnaire.">
          <Textarea
            value={form.description}
            onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
            rows={3}
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Opens at" hint="Leave blank to allow answers immediately once open.">
            <Input
              type="datetime-local"
              value={form.opens_at}
              onChange={(event) => setForm((prev) => ({ ...prev, opens_at: event.target.value }))}
            />
          </Field>
          <Field label="Closes at" hint="Leave blank for no automatic close date.">
            <Input
              type="datetime-local"
              value={form.closes_at}
              onChange={(event) => setForm((prev) => ({ ...prev, closes_at: event.target.value }))}
            />
          </Field>
        </div>

        {!isEdit && (
          <Field label="Status">
            <SegmentedControl
              options={STATUS_OPTIONS}
              value={form.status}
              onChange={(value) => setForm((prev) => ({ ...prev, status: value }))}
            />
          </Field>
        )}

        {(localError || error) && (
          <p role="alert" className="rounded-control border border-danger/30 bg-danger-tint px-4 py-3 text-sm font-semibold text-danger-strong">
            {localError || error}
          </p>
        )}
      </form>
    </Modal>
  );
}
