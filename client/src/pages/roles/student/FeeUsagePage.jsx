import { useCallback, useEffect, useState } from 'react';
import { ChartPie } from 'lucide-react';
import { Card, EmptyState, ErrorState, Field, PageHeader, ProgressMeter, Select, SkeletonCard, SkeletonStat, Stat } from '../../../components/ui';
import { manilaDate, peso } from '../../../lib/format';
import { getFeeUsage } from '../../../services/feeUsageService';
import { getApiErrorMessage } from '../../../utils/apiError';

export default function FeeUsagePage() {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [selectedId, setSelectedId] = useState('');

  const load = useCallback(() => {
    setState((current) => ({ ...current, loading: true, error: null }));
    return getFeeUsage()
      .then((res) => {
        setState({ loading: false, error: null, data: res.data });
        setSelectedId(String(res.data?.reports?.[0]?.id ?? ''));
      })
      .catch((err) => setState({ loading: false, error: getApiErrorMessage(err, 'Could not load where your fees go.'), data: null }));
  }, []);

  useEffect(() => { load(); }, [load]);

  const { loading, error, data } = state;
  const reports = data?.reports || [];
  const report = reports.find((entry) => String(entry.id) === selectedId) || reports[0];

  return (
    <div className="space-y-5 pb-8">
      <PageHeader title="Where your fees go" description={data?.organization ? `How ${data.organization.name} used the money, from reports the SAO approved.` : undefined} />

      {loading && (
        <div className="space-y-4" role="status" aria-label="Loading where your fees go">
          <div className="grid gap-4 sm:grid-cols-3"><SkeletonStat /><SkeletonStat /><SkeletonStat /></div>
          <SkeletonCard />
        </div>
      )}

      {!loading && error && <Card><ErrorState description={error} onRetry={load} /></Card>}

      {!loading && !error && !report && (
        <EmptyState
          icon={ChartPie}
          title="No approved report yet"
          description="Figures appear here after the SAO approves the organization's financial report."
        />
      )}

      {!loading && !error && report && (
        <>
          {reports.length > 1 && (
            <Field label="Period" className="sm:w-80">
              <Select value={String(report.id)} onChange={(event) => setSelectedId(event.target.value)}>
                {reports.map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.period_label || entry.title}</option>
                ))}
              </Select>
            </Field>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Collected" value={peso(report.totals.collected)} />
            <Stat label="Spent" value={peso(report.totals.spent)} />
            <Stat label="Balance" value={peso(report.totals.balance)} context="Closing balance" />
          </div>

          <Card title="Spending by category">
            {report.spending.length === 0 ? (
              <p className="text-sm text-ink-muted">This report has no spending.</p>
            ) : (
              <ul className="space-y-4">
                {report.spending.map((row) => (
                  <li key={row.category}>
                    <ProgressMeter
                      kind="progress"
                      label={row.category}
                      value={row.share_percent}
                      valueLabel={`${peso(row.amount)} · ${row.share_percent}%`}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Where the money came from">
            {report.income.length === 0 ? (
              <p className="text-sm text-ink-muted">This report has no income.</p>
            ) : (
              <ul className="divide-y divide-line-soft">
                {report.income.map((row) => (
                  <li key={row.category} className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0 break-words text-ink">{row.category}</span>
                    <span className="font-medium tabular-nums text-ink">{peso(row.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <p className="text-xs font-medium text-ink-muted">
            {report.title}{report.period_label ? `, ${report.period_label}` : ''}.{' '}
            {report.approved_at ? `Approved by the SAO on ${manilaDate(report.approved_at, 'long')}.` : 'Approved by the SAO.'}
          </p>
        </>
      )}
    </div>
  );
}
