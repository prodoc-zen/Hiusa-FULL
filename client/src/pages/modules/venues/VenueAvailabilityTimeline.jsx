import { useState } from 'react';
import { Clock3 } from 'lucide-react';

export const OPEN_HOUR = 5;
export const CLOSE_HOUR = 22;

export function manilaDay(value) {
  return new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

export function manilaHour(value) {
  const [hour, minute] = new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Manila' }).split(':').map(Number);
  return hour + minute / 60;
}

export function timeLabel(value) {
  return new Date(value).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });
}

export default function VenueAvailabilityTimeline({ from, to, slots }) {
  const [selectedDay, setSelectedDay] = useState('');
  if (!from || !to || from > to) return <p className="text-sm text-ink-muted">Choose a date to see bookings.</p>;

  const days = [];
  const start = new Date(`${from}T12:00:00+08:00`);
  const end = new Date(`${to}T12:00:00+08:00`);
  for (let date = new Date(start); date <= end && days.length < 14; date.setUTCDate(date.getUTCDate() + 1)) days.push(manilaDay(date));
  const activeDay = days.includes(selectedDay) ? selectedDay : days[0];
  const bookings = slots.filter((slot) => manilaDay(slot.start_time) === activeDay);

  return <div>
    <div className="relative flex gap-2 overflow-x-auto pb-3" aria-label="Choose a booking date">
      {days.map((day) => { const daySlots = slots.filter((slot) => manilaDay(slot.start_time) === day); const hasReserved = daySlots.some((slot) => slot.status !== 'pending'); const hasPending = daySlots.some((slot) => slot.status === 'pending'); return <button key={day} type="button" onClick={() => setSelectedDay(day)} aria-pressed={day === activeDay} className={`min-h-11 shrink-0 rounded-lg border px-3 text-left text-xs font-bold focus-visible:outline-2 focus-visible:outline-accent ${day === activeDay ? 'border-brand-600 bg-page text-navy-800' : 'border-line bg-white text-ink-muted'}`}>{new Date(`${day}T12:00:00+08:00`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Manila' })}{daySlots.length > 0 && <span className="mt-1 flex items-center gap-1">{hasReserved && <span className="h-2 w-2 rounded-full bg-navy-800" title="Reserved" />}{hasPending && <span className="h-2 w-2 rounded-full bg-amber-500" title="Pending" />}<span className="sr-only">{hasReserved ? ' Reserved' : ''}{hasPending ? ' Pending' : ''}</span></span>}</button>; })}
    </div>
    <div className="mb-3 flex flex-wrap gap-4 text-xs font-semibold text-ink-muted"><span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-navy-800" />Reserved</span><span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-amber-500" />Pending</span></div>
    <div className="overflow-x-auto rounded-lg border border-line bg-white p-3">
      <div className="min-w-[600px]">
        <div className="flex justify-between text-xs font-semibold text-ink-muted">{[5, 8, 11, 14, 17, 20, 22].map((hour) => <span key={hour}>{new Date(2020, 0, 1, hour).toLocaleTimeString('en-PH', { hour: 'numeric' })}</span>)}</div>
        <div className="relative mt-2 h-12 rounded-md bg-page" aria-label="Booking hours, 5 AM to 10 PM">
          {bookings.map((slot) => <div key={slot.id} title={`${slot.status === 'pending' ? 'Pending' : 'Reserved'} by ${slot.reserved_by || 'another organization'}: ${timeLabel(slot.start_time)} - ${timeLabel(slot.end_time)}`} className={`absolute inset-y-1 rounded ${slot.status === 'pending' ? 'bg-amber-500' : 'bg-navy-800'}`} style={{ left: `${Math.max(0, (manilaHour(slot.start_time) - OPEN_HOUR) / (CLOSE_HOUR - OPEN_HOUR) * 100)}%`, width: `${Math.min(100, (manilaHour(slot.end_time) - manilaHour(slot.start_time)) / (CLOSE_HOUR - OPEN_HOUR) * 100)}%` }} />)}
        </div>
      </div>
    </div>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {bookings.length ? bookings.map((slot) => <div key={slot.id} className={`flex items-start gap-2 rounded-lg border bg-white p-3 text-xs ${slot.status === 'pending' ? 'border-amber-300' : 'border-navy-800'}`}><Clock3 size={16} className={`shrink-0 ${slot.status === 'pending' ? 'text-amber-600' : 'text-navy-800'}`} /><div><p className="font-bold text-ink">{timeLabel(slot.start_time)} - {timeLabel(slot.end_time)}</p><p className="mt-0.5 text-ink-muted">{slot.status === 'pending' ? 'Pending request from' : 'Reserved by'} {slot.reserved_by || 'another organization'}</p></div></div>) : <p className="text-sm text-ink-muted">No bookings on this date.</p>}
    </div>
    {end > new Date(start.getTime() + 13 * 86400000) && <p className="mt-2 text-xs text-ink-muted">Showing the first 14 days.</p>}
  </div>;
}
