import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Activity, Bell, Building2, ClipboardCheck, Landmark, ShieldCheck } from 'lucide-react';
import { getSystemOrganizations, getSystemOverview } from '../../../services/systemAdministrationService';

export default function SuperAdminHomePage() {
  const [overview, setOverview] = useState(null);
  const [organizations, setOrganizations] = useState([]);
  const [organizationId, setOrganizationId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    getSystemOrganizations({ per_page: 100 }).then((data) => setOrganizations(data.data || []));
  }, []);
  useEffect(() => { setOverview(null); getSystemOverview(organizationId ? { organization_id: organizationId } : {}).then(setOverview).catch(() => setError('Unable to load system oversight data.')); }, [organizationId]);

  const cards = overview ? [
    { label: 'Registered SBOs', value: overview.organizations.total, icon: Building2, tone: 'bg-[#E6F6FD] text-[#0B8ED0]' },
    { label: 'Active SBOs', value: overview.organizations.active, icon: ShieldCheck, tone: 'bg-emerald-50 text-emerald-700' },
    { label: 'Inactive SBOs', value: overview.organizations.inactive, icon: Building2, tone: 'bg-slate-100 text-slate-600' },
    { label: 'Pending SAO Approvals', value: overview.operations.pending_approvals, icon: ClipboardCheck, tone: 'bg-amber-50 text-amber-700' },
    { label: 'Unread Notifications', value: overview.notifications?.unread || 0, icon: Bell, tone: 'bg-violet-50 text-violet-700' },
  ] : [];

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-gradient-to-br from-[#08152d] to-[#15395c] p-6 text-white shadow-sm">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="flex items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-[#0B1831] text-[#16C7F3]"><ShieldCheck size={24} /></span>
          <div><p className="text-[10px] font-bold uppercase tracking-widest text-[#16C7F3]">Student Affairs Office</p><h2 className="mt-1 text-2xl font-black sm:text-3xl">University Oversight</h2><p className="mt-1 text-sm font-medium text-slate-300">System-level monitoring, administration, official communication, and financial review.</p></div>
          </div>
          <label className="text-xs font-bold uppercase tracking-wide text-slate-300">Organization filter<select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} className="mt-2 block h-10 min-w-56 rounded-lg border border-white/20 bg-white/10 px-3 text-sm font-semibold normal-case text-white outline-none"><option value="" className="text-slate-900">All organizations</option>{organizations.map((organization) => <option className="text-slate-900" key={organization.id} value={organization.id}>{organization.acronym} — {organization.name}</option>)}</select></label>
        </div>
      </section>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map((card) => <article key={card.label} className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm"><span className={`grid h-10 w-10 place-items-center rounded-lg ${card.tone}`}><card.icon size={19} /></span><p className="mt-4 text-sm font-semibold text-slate-500">{card.label}</p><p className="mt-1 text-2xl font-black tabular-nums text-[#0F172A]">{card.value}</p></article>)}
      </section>

      {overview && <NavLink to="/dashboard/super-admin/approvals" className="flex items-center justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 p-5 transition hover:bg-amber-100"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-lg bg-white text-amber-700"><Landmark size={19} /></span><div><p className="font-bold text-[#0F172A]">₱{Number(overview.financials.net).toLocaleString(undefined, { minimumFractionDigits: 2 })} consolidated funds</p><p className="text-xs font-medium text-amber-800">{overview.operations.pending_approvals} university-wide approval request(s) awaiting review.</p></div></div><span className="text-sm font-bold text-amber-800">Review now</span></NavLink>}

      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm"><h3 className="text-base font-bold text-[#0F172A]">Super Admin Actions</h3><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{[
        ['Manage organizations', '/dashboard/super-admin/organizations'],
        ['Manage administrators', '/dashboard/super-admin/admins'],
        ['Review financial approvals', '/dashboard/super-admin/approvals'],
        ['Official announcements', '/dashboard/super-admin/announcements'],
        ['View notifications', '/dashboard/super-admin/notifications'],
      ].map(([label, path]) => <NavLink key={path} to={path} className="flex min-h-11 items-center rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-4 py-3 text-sm font-semibold text-[#0F172A] hover:border-[#0B8ED0]/40 hover:bg-white">{label}</NavLink>)}</div></section>

      {overview && <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><Activity size={18} className="text-[#0B8ED0]" /><h3 className="font-bold text-[#0F172A]">Recent organization activity</h3></div><div className="mt-4 divide-y divide-[#E5EDF3]">{overview.recent_activity?.length ? overview.recent_activity.slice(0, 6).map((item) => <article key={item.id} className="py-3 first:pt-0"><p className="text-sm font-semibold text-[#0F172A]">{String(item.action || '').replaceAll('_', ' ')}</p><p className="mt-1 text-xs text-slate-500">{item.organization_name || 'System'} · {item.first_name ? `${item.first_name} ${item.last_name}` : 'System actor'}</p></article>) : <p className="py-6 text-center text-sm text-slate-400">No recent activity.</p>}</div></section>
        <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Bell size={18} className="text-[#0B8ED0]" /><h3 className="font-bold text-[#0F172A]">Recent notifications</h3></div><NavLink to="/dashboard/super-admin/notifications" className="text-xs font-bold text-[#0B8ED0]">View all</NavLink></div><div className="mt-4 divide-y divide-[#E5EDF3]">{overview.notifications?.recent?.length ? overview.notifications.recent.map((item) => <article key={item.id} className="py-3 first:pt-0"><p className="text-sm font-semibold text-[#0F172A]">{item.title}</p><p className="mt-1 line-clamp-2 text-xs text-slate-500">{item.message}</p></article>) : <p className="py-6 text-center text-sm text-slate-400">No recent notifications.</p>}</div></section>
      </div>}
    </div>
  );
}
