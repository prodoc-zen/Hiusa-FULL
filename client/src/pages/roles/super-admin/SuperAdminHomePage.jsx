import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Bell, Building2, ClipboardCheck, FileText, ShieldCheck } from 'lucide-react';
import { getSystemOrganizations, getSystemOverview } from '../../../services/systemAdministrationService';
import { RoleBriefing } from '../../../components/dashboard';
import FieldIcon from '../../../components/FieldIcon.jsx';

const ACTIONS = [['Manage organizations', '/dashboard/super-admin/organizations'], ['Manage administrators', '/dashboard/super-admin/admins'], ['Review received reports', '/dashboard/super-admin/financial-reports'], ['Official announcements', '/dashboard/super-admin/announcements'], ['View notifications', '/dashboard/super-admin/notifications']];

export default function SuperAdminHomePage() {
  const [overview, setOverview] = useState(null);
  const [organizations, setOrganizations] = useState([]);
  const [organizationId, setOrganizationId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { getSystemOrganizations({ per_page: 100 }).then((data) => setOrganizations(data.data || [])).catch(() => setError('Unable to load the organization filter.')); }, []);
  useEffect(() => { setOverview(null); setError(''); getSystemOverview(organizationId ? { organization_id: organizationId } : {}).then(setOverview).catch(() => setError('Unable to load system oversight data.')); }, [organizationId]);

  const metrics = overview ? [
    { label: 'Registered SBOs', value: overview.organizations.total, icon: Building2 },
    { label: 'Active SBOs', value: overview.organizations.active, icon: ShieldCheck },
    { label: 'Inactive SBOs', value: overview.organizations.inactive, icon: Building2 },
    { label: 'Pending SAO Approvals', value: overview.operations.pending_approvals, icon: ClipboardCheck },
    { label: 'Unread Notifications', value: overview.notifications?.unread || 0, icon: Bell },
  ] : [];

  return <div className="mx-auto w-full max-w-[1280px] space-y-6">
    <RoleBriefing />
    <div className="flex justify-end"><label className="text-xs font-bold text-[#0F2F62]"><FieldIcon label="Organization filter" />Organization filter<select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} className="mt-1 block h-11 w-full rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm font-semibold text-[#0F172A] sm:min-w-56"><option value="">All organizations</option>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.acronym}: {organization.name}</option>)}</select></label></div>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
    {overview && <NavLink to="/dashboard/super-admin/financial-reports" className="flex flex-col gap-4 rounded-lg border border-amber-200 bg-amber-50 p-5 transition hover:bg-amber-100 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-white text-amber-700"><FileText size={19} /></span><div><p className="font-bold text-[#0F172A]">{overview.operations.pending_approvals} financial report(s) need SAO review</p><p className="mt-1 text-xs font-medium text-amber-800">Reports appear here after Department Head approval.</p></div></div><span className="text-sm font-bold text-amber-800">Open report inbox</span></NavLink>}
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.65fr)]"><section className="overflow-hidden rounded-lg border border-[#DDE7EF] bg-white"><div className="border-b border-[#DDE7EF] px-5 py-4"><h3 className="text-base font-bold text-[#0F172A]">University operations</h3><p className="mt-1 text-xs font-medium text-slate-500">Current organization and report-review workload.</p></div>{!overview ? <div className="space-y-2 p-5" aria-label="Loading system overview">{[1, 2, 3].map((row) => <div key={row} className="h-12 animate-pulse rounded-lg bg-slate-100" />)}</div> : <dl className="grid gap-px bg-[#DDE7EF] sm:grid-cols-2">{metrics.map((metric) => <div key={metric.label} className="flex min-h-28 flex-col justify-between gap-3 bg-white p-4"><dt className="flex items-center gap-2.5 text-sm font-semibold text-slate-600"><metric.icon size={17} className="text-[#0878B7]" />{metric.label}</dt><dd className="text-2xl font-extrabold tabular-nums text-[#0F172A]">{metric.value}</dd></div>)}</dl>}</section><nav aria-label="Super Admin actions" className="rounded-lg border border-[#DDE7EF] bg-white p-5"><h3 className="text-base font-bold text-[#0F172A]">SAO actions</h3><div className="mt-4 space-y-2">{ACTIONS.map(([label, path]) => <NavLink key={path} to={path} className="flex min-h-11 items-center rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-4 py-3 text-sm font-semibold text-[#0F172A] hover:border-[#0B8ED0]/40 hover:bg-white">{label}</NavLink>)}</div></nav></div>
    {overview && <section className="rounded-lg border border-[#DDE7EF] bg-white p-5"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Bell size={18} className="text-[#0878B7]" /><h3 className="font-bold text-[#0F172A]">Recent notifications</h3></div><NavLink to="/dashboard/super-admin/notifications" className="text-xs font-bold text-[#0878B7]">View all</NavLink></div><div className="mt-4 divide-y divide-[#DDE7EF]">{overview.notifications?.recent?.length ? overview.notifications.recent.map((item) => <article key={item.id} className="py-3 first:pt-0"><p className="text-sm font-semibold text-[#0F172A]">{item.title}</p><p className="mt-1 line-clamp-2 text-xs text-slate-500">{item.message}</p></article>) : <p className="py-6 text-center text-sm text-slate-500">No new notifications. Organization notices will appear here when they need your attention.</p>}</div></section>}
  </div>;
}
