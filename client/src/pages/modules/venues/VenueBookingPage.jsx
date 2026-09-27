import { useState, useEffect } from 'react';
import { Calendar as CalendarIcon, Clock, MapPin, Plus, CheckCircle, XCircle, Clock4, X } from 'lucide-react';
import { api } from '../../../services/api';
import Modal from '../../../components/Modal';

export default function VenueBookingPage() {
  const [bookings, setBookings] = useState([]);
  const [venues, setVenues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ venue_id: '', start_time: '', end_time: '', purpose: '' });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [bookingsRes, venuesRes] = await Promise.all([
        api.get('/venue-bookings'),
        api.get('/venues')
      ]);
      setBookings(bookingsRes.data?.data || bookingsRes.data || []);
      setVenues(venuesRes.data || []);
      setError('');
    } catch (err) {
      setError('Unable to load bookings. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  const handleBookingSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post('/venue-bookings', form);
      setShowAdd(false);
      setForm({ venue_id: '', start_time: '', end_time: '', purpose: '' });
      await loadData();
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to submit booking request.');
    } finally {
      setSubmitting(false);
    }
  };

  const statusColors = {
    'Pending': 'bg-amber-100 text-amber-700',
    'Approved': 'bg-green-100 text-green-700',
    'Rejected': 'bg-red-100 text-red-700',
  };

  const statusIcons = {
    'Pending': <Clock4 size={14} className="mr-1" />,
    'Approved': <CheckCircle size={14} className="mr-1" />,
    'Rejected': <XCircle size={14} className="mr-1" />,
  };

  return (
    <div className="space-y-6 p-6">
      <section className="flex flex-col gap-4 rounded-lg border border-[#0F2F62] bg-[#0F2F62] p-6 text-white sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#16C7F3]">Facilities Administration</p>
          <h1 className="mt-1 text-2xl font-black">Venue Bookings</h1>
          <p className="mt-1 text-sm text-slate-200">Request and manage university venue reservations.</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-white px-5 text-sm font-bold text-[#0F2F62] transition hover:bg-[#EEF6FB]"
        >
          <Plus size={16} /> Book a Venue
        </button>
      </section>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg border border-[#DDE7EF] bg-white shadow-sm" />
          ))}
        </div>
      ) : bookings.length === 0 ? (
        <div className="rounded-lg border border-[#DDE7EF] bg-white p-12 text-center shadow-sm">
          <CalendarIcon size={48} className="mx-auto mb-4 text-[#DDE7EF]" />
          <h3 className="text-lg font-bold text-[#0F172A]">No Bookings Found</h3>
          <p className="mt-1 text-sm text-slate-500">There are currently no active venue reservations.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {bookings.map((booking) => (
            <div key={booking.id} className="flex flex-col gap-4 rounded-lg border border-[#DDE7EF] bg-white p-5 shadow-sm transition hover:border-[#0B8ED0]/50 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#EEF6FB] text-[#0878B7]">
                  <MapPin size={24} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#0F172A]">{booking.venue?.name || 'Unknown Venue'}</h3>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-slate-600">
                    <span className="flex items-center gap-1.5"><CalendarIcon size={14} className="text-slate-400" /> {new Date(booking.start_time).toLocaleDateString()}</span>
                    <span className="flex items-center gap-1.5"><Clock size={14} className="text-slate-400" /> {new Date(booking.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {new Date(booking.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  {booking.purpose && <p className="mt-2 text-sm text-slate-500 line-clamp-1">{booking.purpose}</p>}
                </div>
              </div>
              <div className="flex flex-col items-start gap-2 sm:items-end">
                <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${statusColors[booking.status] || statusColors['Pending']}`}>
                  {statusIcons[booking.status] || statusIcons['Pending']}
                  {booking.status || 'Pending'}
                </span>
                <span className="text-xs font-medium text-slate-500">Requested by {booking.organization?.acronym || 'User'}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} closeOnBackdrop={!submitting} closeOnEscape={!submitting} maxWidth="max-w-lg">
        <div className="rounded-lg border border-[#0B8ED0]/30 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-bold text-[#0F172A]">Request Venue Booking</h3>
            <button type="button" onClick={() => setShowAdd(false)} className="rounded p-1 text-slate-500 hover:bg-red-50"><X size={18} /></button>
          </div>
          <form onSubmit={handleBookingSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-[#0F172A]">Select Venue *</label>
              <select
                required
                value={form.venue_id}
                onChange={(e) => setForm({ ...form, venue_id: e.target.value })}
                className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 outline-none"
              >
                <option value="">-- Choose a Venue --</option>
                {venues.filter(v => v.status === 'Available').map(v => (
                  <option key={v.id} value={v.id}>{v.name} (Capacity: {v.capacity})</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-[#0F172A]">Start Time *</label>
                <input
                  type="datetime-local"
                  required
                  value={form.start_time}
                  onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                  className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 outline-none"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-[#0F172A]">End Time *</label>
                <input
                  type="datetime-local"
                  required
                  value={form.end_time}
                  onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                  className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 outline-none"
                />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-[#0F172A]">Purpose of Booking *</label>
              <textarea
                required
                value={form.purpose}
                onChange={(e) => setForm({ ...form, purpose: e.target.value })}
                rows={3}
                placeholder="Briefly describe what this booking is for..."
                className="w-full resize-none rounded-lg border border-[#DDE7EF] p-3 text-sm focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 outline-none"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setShowAdd(false)} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD] transition">Cancel</button>
              <button type="submit" disabled={submitting || !form.venue_id} className="h-11 rounded-lg bg-[#0878B7] px-5 text-sm font-bold text-white hover:bg-[#0F2F62] transition disabled:opacity-50">
                {submitting ? 'Submitting...' : 'Submit Request'}
              </button>
            </div>
          </form>
        </div>
      </Modal>
    </div>
  );
}
