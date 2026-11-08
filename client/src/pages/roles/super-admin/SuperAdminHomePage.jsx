import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { getSystemOverview } from '../../../services/systemAdministrationService';
import { RoleBriefing } from '../../../components/dashboard';
import { ProcessTracker } from '../../../components/process';
import { Button, EmptyState, ErrorState, SkeletonStat, Stat } from '../../../components/ui';
import { useRefetchOnReturn } from '../../../hooks/useRefetchOnReturn';

const ACTIONS = [['Registrations and organizations', '/dashboard/super-admin/organizations'], ['Colleges and Department Heads', '/dashboard/super-admin/colleges'], ['Review received reports', '/dashboard/super-admin/compliance?tab=financial']];

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
    {error ? <ErrorState title="The overview could not load" description={error} onRetry={() => load()} /> : !overview ? <div className="grid grid-cols-3 gap-2 sm:gap-4" aria-busy="true"><SkeletonStat /><SkeletonStat /><SkeletonStat /></div> : <div className="grid grid-cols-3 gap-2 sm:gap-4">{metrics.map(([label, value, to]) => <Stat key={label} className="p-3! sm:p-4!" label={label} value={value} to={to} />)}</div>}
  </section>;
  return <div className="w-full space-y-6">
    <ProcessTracker />
    <RoleBriefing introduction={introduction} />
    {overview?.organizations.total === 0 && <EmptyState kind="first-run" title="No student organizations registered yet" description="A Department Head allows a student of the college to apply, then endorses the application before SAO approval." action={<Button variant="secondary" to="/dashboard/organization-applications">Review applications</Button>} />}
    <nav aria-label="Super Admin actions" className="rounded-card border border-line bg-surface"><h2 className="border-b border-line px-4 py-3 text-base font-semibold text-ink">Go to</h2><ul className="divide-y divide-line-soft">{ACTIONS.map(([label, path]) => <li key={path}><NavLink to={path} className="flex min-h-11 items-center px-4 py-2.5 text-sm font-medium text-brand-700 hover:bg-subtle">{label}</NavLink></li>)}</ul></nav>
  </div>;
}
