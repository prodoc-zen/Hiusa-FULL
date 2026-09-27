import { useState, useEffect } from 'react';
import { FileText, CheckCircle, XCircle, AlertCircle, UploadCloud } from 'lucide-react';
import { api } from '../../../services/api';

export default function OrganizationCompliancePage() {
  const [requirements, setRequirements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadRequirements();
  }, []);

  const loadRequirements = async () => {
    setLoading(true);
    try {
      const response = await api.get('/compliance');
      setRequirements(response.data || []);
      setError('');
    } catch (err) {
      setError('Unable to load compliance requirements.');
    } finally {
      setLoading(false);
    }
  };

  const statusColors = {
    'Pending': 'bg-amber-100 text-amber-700',
    'Approved': 'bg-green-100 text-green-700',
    'Rejected': 'bg-red-100 text-red-700',
  };

  const statusIcons = {
    'Pending': <AlertCircle size={14} className="mr-1" />,
    'Approved': <CheckCircle size={14} className="mr-1" />,
    'Rejected': <XCircle size={14} className="mr-1" />,
  };

  return (
    <div className="space-y-6 p-6">
      <section className="flex flex-col gap-4 rounded-lg border border-[#0F2F62] bg-[#0F2F62] p-6 text-white sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#16C7F3]">Organization Setup</p>
          <h1 className="mt-1 text-2xl font-black">My Compliance</h1>
          <p className="mt-1 text-sm text-slate-200">Submit and track your organization's mandatory accreditation requirements.</p>
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
            <div key={i} className="h-20 animate-pulse rounded-lg border border-[#DDE7EF] bg-white shadow-sm" />
          ))}
        </div>
      ) : requirements.length === 0 ? (
        <div className="rounded-lg border border-[#DDE7EF] bg-white p-12 text-center shadow-sm">
          <FileText size={48} className="mx-auto mb-4 text-[#DDE7EF]" />
          <h3 className="text-lg font-bold text-[#0F172A]">All Clear!</h3>
          <p className="mt-1 text-sm text-slate-500">You currently have no pending compliance requirements assigned by the SAO.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {requirements.map((req) => (
            <div key={req.id} className="flex flex-col gap-4 rounded-lg border border-[#DDE7EF] bg-white p-5 shadow-sm transition hover:border-[#0B8ED0]/50 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#EEF6FB] text-[#0878B7]">
                  <FileText size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-[#0F172A]">{req.requirement_name}</h3>
                  {req.remarks && <p className="mt-1 text-sm text-slate-600">Note: {req.remarks}</p>}
                </div>
              </div>
              <div className="flex flex-col items-start gap-3 sm:items-end">
                <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${statusColors[req.status] || statusColors['Pending']}`}>
                  {statusIcons[req.status] || statusIcons['Pending']}
                  {req.status}
                </span>
                <button className="inline-flex items-center gap-1.5 rounded-md bg-[#EEF6FB] px-3 py-1.5 text-xs font-bold text-[#0F2F62] transition hover:bg-[#E6F6FD]">
                  <UploadCloud size={14} />
                  Submit Document
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
