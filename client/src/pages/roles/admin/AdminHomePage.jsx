import { formatDisplayText } from '../../../utils/displayText.js';
import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { getAdminDashboard } from '../../../services/adminDashboardService';
import { resolveAssetUrl } from '../../../utils/assetUrl';
import { RoleBriefing } from '../../../components/dashboard';
import { ProcessTracker } from '../../../components/process';
import { Button, EmptyState, ErrorState, Field, Select, Skeleton, Stat } from '../../../components/ui';

const tools = [
  ['People', '/dashboard/admin/users'],
  ['Officer positions', '/dashboard/admin/positions'],
  ['Programs and sections', '/dashboard/admin/programs-sections'],
  ['Audit log', '/dashboard/audit-logs'],
];
// Three tiles, each a link. New announcements still count toward "nothing has happened yet".
const cards = [
  ['pending_orders', 'Pending orders', '/dashboard/merchandise/manage-orders'],
  ['approval_requests', 'Approval requests', '/dashboard/approvals'],
  ['pending_tasks', 'Pending tasks', '/dashboard/tasks/task-board'],
];
const money = (value) => `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function FinancialMovement({ rows }) {
  const largest = Math.max(1, ...rows.flatMap((row) => [Number(row.income), Number(row.expense)]));
  if (!rows.some((row) => Number(row.income) || Number(row.expense))) {
    return (
      <EmptyState
        kind="first-run"
        title="No ledger transactions in this period."
        description="A budget comes first, then spending is recorded against it."
        action={<Button to="/dashboard/finance/budget-allocation" variant="secondary" rightIcon={ArrowRight}>Propose a budget</Button>}
      />
    );
  }

  return (
    <div className="mt-4 min-w-0" role="img" aria-label="Monthly ledger income and expenses">
      <div className="flex h-40 min-w-0 items-end gap-1 border-b border-line pb-2 sm:h-56 sm:gap-3">
        {rows.map((row) => (
          <div key={row.month} className="flex min-w-0 flex-1 flex-col items-center">
            <div className="flex h-28 w-full items-end justify-center gap-0.5 sm:h-44 sm:gap-2">
              <div title={`${row.month} income ${money(row.income)}`} className="w-2 max-w-[40%] rounded-t bg-success sm:w-7" style={{ height: `${Math.max(Number(row.income) ? 4 : 0, Number(row.income) / largest * 100)}%` }} />
              <div title={`${row.month} expenses ${money(row.expense)}`} className="w-2 max-w-[40%] rounded-t bg-danger sm:w-7" style={{ height: `${Math.max(Number(row.expense) ? 4 : 0, Number(row.expense) / largest * 100)}%` }} />
            </div>
            <span className="mt-2 text-xs font-medium text-ink-muted">
              <span className="sm:hidden">{new Date(`${row.month}-01T00:00:00`).toLocaleDateString('en', { month: 'numeric' })}</span>
              <span className="hidden sm:inline">{new Date(`${row.month}-01T00:00:00`).toLocaleDateString('en', { month: 'short', year: '2-digit' })}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs font-medium text-ink-muted">
        <span><i className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-success" />Income</span>
        <span><i className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-danger" />Expenses</span>
      </div>
      <table className="sr-only">
        <caption>Monthly financial movement</caption>
        <thead><tr><th>Month</th><th>Income</th><th>Expenses</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.month}><td>{row.month}</td><td>{money(row.income)}</td><td>{money(row.expense)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

export default function AdminHomePage() {
  const [months, setMonths] = useState(6);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    getAdminDashboard(months).then((response) => { if (active) setData(response.data); }).catch(() => { if (active) setError('Dashboard updates could not be loaded.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [months, reload]);

  const firstRun = !loading && !error && Boolean(data)
    && [...cards.map(([key]) => key), 'new_announcements'].every((key) => !Number(data.counts?.[key] ?? 0))
    && !(data.movement || []).some((row) => Number(row.income) || Number(row.expense))
    && !(data.announcements || []).length;

  return (
    <div className="w-full space-y-6">
      <ProcessTracker />
      <RoleBriefing />
      {error && (
        <div role="alert" className="rounded-card border border-line bg-surface px-4">
          <ErrorState title={error} description="Check your connection and try again." onRetry={() => setReload((value) => value + 1)} />
        </div>
      )}
      {firstRun ? (
        <section className="rounded-card border border-line bg-surface px-4" aria-label="Administration summary">
          <EmptyState
            kind="first-run"
            title="Nothing has happened here yet"
            description="Orders, approvals and tasks are counted here once your organization starts using HIUSA."
            action={<Button to="/dashboard/events/manage-events" variant="secondary">Plan your first event</Button>}
          />
        </section>
      ) : (
        <section className="grid grid-cols-3 gap-2 sm:gap-3" aria-label="Administration summary">
          {cards.map(([key, label, to]) => (
            <Stat key={key} className="p-3! sm:p-4!" label={label} to={to} value={loading || error ? '-' : Number(data?.counts?.[key] ?? 0).toLocaleString()} />
          ))}
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <section className="rounded-card border border-line bg-surface p-4 sm:p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 className="text-base font-semibold text-ink">Financial status</h2>
              <Field label="Period">
                <Select aria-label="Financial status period" value={months} onChange={(event) => setMonths(Number(event.target.value))} className="w-36">
                  <option value={3}>3 months</option>
                  <option value={6}>6 months</option>
                  <option value={12}>12 months</option>
                </Select>
              </Field>
            </div>
            {loading
              ? <div role="status" className="mt-4"><Skeleton className="h-40 w-full sm:h-56" /><span className="sr-only">Loading financial status</span></div>
              : error
                ? <p className="py-8 text-sm text-ink-muted">Financial data is unavailable.</p>
                : <FinancialMovement rows={data?.movement || []} />}
            <NavLink to="/dashboard/finance/financial-ledger" className="mt-4 inline-flex min-h-11 items-center gap-1 rounded-control text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">Open ledger <ArrowRight size={14} aria-hidden="true" /></NavLink>
          </section>

          <section className="rounded-card border border-line bg-surface">
            <h2 className="border-b border-line px-4 py-3 text-base font-semibold text-ink sm:px-5">Manage</h2>
            <ul className="grid grid-cols-2">
              {tools.map(([label, to]) => (
                <li key={to} className="border-b border-line-soft">
                  <NavLink to={to} className="flex min-h-12 items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-ink hover:bg-subtle sm:gap-3 sm:px-5">
                    {label}
                    <ArrowRight size={15} className="shrink-0 text-ink-soft" aria-hidden="true" />
                  </NavLink>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="self-start rounded-card border border-line bg-surface p-4 sm:p-5" aria-label="Announcements">
          <h2 className="text-base font-semibold text-ink">Announcements</h2>
          {loading ? (
            <div role="status" className="mt-4 space-y-3"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-5/6" /><span className="sr-only">Loading announcements</span></div>
          ) : error ? (
            <p className="py-6 text-sm text-ink-muted">Announcements are unavailable.</p>
          ) : data?.announcements?.length ? (
            <ul className="mt-2 divide-y divide-line-soft">
              {data.announcements.map((post, index) => (
                <li key={post.id} className={`py-3 first:pt-2 sm:py-4 ${index >= 3 ? 'max-sm:hidden' : ''}`}>
                  <p className="truncate text-xs font-medium text-ink-muted">
                    {[formatDisplayText(post.source_organization?.name) || 'HIUSA', post.creator && `${post.creator.first_name} ${post.creator.last_name}`, post.published_at && new Date(post.published_at).toLocaleDateString()].filter(Boolean).join(' · ')}
                  </p>
                  <h3 className="mt-1 text-sm font-semibold text-ink">{formatDisplayText(post.title)}</h3>
                  <p className="mt-1 line-clamp-2 text-sm leading-5 text-ink-muted-strong sm:line-clamp-3">{post.body}</p>
                  {post.image_url && <img src={resolveAssetUrl(post.image_url)} alt="" loading="lazy" className="mt-3 max-h-28 w-full rounded-card object-cover max-sm:hidden" />}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState kind="first-run" title="No announcements yet" description="Published announcements show here." />
          )}
          <div className="mt-2 flex flex-col items-start border-t border-line pt-2">
            <NavLink to="/dashboard/announcements/manage-announcements" className="inline-flex min-h-11 items-center rounded-control text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">Manage announcements</NavLink>
            <NavLink to="/dashboard/announcements/view-announcements" className="inline-flex min-h-11 items-center rounded-control text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">View the feed</NavLink>
          </div>
        </aside>
      </div>
    </div>
  );
}
