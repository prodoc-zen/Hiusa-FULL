import { useMemo, useState } from 'react';
import { ArrowRight, CalendarDays, ClipboardCheck, Megaphone, Vote, WalletCards } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const REQUEST_TYPES = [
  {
    id: 'announcement',
    title: 'Announcement',
    description: 'Draft the audience, content, publication schedule, and supporting context.',
    roles: ['ADMIN', 'SBO_OFFICER'],
    path: '/dashboard/approval-requests/new/announcement',
    icon: Megaphone,
  },
  {
    id: 'budget',
    title: 'Budget proposal',
    description: 'Enter the allocation, warning threshold, and optional event link.',
    roles: ['ADMIN', 'SBO_OFFICER'],
    path: '/dashboard/approval-requests/new/budget',
    icon: WalletCards,
  },
  {
    id: 'event',
    title: 'Event proposal',
    description: 'Provide the event schedule, venue, planning details, and budget requirements.',
    roles: ['ADMIN'],
    path: '/dashboard/approval-requests/new/event',
    icon: CalendarDays,
  },
  {
    id: 'election',
    title: 'Election',
    description: 'Set the election period, artwork, and ballot positions for review.',
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
      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-start gap-4">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-[#EEF6FB] text-[#0B8ED0]"><ClipboardCheck size={22} /></div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-[#0B8ED0]">Approval workflow</p>
            <h1 className="mt-1 text-2xl font-black text-[#0F172A] sm:text-3xl">Submit a request for approval</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#64748B]">Choose the request type first. You will continue to its complete form, where saving creates the record as pending and notifies the authorized approver.</p>
          </div>
        </div>
      </section>

      <form onSubmit={continueToRequest} className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
        <div className="border-b border-[#DDE7EF] p-5">
          <h2 className="text-lg font-extrabold text-[#0F172A]">1. Select request type</h2>
          <p className="mt-1 text-sm text-[#64748B]">Only request types available to your role are shown.</p>
        </div>
        <fieldset className="grid gap-3 p-5 sm:grid-cols-2">
          <legend className="sr-only">Request type</legend>
          {availableTypes.map((type) => {
            const Icon = type.icon;
            const selected = selectedType === type.id;
            return (
              <label key={type.id} className={`cursor-pointer rounded-lg border p-4 transition focus-within:ring-4 focus-within:ring-[#16C7F3]/15 ${selected ? 'border-[#0B8ED0] bg-[#EEF6FB]' : 'border-[#DDE7EF] hover:border-[#0B8ED0]/40 hover:bg-[#F8FBFD]'}`}>
                <input type="radio" name="request_type" value={type.id} checked={selected} onChange={() => setSelectedType(type.id)} className="sr-only" />
                <span className="flex items-start gap-3">
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${selected ? 'bg-[#0B8ED0] text-white' : 'bg-[#EEF6FB] text-[#0B8ED0]'}`}><Icon size={19} /></span>
                  <span>
                    <span className="block text-sm font-extrabold text-[#0F172A]">{type.title}</span>
                    <span className="mt-1 block text-xs font-medium leading-5 text-[#64748B]">{type.description}</span>
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>
        <div className="flex flex-col gap-3 border-t border-[#DDE7EF] bg-[#F8FBFD] p-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs font-medium text-[#64748B]">The destination form validates all required details before submission.</p>
          <button type="submit" disabled={!selectedRequest} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7] disabled:cursor-not-allowed disabled:opacity-40">Continue to request form <ArrowRight size={16} /></button>
        </div>
      </form>
    </div>
  );
}
