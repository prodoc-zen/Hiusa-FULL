import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { getSystemOverview } from '../../../services/systemAdministrationService';
import { RoleBriefing } from '../../../components/dashboard';
import { ProcessTracker } from '../../../components/process';
import { Button, EmptyState, SkeletonStat, Stat } from '../../../components/ui';
import { useRefetchOnReturn } from '../../../hooks/useRefetchOnReturn';

const ACTIONS = [['Organization applications', '/dashboard/organization-applications'], ['Registrations and organizations', '/dashboard/super-admin/organizations'], ['Colleges and Department Heads', '/dashboard/super-admin/colleges'], ['Review received reports', '/dashboard/super-admin/compliance?tab=financial'], ['Official announcements', '/dashboard/super-admin/announcements'], ['View notifications', '/dashboard/super-admin/notifications']];

export default function SuperAdminHomePage() {
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState('');

  const overviewEpoch = useRef(0);
  const load = useCallback(({ silent = false } = {}) => {
    if (!silent) {
      overviewEpoch.current += 1;
      setError('');
    }
    const epoch = overviewEpoch.current;
    return getSystemOverview()
      .then((next) => {
        if (epoch !== overviewEpoch.current) return;
        setOverview((current) => (silent && JSON.stringify(current) === JSON.stringify(next) ? current : next));
      })
      .catch(() => {
        if (!silent && epoch === overviewEpoch.current) setError('Unable to load system oversight data.');
      });
  }, []);

  useEffect(() => { load(); }, [load]);
  useRefetchOnReturn(() => load({ silent: true }));
  const metrics = overview ? [
    ['Registered organizations', overview.organizations.total, '/dashboard/super-admin/organizations'],
    ['Active organizations', overview.organizations.active, '/dashboard/super-admin/organizations?status=active'],
    ['Inactive organizations', overview.organizations.inactive, '/dashboard/super-admin/organizations?status=archived'],
  ] : [];
  const introduction = <section aria-label="University operations">
    {error ? <p role="alert" className="text-sm text-danger-strong">{error} <button type="button" onClick={load} className="min-h-10 font-medium underline">Retry</button></p> : !overview ? <div className="grid gap-4 sm:grid-cols-3" aria-busy="true"><SkeletonStat /><SkeletonStat /><SkeletonStat /></div> : <div className="grid gap-4 sm:grid-cols-3">{metrics.map(([label, value, to]) => <Stat key={label} label={label} value={value} to={to} />)}</div>}
  </section>;
  return <div className="w-full space-y-6">
    <ProcessTracker />
    <RoleBriefing introduction={introduction} />
    {overview?.organizations.total === 0 && <section className="rounded-card border border-line bg-surface px-4"><EmptyState kind="first-run" title="No student organizations registered yet" description="A Department Head allows a student of the college to apply, then endorses the application before SAO approval." action={<Button variant="secondary" to="/dashboard/organization-applications">Review applications</Button>} /></section>}
    <nav aria-label="Super Admin actions" className="rounded-card border border-line bg-surface"><h2 className="border-b border-line px-4 py-3 text-base font-semibold text-ink">SAO actions</h2><ul className="divide-y divide-line-soft">{ACTIONS.map(([label, path]) => <li key={path}><NavLink to={path} className="flex min-h-11 items-center px-4 py-2.5 text-sm font-medium text-brand-700 hover:bg-subtle">{label}</NavLink></li>)}</ul></nav>
  </div>;
}
