import { useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button, PageHeader } from '../../../components/ui';

// `approver` follows server/config/approvals.php: events, budgets and elections go to the Department
// Head, and an event the SAO has requirements for continues to the SAO afterwards. An Officer's
// announcement goes to the Admin; an Admin publishes their own announcements directly.
const REQUEST_TYPES = [
  {
    id: 'announcement',
    title: 'Announcement',
    description: 'Draft the audience, content, publication schedule, and supporting context.',
    approver: {
      ADMIN: 'You publish it yourself. Announcements from officers are approved by the Admin.',
      SBO_OFFICER: 'Approved by the Admin before it is published.',
    },
    roles: ['ADMIN', 'SBO_OFFICER'],
    path: '/dashboard/approval-requests/new/announcement',
  },
  {
    id: 'budget',
    title: 'Budget proposal',
    description: 'Enter the allocation, warning threshold, and optional event link.',
    approver: { ADMIN: 'Approved by the Department Head.' },
    roles: ['ADMIN'],
    path: '/dashboard/approval-requests/new/budget',
  },
  {
    id: 'event',
    title: 'Event proposal',
    description: 'Provide the event schedule, venue, planning details, and budget requirements.',
    approver: { ADMIN: 'Approved by the Department Head, then by the SAO when SAO requirements apply to the event.' },
    roles: ['ADMIN'],
    path: '/dashboard/approval-requests/new/event',
  },
  {
    id: 'election',
    title: 'Election',
    description: 'Set the election period, artwork, and ballot positions for review.',
    approver: { ADMIN: 'Approved by the Department Head.' },
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

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        actions={role === 'ADMIN' ? <Button variant="secondary" to="/dashboard/approvals?tab=submitted">See what I already submitted</Button> : undefined}
      />
      <form onSubmit={continueToRequest} className="space-y-5">
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-3 text-base font-semibold text-ink">What are you submitting?</legend>
          {availableTypes.map((type) => {
            const selected = selectedType === type.id;
            return (
              <label key={type.id} className={`flex min-h-[44px] cursor-pointer items-start gap-3 rounded-card border p-4 transition-colors duration-150 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-600 ${selected ? 'border-brand-600 bg-brand-600/10' : 'border-line hover:bg-subtle'}`}>
                <input type="radio" name="request_type" value={type.id} checked={selected} onChange={() => setSelectedType(type.id)} className="sr-only" />
                <span aria-hidden="true" className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border ${selected ? 'border-brand-600' : 'border-ink-soft'}`}>
                  {selected && <span className="h-2 w-2 rounded-full bg-brand-600" />}
                </span>
                <span>
                  <span className="block text-sm font-semibold text-ink">{type.title}</span>
                  <span className="mt-1 block text-sm text-ink-muted-strong">{type.description}</span>
                  <span className="mt-1 block text-sm font-medium text-ink">{type.approver[role]}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
        <div className="flex justify-end border-t border-line pt-5">
          <Button type="submit" disabled={!selectedRequest} rightIcon={ArrowRight}>Continue to request form</Button>
        </div>
      </form>
    </div>
  );
}
