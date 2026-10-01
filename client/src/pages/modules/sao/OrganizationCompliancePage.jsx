import { useCallback, useEffect, useMemo, useState } from 'react';
import { File, Lock, ShieldCheck } from 'lucide-react';
import { Button, Card, Drawer, EmptyState, ErrorState, PageHeader, ProgressMeter, SkeletonCard, StatusBadge } from '../../../components/ui';
import notify from '../../../lib/notify';
import { manilaDate, relativeTime } from '../../../lib/format';
import { unwrapList } from '../../../services/pagination';
import { getApiErrorMessage } from '../../../utils/apiError';
import { getComplianceStatus, getRequirementTypes, getSubmissions, submitComplianceDocument } from '../../../services/complianceService';
import ComplianceDropzone, { validateComplianceFile } from './ComplianceDropzone';

function getCurrentRole() {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}')?.role || '';
  } catch {
    return '';
  }
}

function mergeRequirements(statusRequirements, types, submissions) {
  return statusRequirements.map((requirement) => {
    const type = types.find((item) => item.id === requirement.requirement_type_id);
    const submission = submissions.find((item) => item.requirement_type?.id === requirement.requirement_type_id);
    return { ...requirement, description: type?.description || null, submission: submission || null };
  });
}

function deadlineTone(requirement) {
  if (requirement.status === 'approved') return 'text-ink-muted';
  const overdue = new Date(requirement.deadline_at).getTime() < Date.now();
  return overdue ? 'text-danger-strong' : 'text-ink-muted';
}

export default function OrganizationCompliancePage() {
  const role = useMemo(() => getCurrentRole(), []);
  const [state, setState] = useState({ loading: true, error: null, academicYear: null, requirements: [] });
  const [uploadTarget, setUploadTarget] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileError, setFileError] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(() => {
    setState((current) => ({ ...current, loading: true, error: null }));
    Promise.all([getComplianceStatus(), getRequirementTypes(), getSubmissions()])
      .then(([statusRes, typesRes, submissionsRes]) => {
        const org = statusRes.data?.organizations || null;
        setState({
          loading: false,
          error: null,
          academicYear: statusRes.data?.academic_year ?? null,
          requirements: org ? mergeRequirements(org.requirements || [], unwrapList(typesRes.data), unwrapList(submissionsRes.data)) : [],
        });
      })
      .catch((err) => setState((current) => ({ ...current, loading: false, error: getApiErrorMessage(err, 'Could not load your compliance requirements.') })));
  }, []);

  useEffect(() => { if (role === 'ADMIN') load(); }, [load, role]);

  function openUpload(requirement) {
    setUploadTarget(requirement);
    setSelectedFile(null);
    setFileError(null);
    setUploadProgress(0);
  }

  function closeUpload() {
    if (uploading) return;
    setUploadTarget(null);
    setSelectedFile(null);
    setFileError(null);
    setUploadProgress(0);
  }

  function handleFileSelected(file) {
    const validationError = validateComplianceFile(file);
    setFileError(validationError);
    setSelectedFile(validationError ? null : file);
  }

  async function handleUpload() {
    if (!selectedFile || !uploadTarget) return;
    setUploading(true);
    setUploadProgress(0);
    try {
      await submitComplianceDocument(uploadTarget.requirement_type_id, selectedFile, (progressEvent) => {
        if (progressEvent.total) setUploadProgress(Math.round((progressEvent.loaded / progressEvent.total) * 100));
      });
      notify.success(`"${uploadTarget.requirement_name}" submitted to SAO for review.`);
      closeUpload();
      load();
    } catch (err) {
      setFileError(getApiErrorMessage(err, 'Could not submit this document.'));
    } finally {
      setUploading(false);
    }
  }

  if (role !== 'ADMIN') {
    return (
      <div className="space-y-5">
        <PageHeader title="Organization compliance" description="Submit and track your organization's accreditation requirements." />
        <Card><EmptyState kind="restricted" title="Admin access only" description="Only your organization's admin can manage compliance submissions." /></Card>
      </div>
    );
  }

  const approvedCount = state.requirements.filter((requirement) => requirement.status === 'approved').length;

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Organization compliance"
        description={state.academicYear ? `What your organization must submit for the ${state.academicYear} academic year.` : 'What your organization must submit for accreditation.'}
        meta={!state.loading && !state.error && state.requirements.length > 0 && (
          <div className="w-full max-w-xs">
            <ProgressMeter label="Requirements met" value={approvedCount} max={state.requirements.length} valueLabel={`${approvedCount}/${state.requirements.length}`} />
          </div>
        )}
      />

      {state.loading && (
        <div className="space-y-3">
          <SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
      )}

      {!state.loading && state.error && (
        <Card><ErrorState description={state.error} onRetry={load} /></Card>
      )}

      {!state.loading && !state.error && state.requirements.length === 0 && (
        <Card>
          <EmptyState
            kind="first-run"
            icon={ShieldCheck}
            title="No requirements assigned yet"
            description="SAO has not published any compliance requirements for this academic year. Check back once they do."
          />
        </Card>
      )}

      {!state.loading && !state.error && state.requirements.length > 0 && (
        <Card bodyClassName="divide-y divide-line p-0">
          {state.requirements.map((requirement) => (
            <div key={requirement.requirement_type_id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-bold text-ink">{requirement.requirement_name}</h3>
                  <StatusBadge status={requirement.status === 'not_submitted' ? 'pending' : requirement.status} label={requirement.status === 'not_submitted' ? 'Not submitted' : undefined} />
                </div>
                {requirement.description && <p className="mt-1 max-w-xl text-sm font-medium text-ink-muted">{requirement.description}</p>}
                <p className={`mt-2 text-xs font-semibold ${deadlineTone(requirement)}`}>
                  Due {manilaDate(requirement.deadline_at, 'long')} ({relativeTime(requirement.deadline_at)})
                </p>
                {requirement.submission?.file_original_name && (
                  <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted">
                    <File size={13} aria-hidden="true" /> {requirement.submission.file_original_name} - submitted {manilaDate(requirement.submission.submitted_at, 'long')}
                  </p>
                )}
                {requirement.status === 'returned' && requirement.submission?.remarks && (
                  <div className="mt-3 rounded-control border border-danger/30 bg-danger-tint p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-danger-strong">SAO remarks</p>
                    <p className="mt-1 text-sm font-medium text-danger-strong">{requirement.submission.remarks}</p>
                  </div>
                )}
                {requirement.status === 'approved' && (
                  <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted">
                    <Lock size={14} aria-hidden="true" /> Approved{requirement.submission?.reviewed_at ? ` on ${manilaDate(requirement.submission.reviewed_at, 'long')}` : ''} and locked from further changes.
                  </p>
                )}
              </div>
              {requirement.status !== 'approved' && (
                <Button variant="secondary" size="sm" className="shrink-0" onClick={() => openUpload(requirement)}>
                  {requirement.status === 'not_submitted' ? 'Upload document' : 'Replace document'}
                </Button>
              )}
            </div>
          ))}
        </Card>
      )}

      <Drawer
        open={Boolean(uploadTarget)}
        title={uploadTarget?.requirement_name}
        description={uploadTarget ? `Due ${manilaDate(uploadTarget.deadline_at, 'long')}` : undefined}
        onClose={closeUpload}
        footer={(
          <>
            <Button variant="secondary" onClick={closeUpload} disabled={uploading}>Cancel</Button>
            <Button onClick={handleUpload} loading={uploading} disabled={!selectedFile}>Submit for review</Button>
          </>
        )}
      >
        <div className="space-y-4">
          {uploadTarget?.description && <p className="text-sm font-medium text-ink-muted">{uploadTarget.description}</p>}
          {uploadTarget?.status === 'returned' && uploadTarget.submission?.remarks && (
            <div className="rounded-control border border-danger/30 bg-danger-tint p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-danger-strong">Why this was returned</p>
              <p className="mt-1 text-sm font-medium text-danger-strong">{uploadTarget.submission.remarks}</p>
            </div>
          )}
          <ComplianceDropzone onFileSelected={handleFileSelected} disabled={uploading} error={fileError} />
          {selectedFile && !fileError && (
            <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
              <File size={14} aria-hidden="true" /> {selectedFile.name}
            </p>
          )}
          {uploading && <ProgressMeter label="Uploading" value={uploadProgress} max={100} valueLabel={`${uploadProgress}%`} />}
        </div>
      </Drawer>
    </div>
  );
}
