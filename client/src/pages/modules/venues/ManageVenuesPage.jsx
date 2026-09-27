import { useState, useEffect } from 'react';
import { Building, MapPin, Plus, Edit2, Trash2, X } from 'lucide-react';
import { api } from '../../../services/api';
import Modal from '../../../components/Modal';

export default function ManageVenuesPage() {
  const [venues, setVenues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [showAdd, setShowAdd] = useState(false);
  const [showEdit, setShowEdit] = useState(null);
  
  const [form, setForm] = useState({ name: '', capacity: '', description: '', status: 'Available' });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadVenues();
  }, []);

  const loadVenues = async () => {
    setLoading(true);
    try {
      const response = await api.get('/venues');
      setVenues(response.data || []);
      setError('');
    } catch (err) {
      setError('Unable to load venues. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  const handleAddSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post('/venues', { ...form, capacity: parseInt(form.capacity) || 0 });
      setShowAdd(false);
      setForm({ name: '', capacity: '', description: '', status: 'Available' });
      await loadVenues();
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to add venue.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.put(`/venues/${showEdit.id}`, { ...form, capacity: parseInt(form.capacity) || 0 });
      setShowEdit(null);
      await loadVenues();
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to update venue.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this venue?')) return;
    try {
      await api.delete(`/venues/${id}`);
      await loadVenues();
    } catch (err) {
      setError('Failed to delete venue.');
    }
  };

  const openEdit = (venue) => {
    setForm({ name: venue.name, capacity: venue.capacity, description: venue.description || '', status: venue.status });
    setShowEdit(venue);
  };

  const renderForm = (onSubmit, onCancel, title) => (
    <div className="rounded-lg border border-[#0B8ED0]/30 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-bold text-[#0F172A]">{title}</h3>
        <button type="button" onClick={onCancel} className="rounded p-1 text-slate-500 hover:bg-red-50"><X size={18} /></button>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-semibold text-[#0F172A]">Venue Name *</label>
          <input
            type="text"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 outline-none"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-[#0F172A]">Capacity</label>
            <input
              type="number"
              value={form.capacity}
              onChange={(e) => setForm({ ...form, capacity: e.target.value })}
              className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 outline-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-[#0F172A]">Status</label>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
              className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 outline-none"
            >
              <option value="Available">Available</option>
              <option value="Maintenance">Maintenance</option>
            </select>
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-semibold text-[#0F172A]">Description</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={3}
            className="w-full resize-none rounded-lg border border-[#DDE7EF] p-3 text-sm focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 outline-none"
          />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onCancel} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD] transition">Cancel</button>
          <button type="submit" disabled={submitting} className="h-11 rounded-lg bg-[#0878B7] px-5 text-sm font-bold text-white hover:bg-[#0F2F62] transition disabled:opacity-50">
            {submitting ? 'Saving...' : 'Save Venue'}
          </button>
        </div>
      </form>
    </div>
  );

  return (
    <div className="space-y-6 p-6">
      <section className="flex flex-col gap-4 rounded-lg border border-[#0F2F62] bg-[#0F2F62] p-6 text-white sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#16C7F3]">Facilities Administration</p>
          <h1 className="mt-1 text-2xl font-black">Manage Venues</h1>
          <p className="mt-1 text-sm text-slate-200">Add or modify bookable university venues.</p>
        </div>
        <button
          onClick={() => { setForm({ name: '', capacity: '', description: '', status: 'Available' }); setShowAdd(true); }}
          className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-white px-5 text-sm font-bold text-[#0F2F62] transition hover:bg-[#EEF6FB]"
        >
          <Plus size={16} /> Add Venue
        </button>
      </section>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-lg border border-[#DDE7EF] bg-white shadow-sm" />
          ))}
        </div>
      ) : venues.length === 0 ? (
        <div className="rounded-lg border border-[#DDE7EF] bg-white p-12 text-center shadow-sm">
          <Building size={48} className="mx-auto mb-4 text-[#DDE7EF]" />
          <h3 className="text-lg font-bold text-[#0F172A]">No Venues Found</h3>
          <p className="mt-1 text-sm text-slate-500">There are currently no venues registered in the system.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {venues.map((venue) => (
            <div key={venue.id} className="rounded-lg border border-[#DDE7EF] bg-white p-5 shadow-sm transition hover:border-[#0B8ED0]/50">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#EEF6FB] text-[#0878B7]">
                    <MapPin size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold text-[#0F172A]">{venue.name}</h3>
                    <p className="text-xs font-medium text-slate-500">Capacity: {venue.capacity || 'Not set'}</p>
                  </div>
                </div>
              </div>
              <p className="mt-4 text-sm text-slate-600 line-clamp-2 min-h-[40px]">{venue.description || 'No description provided.'}</p>
              <div className="mt-5 flex items-center justify-between border-t border-[#DDE7EF] pt-4">
                <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
                  venue.status === 'Available' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                }`}>
                  {venue.status}
                </span>
                <div className="flex items-center gap-2">
                  <button onClick={() => openEdit(venue)} className="rounded p-1.5 text-slate-400 transition hover:bg-[#EEF6FB] hover:text-[#0878B7]">
                    <Edit2 size={16} />
                  </button>
                  <button onClick={() => handleDelete(venue.id)} className="rounded p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} closeOnBackdrop={!submitting} closeOnEscape={!submitting} maxWidth="max-w-md">
        {renderForm(handleAddSubmit, () => setShowAdd(false), 'Add New Venue')}
      </Modal>

      <Modal open={Boolean(showEdit)} onClose={() => setShowEdit(null)} closeOnBackdrop={!submitting} closeOnEscape={!submitting} maxWidth="max-w-md">
        {showEdit && renderForm(handleEditSubmit, () => setShowEdit(null), 'Edit Venue')}
      </Modal>
    </div>
  );
}
