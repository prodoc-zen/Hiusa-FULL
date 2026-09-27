import { useState, useEffect } from 'react';
import { CheckSquare, Calendar, ChevronRight, Plus, X } from 'lucide-react';
import { api } from '../../../services/api';
import Modal from '../../../components/Modal';

export default function ManageClearancesPage() {
  const [clearances, setClearances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [showAdd, setShowAdd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ title: '', academic_year: '', semester: '1st Semester', deadline: '' });

  useEffect(() => {
    loadClearances();
  }, []);

  const loadClearances = async () => {
    setLoading(true);
    try {
      const response = await api.get('/clearances');
      setClearances(response.data || []);
      setError('');
    } catch (err) {
      setError('Unable to load clearances.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post('/clearances', form);
      setShowAdd(false);
      setForm({ title: '', academic_year: '', semester: '1st Semester', deadline: '' });
      await loadClearances();
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to create clearance form.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <section className="flex flex-col gap-4 rounded-lg border border-[#0F2F62] bg-[#0F2F62] p-6 text-white sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#16C7F3]">SAO Administration</p>
          <h1 className="mt-1 text-2xl font-black">Digital Clearances</h1>
          <p className="mt-1 text-sm text-slate-200">Manage multi-signature clearance requirements for student organizations.</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-white px-5 text-sm font-bold text-[#0F2F62] transition hover:bg-[#EEF6FB]"
        >
          <Plus size={16} /> Create Clearance Cycle
        </button>
      </section>

      {error && !showAdd && (
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
      ) : clearances.length === 0 ? (
        <div className="rounded-lg border border-[#DDE7EF] bg-white p-12 text-center shadow-sm">
          <CheckSquare size={48} className="mx-auto mb-4 text-[#DDE7EF]" />
          <h3 className="text-lg font-bold text-[#0F172A]">No Clearance Cycles</h3>
          <p className="mt-1 text-sm text-slate-500">Create a clearance cycle to begin collecting organizational signatures.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {clearances.map((c) => (
            <div key={c.id} className="group flex flex-col gap-4 rounded-lg border border-[#DDE7EF] bg-white p-5 shadow-sm transition hover:border-[#0B8ED0]/50 sm:flex-row sm:items-center sm:justify-between cursor-pointer">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#EEF6FB] text-[#0878B7]">
                  <CheckSquare size={24} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#0F172A]">{c.title}</h3>
                  <div className="mt-1 flex items-center gap-3 text-sm text-slate-600">
                    <span className="font-medium text-[#0F2F62]">{c.academic_year} • {c.semester}</span>
                    {c.deadline && (
                      <span className="flex items-center gap-1.5"><Calendar size={14} className="text-slate-400" /> Due: {new Date(c.deadline).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>
              </div>
              <ChevronRight size={20} className="text-slate-400 transition group-hover:text-[#0B8ED0] group-hover:translate-x-1" />
            </div>
          ))}
        </div>
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} closeOnBackdrop={!submitting} closeOnEscape={!submitting} maxWidth="max-w-md">
        <div className="rounded-lg border border-[#0B8ED0]/30 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-bold text-[#0F172A]">Create Clearance Cycle</h3>
            <button type="button" onClick={() => setShowAdd(false)} className="rounded p-1 text-slate-500 hover:bg-red-50"><X size={18} /></button>
          </div>
          
          {error && showAdd && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-[#0F172A]">Title *</label>
              <input
                type="text"
                required
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="E.g. End of Semester Clearance"
                className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-[#0F172A]">Academic Year *</label>
                <input
                  type="text"
                  required
                  placeholder="E.g. 2026-2027"
                  value={form.academic_year}
                  onChange={(e) => setForm({ ...form, academic_year: e.target.value })}
                  className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 outline-none"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-[#0F172A]">Semester *</label>
                <select
                  required
                  value={form.semester}
                  onChange={(e) => setForm({ ...form, semester: e.target.value })}
                  className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 outline-none"
                >
                  <option value="1st Semester">1st Semester</option>
                  <option value="2nd Semester">2nd Semester</option>
                  <option value="Summer">Summer</option>
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-[#0F172A]">Deadline</label>
              <input
                type="date"
                value={form.deadline}
                onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 outline-none"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setShowAdd(false)} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD] transition">Cancel</button>
              <button type="submit" disabled={submitting} className="h-11 rounded-lg bg-[#0878B7] px-5 text-sm font-bold text-white hover:bg-[#0F2F62] transition disabled:opacity-50">
                {submitting ? 'Creating...' : 'Create Cycle'}
              </button>
            </div>
          </form>
        </div>
      </Modal>
    </div>
  );
}
