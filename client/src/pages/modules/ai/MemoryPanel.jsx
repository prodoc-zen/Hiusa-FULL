import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import ConfirmModal from '../../../components/ConfirmModal';
import { Button, Drawer, EmptyState, ErrorState, IconButton, SkeletonText } from '../../../components/ui';
import { addAiMemory, deleteAiMemory, deleteAllAiMemories, listAiMemories } from '../../../services/askAiService';

const MIN_LENGTH = 3;
const MAX_LENGTH = 300;

const errorMessage = (err, fallback) =>
  err?.response?.data?.errors?.content?.[0] || err?.response?.data?.message || fallback;

const asList = (data) => {
  const list = data?.memories ?? data?.data ?? data;
  return Array.isArray(list) ? list : [];
};

export default function MemoryPanel({ open, onClose }) {
  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const response = await listAiMemories();
      setMemories(asList(response.data));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const trimmed = draft.trim();
  const valid = trimmed.length >= MIN_LENGTH && trimmed.length <= MAX_LENGTH;

  const add = async (event) => {
    event.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setFormError('');
    try {
      const response = await addAiMemory(trimmed);
      const saved = response.data?.memory ?? response.data?.data ?? response.data;
      setMemories((current) => [saved, ...current]);
      setDraft('');
    } catch (err) {
      setFormError(errorMessage(err, 'Could not save that. Try again.'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (memory) => {
    setFormError('');
    try {
      await deleteAiMemory(memory.id);
      setMemories((current) => current.filter((item) => item.id !== memory.id));
    } catch (err) {
      setFormError(errorMessage(err, 'Could not delete that. Try again.'));
    }
  };

  const removeAll = async () => {
    setBusy(true);
    setFormError('');
    try {
      await deleteAllAiMemories();
      setMemories([]);
    } catch (err) {
      setFormError(errorMessage(err, 'Could not delete your memory. Try again.'));
    } finally {
      setBusy(false);
      setConfirmAll(false);
    }
  };

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        title="Memory"
        description="Things you ask Ask AI to keep in mind. They are used in your answers, only for you."
      >
        <form onSubmit={add} className="flex flex-col gap-2">
          <label htmlFor="memory-input" className="text-[13px] font-semibold text-ink">Add something to remember</label>
          <textarea
            id="memory-input"
            rows={2}
            value={draft}
            maxLength={MAX_LENGTH}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="For example: I am the treasurer, keep answers short"
            className="w-full resize-none rounded-control border border-line bg-surface px-3 py-2.5 text-base font-normal leading-5 text-ink placeholder:text-ink-soft focus:border-brand-600 sm:text-sm"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-ink-muted-strong tabular-nums">{draft.length} / {MAX_LENGTH}</span>
            <Button type="submit" leftIcon={Plus} loading={saving} disabled={!valid}>Save</Button>
          </div>
          {formError && <p role="alert" className="text-xs font-medium text-danger-strong">{formError}</p>}
          <p className="text-xs font-medium text-ink-muted-strong">
            You can also type &ldquo;remember that &hellip;&rdquo; in the chat to save one.
          </p>
        </form>

        <div className="mt-5 border-t border-line pt-4">
          {loading ? (
            <SkeletonText lines={3} />
          ) : loadError ? (
            <ErrorState title="Could not load your memory" onRetry={load} className="py-2" />
          ) : memories.length === 0 ? (
            <EmptyState title="Nothing saved yet" description="Saved notes will show up here." />
          ) : (
            <>
              <ul className="divide-y divide-line-soft">
                {memories.map((memory) => (
                  <li key={memory.id} className="flex items-start justify-between gap-3 py-2.5">
                    <p className="min-w-0 break-words text-sm font-medium text-ink">{memory.content}</p>
                    <IconButton
                      icon={Trash2}
                      label={`Delete memory: ${memory.content}`}
                      size="sm"
                      variant="danger"
                      onClick={() => remove(memory)}
                      className="max-sm:h-[42px] max-sm:w-[42px]"
                    />
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => setConfirmAll(true)}
                className="mt-3 inline-flex min-h-[42px] items-center gap-2 rounded-control px-2.5 text-sm font-semibold text-danger-strong hover:bg-danger-tint"
              >
                <Trash2 size={14} aria-hidden="true" />
                Delete all
              </button>
            </>
          )}
        </div>
      </Drawer>
      <ConfirmModal
        open={confirmAll}
        title="Delete all memory?"
        message="Ask AI will forget everything you saved."
        confirmText="Delete all"
        busy={busy}
        onCancel={() => setConfirmAll(false)}
        onConfirm={removeAll}
      />
    </>
  );
}
