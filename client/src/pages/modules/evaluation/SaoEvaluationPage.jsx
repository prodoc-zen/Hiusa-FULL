import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Plus, Unlock, Lock, Pencil } from 'lucide-react';
import {
  Button,
  DataTable,
  IconButton,
  PageHeader,
  SegmentedControl,
  StatusBadge,
  Tabs,
} from '../../../components/ui';
import ConfirmModal from '../../../components/ConfirmModal';
import {
  createEvaluationWindow,
  exportEvaluationResults,
  getEvaluationResults,
  getEvaluationWindows,
  updateEvaluationWindow,
} from '../../../services/evaluationService';
import { getOrganizations } from '../../../services/organizationService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { manilaDate } from '../../../lib/format';
import notify from '../../../lib/notify';
import { unwrapList, listMeta } from '../../../services/pagination';
import PaginationControls from '../../../components/PaginationControls';
import WindowFormModal from './components/WindowFormModal';
import EvaluationResultsPanel from './components/EvaluationResultsPanel';

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

function WindowsTab() {
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ status: 'loading', rows: [], meta: null, error: null });
  const [formOpen, setFormOpen] = useState(false);
  const [editingWindow, setEditingWindow] = useState(null);
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [transition, setTransition] = useState(null); // { window, action: 'open'|'close' }
  const [transitionBusy, setTransitionBusy] = useState(false);

  const load = useCallback(() => {
    setState((prev) => ({ ...prev, status: 'loading', error: null }));
    getEvaluationWindows({ page })
      .then((res) => setState({ status: 'ready', rows: unwrapList(res.data), meta: listMeta(res.data), error: null }))
      .catch((err) => setState({ status: 'error', rows: [], meta: null, error: getApiErrorMessage(err, 'Unable to load evaluation windows.') }));
  }, [page]);

  useEffect(() => { load(); }, [load]);

  async function handleFormSubmit(payload) {
    setFormBusy(true);
    setFormError('');
    try {
      if (editingWindow) {
        await updateEvaluationWindow(editingWindow.id, payload);
        notify.success('Evaluation window updated.');
      } else {
        await createEvaluationWindow(payload);
        notify.success(payload.status === 'open' ? 'Evaluation window created and opened.' : 'Evaluation window created as a draft.');
      }
      setFormOpen(false);
      setEditingWindow(null);
      load();
    } catch (error) {
      setFormError(getApiErrorMessage(error, 'Unable to save this evaluation window.'));
    } finally {
      setFormBusy(false);
    }
  }

  async function handleTransitionConfirm() {
    if (!transition) return;
    setTransitionBusy(true);
    try {
      await updateEvaluationWindow(transition.window.id, { status: transition.action === 'open' ? 'open' : 'closed' });
      notify.success(transition.action === 'open' ? 'Evaluation window opened. Everyone was notified.' : 'Evaluation window closed. Its results are now available.');
      setTransition(null);
      load();
    } catch (error) {
      notify.error(getApiErrorMessage(error, 'Unable to update this window.'));
    } finally {
      setTransitionBusy(false);
    }
  }

  const columns = [
    { key: 'title', header: 'Window', render: (row) => (
      <div className="min-w-0">
        <p className="truncate font-bold text-ink" title={row.title}>{row.title}</p>
        {row.description && <p className="truncate text-xs font-medium text-ink-muted" title={row.description}>{row.description}</p>}
      </div>
    ) },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    { key: 'opens_at', header: 'Opens', render: (row) => row.opens_at ? manilaDate(row.opens_at, 'short') : 'Not set' },
    { key: 'closes_at', header: 'Closes', render: (row) => row.closes_at ? manilaDate(row.closes_at, 'short') : 'Not set' },
    { key: 'responses_count', header: 'Responses', align: 'right', render: (row) => row.responses_count ?? 0 },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button
          variant="primary"
          leftIcon={Plus}
          onClick={() => { setEditingWindow(null); setFormOpen(true); }}
        >
          New window
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={state.rows}
        loading={state.status === 'loading'}
        error={state.error}
        onRetry={load}
        emptyState={state.status === 'ready' ? (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <p className="text-lg font-bold text-ink">No evaluation windows yet</p>
            <p className="max-w-sm text-sm font-medium text-ink-muted">
              Create one to start collecting responses for the study's SO1 and SO4 evaluation instruments.
            </p>
            <Button variant="primary" leftIcon={Plus} onClick={() => { setEditingWindow(null); setFormOpen(true); }}>
              New window
            </Button>
          </div>
        ) : undefined}
        actions={(row) => (
          <div className="flex items-center justify-end gap-1.5">
            <IconButton
              label="Edit window"
              icon={Pencil}
              variant="secondary"
              size="sm"
              onClick={() => { setEditingWindow(row); setFormOpen(true); }}
            />
            {row.status === 'draft' && (
              <IconButton
                label="Open window"
                icon={Unlock}
                variant="secondary"
                size="sm"
                onClick={() => setTransition({ window: row, action: 'open' })}
              />
            )}
            {row.status === 'open' && (
              <IconButton
                label="Close window"
                icon={Lock}
                variant="danger"
                size="sm"
                onClick={() => setTransition({ window: row, action: 'close' })}
              />
            )}
          </div>
        )}
        pagination={state.meta && (
          <PaginationControls
            currentPage={state.meta.currentPage}
            totalItems={state.meta.total}
            pageSize={state.meta.perPage}
            onPageChange={setPage}
            label="windows"
          />
        )}
      />

      <WindowFormModal
        open={formOpen}
        window={editingWindow}
        busy={formBusy}
        error={formError}
        onCancel={() => { setFormOpen(false); setEditingWindow(null); setFormError(''); }}
        onSubmit={handleFormSubmit}
      />

      <ConfirmModal
        open={Boolean(transition)}
        title={transition?.action === 'open' ? 'Open this evaluation window?' : 'Close this evaluation window?'}
        message={transition?.action === 'open'
          ? 'Every student, officer, admin and department head account will be notified that the survey is open. They can answer until you close it.'
          : 'Closing is final: once closed, this window can never be reopened or changed back, and its aggregated results become visible to organization admins and department heads.'}
        recordName={transition?.window?.title}
        confirmText={transition?.action === 'open' ? 'Open window' : 'Close window'}
        variant={transition?.action === 'open' ? 'primary' : 'danger'}
        busy={transitionBusy}
        onCancel={() => setTransition(null)}
        onConfirm={handleTransitionConfirm}
      />
    </div>
  );
}

function UniversityResultsTab() {
  const [windows, setWindows] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [windowId, setWindowId] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [respondentType, setRespondentType] = useState('');
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    getEvaluationWindows({ page: 1, per_page: 100 })
      .then((res) => setWindows(unwrapList(res.data).filter((w) => w.status === 'closed')))
      .catch(() => setWindows([]));
    getOrganizations()
      .then((res) => setOrganizations(res.data || []))
      .catch(() => setOrganizations([]));
  }, []);

  const params = useMemo(() => {
    const query = {};
    if (windowId) query.evaluation_window_id = windowId;
    if (organizationId) query.organization_id = organizationId;
    if (respondentType) query.respondent_type = respondentType;
    return query;
  }, [windowId, organizationId, respondentType]);

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
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex flex-col gap-1 text-xs font-semibold text-ink-muted">
          Window
          <select
            value={windowId}
            onChange={(event) => setWindowId(event.target.value)}
            className="h-11 rounded-control border border-line bg-surface px-3 text-sm font-medium text-ink outline-none focus:border-brand-600 focus:ring-4 focus:ring-accent/15"
          >
            <option value="">Latest closed window</option>
            {windows.map((w) => (
              <option key={w.id} value={w.id}>{w.title}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs font-semibold text-ink-muted">
          Organization
          <select
            value={organizationId}
            onChange={(event) => setOrganizationId(event.target.value)}
            className="h-11 rounded-control border border-line bg-surface px-3 text-sm font-medium text-ink outline-none focus:border-brand-600 focus:ring-4 focus:ring-accent/15"
          >
            <option value="">All organizations (university-wide)</option>
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>{org.acronym || org.name}</option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-ink-muted">Respondent type</span>
          <SegmentedControl options={RESPONDENT_TYPE_OPTIONS} value={respondentType} onChange={setRespondentType} />
        </div>

        <Button variant="secondary" leftIcon={Download} onClick={handleExport} loading={exporting} disabled={!canExport} className="ml-auto">
          Export CSV
        </Button>
      </div>

      <EvaluationResultsPanel
        data={state.data}
        loading={state.status === 'loading'}
        error={state.error}
        onRetry={load}
        promptMap={null}
        itemLabelNote="Items are shown by their question code. Full question text lives in each role's own questionnaire."
      />
    </div>
  );
}

export default function SaoEvaluationPage() {
  const [tab, setTab] = useState('windows');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Evaluation"
        description="Manage the SO1/SO4 evaluation windows and read university-wide acceptability results across every organization."
      />

      <Tabs
        tabs={[
          { key: 'windows', label: 'Windows' },
          { key: 'results', label: 'University-wide results' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'windows' ? <WindowsTab /> : <UniversityResultsTab />}
    </div>
  );
}
