import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarRange, ClipboardList, MapPin } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, Field, PageHeader, Select, StatusBadge } from '../../../components/ui';
import Modal from '../../../components/Modal';
import ConfirmModal from '../../../components/ConfirmModal';
import PaginationControls from '../../../components/PaginationControls';
import notify from '../../../lib/notify';
import { manilaDate } from '../../../lib/format';
import { localDateTimeToIso } from '../../../utils/dateTime';
import { listMeta, unwrapList } from '../../../services/pagination';
import { getApiErrorMessage } from '../../../utils/apiError';
import { createVenueBooking, getVenueAvailability, getVenueBookings, getVenues, withdrawVenueBooking } from '../../../services/venueService';
import { getEvents } from '../../../services/eventService';
import VenueAvailabilityTimeline from './VenueAvailabilityTimeline';

function getCurrentRole() {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}')?.role || '';
  } catch {
    return '';
  }
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function weekAheadIso() {
  return new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
}

function formatRange(start, end) {
  return `${manilaDate(start, 'long')}, ${new Date(start).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' })} - ${new Date(end).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' })}`;
}

const EMPTY_REQUEST_FORM = { venue_type: 'on_campus', venue_id: '', off_campus_location: '', event_id: '', start_time: '', end_time: '' };

export default function VenueBookingPage() {
  const role = useMemo(() => getCurrentRole(), []);

  const [venues, setVenues] = useState({ loading: true, error: null, items: [] });
  const [events, setEvents] = useState([]);
  const [selectedVenueId, setSelectedVenueId] = useState('');
  const [range, setRange] = useState({ from: todayIso(), to: weekAheadIso() });
  const [availability, setAvailability] = useState({ loading: false, error: null, slots: [] });

  const [requestForm, setRequestForm] = useState(EMPTY_REQUEST_FORM);
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestError, setRequestError] = useState(null);
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [submittedBooking, setSubmittedBooking] = useState(null);

  const [bookings, setBookings] = useState({ loading: true, error: null, items: [], meta: { total: 0, currentPage: 1, lastPage: 1, perPage: 20 } });
  const [bookingsPage, setBookingsPage] = useState(1);
  const [withdrawTarget, setWithdrawTarget] = useState(null);
  const [withdrawBusy, setWithdrawBusy] = useState(false);

  const loadVenues = useCallback(() => {
    setVenues((current) => ({ ...current, loading: true, error: null }));
    getVenues({ per_page: 100 })
      .then((response) => {
        const items = unwrapList(response.data);
        setVenues({ loading: false, error: null, items });
        setSelectedVenueId((current) => current || String(items[0]?.id || ''));
      })
      .catch((err) => setVenues((current) => ({ ...current, loading: false, error: getApiErrorMessage(err, 'Could not load the venue catalog.') })));
  }, []);

  const loadBookings = useCallback((page = 1) => {
    setBookings((current) => ({ ...current, loading: true, error: null }));
    getVenueBookings({ page })
      .then((response) => setBookings({ loading: false, error: null, items: unwrapList(response.data), meta: listMeta(response.data) }))
      .catch((err) => setBookings((current) => ({ ...current, loading: false, error: getApiErrorMessage(err, 'Could not load your booking requests.') })));
  }, []);

  const loadAvailability = useCallback(() => {
    if (!selectedVenueId || !range.from || !range.to) return;
    setAvailability((current) => ({ ...current, loading: true, error: null }));
    getVenueAvailability(selectedVenueId, { from: range.from, to: range.to })
      .then((response) => setAvailability({ loading: false, error: null, slots: unwrapList(response.data) }))
      .catch((err) => setAvailability({ loading: false, error: getApiErrorMessage(err, 'Could not load availability for this venue.'), slots: [] }));
  }, [selectedVenueId, range]);

  useEffect(() => {
    if (!['ADMIN', 'SBO_OFFICER'].includes(role)) return;
    loadVenues();
    loadBookings(1);
    getEvents({ per_page: 100 }).then((response) => setEvents(unwrapList(response.data))).catch(() => setEvents([]));
  }, [loadVenues, loadBookings, role]);

  useEffect(() => { loadAvailability(); }, [loadAvailability]);
  useEffect(() => { if (role) loadBookings(bookingsPage); }, [bookingsPage]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedVenue = venues.items.find((venue) => String(venue.id) === String(selectedVenueId));

  function openRequestForm(offCampus = false) {
    setRequestError(null);
    setRequestForm({
      venue_type: offCampus === true ? 'off_campus' : 'on_campus',
      venue_id: selectedVenueId,
      off_campus_location: '',
      event_id: '',
      start_time: range.from ? `${range.from}T09:00` : '',
      end_time: range.from ? `${range.from}T17:00` : '',
    });
    setRequestOpen(true);
  }

  async function handleRequestSubmit(event) {
    event.preventDefault();
    if ((requestForm.venue_type === 'on_campus' && !requestForm.venue_id) || (requestForm.venue_type === 'off_campus' && !requestForm.off_campus_location.trim()) || !requestForm.start_time || !requestForm.end_time) {
      setRequestError('Choose an on-campus venue or enter an off-campus location and both times.');
      return;
    }
    if (new Date(requestForm.end_time) <= new Date(requestForm.start_time)) {
      setRequestError('The end time must be after the start time.');
      return;
    }
    const startClock = requestForm.start_time.slice(11, 16);
    const endClock = requestForm.end_time.slice(11, 16);
    if (requestForm.start_time.slice(0, 10) !== requestForm.end_time.slice(0, 10) || startClock < '05:00' || endClock > '22:00') {
      setRequestError('Choose a time on one day between 5:00 AM and 10:00 PM.');
      return;
    }

    setRequestSubmitting(true);
    setRequestError(null);
    try {
      const response = await createVenueBooking({
        venue_type: requestForm.venue_type,
        venue_id: requestForm.venue_type === 'on_campus' ? Number(requestForm.venue_id) : null,
        off_campus_location: requestForm.venue_type === 'off_campus' ? requestForm.off_campus_location.trim() : null,
        event_id: requestForm.event_id || null,
        start_time: localDateTimeToIso(requestForm.start_time),
        end_time: localDateTimeToIso(requestForm.end_time),
      });
      setSubmittedBooking(response.data);
      setRequestOpen(false);
      loadBookings(1);
      setBookingsPage(1);
      loadAvailability();
    } catch (err) {
      setRequestError(getApiErrorMessage(err, 'Could not submit this booking request.'));
      if (err.response?.status === 422) loadAvailability();
    } finally {
      setRequestSubmitting(false);
    }
  }

  async function confirmWithdraw() {
    setWithdrawBusy(true);
    try {
      await withdrawVenueBooking(withdrawTarget.id);
      notify.success('Booking request withdrawn.');
      setWithdrawTarget(null);
      loadBookings(bookingsPage);
      loadAvailability();
    } catch (err) {
      notify.error(getApiErrorMessage(err, 'Could not withdraw this booking.'));
    } finally {
      setWithdrawBusy(false);
    }
  }

  if (!['ADMIN', 'SBO_OFFICER'].includes(role)) {
    return (
      <div className="space-y-5">
        <PageHeader title="Venues" description="Browse venues and request a booking for your organization." />
        <Card><EmptyState kind="restricted" title="Organization access only" description="Only organization admins and officers can request venue bookings." /></Card>
      </div>
    );
  }

  const bookingColumns = [
    { key: 'venue', header: 'Venue', render: (booking) => booking.venue?.name || booking.off_campus_location || 'Unknown' },
    { key: 'event', header: 'Event', render: (booking) => booking.event?.title || 'Not linked' },
    { key: 'when', header: 'Requested time', render: (booking) => formatRange(booking.start_time, booking.end_time) },
    { key: 'status', header: 'Status', render: (booking) => <StatusBadge status={booking.status} /> },
    { key: 'remarks', header: 'SAO remarks', render: (booking) => booking.status === 'rejected' && booking.remarks ? <span className="text-ink-muted">{booking.remarks}</span> : <span className="text-ink-soft">-</span> },
  ];

  function canWithdraw(booking) {
    return booking.status === 'pending' || (booking.status === 'approved' && new Date(booking.start_time) > new Date());
  }

  return (
    <div className="space-y-5 pb-8">
      <PageHeader title="Venues" description="Check availability, request a booking, and track your organization's requests." />
      <div className="flex justify-end"><Button variant="secondary" onClick={() => openRequestForm(true)}>Request an off-campus venue</Button></div>

      <Card title="Find a venue" description="Pending requests and approved bookings for the venue and dates you choose.">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Venue">
            <Select value={selectedVenueId} onChange={(event) => setSelectedVenueId(event.target.value)} disabled={venues.loading || venues.items.length === 0}>
              {venues.items.map((venue) => <option key={venue.id} value={venue.id}>{venue.name} - capacity {venue.capacity}</option>)}
            </Select>
          </Field>
          <Field label="From">
            <input type="date" value={range.from} max={range.to} onChange={(event) => setRange({ ...range, from: event.target.value })} className="h-11 w-full rounded-control border border-line bg-surface px-3 text-sm font-medium text-ink outline-none focus:border-brand-600 focus:ring-4 focus:ring-accent/15" />
          </Field>
          <Field label="To">
            <input type="date" value={range.to} min={range.from} onChange={(event) => setRange({ ...range, to: event.target.value })} className="h-11 w-full rounded-control border border-line bg-surface px-3 text-sm font-medium text-ink outline-none focus:border-brand-600 focus:ring-4 focus:ring-accent/15" />
          </Field>
        </div>

        {venues.error && <p className="mt-4 text-sm font-semibold text-danger-strong">{venues.error}</p>}

        {!venues.loading && venues.items.length === 0 && !venues.error && (
          <EmptyState kind="first-run" icon={MapPin} title="No venues available yet" description="SAO has not added any bookable venues yet. Check back later." className="mt-2" />
        )}

        {selectedVenue && (
          <div className="mt-5 border-t border-line pt-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-ink">{selectedVenue.name}</p>
                <p className="text-xs font-medium text-ink-muted">{selectedVenue.location} - capacity {selectedVenue.capacity}</p>
              </div>
              <Button size="sm" onClick={openRequestForm}>Request this venue</Button>
            </div>
            {availability.loading ? (
              <p className="text-sm font-medium text-ink-muted">Checking availability...</p>
            ) : availability.error ? (
              <p className="text-sm font-semibold text-danger-strong">{availability.error}</p>
            ) : (
              <VenueAvailabilityTimeline from={range.from} to={range.to} slots={availability.slots} />
            )}
          </div>
        )}
      </Card>

      <Card title="My organization's requests" description="Every venue booking your organization has requested.">
        <DataTable
          columns={bookingColumns}
          rows={bookings.items}
          loading={bookings.loading}
          error={bookings.error}
          onRetry={() => loadBookings(bookingsPage)}
          actions={(booking) => canWithdraw(booking) ? <Button size="sm" variant="secondary" onClick={() => setWithdrawTarget(booking)}>Withdraw</Button> : null}
          pagination={(
            <PaginationControls
              currentPage={bookings.meta.currentPage}
              totalItems={bookings.meta.total}
              pageSize={bookings.meta.perPage}
              onPageChange={setBookingsPage}
              label="requests"
            />
          )}
          emptyState={(
            <EmptyState
              kind="first-run"
              icon={ClipboardList}
              title="No booking requests yet"
              description="Requests your organization sends to SAO will show up here with their status."
              action={<Button leftIcon={CalendarRange} onClick={openRequestForm}>Request a venue</Button>}
            />
          )}
        />
      </Card>

      <Modal
        open={requestOpen}
        title="Request a venue booking"
        onClose={requestSubmitting ? undefined : () => setRequestOpen(false)}
        closeOnEscape={!requestSubmitting}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setRequestOpen(false)} disabled={requestSubmitting}>Cancel</Button>
            <Button onClick={handleRequestSubmit} loading={requestSubmitting}>Send request</Button>
          </>
        )}
      >
        <form onSubmit={handleRequestSubmit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Venue type" required className="sm:col-span-2"><Select value={requestForm.venue_type} onChange={(event) => setRequestForm({ ...requestForm, venue_type: event.target.value })}><option value="on_campus">On campus</option><option value="off_campus">Off campus</option></Select></Field>
          {requestForm.venue_type === 'on_campus' ? <Field label="Venue" required className="sm:col-span-2">
            <Select data-autofocus value={requestForm.venue_id} onChange={(event) => setRequestForm({ ...requestForm, venue_id: event.target.value })}>
              <option value="">Choose a venue</option>
              {venues.items.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
            </Select>
          </Field> : <Field label="Off-campus location" required className="sm:col-span-2"><input data-autofocus maxLength={255} value={requestForm.off_campus_location} onChange={(event) => setRequestForm({ ...requestForm, off_campus_location: event.target.value })} className="h-11 w-full rounded-control border border-line bg-surface px-3 text-sm" /></Field>}
          <Field label="Start" required>
            <input type="datetime-local" value={requestForm.start_time} onChange={(event) => setRequestForm({ ...requestForm, start_time: event.target.value })} className="h-11 w-full rounded-control border border-line bg-surface px-3 text-sm font-medium text-ink outline-none focus:border-brand-600 focus:ring-4 focus:ring-accent/15" />
          </Field>
          <Field label="End" required>
            <input type="datetime-local" value={requestForm.end_time} onChange={(event) => setRequestForm({ ...requestForm, end_time: event.target.value })} className="h-11 w-full rounded-control border border-line bg-surface px-3 text-sm font-medium text-ink outline-none focus:border-brand-600 focus:ring-4 focus:ring-accent/15" />
          </Field>
          <p className="text-xs text-[#64748B] sm:col-span-2">Bookings run from 5:00 AM to 10:00 PM on one day.</p>
          <Field label="Link to an event" hint="Optional" className="sm:col-span-2">
            <Select value={requestForm.event_id} onChange={(event) => setRequestForm({ ...requestForm, event_id: event.target.value })}>
              <option value="">Not linked to an event</option>
              {events.map((eventItem) => <option key={eventItem.id} value={eventItem.id}>{eventItem.title}</option>)}
            </Select>
          </Field>
          {requestError && <p role="alert" className="text-sm font-semibold text-danger-strong sm:col-span-2">{requestError}</p>}
        </form>
      </Modal>

      <Modal open={Boolean(submittedBooking)} title="Booking request sent" description="SAO will review this request. This is your booking reference, not an approval." onClose={() => setSubmittedBooking(null)} maxWidth="max-w-md" footer={<Button onClick={() => setSubmittedBooking(null)}>Done</Button>}>
        {submittedBooking && <div className="rounded-lg border border-[#DDE7EF] bg-[#FFFDF7] p-5">
          <div className="flex items-center gap-2 border-b border-dashed border-[#DDE7EF] pb-3 text-[#0F2F62]"><CalendarRange size={20} aria-hidden="true" /><span className="text-sm font-black">Venue request #{submittedBooking.id}</span></div>
          <dl className="mt-4 space-y-3 text-sm"><div><dt className="text-xs font-semibold text-[#64748B]">Venue</dt><dd className="font-bold text-[#0F172A]">{submittedBooking.venue?.name || submittedBooking.off_campus_location || 'Selected venue'}</dd></div><div><dt className="text-xs font-semibold text-[#64748B]">Requested time</dt><dd className="font-bold text-[#0F172A]">{formatRange(submittedBooking.start_time, submittedBooking.end_time)}</dd></div><div><dt className="text-xs font-semibold text-[#64748B]">Status</dt><dd><StatusBadge status="pending" /></dd></div></dl>
        </div>}
      </Modal>

      <ConfirmModal
        open={Boolean(withdrawTarget)}
        title="Withdraw this booking request?"
        message="SAO will be notified. You will need to submit a new request if you still need this venue."
        recordName={withdrawTarget ? `${withdrawTarget.venue?.name} - ${formatRange(withdrawTarget.start_time, withdrawTarget.end_time)}` : ''}
        confirmText="Withdraw request"
        variant="danger"
        busy={withdrawBusy}
        onCancel={() => setWithdrawTarget(null)}
        onConfirm={confirmWithdraw}
      />
    </div>
  );
}
