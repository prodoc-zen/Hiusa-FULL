import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Activity, Bell, Building2, ClipboardCheck, Landmark, ShieldCheck } from 'lucide-react';
import { getSystemOrganizations, getSystemOverview } from '../../../services/systemAdministrationService';

const ACTIONS = [
  ['Manage organizations', '/dashboard/super-admin/organizations'],
  ['Manage administrators', '/dashboard/super-admin/admins'],
  ['Review financial approvals', '/dashboard/super-admin/approvals'],
  ['Official announcements', '/dashboard/super-admin/announcements'],
  ['View notifications', '/dashboard/super-admin/notifications'],
];

export default function SuperAdminHomePage() {
  const [overview, setOverview] = useState(null);
  const [organizations, setOrganizations] = useState([]);
  const [organizationId, setOrganizationId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    getSystemOrganizations({ per_page: 100 })
      .then((data) => setOrganizations(data.data || []))
      .catch(() => setError('Unable to load the organization filter.'));
  }, []);

  useEffect(() => {
    setOverview(null);
    setError('');
    getSystemOverview(organizationId ? { organization_id: organizationId } : {})
      .then(setOverview)
      .catch(() => setError('Unable to load system oversight data.'));
  }, [organizationId]);

  const metrics = overview ? [
    { label: 'Registered SBOs', value: overview.organizations.total, icon: Building2 },
    { label: 'Active SBOs', value: overview.organizations.active, icon: ShieldCheck },
    { label: 'Inactive SBOs', value: overview.organizations.inactive, icon: Building2 },
    { label: 'Pending SAO Approvals', value: overview.operations.pending_approvals, icon: ClipboardCheck },
    { label: 'Unread Notifications', value: overview.notifications?.unread || 0, icon: Bell },
  ] : [];

  return (
    <div className="space-y-6">
      <header className="rounded-lg bg-gradient-to-br from-[#0B1831] to-[#0F2F62] p-6 text-white">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-[#0B1831] text-[#16C7F3]"><ShieldCheck size={24} /></span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#16C7F3]">Student Affairs Office</p>
              <h2 className="mt-1 text-2xl font-black sm:text-3xl">University Oversight</h2>
              <p className="mt-1 text-sm font-medium text-slate-300">Review exceptions, administer organizations, and publish official university notices.</p>
            </div>
          </div>
          <label className="text-xs font-bold uppercase tracking-wide text-slate-300">
            Organization filter
            <select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} className="mt-2 block h-11 w-full rounded-lg border border-white/20 bg-white/10 px-3 text-sm font-semibold normal-case text-white sm:min-w-56">
              <option value="" className="text-slate-900">All organizations</option>
              {organizations.map((organization) => <option className="text-slate-900" key={organization.id} value={organization.id}>{organization.acronym}: {organization.name}</option>)}
            </select>
          </label>
        </div>
      </header>

      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}

      {overview && (
        <NavLink to="/dashboard/super-admin/approvals" className="flex flex-col gap-4 rounded-lg border border-amber-200 bg-amber-50 p-5 transition hover:bg-amber-100 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-white text-amber-700"><Landmark size={19} /></span>
            <div>
              <p className="font-bold text-[#0F172A]">{overview.operations.pending_approvals} approval request(s) need SAO review</p>
              <p className="mt-1 text-xs font-medium text-amber-800">Consolidated funds: ₱{Number(overview.financials.net).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
            </div>
          </div>
          <span className="text-sm font-bold text-amber-800">Review approval queue</span>
        </NavLink>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)]">
        <section className="overflow-hidden rounded-lg border border-[#DDE7EF] bg-white">
          <div className="border-b border-[#DDE7EF] px-5 py-4">
            <h3 className="text-base font-bold text-[#0F172A]">University operations</h3>
            <p className="mt-1 text-xs font-medium text-slate-500">Current organization and review workload.</p>
          </div>
          {!overview ? (
            <div className="space-y-2 p-5" aria-label="Loading system overview">{[1, 2, 3].map((row) => <div key={row} className="h-12 animate-pulse rounded-lg bg-slate-100" />)}</div>
          ) : (
            <dl className="divide-y divide-[#DDE7EF]">
              {metrics.map((metric) => (
                <div key={metric.label} className="flex min-h-14 items-center justify-between gap-3 px-5 py-3">
                  <dt className="flex items-center gap-2.5 text-sm font-semibold text-slate-600"><metric.icon size={17} className="text-[#0878B7]" />{metric.label}</dt>
                  <dd className="text-xl font-black tabular-nums text-[#0F172A]">{metric.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        <nav aria-label="Super Admin actions" className="rounded-lg border border-[#DDE7EF] bg-white p-5">
          <h3 className="text-base font-bold text-[#0F172A]">SAO actions</h3>
          <div className="mt-4 space-y-2">
            {ACTIONS.map(([label, path]) => <NavLink key={path} to={path} className="flex min-h-11 items-center rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-4 py-3 text-sm font-semibold text-[#0F172A] hover:border-[#0B8ED0]/40 hover:bg-white">{label}</NavLink>)}
          </div>
        </nav>
      </div>

      {overview && <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-lg border border-[#DDE7EF] bg-white p-5"><div className="flex items-center gap-2"><Activity size={18} className="text-[#0878B7]" /><h3 className="font-bold text-[#0F172A]">Recent organization activity</h3></div><div className="mt-4 divide-y divide-[#DDE7EF]">{overview.recent_activity?.length ? overview.recent_activity.slice(0, 6).map((item) => <article key={item.id} className="py-3 first:pt-0"><p className="text-sm font-semibold text-[#0F172A]">{String(item.action || '').replaceAll('_', ' ')}</p><p className="mt-1 text-xs text-slate-500">{item.organization_name || 'System'} · {item.first_name ? `${item.first_name} ${item.last_name}` : 'System actor'}</p></article>) : <p className="py-6 text-center text-sm text-slate-500">No recent activity.</p>}</div></section>
        <section className="rounded-lg border border-[#DDE7EF] bg-white p-5"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Bell size={18} className="text-[#0878B7]" /><h3 className="font-bold text-[#0F172A]">Recent notifications</h3></div><NavLink to="/dashboard/super-admin/notifications" className="text-xs font-bold text-[#0878B7]">View all</NavLink></div><div className="mt-4 divide-y divide-[#DDE7EF]">{overview.notifications?.recent?.length ? overview.notifications.recent.map((item) => <article key={item.id} className="py-3 first:pt-0"><p className="text-sm font-semibold text-[#0F172A]">{item.title}</p><p className="mt-1 line-clamp-2 text-xs text-slate-500">{item.message}</p></article>) : <p className="py-6 text-center text-sm text-slate-500">No recent notifications.</p>}</div></section>
      </div>}
    </div>
  );
}
