import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EventFilesReview, { draftMarks } from './EventFilesReview';
import EventSubmissionPanel from '../events/EventSubmissionPanel';

const mocks = vi.hoisted(() => ({
  getEventSubmission: vi.fn(),
  submitEventRequirements: vi.fn(),
}));
vi.mock('../../services/eventService', () => mocks);
vi.mock('../../utils/openProtectedFile', () => ({ openProtectedFile: vi.fn() }));
vi.mock('../../lib/notify', () => ({ default: { error: vi.fn() } }));

const flagged = { id: 5, requirement_id: 1, requirement: 'Event Proposal', original_name: 'proposal.pdf', open_url: '/f/5', reviews: [{ stage: 'sao', status: 'needs_changes', note: 'The seal is missing.' }] };
const accepted = { id: 6, requirement_id: 2, requirement: 'Venue Permit', original_name: 'permit.pdf', open_url: '/f/6', reviews: [{ stage: 'sao', status: 'ok', note: 'Clear scan.' }] };

describe('per-file SAO notes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('tints a needs-changes note in the warning colours and leaves an accepted note plain in the review list', () => {
    render(<EventFilesReview files={[flagged, accepted]} actionable={false} marks={{}} notes={{}} onMark={() => {}} onNote={() => {}} />);

    expect(screen.getByText('SAO: Needs changes. The seal is missing.')).toHaveClass('bg-warning-tint', 'text-warning-strong');
    expect(screen.getByText('SAO: Accepted. Clear scan.')).not.toHaveClass('bg-warning-tint');
  });

  it('tints the same note on the Admin event panel', async () => {
    mocks.getEventSubmission.mockResolvedValue({
      data: {
        requirements: [{ id: 1, name: 'Event Proposal', description: '', is_optional: false }, { id: 2, name: 'Venue Permit', description: '', is_optional: true }],
        files: [{ ...flagged, requirement: { name: 'Event Proposal' } }, { ...accepted, requirement: { name: 'Venue Permit' } }],
        approval_status: 'rejected',
        approval_remarks: 'Fix the proposal.',
      },
    });
    render(<EventSubmissionPanel eventId={9} role="ADMIN" />);

    expect(await screen.findByText('SAO: Needs changes. The seal is missing.')).toHaveClass('bg-warning-tint', 'text-warning-strong');
    expect(screen.getByText('SAO: Accepted. Clear scan.')).not.toHaveClass('bg-warning-tint');
  });
});

describe('draftMarks', () => {
  const files = [{ id: 7, requirement: 'Venue Reservation Letter', original_name: 'Juan Dela Cruz COC.pdf' }, { id: 8, requirement: 'Request Letter', original_name: 'request.pdf' }];

  it('names each marked file by its requirement and never by the uploaded file name', () => {
    const marks = draftMarks(files, [{ id: 7, status: 'ok' }, { id: 8, status: 'needs_changes', note: 'The seal is missing.' }]);

    expect(marks).toEqual([
      { requirement: 'Venue Reservation Letter', mark: 'accepted', note: '' },
      { requirement: 'Request Letter', mark: 'needs_changes', note: 'The seal is missing.' },
    ]);
    expect(JSON.stringify(marks)).not.toContain('Juan');
  });

  it('is empty when nothing was marked', () => {
    expect(draftMarks(files, undefined)).toEqual([]);
  });
});
