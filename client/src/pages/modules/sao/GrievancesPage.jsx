import { useState, useEffect } from 'react';
import { ShieldAlert, AlertTriangle, AlertCircle, Info, ChevronRight, Eye } from 'lucide-react';
import { api } from '../../../services/api';

export default function GrievancesPage() {
  const [grievances, setGrievances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('All');

  useEffect(() => {
    loadGrievances();
  }, []);

  const loadGrievances = async () => {
    setLoading(true);
    try {
      const response = await api.get('/grievances');
      setGrievances(response.data.data || []);
      setError('');
    } catch (err) {
      setError('Unable to load grievances.');
    } finally {
      setLoading(false);
    }
  };

  const filtered = filter === 'All' ? grievances : grievances.filter(g => g.status === filter);

  const urgencyColors = {
    'Critical': 'bg-red-100 text-red-800 border-red-200',
    'High': 'bg-orange-100 text-orange-800 border-orange-200',
    'Medium': 'bg-amber-100 text-amber-800 border-amber-200',
    'Low': 'bg-blue-100 text-blue-800 border-blue-200',
  };
  
  const statusColors = {
    'Resolved': 'bg-green-100 text-green-700',
    'In Progress': 'bg-blue-100 text-blue-700',
    'Pending': 'bg-amber-100 text-amber-700'
  };

  return (
    <div className="space-y-6 p-6">
      <section className="flex flex-col gap-4 rounded-lg border border-[#0F2F62] bg-[#0F2F62] p-6 text-white sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#16C7F3]">SAO Administration</p>
          <h1 className="mt-1 text-2xl font-black">Grievance Review</h1>
          <p className="mt-1 text-sm text-slate-200">Confidential monitoring and resolution of university complaints.</p>
        </div>
        <div className="flex gap-2 bg-white/10 p-1.5 rounded-lg border border-white/20">
          {['All', 'Pending', 'In Progress', 'Resolved'].map((status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`px-3 py-1.5 text-xs font-bold rounded-md transition ${filter === status ? 'bg-white text-[#0F2F62]' : 'text-slate-200 hover:bg-white/15'}`}
            >
              {status}
            </button>
          ))}
        </div>
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
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-[#DDE7EF] bg-white p-12 text-center shadow-sm">
          <ShieldAlert size={48} className="mx-auto mb-4 text-[#DDE7EF]" />
          <h3 className="text-lg font-bold text-[#0F172A]">No Grievances Found</h3>
          <p className="mt-1 text-sm text-slate-500">There are no {filter.toLowerCase()} grievances at this time.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((g) => (
            <div key={g.id} className="flex flex-col gap-4 rounded-lg border border-[#DDE7EF] bg-white p-5 shadow-sm transition hover:border-[#0B8ED0]/50 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#EEF6FB] text-[#0878B7]">
                  {g.urgency === 'Critical' || g.urgency === 'High' ? <AlertTriangle size={20} className="text-red-600" /> : <Info size={20} />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-[#0F172A]">{g.title}</h3>
                    {g.urgency && (
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${urgencyColors[g.urgency] || urgencyColors['Low']}`}>
                        {g.urgency}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs font-medium text-slate-500">
                    Category: {g.category || 'General'} • Submitted by: {g.is_anonymous ? 'Anonymous' : (g.submitter?.first_name + ' ' + g.submitter?.last_name)}
                  </div>
                </div>
              </div>
              <div className="flex flex-col items-start gap-3 sm:items-end">
                <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${statusColors[g.status] || statusColors['Pending']}`}>
                  {g.status || 'Pending'}
                </span>
                <button className="inline-flex items-center gap-1.5 rounded-md bg-[#EEF6FB] px-3 py-1.5 text-xs font-bold text-[#0F2F62] transition hover:bg-[#E6F6FD]">
                  <Eye size={14} />
                  Review Case
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
