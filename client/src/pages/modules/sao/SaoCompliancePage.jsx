import { useState, useEffect } from 'react';
import { ShieldCheck, Building2, Search, ChevronRight } from 'lucide-react';
import { api } from '../../../services/api';

export default function SaoCompliancePage() {
  const [organizations, setOrganizations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadOrganizations();
  }, []);

  const loadOrganizations = async () => {
    setLoading(true);
    try {
      const response = await api.get('/system/organizations');
      setOrganizations(response.data.data || []);
      setError('');
    } catch (err) {
      setError('Unable to load organizations. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const filtered = organizations.filter(org => 
    org.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    org.acronym.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6 p-6">
      <section className="flex flex-col gap-4 rounded-lg border border-[#0F2F62] bg-[#0F2F62] p-6 text-white sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#16C7F3]">SAO Administration</p>
          <h1 className="mt-1 text-2xl font-black">Organization Compliance</h1>
          <p className="mt-1 text-sm text-slate-200">Monitor accreditation status and compliance requirements for all registered organizations.</p>
        </div>
      </section>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      <div className="relative mb-6 max-w-md">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Search organizations..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-11 w-full rounded-lg border border-[#DDE7EF] bg-white pl-10 pr-4 text-sm focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 outline-none transition"
        />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-lg border border-[#DDE7EF] bg-white shadow-sm" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-[#DDE7EF] bg-white p-12 text-center shadow-sm">
          <Building2 size={48} className="mx-auto mb-4 text-[#DDE7EF]" />
          <h3 className="text-lg font-bold text-[#0F172A]">No Organizations Found</h3>
          <p className="mt-1 text-sm text-slate-500">No organizations match your search query.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((org) => (
            <div key={org.id} className="group flex flex-col justify-between rounded-lg border border-[#DDE7EF] bg-white p-5 shadow-sm transition hover:border-[#0B8ED0]/50 hover:shadow-md cursor-pointer">
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#EEF6FB] text-[#0878B7] font-black text-xl">
                    {org.acronym?.[0] || 'O'}
                  </div>
                  <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                    org.accreditation_status === 'Active' ? 'bg-green-100 text-green-700' : 
                    org.accreditation_status === 'Probation' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700'
                  }`}>
                    {org.accreditation_status || 'Active'}
                  </span>
                </div>
                <h3 className="mt-4 font-bold text-[#0F172A] leading-tight">{org.name}</h3>
                <p className="mt-1 text-xs font-medium text-slate-500">{org.acronym} • {org.college || 'University-Wide'}</p>
              </div>
              
              <div className="mt-5 flex items-center justify-between border-t border-[#DDE7EF] pt-4">
                <span className="flex items-center gap-1.5 text-xs font-bold text-[#0B8ED0]">
                  <ShieldCheck size={14} /> View Requirements
                </span>
                <ChevronRight size={16} className="text-slate-400 transition group-hover:text-[#0B8ED0] group-hover:translate-x-1" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
