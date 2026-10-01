import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { Button, SegmentedControl } from '../../../../components/ui';
import { exportEvaluationResults, getCurrentEvaluation, getEvaluationResults } from '../../../../services/evaluationService';
import { getApiErrorMessage } from '../../../../utils/apiError';
import notify from '../../../../lib/notify';
import EvaluationResultsPanel from './EvaluationResultsPanel';

const RESPONDENT_TYPE_OPTIONS = [
  { value: '', label: 'All respondents' },
  { value: 'student', label: 'Students' },
  { value: 'officer', label: 'Officers' },
  { value: 'adviser', label: 'Department heads' },
];

function downloadBlob(response, fallbackName) {
  const disposition = response.headers?.['content-disposition'] || '';
  const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || fallbackName;
  const url = URL.createObjectURL(response.data);
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function OrgResultsTab() {
  const [respondentType, setRespondentType] = useState('');
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [exporting, setExporting] = useState(false);
  const [promptMap, setPromptMap] = useState(null);

  useEffect(() => {
    getCurrentEvaluation()
      .then((res) => {
        const map = {};
        (res.data?.instrument?.items || []).forEach((item) => { map[item.code] = item.prompt; });
        setPromptMap(map);
      })
      .catch(() => setPromptMap({}));
  }, []);

  const params = useMemo(
    () => (respondentType ? { respondent_type: respondentType } : {}),
    [respondentType],
  );

  const load = useCallback(() => {
    setState({ status: 'loading', data: null, error: null });
    getEvaluationResults(params)
      .then((res) => setState({ status: 'ready', data: res.data, error: null }))
      .catch((err) => {
        if (err.response?.status === 404) {
          setState({ status: 'ready', data: null, error: null });
          return;
        }
        setState({ status: 'error', data: null, error: getApiErrorMessage(err, 'Unable to load evaluation results.') });
      });
  }, [params]);

  useEffect(() => { load(); }, [load]);

  async function handleExport() {
    setExporting(true);
    try {
      const response = await exportEvaluationResults(params);
      downloadBlob(response, `evaluation-results-${Date.now()}.csv`);
      notify.success('Results exported.');
    } catch (error) {
      notify.error(getApiErrorMessage(error, 'Unable to export results.'));
    } finally {
      setExporting(false);
    }
  }

  const canExport = state.status === 'ready' && state.data?.window;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl options={RESPONDENT_TYPE_OPTIONS} value={respondentType} onChange={setRespondentType} />
        <Button variant="secondary" leftIcon={Download} onClick={handleExport} loading={exporting} disabled={!canExport}>
          Export CSV
        </Button>
      </div>

      <EvaluationResultsPanel
        data={state.data}
        loading={state.status === 'loading'}
        error={state.error}
        onRetry={load}
        promptMap={promptMap}
        itemLabelNote={promptMap ? 'Question text is shown in full for your own questionnaire. Other roles’ questions are shown by their item code.' : undefined}
      />
    </div>
  );
}
