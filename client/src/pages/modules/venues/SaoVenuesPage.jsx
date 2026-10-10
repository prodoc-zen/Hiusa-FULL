import { formatDisplayText } from '../../../utils/displayText.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Building2, ClipboardCheck, Plus, Trash2 } from 'lucide-react';
import {
  Button, Card, DataTable, Drawer, EmptyState, Field, FlowStepper, IconButton, Input, NextStep, PageHeader,
  Select, StatusBadge, Tabs, Textarea,
} from '../../../components/ui';
import Modal from '../../../components/Modal';
import ConfirmModal from '../../../components/ConfirmModal';
import PaginationControls from '../../../components/PaginationControls';
import notify from '../../../lib/notify';
import { manilaDate } from '../../../lib/format';
import { toNextStepProps, venueBookingLifecycle } from '../../../lib/lifecycle';
import useRecordParam from '../../../lib/useRecordParam';
import { listMeta, unwrapList } from '../../../services/pagination';
import { getApiErrorMessage } from '../../../utils/apiError';
import {
  createVenue, deleteVenue, getVenueAvailability, getVenueBookings, getVenues,
  reviewVenueBooking, updateVenue,
} from '../../../services/venueService';
import VenueWeekCalendar, { addDays, todayInManila, weekStartOf } from './VenueWeekCalendar';
import { venueStageText } from './venueStage';

const EMPTY_VENUE_FORM = { name: '', location: '', capacity: '', is_active: true };
const ROW_ACTION = 'h-11! sm:h-9!';

function getCurrentRole() {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}')?.role || '';
  } catch {
    return '';
  }
}

function toCalendarSlot(booking) {
  return {
    id: booking.id,
    venue_id: booking.venue_id,
    start_time: booking.start_time,
    end_time: booking.end_time,
    status: booking.status,
    reserved_by: booking.organization?.name || 'Unknown organization',
    event_title: booking.event?.title,
    venue_name: booking.venue?.name,
  };
}

function formatRange(start, end) {
  return `${manilaDate(start, 'long')}, ${new Date(start).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' })} - ${new Date(end).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' })}`;
}

// The Approve and Reject buttons open the review modals, so the callout carries no button of its own.
function BookingDetail({ booking, onApprove, onReject }) {
  const stage = venueBookingLifecycle(booking, 'SUPER_ADMIN');
  const next = { ...toNextStepProps(stage), primary: undefined };

  return (
    <div className="flex flex-col gap-4">
      <FlowStepper steps={stage.steps} ariaLabel="Venue booking progress" />
      <NextStep {...next} />
      <dl className="grid gap-3 text-sm">
        <div><dt className="text-xs font-semibold text-ink-muted">Organization</dt><dd className="font-bold text-ink">{booking.organization?.name || 'Unknown'}</dd></div>
        <div><dt className="text-xs font-semibold text-ink-muted">Event</dt><dd className="font-bold text-ink">{booking.event?.title ? formatDisplayText(booking.event.title) : 'Not linked'}</dd></div>
        <div><dt className="text-xs font-semibold text-ink-muted">Requested time</dt><dd className="font-bold text-ink">{formatRange(booking.start_time, booking.end_time)}</dd></div>
        {booking.remarks && <div><dt className="text-xs font-semibold text-ink-muted">Remarks</dt><dd className="font-medium text-ink">{booking.remarks}</dd></div>}
      </dl>
      {booking.status === 'pending' && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onReject}>Reject</Button>
          <Button onClick={onApprove}>Approve</Button>
        </div>
      )}
    </div>
  );
}

export default function SaoVenuesPage() {
  const role = useMemo(() => getCurrentRole(), []);
  const [recordId, setRecordId] = useRecordParam();
  const [pinned, setPinned] = useState(null);

  const [activeTab, setActiveTab] = useState(recordId ? 'bookings' : 'venues');

  const [venues, setVenues] = useState({ loading: true, error: null, items: [] });
  const [venueModal, setVenueModal] = useState(null);
  const [venueForm, setVenueForm] = useState(EMPTY_VENUE_FORM);
  const [venueFormError, setVenueFormError] = useState(null);
  const [venueSaving, setVenueSaving] = useState(false);
  const [togglingVenueId, setTogglingVenueId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [bookings, setBookings] = useState({ loading: true, error: null, items: [], meta: { total: 0, currentPage: 1, lastPage: 1, perPage: 20 } });
  const [bookingsPage, setBookingsPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState(recordId ? '' : 'pending');
  const [venueFilter, setVenueFilter] = useState('');
  const queueRef = useRef(null);
  const [reviewState, setReviewState] = useState(null);
  const [conflicts, setConflicts] = useState({ loading: false, items: [] });
  const [rejectRemarks, setRejectRemarks] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);

  const [weekStart, setWeekStart] = useState(() => weekStartOf(todayInManila()));
  const [calendar, setCalendar] = useState({ loading: true, error: null, slots: [], weekStart: null, truncated: null });
  const calendarRequest = useRef(0);

  const loadVenues = useCallback(() => {
    setVenues((current) => ({ ...current, loading: true, error: null }));
    getVenues({ per_page: 100 })
      .then((response) => setVenues({ loading: false, error: null, items: unwrapList(response.data) }))
      .catch((err) => setVenues((current) => ({ ...current, loading: false, error: getApiErrorMessage(err, 'Could not load the venue catalog.') })));
  }, []);

  const loadBookings = useCallback((page = 1) => {
    setBookings((current) => ({ ...current, loading: true, error: null }));
    getVenueBookings({ page, status: statusFilter || undefined, venue_id: venueFilter || undefined })
      .then((response) => setBookings({ loading: false, error: null, items: unwrapList(response.data), meta: listMeta(response.data) }))
      .catch((err) => setBookings((current) => ({ ...current, loading: false, error: getApiErrorMessage(err, 'Could not load booking requests.') })));
  }, [statusFilter, venueFilter]);

  const loadCalendar = useCallback(() => {
    const request = ++calendarRequest.current;
    setCalendar((current) => ({ ...current, loading: true, error: null }));
    const params = { from: `${weekStart}T00:00:00+08:00`, to: `${addDays(weekStart, 6)}T23:59:59+08:00`, venue_id: venueFilter || undefined, per_page: 100 };
    Promise.all(['pending', 'approved'].map((status) => getVenueBookings({ ...params, status })))
      .then((responses) => {
        if (request !== calendarRequest.current) return;
        const fetched = responses.flatMap((response) => unwrapList(response.data));
        const total = responses.reduce((sum, response) => sum + listMeta(response.data).total, 0);
        const slots = fetched.filter((booking) => booking.venue_id).map(toCalendarSlot);
        setCalendar({ loading: false, error: null, slots, weekStart, truncated: total > fetched.length ? { shown: fetched.length, total } : null });
      })
      .catch((err) => {
        if (request !== calendarRequest.current) return;
        setCalendar({ loading: false, error: getApiErrorMessage(err, 'Could not load the venue calendar.'), slots: [], weekStart: null, truncated: null });
      });
  }, [weekStart, venueFilter]);

  useEffect(() => { if (role === 'SUPER_ADMIN') loadVenues(); }, [loadVenues, role]);
  useEffect(() => { if (role === 'SUPER_ADMIN') loadBookings(bookingsPage); }, [loadBookings, bookingsPage, role]);
  useEffect(() => { if (role === 'SUPER_ADMIN' && activeTab === 'bookings') loadCalendar(); }, [loadCalendar, activeTab, role]);
  useEffect(() => { setBookingsPage(1); }, [statusFilter, venueFilter]);

  function openVenueModal(venue = null) {
    setVenueFormError(null);
    setVenueModal({ mode: venue ? 'edit' : 'create', venue });
    setVenueForm(venue ? {
      name: venue.name || '',
      location: venue.location || '',
      capacity: String(venue.capacity ?? ''),
      is_active: venue.is_active !== false,
    } : EMPTY_VENUE_FORM);
  }

  async function handleVenueSubmit(event) {
    event.preventDefault();
    if (!venueForm.name.trim() || !venueForm.location.trim() || venueForm.capacity === '' || Number(venueForm.capacity) < 0) {
      setVenueFormError('Complete the name, location, and a valid capacity before saving.');
      return;
    }

    setVenueSaving(true);
    setVenueFormError(null);
    const payload = {
      name: venueForm.name.trim(),
      location: venueForm.location.trim(),
      capacity: Number(venueForm.capacity),
      is_active: venueForm.is_active,
    };

    try {
      if (venueModal.mode === 'edit') {
        await updateVenue(venueModal.venue.id, payload);
        notify.success('Venue updated.');
      } else {
        await createVenue(payload);
        notify.success('Venue added to the catalog.');
      }
      setVenueModal(null);
      loadVenues();
    } catch (err) {
      setVenueFormError(getApiErrorMessage(err, 'Could not save this venue.'));
    } finally {
      setVenueSaving(false);
    }
  }

  async function toggleVenueActive(venue) {
    setTogglingVenueId(venue.id);
    try {
      await updateVenue(venue.id, { is_active: !venue.is_active });
      notify.success(venue.is_active ? `"${venue.name}" marked inactive.` : `"${venue.name}" marked active.`);
      loadVenues();
    } catch (err) {
      notify.error(getApiErrorMessage(err, 'Could not update this venue.'));
    } finally {
      setTogglingVenueId(null);
    }
  }

  async function confirmDelete() {
    setDeleteBusy(true);
    try {
      await deleteVenue(deleteTarget.id);
      notify.success(`"${deleteTarget.name}" deleted.`);
      setDeleteTarget(null);
      loadVenues();
    } catch (err) {
      notify.error(getApiErrorMessage(err, 'This venue could not be deleted.'));
    } finally {
      setDeleteBusy(false);
    }
  }

  const found = recordId ? bookings.items.find((booking) => String(booking.id) === recordId) ?? null : null;
  const openBooking = found ?? (pinned && String(pinned.id) === recordId ? pinned : null);

  useEffect(() => {
    if (found) setPinned(found);
  }, [found]);

  // A deep link can name a request on a later page, so walk the pages until it turns up.
  useEffect(() => {
    if (!recordId || openBooking || bookings.loading || bookings.error) return;
    if (bookingsPage < bookings.meta.lastPage) {
      setBookingsPage(bookingsPage + 1);
      return;
    }
    notify.error('That booking request is not in the list.');
    setRecordId(null);
  }, [recordId, openBooking, bookings.loading, bookings.error, bookings.meta.lastPage, bookingsPage, setRecordId]);

  function showInQueue(slot) {
    setStatusFilter(slot.status);
    setVenueFilter(String(slot.venue_id));
    queueRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  function openReview(booking, action) {
    setReviewState({ booking, action });
    setRejectRemarks('');
    if (action === 'approve' && booking.venue_id) {
      setConflicts({ loading: true, items: [] });
      getVenueAvailability(booking.venue_id, { from: booking.start_time, to: booking.end_time })
        .then((response) => setConflicts({ loading: false, items: (unwrapList(response.data)).filter((slot) => slot.id !== booking.id) }))
        .catch(() => setConflicts({ loading: false, items: [] }));
    } else {
      setConflicts({ loading: false, items: [] });
    }
  }

  async function confirmApprove() {
    setReviewBusy(true);
    try {
      const response = await reviewVenueBooking(reviewState.booking.id, { status: 'approved' });
      setPinned(response?.data?.id ? response.data : { ...reviewState.booking, status: 'approved' });
      notify.success(`Booking for "${reviewState.booking.venue?.name || reviewState.booking.off_campus_location}" approved.`);
      setReviewState(null);
      loadBookings(bookingsPage);
      loadCalendar();
    } catch (err) {
      notify.error(getApiErrorMessage(err, 'Could not approve this booking.'));
    } finally {
      setReviewBusy(false);
    }
  }

  async function confirmReject() {
    if (!rejectRemarks.trim()) return;
    setReviewBusy(true);
    try {
      const response = await reviewVenueBooking(reviewState.booking.id, { status: 'rejected', remarks: rejectRemarks.trim() });
      setPinned(response?.data?.id ? response.data : { ...reviewState.booking, status: 'rejected', remarks: rejectRemarks.trim() });
      notify.success(`Booking for "${reviewState.booking.venue?.name || reviewState.booking.off_campus_location}" rejected.`);
      setReviewState(null);
      setRejectRemarks('');
      loadBookings(bookingsPage);
      loadCalendar();
    } catch (err) {
      notify.error(getApiErrorMessage(err, 'Could not reject this booking.'));
    } finally {
      setReviewBusy(false);
    }
  }

  if (role !== 'SUPER_ADMIN') {
    return (
      <div className="space-y-5">
        <PageHeader />
        <Card><EmptyState kind="restricted" title="SAO access only" description="Only the Student Affairs Office manages the venue catalog." /></Card>
      </div>
    );
  }

  const venueColumns = [
    { key: 'name', header: 'Venue', render: (venue) => <span className="font-bold text-ink">{formatDisplayText(venue.name)}</span> },
    { key: 'location', header: 'Location' },
    { key: 'capacity', header: 'Capacity', align: 'right' },
    { key: 'is_active', header: 'Status', render: (venue) => <button type="button" role="switch" aria-checked={venue.is_active} aria-label={`${formatDisplayText(venue.name)} active status`} disabled={togglingVenueId === venue.id} onClick={() => toggleVenueActive(venue)} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-xs font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"><span aria-hidden="true" className={`relative h-6 w-11 rounded-full transition-colors ${venue.is_active ? 'bg-success' : 'bg-ink-soft'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${venue.is_active ? 'left-6' : 'left-1'}`} /></span><StatusBadge status={venue.is_active ? 'active' : 'inactive'} /></button> },
  ];

  const bookingColumns = [
    { key: 'organization', header: 'Organization', render: (booking) => <button type="button" onClick={() => setRecordId(booking.id)} className="text-left font-bold text-ink hover:text-brand-700">{booking.organization?.name || 'Unknown'}</button> },
    { key: 'venue', header: 'Venue', render: (booking) => booking.venue?.name || booking.off_campus_location || 'Unknown' },
    { key: 'event', header: 'Event', render: (booking) => booking.event?.title || 'Not linked' },
    { key: 'when', header: 'Requested time', render: (booking) => formatRange(booking.start_time, booking.end_time) },
    {
      key: 'status',
      header: 'Status',
      render: (booking) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge status={booking.status} />
          <span className="text-xs font-semibold text-ink-muted-strong">{venueStageText(booking)}</span>
        </div>
      ),
    },
  ];

  const bookingFiltersActive = statusFilter !== 'pending' || Boolean(venueFilter);

  return (
    <div className="space-y-5 pb-8">
      <PageHeader primary={activeTab === 'venues' && venues.items.length > 0 && <Button leftIcon={Plus} onClick={() => openVenueModal()}>New venue</Button>} />

      <Tabs
        value={activeTab}
        onChange={setActiveTab}
        tabs={[
          { key: 'venues', label: 'Venue catalog', icon: Building2 },
          { key: 'bookings', label: 'Booking requests', icon: ClipboardCheck },
        ]}
      />

      {activeTab === 'venues' && (
        <Card title="Venues" description="Capacity, location, and whether an organization can book it.">
          <DataTable
            columns={venueColumns}
            rows={venues.items}
            loading={venues.loading}
            error={venues.error}
            onRetry={loadVenues}
            actions={(venue) => (
              <div className="flex justify-end gap-1.5">
                <Button size="sm" variant="secondary" className={ROW_ACTION} onClick={() => openVenueModal(venue)}>Edit</Button>
                <IconButton icon={Trash2} label={`Delete ${formatDisplayText(venue.name)}`} variant="danger" onClick={() => setDeleteTarget(venue)} />
              </div>
            )}
            emptyState={(
              <EmptyState
                kind="first-run"
                icon={Building2}
                title="No venues added yet"
                description="Add a venue so organizations can request bookings against it."
                action={<Button leftIcon={Plus} onClick={() => openVenueModal()}>New venue</Button>}
              />
            )}
          />
        </Card>
      )}

      {activeTab === 'bookings' && (
        <div ref={queueRef}><Card title="Booking requests" description="Approve or reject requests, with overlapping approved bookings shown before you decide.">
          <DataTable
            columns={bookingColumns}
            rows={bookings.items}
            loading={bookings.loading}
            error={bookings.error}
            onRetry={() => loadBookings(bookingsPage)}
            filtersActive={bookingFiltersActive}
            filters={(
              <div className="flex flex-col gap-3 border-b border-line bg-surface p-3 sm:flex-row sm:items-center sm:p-4">
                <Select aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="sm:w-56">
                  <option value="pending">Awaiting decision</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                  <option value="withdrawn">Withdrawn</option>
                  <option value="">All statuses</option>
                </Select>
                <Select aria-label="Filter by venue" value={venueFilter} onChange={(event) => setVenueFilter(event.target.value)} className="sm:w-56">
                  <option value="">All venues</option>
                  {venues.items.map((venue) => <option key={venue.id} value={venue.id}>{formatDisplayText(venue.name)}</option>)}
                </Select>
                {bookingFiltersActive && <Button variant="ghost" size="sm" className={ROW_ACTION} onClick={() => { setStatusFilter('pending'); setVenueFilter(''); }}>Clear filters</Button>}
                <p className="text-xs font-semibold tabular-nums text-ink-muted sm:ml-auto">{bookings.meta.total} {bookings.meta.total === 1 ? 'request' : 'requests'}</p>
              </div>
            )}
            actions={(booking) => (
              booking.status === 'pending' ? (
                <div className="flex justify-end gap-1.5">
                  <Button size="sm" variant="secondary" className={ROW_ACTION} onClick={() => openReview(booking, 'reject')}>Reject</Button>
                  <Button size="sm" className={ROW_ACTION} onClick={() => openReview(booking, 'approve')}>Approve</Button>
                </div>
              ) : null
            )}
            pagination={(
              <PaginationControls
                currentPage={bookings.meta.currentPage}
                totalItems={bookings.meta.total}
                pageSize={bookings.meta.perPage}
                onPageChange={setBookingsPage}
                label="requests"
              />
            )}
            emptyState={bookingFiltersActive ? (
              <EmptyState kind="filtered" title="No booking requests match these filters" description="Try another status or venue, or clear the filters." onClearFilters={() => { setStatusFilter('pending'); setVenueFilter(''); }} />
            ) : (
              <EmptyState
                kind="first-run"
                icon={ClipboardCheck}
                title="Nothing to review"
                description="Organization admins and officers request venues from Venue booking. Each request appears here for your decision."
              />
            )}
          />
        </Card></div>
      )}

      {activeTab === 'bookings' && (
        <Card title="Availability calendar" description="Who holds each venue and when. Pending requests are marked so you can spot clashes before deciding.">
          <VenueWeekCalendar
            weekStart={weekStart}
            slots={calendar.slots}
            venues={venues.items}
            loadedWeekStart={calendar.weekStart}
            venueId={venueFilter}
            onVenueChange={setVenueFilter}
            onWeekChange={setWeekStart}
            loading={calendar.loading}
            error={calendar.error}
            onRetry={loadCalendar}
            truncated={calendar.truncated}
            onShowInQueue={showInQueue}
          />
        </Card>
      )}

      <Drawer open={Boolean(openBooking)} title={openBooking ? (openBooking.venue?.name || openBooking.off_campus_location || 'Venue request') : undefined} description={openBooking ? `Venue request #${openBooking.id}` : undefined} onClose={() => setRecordId(null)}>
        {openBooking && <BookingDetail booking={openBooking} onApprove={() => openReview(openBooking, 'approve')} onReject={() => openReview(openBooking, 'reject')} />}
      </Drawer>

      <Modal
        open={Boolean(venueModal)}
        title={venueModal?.mode === 'edit' ? 'Edit venue' : 'New venue'}
        onClose={venueSaving ? undefined : () => setVenueModal(null)}
        closeOnEscape={!venueSaving}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setVenueModal(null)} disabled={venueSaving}>Cancel</Button>
            <Button onClick={handleVenueSubmit} loading={venueSaving}>{venueModal?.mode === 'edit' ? 'Save changes' : 'Add venue'}</Button>
          </>
        )}
      >
        <form onSubmit={handleVenueSubmit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required className="sm:col-span-2">
            <Input data-autofocus placeholder="e.g. Main Gymnasium" value={venueForm.name} onChange={(event) => setVenueForm({ ...venueForm, name: event.target.value })} />
          </Field>
          <Field label="Location" required className="sm:col-span-2">
            <Input placeholder="e.g. Building A, Ground Floor" value={venueForm.location} onChange={(event) => setVenueForm({ ...venueForm, location: event.target.value })} />
          </Field>
          <Field label="Capacity" required hint="Number of people this venue can hold">
            <Input type="number" min="0" value={venueForm.capacity} onChange={(event) => setVenueForm({ ...venueForm, capacity: event.target.value })} />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2.5 text-sm font-semibold text-ink">
            <input type="checkbox" className="h-4 w-4 accent-brand-700" checked={venueForm.is_active} onChange={(event) => setVenueForm({ ...venueForm, is_active: event.target.checked })} />
            Active (organizations can request this venue)
          </label>
          {venueFormError && <p role="alert" className="text-sm font-semibold text-danger-strong sm:col-span-2">{venueFormError}</p>}
        </form>
      </Modal>

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Delete this venue?"
        message="This cannot be undone. Venues with pending or approved bookings cannot be deleted."
        recordName={deleteTarget?.name}
        confirmText="Delete venue"
        variant="danger"
        busy={deleteBusy}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />

      <Modal
        open={reviewState?.action === 'approve'}
        title="Approve this booking?"
        description={reviewState?.booking ? `${reviewState.booking.venue?.name || reviewState.booking.off_campus_location} - ${formatRange(reviewState.booking.start_time, reviewState.booking.end_time)}` : undefined}
        onClose={reviewBusy ? undefined : () => setReviewState(null)}
        closeOnEscape={!reviewBusy}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setReviewState(null)} disabled={reviewBusy}>Cancel</Button>
            <Button onClick={confirmApprove} loading={reviewBusy}>Approve</Button>
          </>
        )}
      >
        {conflicts.loading ? (
          <p className="text-sm font-medium text-ink-muted">Checking for overlapping approved bookings...</p>
        ) : conflicts.items.length > 0 ? (
          <div className="rounded-control border border-warning/30 bg-warning-tint p-3">
            <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-warning-strong"><AlertTriangle size={14} aria-hidden="true" />Overlaps {conflicts.items.length} approved booking{conflicts.items.length === 1 ? '' : 's'}</p>
            <ul className="mt-2 space-y-1 text-sm font-medium text-warning-strong">
              {conflicts.items.map((slot) => <li key={slot.id}>{formatRange(slot.start_time, slot.end_time)}</li>)}
            </ul>
            <p className="mt-2 text-xs font-medium text-warning-strong">The server will reject this approval if it truly overlaps another approved booking.</p>
          </div>
        ) : (
          <p className="text-sm font-medium text-ink-muted">No overlapping approved bookings for this venue and time.</p>
        )}
      </Modal>

      <Modal
        open={reviewState?.action === 'reject'}
        title="Reject this booking"
        description="A remark is required so the organization knows why."
        onClose={reviewBusy ? undefined : () => { setReviewState(null); setRejectRemarks(''); }}
        closeOnEscape={!reviewBusy}
        footer={(
          <>
            <Button variant="secondary" onClick={() => { setReviewState(null); setRejectRemarks(''); }} disabled={reviewBusy}>Cancel</Button>
            <Button variant="danger" onClick={confirmReject} loading={reviewBusy} disabled={!rejectRemarks.trim()}>Reject booking</Button>
          </>
        )}
      >
        <Field label="Remarks" required>
          <Textarea data-autofocus value={rejectRemarks} onChange={(event) => setRejectRemarks(event.target.value)} />
        </Field>
      </Modal>
    </div>
  );
}
