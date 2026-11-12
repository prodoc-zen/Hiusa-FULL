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
