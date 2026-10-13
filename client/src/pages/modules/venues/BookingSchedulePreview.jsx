import { useEffect, useState } from 'react';
import { getVenueAvailability } from '../../../services/venueService';
import { unwrapList } from '../../../services/pagination';
import VenueAvailabilityTimeline from './VenueAvailabilityTimeline';

const day = (value) => new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

export default function BookingSchedulePreview({ booking }) {
  const [state, setState] = useState({ loading: true, slots: [], error: '' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!booking.venue_id) return;
    let active = true;
    getVenueAvailability(booking.venue_id, { from: `${day(booking.start_time)}T00:00:00+08:00`, to: `${day(booking.end_time)}T23:59:59+08:00` })
      .then((res) => { if (active) setState({ loading: false, slots: unwrapList(res.data), error: '' }); })
      .catch(() => { if (active) setState({ loading: false, slots: [], error: 'Could not load the venue schedule.' }); });
    return () => { active = false; };
  }, [booking, attempt]);
  if (!booking.venue_id) return <p className="text-sm text-ink-muted">Off-campus location: {booking.off_campus_location}. No campus venue calendar applies.</p>;
  return <section aria-label="Requested venue schedule" className="space-y-3">
    <h3 className="text-sm font-bold text-ink">{booking.venue?.name || 'Venue'} schedule</h3>
    <p className="text-xs text-ink-muted">Requested: {new Date(booking.start_time).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })} to {new Date(booking.end_time).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}. Compare this with the reservations below.</p>
    {state.loading ? <p role="status" className="text-sm text-ink-muted">Loading venue schedule…</p> : state.error ? <p role="alert" className="text-sm text-red-700">{state.error} <button type="button" className="font-bold underline" onClick={() => { setState({ loading: true, slots: [], error: '' }); setAttempt((v) => v + 1); }}>Retry</button></p> : <VenueAvailabilityTimeline from={day(booking.start_time)} to={day(booking.end_time)} slots={state.slots} />}
  </section>;
}
