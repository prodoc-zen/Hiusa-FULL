import { ListChecks } from 'lucide-react';
import { Button, StatusBadge } from '../../../components/ui';
import Modal from '../../../components/Modal';
import { manilaDay, timeLabel } from './VenueAvailabilityTimeline';
import { dayLabel } from './calendarDates';
import { ConflictBadge } from './calendarParts';

export default function VenueBookingDetails({ slot, conflict, onClose, onShowInQueue }) {
  const sameDay = slot ? manilaDay(slot.start_time) === manilaDay(slot.end_time) : true;
  const dayText = (value) => dayLabel(manilaDay(value), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const rows = slot ? [
    ['Organization', slot.organization_name || slot.reserved_by],
    ['Event', slot.event_title || 'Not linked'],
    ['Venue', slot.venue_name || 'Not specified'],
    ['Date', sameDay ? dayText(slot.start_time) : `${dayText(slot.start_time)} to ${dayText(slot.end_time)}`],
    ['Time', `${timeLabel(slot.start_time)} to ${timeLabel(slot.end_time)}`],
  ] : [];

  return (
    <Modal
      open={Boolean(slot)}
      title="Booking details"
      onClose={onClose}
      maxWidth="max-w-md"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {onShowInQueue && slot && (
            <Button variant="secondary" leftIcon={ListChecks} onClick={() => onShowInQueue(slot)}>Show in booking requests</Button>
          )}
        </>
      )}
    >
      {slot && (
        <div className="grid gap-3">
          <dl className="grid gap-3">
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs font-bold uppercase tracking-wide text-ink-muted">{label}</dt>
                <dd className="mt-0.5 break-words text-sm font-semibold text-ink">{value}</dd>
              </div>
            ))}
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-ink-muted">Status</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-2">
                <StatusBadge status={slot.status} />
                {conflict && <ConflictBadge />}
              </dd>
            </div>
          </dl>
          {conflict && <p className="text-sm font-medium text-danger-strong">This request overlaps another booking for the same venue. Check the calendar before approving.</p>}
        </div>
      )}
    </Modal>
  );
}
