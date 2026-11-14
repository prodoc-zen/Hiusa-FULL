import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ConversationList, { groupConversations } from './ConversationList';

const now = new Date(2026, 10, 14, 15, 0, 0);
const at = (daysAgo) => new Date(2026, 10, 14 - daysAgo, 9, 0, 0).toISOString();

describe('groupConversations', () => {
  it('groups by Today, Yesterday, Earlier this week and Older, dropping empty groups', () => {
    const groups = groupConversations([
      { id: 1, title: 'a', last_message_at: at(0) },
      { id: 2, title: 'b', last_message_at: at(1) },
      { id: 3, title: 'c', last_message_at: at(4) },
      { id: 4, title: 'd', last_message_at: at(20) },
      { id: 5, title: 'e', last_message_at: null },
    ], now);
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ['Today', [1]],
      ['Yesterday', [2]],
      ['Earlier this week', [3]],
      ['Older', [4, 5]],
    ]);
    expect(groupConversations([{ id: 1, title: 'a', last_message_at: at(0) }], now)).toHaveLength(1);
  });
});

describe('ConversationList', () => {
  const props = { activeId: null, loading: false, error: false, onOpen: vi.fn(), onNew: vi.fn(), onRename: vi.fn(), onDelete: vi.fn(), onDeleteAll: vi.fn(), onRetry: vi.fn() };
  const many = (count) => Array.from({ length: count }, (_, i) => ({ id: i + 1, title: `Chat ${i + 1}`, last_message_at: new Date().toISOString() }));

  it('shows a search box only with more than eight conversations and filters by title', () => {
    const { rerender } = render(<ConversationList {...props} conversations={many(8)} />);
    expect(screen.queryByLabelText('Search conversations')).not.toBeInTheDocument();
    rerender(<ConversationList {...props} conversations={many(9)} />);
    fireEvent.change(screen.getByLabelText('Search conversations'), { target: { value: 'chat 9' } });
    expect(screen.getByRole('button', { name: 'Chat 9' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Chat 1' })).not.toBeInTheDocument();
  });

  it('shows Show more only when there is more, and asks for the next page when pressed', () => {
    const onLoadMore = vi.fn();
    const { rerender } = render(<ConversationList {...props} conversations={many(3)} />);
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
    rerender(<ConversationList {...props} conversations={many(3)} hasMore onLoadMore={onLoadMore} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    rerender(<ConversationList {...props} conversations={many(3)} hasMore loadingMore onLoadMore={onLoadMore} />);
    expect(screen.getByRole('button', { name: /Show more/ })).toBeDisabled();
  });

  it('names the row options button without a tooltip that would run off a phone screen', async () => {
    render(<ConversationList {...props} conversations={many(2)} />);
    const options = screen.getByRole('button', { name: 'Options for Chat 1' });
    fireEvent.focus(options);
    fireEvent.mouseEnter(options);
    await new Promise((resolve) => { setTimeout(resolve, 450); });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.click(options);
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });

  it('shows an empty state', () => {
    render(<ConversationList {...props} conversations={[]} />);
    expect(screen.getByText('Your conversations will show up here.')).toBeInTheDocument();
  });
});
