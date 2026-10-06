import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Building2, ClipboardCheck, Plus, Trash2 } from 'lucide-react';
import {
  Button, Card, DataTable, EmptyState, Field, IconButton, Input, PageHeader,
  Select, StatusBadge, Tabs, Textarea,
} from '../../../components/ui';
import Modal from '../../../components/Modal';
import ConfirmModal from '../../../components/ConfirmModal';
import PaginationControls from '../../../components/PaginationControls';
import notify from '../../../lib/notify';
import { manilaDate } from '../../../lib/format';
import { listMeta, unwrapList } from '../../../services/pagination';
import { getApiErrorMessage } from '../../../utils/apiError';
import {
  createVenue, deleteVenue, getVenueAvailability, getVenueBookings, getVenues,
  reviewVenueBooking, updateVenue,
} from '../../../services/venueService';

const EMPTY_VENUE_FORM = { name: '', location: '', capacity: '', is_active: true };

function getCurrentRole() {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}')?.role || '';
  } catch {
    return '';
  }
}

function formatRange(start, end) {
  return `${manilaDate(start, 'long')}, ${new Date(start).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' })} - ${new Date(end).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' })}`;
}

export default function SaoVenuesPage() {
  const role = useMemo(() => getCurrentRole(), []);

  const [activeTab, setActiveTab] = useState('venues');

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
  const [statusFilter, setStatusFilter] = useState('pending');
  const [venueFilter, setVenueFilter] = useState('');
  const [reviewState, setReviewState] = useState(null);
  const [conflicts, setConflicts] = useState({ loading: false, items: [] });
  const [rejectRemarks, setRejectRemarks] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);

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

  useEffect(() => { if (role === 'SUPER_ADMIN') loadVenues(); }, [loadVenues, role]);
  useEffect(() => { if (role === 'SUPER_ADMIN') loadBookings(bookingsPage); }, [loadBookings, bookingsPage, role]);
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
      await reviewVenueBooking(reviewState.booking.id, { status: 'approved' });
      notify.success(`Booking for "${reviewState.booking.venue?.name || reviewState.booking.off_campus_location}" approved.`);
      setReviewState(null);
      loadBookings(bookingsPage);
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
      await reviewVenueBooking(reviewState.booking.id, { status: 'rejected', remarks: rejectRemarks.trim() });
      notify.success(`Booking for "${reviewState.booking.venue?.name || reviewState.booking.off_campus_location}" rejected.`);
      setReviewState(null);
      setRejectRemarks('');
      loadBookings(bookingsPage);
    } catch (err) {
      notify.error(getApiErrorMessage(err, 'Could not reject this booking.'));
    } finally {
      setReviewBusy(false);
    }
  }

  if (role !== 'SUPER_ADMIN') {
    return (
      <div className="space-y-5">
        <PageHeader title="Venues" description="Manage the venue catalog and review booking requests." />
        <Card><EmptyState kind="restricted" title="SAO access only" description="Only the Student Affairs Office manages the venue catalog." /></Card>
      </div>
    );
  }

  const venueColumns = [
    { key: 'name', header: 'Venue', render: (venue) => <span className="font-bold text-ink">{venue.name}</span> },
    { key: 'location', header: 'Location' },
    { key: 'capacity', header: 'Capacity', align: 'right' },
    { key: 'is_active', header: 'Status', render: (venue) => <button type="button" role="switch" aria-checked={venue.is_active} aria-label={`${venue.name} active status`} disabled={togglingVenueId === venue.id} onClick={() => toggleVenueActive(venue)} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-xs font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B8ED0] disabled:opacity-50"><span aria-hidden="true" className={`relative h-6 w-11 rounded-full transition-colors ${venue.is_active ? 'bg-[#0B8ED0]' : 'bg-slate-300'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${venue.is_active ? 'left-6' : 'left-1'}`} /></span><StatusBadge status={venue.is_active ? 'active' : 'inactive'} /></button> },
  ];

  const bookingColumns = [
    { key: 'organization', header: 'Organization', render: (booking) => booking.organization?.name || 'Unknown' },
    { key: 'venue', header: 'Venue', render: (booking) => booking.venue?.name || booking.off_campus_location || 'Unknown' },
    { key: 'event', header: 'Event', render: (booking) => booking.event?.title || 'Not linked' },
    { key: 'when', header: 'Requested time', render: (booking) => formatRange(booking.start_time, booking.end_time) },
    { key: 'status', header: 'Status', render: (booking) => <StatusBadge status={booking.status} /> },
  ];

  const bookingFiltersActive = statusFilter !== 'pending' || Boolean(venueFilter);

  return (
    <div className="space-y-5 pb-8">
      <PageHeader title="Venues" description="Keep the venue catalog current and decide booking requests with conflicts in view." />

      <Tabs
        value={activeTab}
        onChange={setActiveTab}
        tabs={[
          { key: 'venues', label: 'Venue catalog', icon: Building2 },
          { key: 'bookings', label: 'Booking requests', icon: ClipboardCheck },
        ]}
      />

      {activeTab === 'venues' && (
        <Card title="Venues" description="Capacity, location, and whether an organization can book it." actions={<Button leftIcon={Plus} onClick={() => openVenueModal()}>New venue</Button>}>
          <DataTable
            columns={venueColumns}
            rows={venues.items}
            loading={venues.loading}
            error={venues.error}
            onRetry={loadVenues}
            actions={(venue) => (
              <div className="flex justify-end gap-1.5">
                <Button size="sm" variant="secondary" onClick={() => openVenueModal(venue)}>Edit</Button>
                <IconButton icon={Trash2} label="Delete venue" variant="danger" onClick={() => setDeleteTarget(venue)} />
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
        <Card title="Booking requests" description="Approve or reject requests, with overlapping approved bookings shown before you decide.">
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
                  {venues.items.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
                </Select>
                {bookingFiltersActive && <Button variant="ghost" size="sm" onClick={() => { setStatusFilter('pending'); setVenueFilter(''); }}>Clear filters</Button>}
                <p className="text-xs font-semibold tabular-nums text-ink-muted sm:ml-auto">{bookings.meta.total} {bookings.meta.total === 1 ? 'request' : 'requests'}</p>
              </div>
            )}
            actions={(booking) => (
              booking.status === 'pending' ? (
                <div className="flex justify-end gap-1.5">
                  <Button size="sm" variant="secondary" onClick={() => openReview(booking, 'reject')}>Reject</Button>
                  <Button size="sm" onClick={() => openReview(booking, 'approve')}>Approve</Button>
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
            emptyState={(
              <EmptyState
                kind="first-run"
                icon={ClipboardCheck}
                title="No booking requests waiting"
                description="Requests from organizations will appear here for your decision."
              />
            )}
          />
        </Card>
      )}

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
