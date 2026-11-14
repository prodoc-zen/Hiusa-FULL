import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import ConfirmModal from '../../../components/ConfirmModal';
import { Button, ErrorState, IconButton, Skeleton } from '../../../components/ui';

const DAY_MS = 86400000;
const GROUPS = ['Today', 'Yesterday', 'Earlier this week', 'Older'];
const SEARCH_FROM = 9;

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

export function groupConversations(conversations, now = new Date()) {
  const today = startOfDay(now);
  const buckets = new Map(GROUPS.map((label) => [label, []]));

  conversations.forEach((conversation) => {
    const stamp = conversation.last_message_at ? new Date(conversation.last_message_at) : null;
    const age = stamp && !Number.isNaN(stamp.getTime()) ? Math.round((today - startOfDay(stamp)) / DAY_MS) : Infinity;
    let label = 'Older';
    if (age <= 0) label = 'Today';
    else if (age === 1) label = 'Yesterday';
    else if (age < 7) label = 'Earlier this week';
    buckets.get(label).push(conversation);
  });

  return GROUPS.filter((label) => buckets.get(label).length > 0).map((label) => ({ label, items: buckets.get(label) }));
}

function ConversationRow({ conversation, active, onOpen, onRename, onAskDelete }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(conversation.title);
  const rowRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (event) => {
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      if (event.type === 'mousedown' && rowRef.current?.contains(event.target)) return;
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [menuOpen]);

  const commitRename = async () => {
    const title = draft.trim();
    setRenaming(false);
    if (title && title !== conversation.title) await onRename(conversation.id, title);
  };

  if (renaming) {
    return (
      <li className="px-1 py-1">
        <label className="sr-only" htmlFor={`rename-${conversation.id}`}>Conversation title</label>
        <input
          id={`rename-${conversation.id}`}
          autoFocus
          value={draft}
          maxLength={160}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitRename();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              setDraft(conversation.title);
              setRenaming(false);
            }
          }}
          className="h-10 w-full rounded-control border border-brand-600 bg-surface px-2.5 text-base font-medium text-ink sm:text-sm max-sm:h-[42px]"
        />
      </li>
    );
  }

  return (
    <li ref={rowRef} className="relative">
      <div className={`flex items-center rounded-control ${active ? 'bg-brand-50' : 'hover:bg-subtle'}`}>
        <button
          type="button"
          onClick={() => onOpen(conversation.id)}
          aria-current={active ? 'true' : undefined}
          className={`min-h-[42px] min-w-0 flex-1 truncate rounded-control px-2.5 py-2 text-left text-sm ${active ? 'font-semibold text-brand-800' : 'font-medium text-ink'}`}
        >
          {conversation.title}
        </button>
        <IconButton
          icon={MoreHorizontal}
          label={`Options for ${conversation.title}`}
          size="sm"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          className="mr-1 max-sm:h-[42px] max-sm:w-[42px]"
        />
      </div>
      {menuOpen && (
        <div role="menu" className="absolute right-1 top-full z-10 mt-1 w-40 rounded-card border border-line bg-surface p-1 shadow-raised">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              setDraft(conversation.title);
              setRenaming(true);
            }}
            className="flex min-h-[42px] w-full items-center gap-2 rounded-control px-2.5 text-sm font-medium text-ink hover:bg-subtle"
          >
            <Pencil size={14} aria-hidden="true" />
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              onAskDelete(conversation);
            }}
            className="flex min-h-[42px] w-full items-center gap-2 rounded-control px-2.5 text-sm font-medium text-danger-strong hover:bg-danger-tint"
          >
            <Trash2 size={14} aria-hidden="true" />
            Delete
          </button>
        </div>
      )}
    </li>
  );
}

export default function ConversationList({
  conversations,
  activeId,
  loading,
  error,
  onRetry,
  onOpen,
  onNew,
  onRename,
  onDelete,
  onDeleteAll,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
}) {
  const [search, setSearch] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);

  const needle = search.trim().toLowerCase();
  const visible = needle ? conversations.filter((c) => c.title.toLowerCase().includes(needle)) : conversations;
  const groups = groupConversations(visible);

  const runDelete = async (action, close) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
      close();
    }
  };

  return (
    <nav aria-label="Conversations" className="flex min-h-0 flex-col gap-3">
      <Button variant="secondary" leftIcon={Plus} onClick={onNew} className="w-full">New chat</Button>

      {conversations.length >= SEARCH_FROM && (
        <div className="relative">
          <label htmlFor="conversation-search" className="sr-only">Search conversations</label>
          <Search size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
          <input
            id="conversation-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search conversations"
            className="h-10 w-full rounded-control border border-line bg-surface pl-9 pr-3 text-base font-normal text-ink placeholder:text-ink-soft focus:border-brand-600 sm:text-sm max-sm:h-[42px]"
          />
        </div>
      )}

      {loading && conversations.length === 0 ? (
        <div role="status" aria-label="Loading conversations" className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-9 w-full" />)}
        </div>
      ) : error && conversations.length === 0 ? (
        <ErrorState title="Could not load conversations" onRetry={onRetry} className="py-2" />
      ) : conversations.length === 0 ? (
        <p className="px-1 text-sm font-medium text-ink-muted-strong">Your conversations will show up here.</p>
      ) : groups.length === 0 ? (
        <p className="px-1 text-sm font-medium text-ink-muted-strong">No conversations match that search.</p>
      ) : (
        groups.map((group) => (
          <section key={group.label} aria-label={group.label}>
            <h3 className="px-2.5 pb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted-strong">{group.label}</h3>
            <ul className="flex flex-col gap-0.5">
              {group.items.map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  active={conversation.id === activeId}
                  onOpen={onOpen}
                  onRename={onRename}
                  onAskDelete={setPendingDelete}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      {hasMore && onLoadMore && (
        <Button variant="secondary" onClick={onLoadMore} loading={loadingMore} className="w-full max-sm:h-[42px]">Show more</Button>
      )}

      {conversations.length > 0 && (
        <button
          type="button"
          onClick={() => setConfirmAll(true)}
          className="mt-1 inline-flex min-h-[42px] items-center gap-2 rounded-control px-2.5 text-left text-sm font-semibold text-danger-strong hover:bg-danger-tint"
        >
          <Trash2 size={14} aria-hidden="true" />
          Delete all
        </button>
      )}

      <ConfirmModal
        open={Boolean(pendingDelete)}
        title="Delete this conversation?"
        message={pendingDelete ? `"${pendingDelete.title}" will be removed for good.` : ''}
        confirmText="Delete"
        busy={busy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => runDelete(() => onDelete(pendingDelete.id), () => setPendingDelete(null))}
      />
      <ConfirmModal
        open={confirmAll}
        title="Delete all conversations?"
        message="Every conversation in your history will be removed for good."
        confirmText="Delete all"
        busy={busy}
        onCancel={() => setConfirmAll(false)}
        onConfirm={() => runDelete(onDeleteAll, () => setConfirmAll(false))}
      />
    </nav>
  );
}
