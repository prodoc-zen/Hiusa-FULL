import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Bell, Building2, ClipboardCheck, FileText, Megaphone, ShieldCheck } from 'lucide-react';
import { getSystemOverview } from '../../../services/systemAdministrationService';
import { RoleBriefing } from '../../../components/dashboard';

const ACTIONS = [['Organization applications', '/dashboard/organization-applications', ClipboardCheck], ['Registrations and organizations', '/dashboard/super-admin/organizations', Building2], ['Colleges and Department Heads', '/dashboard/super-admin/colleges', Building2], ['Review received reports', '/dashboard/super-admin/compliance?tab=financial', FileText], ['Official announcements', '/dashboard/super-admin/announcements', Megaphone], ['View notifications', '/dashboard/super-admin/notifications', Bell]];

export default function SuperAdminHomePage() {
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState('');
  function load() {
    setError('');
    getSystemOverview().then(setOverview).catch(() => setError('Unable to load system oversight data.'));
  }
  useEffect(() => { load(); }, []);
  const metrics = overview ? [
    ['Registered organizations', overview.organizations.total, Building2],
    ['Active organizations', overview.organizations.active, ShieldCheck],
    ['Inactive organizations', overview.organizations.inactive, Building2],
  ] : [];
  const introduction = <section aria-label="University operations" className="overflow-hidden rounded-lg border border-[#DDE7EF] bg-white">
    {error ? <p role="alert" className="p-4 text-sm text-red-700">{error} <button type="button" onClick={load} className="font-bold underline">Retry</button></p> : !overview ? <p role="status" className="p-5 text-sm text-[#64748B]">Loading university operations...</p> : <dl className="grid divide-y divide-[#DDE7EF] sm:grid-cols-3 sm:divide-x sm:divide-y-0">{metrics.map(([label, value, Icon]) => <div key={label} className="p-4"><dt className="flex items-center gap-2 text-xs font-semibold text-[#64748B]"><Icon size={17} aria-hidden="true" className="shrink-0 text-[#0878B7]" />{label}</dt><dd className="mt-3 text-2xl font-extrabold text-[#0F172A]">{value}</dd></div>)}</dl>}
  </section>;
  return <div className="mx-auto w-full max-w-[1280px] space-y-6">
    <RoleBriefing introduction={introduction} />
    {overview?.organizations.total === 0 && <section className="rounded-lg border border-[#DDE7EF] bg-white p-5"><h3 className="font-bold text-[#0F172A]">No student organizations registered yet</h3><p className="mt-1 text-sm text-[#64748B]">Applicants can register from the public landing page. Department Heads endorse verified applications before SAO approval.</p><NavLink to="/dashboard/organization-applications" className="mt-3 inline-flex min-h-11 items-center text-sm font-bold text-[#0878B7]">Review applications</NavLink></section>}
    <nav aria-label="Super Admin actions" className="rounded-lg border border-[#DDE7EF] bg-white p-5"><h3 className="font-bold text-[#0F172A]">SAO actions</h3><div className="mt-4 flex flex-wrap gap-3">{ACTIONS.map(([label, path, Icon]) => <NavLink key={path} to={path} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#DDE7EF] px-4 py-3 text-sm font-semibold text-[#0878B7] hover:bg-[#EEF6FB]"><Icon size={17} aria-hidden="true" />{label}</NavLink>)}</div></nav>
  </div>;
}
