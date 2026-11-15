import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FileReviewList from './FileReviewList';

const openMocks = vi.hoisted(() => ({ openProtectedFile: vi.fn() }));
vi.mock('../../utils/openProtectedFile', () => openMocks);
const notifyMocks = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('../../lib/notify', () => ({ default: notifyMocks }));

const LONG = 'financial-report-qa-financial-semester-2026-10-30-1.pdf';

const rows = (extra = {}) => [
  {
    id: 1,
    name: 'Calendar of Activities (1st & 2nd Sem)',
    status: { status: 'ok', label: 'Accepted' },
    file: { name: LONG, url: '/documents/1' },
    actions: [{ label: 'Change', ariaLabel: 'Change Calendar of Activities', expanded: false, onClick: vi.fn() }],
    ...extra,
  },
  { id: 2, name: 'VMGO', status: { status: 'missing', label: 'Missing' }, file: null, emptyFile: 'No file attached.' },
];

describe('FileReviewList', () => {
  beforeEach(() => vi.clearAllMocks());

  it('has the columns Requirement, Status, File and Action once, above one row per requirement', () => {
    render(<FileReviewList rows={rows()} />);

    const header = ['Requirement', 'Status', 'File', 'Action'].map((name) => screen.getByText(name));
    expect(new Set(header.map((cell) => cell.parentElement)).size).toBe(1);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('cuts a long file name with an ellipsis, keeps the whole name in the title and never wraps it', () => {
    render(<FileReviewList rows={rows()} />);

    const link = screen.getByRole('button', { name: LONG });
    expect(link).toHaveAttribute('title', LONG);
    expect(within(link).getByText(LONG)).toHaveClass('truncate');
    expect(link.innerHTML).not.toContain('break-all');
  });

  it('puts the status badge, file and action of every row in the same cells', () => {
    render(<FileReviewList rows={rows()} />);

    const [first, second] = screen.getAllByRole('listitem');
    expect(first.firstElementChild.children).toHaveLength(4);
    expect(second.firstElementChild.children).toHaveLength(4);
    expect(within(first).getByText('Accepted')).toBeInTheDocument();
    expect(within(second).getByText('No file attached.')).toBeInTheDocument();
  });

  it('opens the file through the protected route and says so when it cannot', async () => {
    openMocks.openProtectedFile.mockRejectedValueOnce(new Error('nope'));
    render(<FileReviewList rows={rows()} />);

    fireEvent.click(screen.getByRole('button', { name: LONG }));

    await waitFor(() => expect(openMocks.openProtectedFile).toHaveBeenCalledWith('/documents/1'));
    await waitFor(() => expect(notifyMocks.error).toHaveBeenCalled());
  });

  it('draws no checkbox and no select all unless the screen passes selection', () => {
    render(<FileReviewList rows={rows()} />);

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  describe('with selection', () => {
    const selection = (extra = {}) => ({
      label: 'Select',
      allLabel: 'Select all files',
      checkedIds: new Set(),
      selectableIds: [1, 2],
      onToggle: vi.fn(),
      onToggleAll: vi.fn(),
      ...extra,
    });

    it('puts a box named after its row on every row, keeps the ul rows as they were and shows how many are ticked', () => {
      const { container } = render(<FileReviewList rows={rows()} selection={selection({ checkedIds: new Set([1]), actions: <button type="button">Accept selected</button> })} />);

      expect(screen.getByRole('checkbox', { name: 'Select Calendar of Activities (1st & 2nd Sem)' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Select VMGO' })).not.toBeChecked();
      expect(screen.getAllByRole('listitem')).toHaveLength(2);
      expect(container.querySelectorAll(':scope > ul > li')).toHaveLength(2);
      expect(screen.getByText('1 selected')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Accept selected' })).toBeInTheDocument();
    });

    it('shows select all unchecked, in-between and checked as rows are ticked', () => {
      const { rerender } = render(<FileReviewList rows={rows()} selection={selection()} />);
      const all = () => screen.getByRole('checkbox', { name: 'Select all files' });

      expect(all()).not.toBeChecked();
      expect(all()).not.toBePartiallyChecked();
      rerender(<FileReviewList rows={rows()} selection={selection({ checkedIds: new Set([2]) })} />);
      expect(all()).toBePartiallyChecked();
      expect(all()).not.toBeChecked();
      rerender(<FileReviewList rows={rows()} selection={selection({ checkedIds: new Set([1, 2]) })} />);
      expect(all()).toBeChecked();
      expect(all()).not.toBePartiallyChecked();
    });

    it('counts only the rows select all covers, so a row ticked on its own does not fake a full select all', () => {
      render(<FileReviewList rows={rows()} selection={selection({ selectableIds: [2], checkedIds: new Set([1]) })} />);

      const all = screen.getByRole('checkbox', { name: 'Select all files' });
      expect(all).not.toBeChecked();
      expect(all).not.toBePartiallyChecked();
    });

    it('reports a row toggle and a select all toggle, and cannot tick a disabled row', () => {
      const props = selection({ disabledIds: new Set([2]) });
      render(<FileReviewList rows={rows()} selection={props} />);

      fireEvent.click(screen.getByRole('checkbox', { name: 'Select Calendar of Activities (1st & 2nd Sem)' }));
      expect(props.onToggle).toHaveBeenCalledWith(1);
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select all files' }));
      expect(props.onToggleAll).toHaveBeenCalledWith(true);
      expect(screen.getByRole('checkbox', { name: 'Select VMGO' })).toBeDisabled();
    });

    it('turns select all off when there is nothing to select', () => {
      render(<FileReviewList rows={rows()} selection={selection({ selectableIds: [] })} />);

      expect(screen.getByRole('checkbox', { name: 'Select all files' })).toBeDisabled();
    });
  });

  it('calls the action and shows the note and detail only while the row is expanded', () => {
    const onClick = vi.fn();
    const { rerender } = render(<FileReviewList rows={rows({ actions: [{ label: 'Review', ariaLabel: 'Review Calendar', expanded: false, onClick }], note: 'Sign it.', detail: <p>More</p> })} />);

    expect(screen.queryByText('Sign it.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review Calendar' }));
    expect(onClick).toHaveBeenCalled();

    rerender(<FileReviewList rows={rows({ expanded: true, actions: [{ label: 'Close', ariaLabel: 'Close Calendar', expanded: true, onClick }], note: 'Sign it.', detail: <p>More</p> })} />);
    expect(screen.getByText('Sign it.')).toBeInTheDocument();
    expect(screen.getByText('More')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close Calendar' })).toHaveAttribute('aria-expanded', 'true');
  });
});
