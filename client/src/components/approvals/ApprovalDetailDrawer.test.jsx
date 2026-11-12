import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ApprovalDetailDrawer from './ApprovalDetailDrawer';

const mocks = vi.hoisted(() => ({ openProtectedFile: vi.fn() }));
vi.mock('../../utils/openProtectedFile', () => ({ openProtectedFile: mocks.openProtectedFile }));
vi.mock('../../services/financeService', () => ({ downloadFinancialReportPdf: vi.fn() }));

const FILES = [
  { id: 7, requirement: 'Venue Reservation Letter', original_name: 'venue.pdf', open_url: '/events/9/submission/files/7', reviews: [] },
  { id: 8, requirement: 'Request Letter', original_name: 'request.pdf', open_url: '/events/9/submission/files/8', reviews: [] },
];

const request = (overrides = {}, files = FILES) => ({
  id: 25, entity_type: 'event', entity_id: 9, title: 'Acquaintance Party', status: 'pending', required_role: 'DEPARTMENT_HEAD',
  requested_by: 'ADM-1', requested_at: '2026-11-12T09:26:00+08:00', requester: { first_name: 'James', last_name: 'Borgueta', school_id: 'ADM-1' },
  summary: { start_time: '2026-11-16', end_time: '2026-11-16', location: 'AVR', status: 'planning', requirement_files: files },
  ...overrides,
});

function renderDrawer(props = {}) {
  const handlers = { onApprove: vi.fn(), onReject: vi.fn(), onClose: vi.fn() };
  render(
    <MemoryRouter>
      <ApprovalDetailDrawer open request={request()} role="DEPARTMENT_HEAD" canAct {...handlers} {...props} />
    </MemoryRouter>,
  );
  return { ...handlers, drawer: screen.getByRole('dialog') };
}

const rowOf = (drawer, name) => within(drawer).getByText(name).closest('li');

describe('ApprovalDetailDrawer SAO event files', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists each file as a row with its requirement, a status, a file link and a Review action', () => {
    const { drawer } = renderDrawer();
    const section = within(drawer).getByRole('region', { name: 'SAO event files' });

    expect(within(section).getAllByRole('listitem')).toHaveLength(2);
    const row = within(rowOf(drawer, 'Venue Reservation Letter'));
    expect(row.getByText('Not checked')).toBeInTheDocument();
    expect(row.getByRole('button', { name: 'venue.pdf' })).toBeInTheDocument();
    expect(row.getByRole('button', { name: 'Review Venue Reservation Letter' })).toBeInTheDocument();
  });

  it('opens a file through the protected url', () => {
    const { drawer } = renderDrawer();
    fireEvent.click(within(rowOf(drawer, 'Request Letter')).getByRole('button', { name: 'request.pdf' }));
    expect(mocks.openProtectedFile).toHaveBeenCalledWith('/events/9/submission/files/8');
  });

  it('keeps Approve off until every file is accepted, and says why', () => {
    const { drawer, onApprove } = renderDrawer();
    const approve = within(drawer).getByRole('button', { name: 'Approve' });
    expect(approve).toBeDisabled();
    expect(within(drawer).getByText('Accept every file to approve. Return the request to send back a file with a note.')).toBeInTheDocument();

    for (const name of ['Venue Reservation Letter', 'Request Letter']) {
      fireEvent.click(within(rowOf(drawer, name)).getByRole('button', { name: `Review ${name}` }));
      fireEvent.change(within(drawer).getByLabelText(`Review of ${name}`), { target: { value: 'ok' } });
    }
    expect(approve).toBeEnabled();

    fireEvent.click(approve);
    expect(onApprove).toHaveBeenCalledWith(expect.objectContaining({ id: 25 }), [
      { id: 7, status: 'ok' },
      { id: 8, status: 'ok' },
    ]);
  });

  it('requires a note for Needs changes and sends the marked files with the rejection', () => {
    const { drawer, onReject } = renderDrawer();
    fireEvent.click(within(rowOf(drawer, 'Request Letter')).getByRole('button', { name: 'Review Request Letter' }));
    fireEvent.change(within(drawer).getByLabelText('Review of Request Letter'), { target: { value: 'needs_changes' } });

    expect(within(drawer).getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(within(drawer).getByRole('button', { name: 'Reject' })).toBeDisabled();
    fireEvent.change(within(drawer).getByLabelText('Note for the organization'), { target: { value: 'The seal is missing.' } });
    expect(within(drawer).getByRole('button', { name: 'Reject' })).toBeEnabled();

    fireEvent.click(within(drawer).getByRole('button', { name: 'Reject' }));
    expect(onReject).toHaveBeenCalledWith(expect.objectContaining({ id: 25 }), [{ id: 8, status: 'needs_changes', note: 'The seal is missing.' }]);
  });

  it('hands over no files when nothing was marked, so a plain rejection is unchanged', () => {
    const { drawer, onReject } = renderDrawer();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Reject' }));
    expect(onReject).toHaveBeenCalledWith(expect.objectContaining({ id: 25 }), undefined);
  });

  it('starts a file this step already accepted as Accepted', () => {
    const files = [{ ...FILES[0], reviews: [{ stage: 'dean', status: 'ok', note: null }] }, FILES[1]];
    const { drawer } = renderDrawer({ request: request({}, files) });
    expect(within(rowOf(drawer, 'Venue Reservation Letter')).getByText('Accepted')).toBeInTheDocument();
  });

  it('shows the note of an earlier return beside the file, and the file starts unchecked', () => {
    const files = [{ ...FILES[0], reviews: [{ stage: 'dean', status: 'needs_changes', note: 'The permit is expired.' }] }, FILES[1]];
    const { drawer } = renderDrawer({ request: request({}, files) });
    const row = within(rowOf(drawer, 'Venue Reservation Letter'));
    expect(row.getByText('Not checked')).toBeInTheDocument();
    expect(row.getByText(/The permit is expired\./)).toBeInTheDocument();
  });

  it('shows a decided request its marks and notes with no way to change them', () => {
    const files = [{ ...FILES[0], reviews: [{ stage: 'dean', status: 'needs_changes', note: 'The permit is expired.' }] }, { ...FILES[1], reviews: [{ stage: 'dean', status: 'ok', note: null }] }];
    const { drawer } = renderDrawer({ canAct: false, request: request({ status: 'rejected', remarks: 'Fix the permit.' }, files) });

    const flagged = within(rowOf(drawer, 'Venue Reservation Letter'));
    expect(flagged.getByText('Needs changes')).toBeInTheDocument();
    expect(flagged.getByText('Department Head: Needs changes. The permit is expired.')).toBeInTheDocument();
    expect(within(rowOf(drawer, 'Request Letter')).getByText('Accepted')).toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: /^Review / })).not.toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('keeps Approve usable when the event has no files yet', () => {
    const { drawer, onApprove } = renderDrawer({ request: request({}, []) });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Approve' }));
    expect(onApprove).toHaveBeenCalledWith(expect.objectContaining({ id: 25 }), undefined);
  });
});

describe('ApprovalDetailDrawer election letter', () => {
  const election = (url) => ({ id: 30, entity_type: 'election', entity_id: 3, title: 'SBO Election', status: 'pending', required_role: 'DEPARTMENT_HEAD', requested_by: 'ADM-1', requester: { first_name: 'Ana', last_name: 'Admin' }, summary: { status: 'pending_approval', target_status: 'pending_approval', informative_letter_url: url } });

  beforeEach(() => vi.clearAllMocks());

  it('opens the informative letter through the protected url', () => {
    const { drawer } = renderDrawer({ request: election('/elections/3/informative-letter') });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Informative letter' }));
    expect(mocks.openProtectedFile).toHaveBeenCalledWith('/elections/3/informative-letter');
  });

  it('shows no letter link when none was uploaded', () => {
    const { drawer } = renderDrawer({ request: election(null) });
    expect(within(drawer).queryByRole('button', { name: 'Informative letter' })).not.toBeInTheDocument();
  });
});

describe('ApprovalDetailDrawer step tracker', () => {
  it('wraps the steps into a grid that fits the drawer and stays pinned above the scrolling content', () => {
    const { drawer } = renderDrawer();
    const tracker = within(drawer).getByRole('list', { name: 'Event progress' });

    expect(tracker.className).toContain('grid-cols-2');
    expect(tracker.className).not.toContain('md:flex-row');
    expect(tracker.parentElement.className).toContain('sticky');
  });
});
