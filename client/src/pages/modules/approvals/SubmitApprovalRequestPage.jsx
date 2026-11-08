import { useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button, EmptyState, PageHeader } from '../../../components/ui';

// `approver` follows server/config/approvals.php: events, budgets and elections go to the Department
// Head, and an event the SAO has requirements for continues to the SAO afterwards. An Officer's
// announcement goes to the Admin; an Admin publishes their own announcements directly.
const REQUEST_TYPES = [
  {
    id: 'announcement',
    title: 'Announcement',
    description: 'Audience, content and publication schedule.',
    approver: {
      ADMIN: 'You publish it yourself.',
      SBO_OFFICER: 'The Admin approves it before it is published.',
    },
    roles: ['ADMIN', 'SBO_OFFICER'],
    path: '/dashboard/approval-requests/new/announcement',
  },
  {
    id: 'budget',
    title: 'Budget proposal',
    description: 'Allocation, warning threshold and an optional event link.',
    approver: { ADMIN: 'The Department Head approves it.' },
    roles: ['ADMIN'],
    path: '/dashboard/approval-requests/new/budget',
  },
  {
    id: 'event',
    title: 'Event proposal',
    description: 'Schedule, venue, plan and budget.',
    approver: { ADMIN: 'The Department Head approves it, then the SAO if the event has SAO requirements.' },
    roles: ['ADMIN'],
    path: '/dashboard/approval-requests/new/event',
  },
  {
    id: 'election',
    title: 'Election',
    description: 'Election period, artwork and ballot positions.',
    approver: { ADMIN: 'The Department Head approves it.' },
    roles: ['ADMIN'],
    path: '/dashboard/approval-requests/new/election',
  },
];

function getStoredRole() {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}')?.role || '';
  } catch {
    return '';
  }
}

export default function SubmitApprovalRequestPage() {
  const navigate = useNavigate();
  const role = getStoredRole();
  const availableTypes = useMemo(() => REQUEST_TYPES.filter((type) => type.roles.includes(role)), [role]);
  const [selectedType, setSelectedType] = useState(availableTypes[0]?.id || '');
  const selectedRequest = availableTypes.find((type) => type.id === selectedType);

  const continueToRequest = (event) => {
    event.preventDefault();
    if (selectedRequest) navigate(selectedRequest.path);
  };

  // With one request type there is nothing to choose, so go straight to its form.
  if (availableTypes.length === 1) return <Navigate to={availableTypes[0].path} replace />;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        actions={role === 'ADMIN' ? <Button variant="secondary" to="/dashboard/approvals?tab=submitted">See what I already submitted</Button> : undefined}
      />
      {availableTypes.length === 0 ? (
        <EmptyState title="No request types available" description="Your role cannot send requests for approval." />
      ) : (
      <form onSubmit={continueToRequest} className="space-y-5">
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-3 text-base font-semibold text-ink">What are you submitting?</legend>
          {availableTypes.map((type) => {
            const selected = selectedType === type.id;
            return (
              <label key={type.id} className={`flex min-h-[44px] cursor-pointer items-start gap-3 rounded-card border p-4 transition-colors duration-150 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-600 ${selected ? 'border-brand-600 bg-brand-50' : 'border-line bg-white hover:bg-subtle'}`}>
                <input type="radio" name="request_type" value={type.id} checked={selected} onChange={() => setSelectedType(type.id)} className="sr-only" />
                <span aria-hidden="true" className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border ${selected ? 'border-brand-600' : 'border-ink-soft'}`}>
                  {selected && <span className="h-2 w-2 rounded-full bg-brand-600" />}
                </span>
                <span>
                  <span className="block text-sm font-semibold text-ink">{type.title}</span>
                  <span className="mt-1 block text-sm text-ink-muted-strong">{type.description}</span>
                  <span className="mt-1 block text-sm text-ink-muted-strong">{type.approver[role]}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
        <div className="flex justify-end border-t border-line pt-5">
          <Button type="submit" disabled={!selectedRequest} rightIcon={ArrowRight}>Continue to request form</Button>
        </div>
      </form>
      )}
    </div>
  );
}
