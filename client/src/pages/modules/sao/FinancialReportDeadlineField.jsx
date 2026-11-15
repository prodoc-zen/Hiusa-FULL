import { useEffect, useState } from 'react';
import { Button, Field, Input } from '../../../components/ui';
import notify from '../../../lib/notify';
import { getFinancialReportDeadline, setFinancialReportDeadline } from '../../../services/financeService';
import { getApiErrorMessage } from '../../../utils/apiError';

const pad = (value) => String(value).padStart(2, '0');
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};
const label = (value) => new Date(`${value}T12:00:00`).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' });

// The one date every organization sends its financial report by. Dashboards and the assistant read it, so changing
// the date fixes the current round and starting a new round asks everyone to send a report again.
export default function FinancialReportDeadlineField() {
  const [deadline, setDeadline] = useState(undefined);
  const [date, setDate] = useState('');
  const [newRound, setNewRound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let current = true;
    getFinancialReportDeadline()
      .then((response) => {
        if (!current) return;
        setDeadline(response.data.data);
        setDate(response.data.data?.deadline_at || '');
      })
      .catch(() => { if (current) setDeadline(null); });
    return () => { current = false; };
  }, []);

  async function save() {
    setSaving(true);
    setError('');
    try {
      const response = await setFinancialReportDeadline(date, newRound);
      setDeadline(response.data.data);
      setNewRound(false);
      notify.success('Financial report due date saved.');
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Could not save the due date.'));
    } finally {
      setSaving(false);
    }
  }

  const unchanged = deadline?.deadline_at === date && !newRound;

  return (
    <section aria-label="Financial report due date" className="mb-5 border-b border-line pb-5">
      <h3 className="text-sm font-semibold text-ink">Financial report due date</h3>
      <p className="mt-1 text-xs font-medium text-ink-muted-strong">
        {deadline ? `Organizations send their financial report by ${label(deadline.deadline_at)}.` : 'No due date is set, so organizations are not reminded to send a financial report.'}
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <Field label="Due on" error={error} className="w-full sm:w-56">
          <Input type="date" min={today()} value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>
        <Button loading={saving} disabled={!date || unchanged} onClick={save}>{deadline ? 'Save due date' : 'Set due date'}</Button>
      </div>
      {deadline && (
        <label className="mt-3 flex min-h-8 items-start gap-2 text-sm font-medium text-ink pointer-coarse:min-h-[42px]">
          <input type="checkbox" checked={newRound} onChange={(event) => setNewRound(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-line accent-brand-700" />
          <span>This starts a new round. Organizations that already sent a report must send another.</span>
        </label>
      )}
    </section>
  );
}
