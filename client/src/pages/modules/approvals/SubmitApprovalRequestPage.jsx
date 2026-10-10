import { useMemo, useState } from 'react';
import { ArrowRight, CalendarDays, ClipboardCheck, Megaphone, Vote, WalletCards } from 'lucide-react';
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
    icon: Megaphone,
  },
  {
    id: 'budget',
    title: 'Budget proposal',
    description: 'Enter the allocation, warning threshold, and optional event link.',
    approver: { ADMIN: 'Approved by the Department Head.' },
    roles: ['ADMIN'],
    path: '/dashboard/approval-requests/new/budget',
    icon: WalletCards,
  },
  {
    id: 'event',
    title: 'Event proposal',
    description: 'Provide the event schedule, venue, planning details, and budget requirements.',
    approver: { ADMIN: 'Approved by the Department Head, then by the SAO when SAO requirements apply to the event.' },
    roles: ['ADMIN'],
    path: '/dashboard/approval-requests/new/event',
    icon: CalendarDays,
  },
  {
    id: 'election',
    title: 'Election',
    description: 'Set the election period, artwork, and ballot positions for review.',
    approver: { ADMIN: 'Approved by the Department Head.' },
    roles: ['ADMIN'],
    path: '/dashboard/approval-requests/new/election',
    icon: Vote,
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
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        actions={role === 'ADMIN' ? <Button variant="secondary" to="/dashboard/approvals?tab=submitted" leftIcon={ClipboardCheck}>See what I already submitted</Button> : undefined}
      />
      <form onSubmit={continueToRequest} className="rounded-lg border border-line bg-surface shadow-sm">
        <div className="border-b border-line p-5">
          <h2 className="text-lg font-extrabold text-ink">What are you submitting?</h2>
          <p className="mt-1 text-sm text-ink-muted-strong">Only request types available to your role are shown. Each one says who approves it.</p>
        </div>
        <fieldset className="grid gap-3 p-5 sm:grid-cols-2">
          <legend className="sr-only">Request type</legend>
          {availableTypes.map((type) => {
            const Icon = type.icon;
            const selected = selectedType === type.id;
            return (
              <label key={type.id} className={`cursor-pointer rounded-lg border p-4 transition focus-within:ring-4 focus-within:ring-accent/15 ${selected ? 'border-brand-600 bg-brand-50' : 'border-line hover:border-brand-600/40 hover:bg-subtle'}`}>
                <input type="radio" name="request_type" value={type.id} checked={selected} onChange={() => setSelectedType(type.id)} className="sr-only" />
                <span className="flex items-start gap-3">
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${selected ? 'bg-brand-700 text-white' : 'bg-brand-50 text-navy-800'}`}><Icon size={19} aria-hidden="true" /></span>
                  <span>
                    <span className="block text-sm font-extrabold text-ink">{type.title}</span>
                    <span className="mt-1 block text-xs font-medium leading-5 text-ink-muted-strong">{type.description}</span>
                    <span className="mt-2 block text-xs font-bold leading-5 text-ink">{type.approver[role]}</span>
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>
        <div className="flex flex-col gap-3 border-t border-line bg-subtle p-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs font-medium text-ink-muted-strong">The destination form validates all required details before submission.</p>
          <Button type="submit" disabled={!selectedRequest} rightIcon={ArrowRight}>Continue to request form</Button>
        </div>
      </form>
    </div>
  );
}
