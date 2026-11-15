import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Sparkles } from 'lucide-react';
import { Button, Field, StatusBadge, Textarea } from '../ui';
import EngineBadge from '../ai/EngineBadge';
import { explainReportChecks, getReportChecks, ignoreReportCheck } from '../../services/financeService';
import { recordAiOutcome } from '../../services/aiDraftService';
import { getApiErrorMessage } from '../../utils/apiError';

const SEVERITY = {
  high: { label: 'Fix first', tone: 'danger' },
  medium: { label: 'Check', tone: 'warning' },
  low: { label: 'Look at', tone: 'neutral' },
};

// The checks a report is read against before it is sent. They run on the organization's records, name what is
// wrong and block nothing. The Admin may put them in order with a written explanation, or set one aside with a
// reason that is kept in the audit log. onExplained hands the explanation up so the screen can report what became of it.
export default function ReportChecksPanel({ reportId, canIgnore = false, heading = 'Before you send', onExplained }) {
  const [findings, setFindings] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [explanation, setExplanation] = useState(null);
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState('');
  const [ignoring, setIgnoring] = useState(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [ignoreError, setIgnoreError] = useState('');

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const response = await getReportChecks(reportId);
      setFindings(response.data.findings || []);
    } catch {
      setFindings([]);
      setLoadError('The checks could not be loaded. Try again in a moment.');
    }
  }, [reportId]);

  useEffect(() => {
    let current = true;
    setFindings(null);
    setExplanation(null);
    setIgnoring(null);
    getReportChecks(reportId)
      .then((response) => { if (current) { setFindings(response.data.findings || []); setLoadError(''); } })
      .catch(() => { if (current) { setFindings([]); setLoadError('The checks could not be loaded. Try again in a moment.'); } });
    return () => { current = false; };
  }, [reportId]);

  async function explain() {
    setExplaining(true);
    setExplainError('');
    try {
      const response = await explainReportChecks(reportId);
      setExplanation(response.data);
      onExplained?.({ aiOutputId: response.data.ai_output_id, text: response.data.text });
    } catch (error) {
      setExplainError(getApiErrorMessage(error, 'The explanation could not be written. The list above still applies.'));
    } finally {
      setExplaining(false);
    }
  }

  function hideExplanation() {
    if (explanation?.ai_output_id) recordAiOutcome(explanation.ai_output_id, null).catch(() => {});
    setExplanation(null);
    onExplained?.(null);
  }

  async function ignore(finding) {
    setSaving(true);
    setIgnoreError('');
    try {
      const response = await ignoreReportCheck(reportId, finding.key, reason.trim());
      setFindings(response.data.findings || []);
      setIgnoring(null);
      setReason('');
    } catch (error) {
      setIgnoreError(getApiErrorMessage(error, 'Could not set this check aside.'));
    } finally {
      setSaving(false);
    }
  }

  if (findings === null) {
    return (
      <section aria-label={heading} className="border-t border-line pt-4">
        <h3 className="text-sm font-semibold text-ink">{heading}</h3>
        <p role="status" className="mt-2 text-xs font-medium text-ink-muted">Checking the records...</p>
      </section>
    );
  }

  const sentences = new Map((explanation?.items || []).map((item) => [item.key, item.sentence]));
  const order = (explanation?.items || []).map((item) => item.key);
  const shown = explanation
    ? [...findings].sort((a, b) => {
      const left = order.indexOf(a.key);
      const right = order.indexOf(b.key);
      return (left === -1 ? order.length : left) - (right === -1 ? order.length : right);
    })
    : findings;
  const open = findings.filter((finding) => !finding.ignored).length;

  return (
    <section aria-label={heading} className="border-t border-line pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">{heading}</h3>
        {open > 0 && !explanation && (
          <Button size="sm" variant="secondary" leftIcon={Sparkles} loading={explaining} onClick={explain} className="max-sm:h-[42px]">
            Explain and put in order
          </Button>
        )}
      </div>
      <p className="mt-1 text-xs font-medium text-ink-muted">These checks read your records. They do not stop you from sending the report.</p>

      {loadError && <p role="status" className="mt-2 text-sm font-medium text-danger-strong">{loadError} <button type="button" onClick={load} className="font-semibold text-brand-700 underline underline-offset-2">Retry</button></p>}

      {!loadError && findings.length === 0 && (
        <p className="mt-3 flex items-center gap-2 text-sm font-medium text-success-strong">
          <CheckCircle2 size={16} aria-hidden="true" />
          The checks found nothing to fix.
        </p>
      )}

      {explanation && (
        <div className="mt-3 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <EngineBadge engine={explanation.engine} />
            <button type="button" onClick={hideExplanation} className="min-h-8 text-xs font-semibold text-brand-700 underline underline-offset-2 pointer-coarse:min-h-[42px]">Hide the explanation</button>
          </div>
          <p className="text-sm font-medium text-ink">{explanation.summary}</p>
          <p className="text-xs font-medium text-ink-muted">Draft. Read and edit before you send.</p>
        </div>
      )}
      {explainError && <p role="status" className="mt-2 text-sm font-medium text-danger-strong">{explainError}</p>}

      {findings.length > 0 && (
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {shown.map((finding) => {
            const severity = SEVERITY[finding.severity] || SEVERITY.low;
            const text = sentences.get(finding.key) || finding.message;
            return (
              <li key={finding.key} className="py-3">
                <div className="flex flex-wrap items-start gap-2">
                  <StatusBadge tone={finding.ignored ? 'neutral' : severity.tone} label={finding.ignored ? 'Set aside' : severity.label} />
                  <p className={`min-w-0 flex-1 text-sm font-medium ${finding.ignored ? 'text-ink-muted-strong' : 'text-ink'}`}>{text}</p>
                </div>
                {finding.ignored && <p className="mt-1 text-xs font-medium text-ink-muted-strong">Reason: {finding.ignored.reason}</p>}
                {canIgnore && !finding.ignored && ignoring !== finding.key && (
                  <button
                    type="button"
                    onClick={() => { setIgnoring(finding.key); setReason(''); setIgnoreError(''); }}
                    className="mt-1 min-h-8 text-xs font-semibold text-brand-700 underline underline-offset-2 pointer-coarse:min-h-[42px]"
                  >
                    Ignore with a reason
                  </button>
                )}
                {ignoring === finding.key && (
                  <div className="mt-2 space-y-2">
                    <Field label="Why can this be ignored?" error={ignoreError}>
                      <Textarea rows={2} value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="For example: paid in cash, no receipt was issued." />
                    </Field>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" disabled={saving} onClick={() => setIgnoring(null)} className="max-sm:h-[42px]">Cancel</Button>
                      <Button size="sm" loading={saving} disabled={reason.trim().length < 5} onClick={() => ignore(finding)} className="max-sm:h-[42px]">Ignore this check</Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
