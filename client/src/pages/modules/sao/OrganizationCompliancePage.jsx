import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Eye, File, Pencil, ShieldCheck, Upload } from 'lucide-react';
import { Button, Card, DataTable, Drawer, EmptyState, ErrorState, FlowStepper, NextStep, PageHeader, ProgressMeter, SkeletonCard, StatusBadge, Tabs } from '../../../components/ui';
import { accreditationLifecycle, toNextStepProps } from '../../../lib/lifecycle';
import notify from '../../../lib/notify';
import { manilaDate, relativeTime } from '../../../lib/format';
import { fetchAllPages } from '../../../services/pagination';
import { getApiErrorMessage } from '../../../utils/apiError';
import { getComplianceStatus, getRequirementTypes, getSubmissions, submitComplianceDocument } from '../../../services/complianceService';
import ComplianceDropzone, { validateComplianceFile } from './ComplianceDropzone';
import { complianceStageText } from './complianceStage';
import { RichTextBody } from '../../../components/RichText';
import TableRowActions from '../../../components/TableRowActions';
import PaginationControls from '../../../components/PaginationControls';
import { openProtectedFile } from '../../../utils/openProtectedFile';
import { openRequirementSample } from '../../../utils/requirementSample';

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
    return { ...requirement, description: type?.description || null, allowed_extensions: type?.allowed_extensions, template_url: type?.template_url, template_original_name: type?.template_original_name, submission: submission || null };
  });
}

function deadlineTone(requirement) {
  if (requirement.status === 'approved') return 'text-ink-muted';
  const overdue = new Date(requirement.deadline_at).getTime() < Date.now();
  return overdue ? 'text-danger-strong' : 'text-ink-muted';
}

export default function OrganizationCompliancePage() {
  const role = useMemo(() => getCurrentRole(), []);
  const [category, setCategory] = useState('organization');
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ loading: true, error: null, academicYear: null, accreditationStatus: null, requirements: [] });
  const [uploadTarget, setUploadTarget] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileError, setFileError] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const requestSequence = useRef(0);

  const load = useCallback(() => {
    const request = ++requestSequence.current;
    setState((current) => ({ ...current, loading: true, error: null }));
    Promise.all([getComplianceStatus({ category }), fetchAllPages((params) => getRequirementTypes({ ...params, category }).then((response) => response.data)), fetchAllPages((params) => getSubmissions({ ...params, category }).then((response) => response.data))])
      .then(([statusRes, types, submissions]) => {
        if (request !== requestSequence.current) return;
        const org = statusRes.data?.organizations || null;
        setState({
          loading: false,
          error: null,
          academicYear: statusRes.data?.academic_year ?? null,
          accreditationStatus: org?.accreditation_status ?? null,
          requirements: org ? mergeRequirements(org.requirements || [], types, submissions) : [],
        });
      })
      .catch((err) => { if (request === requestSequence.current) setState((current) => ({ ...current, loading: false, error: getApiErrorMessage(err, 'Could not load your compliance requirements.') })); });
  }, [category]);

  useEffect(() => { if (role === 'ADMIN') load(); return () => { requestSequence.current += 1; }; }, [load, role]);

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
    const validationError = validateComplianceFile(file, uploadTarget?.allowed_extensions);
    setFileError(validationError);
    setSelectedFile(validationError ? null : file);
  }

  async function viewFile(requirement) {
    const id = requirement.submission_id || requirement.submission?.id;
    if (!id) return;
    try {
      await openProtectedFile(`/compliance/submissions/${id}/document`);
    } catch (error) {
      notify.error(getApiErrorMessage(error, 'Could not open this document.'));
    }
  }

  async function viewSample(requirement) {
    try {
      await openRequirementSample(requirement);
    } catch (error) {
      notify.error(getApiErrorMessage(error, 'Could not open the sample file.'));
    }
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
      setUploadTarget(null);
      setSelectedFile(null);
      setFileError(null);
      setUploadProgress(0);
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
        <PageHeader />
        <Card><EmptyState kind="restricted" title="Admin access only" description="Only your organization's admin can manage compliance submissions." /></Card>
      </div>
    );
  }

  const approvedCount = state.requirements.filter((requirement) => requirement.status === 'approved').length;
  const ready = !state.loading && !state.error && state.requirements.length > 0;
  const accreditation = category === 'organization' && ready && state.accreditationStatus
    ? accreditationLifecycle({ status: state.accreditationStatus, total: state.requirements.length, approved: approvedCount }, 'ADMIN')
    : null;

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        meta={ready && (
          <>
            {state.academicYear && <span className="text-xs font-semibold text-ink-muted-strong">Academic year {state.academicYear}</span>}
            <div className="w-full">
              <ProgressMeter label="Requirements met" value={approvedCount} max={state.requirements.length} valueLabel={`${approvedCount}/${state.requirements.length}`} />
            </div>
          </>
        )}
        stepper={accreditation && <FlowStepper steps={accreditation.steps} ariaLabel="Accreditation progress" />}
        nextStep={accreditation && <NextStep {...toNextStepProps(accreditation)} primary={undefined} />}
      />

      <Tabs value={category} onChange={(next) => { setPage(1); setCategory(next); }} tabs={[{ key: 'organization', label: 'Organization accreditation' }, { key: 'semestral_report', label: 'Semestral report' }]} />

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
            description="The SAO publishes the compliance requirements for each academic year. Once it does, each one appears here for you to upload."
          />
        </Card>
      )}

      {!state.loading && !state.error && state.requirements.length > 0 && (
        <Card>
          <DataTable
            stickyHeader={false}
            caption={category === 'semestral_report' ? 'Semestral report requirements' : 'Organization compliance requirements'}
            rowKey={(requirement) => requirement.requirement_type_id}
            rows={state.requirements.slice((page - 1) * 10, page * 10)}
            pagination={<PaginationControls currentPage={page} totalItems={state.requirements.length} pageSize={10} onPageChange={setPage} label="requirements" />}
            columns={[
              { key: 'name', header: 'Requirement', render: (requirement) => <div><strong>{requirement.requirement_name}</strong>{requirement.description && <RichTextBody value={requirement.description} className="mt-1 max-w-xs text-xs text-ink-muted" />}{requirement.status === 'returned' && (requirement.remarks || requirement.submission?.remarks) && <p className="mt-1 text-xs text-danger-strong">SAO: {requirement.remarks || requirement.submission.remarks}</p>}</div> },
              { key: 'date', header: 'Submitted', render: (requirement) => requirement.submitted_at ? manilaDate(requirement.submitted_at, 'long') : 'Not submitted' },
              { key: 'deadline', header: 'Deadline', render: (requirement) => <span className={deadlineTone(requirement)}>{manilaDate(requirement.deadline_at, 'long')} <span className="block text-xs">{relativeTime(requirement.deadline_at)}</span></span> },
              { key: 'status', header: 'Status', render: (requirement) => <div className="flex flex-col items-start gap-1"><StatusBadge status={requirement.status === 'not_submitted' ? 'pending' : requirement.status} label={requirement.status === 'not_submitted' ? 'Not submitted' : undefined} /><span className="text-xs font-semibold text-ink-muted-strong">{complianceStageText(requirement)}</span></div> },
              { key: 'file', header: 'File', render: (requirement) => requirement.file_name ? <span className="inline-flex items-center gap-1 break-all text-xs"><File size={13} aria-hidden="true" />{requirement.file_name}</span> : 'No file' },
            ]}
            actions={(requirement) => <TableRowActions subject={requirement.requirement_name} actions={[
              (requirement.template_url || requirement.template_original_name) && { label: 'View sample format', icon: Eye, onClick: () => viewSample(requirement) },
              requirement.submission_id && { label: 'View file', icon: Eye, onClick: () => viewFile(requirement) },
              requirement.status !== 'approved' && { label: requirement.status === 'not_submitted' ? 'Upload document' : 'Replace document', icon: requirement.status === 'not_submitted' ? Upload : Pencil, onClick: () => openUpload(requirement) },
            ]} />}
          />
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
          {(uploadTarget?.template_url || uploadTarget?.template_original_name) && <Button variant="secondary" size="sm" onClick={() => viewSample(uploadTarget)}>View sample format</Button>}
          {uploadTarget?.status === 'returned' && (uploadTarget.remarks || uploadTarget.submission?.remarks) && (
            <div className="rounded-control border border-danger/30 bg-danger-tint p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-danger-strong">Why this was returned</p>
              <p className="mt-1 text-sm font-medium text-danger-strong">{uploadTarget.remarks || uploadTarget.submission.remarks}</p>
            </div>
          )}
          {uploadTarget?.submission_id && <Button variant="secondary" size="sm" onClick={() => viewFile(uploadTarget)}><Eye size={15} aria-hidden="true" />View current file{uploadTarget.file_name ? `: ${uploadTarget.file_name}` : ''}</Button>}
          <ComplianceDropzone onFileSelected={handleFileSelected} disabled={uploading} error={fileError} allowedExtensions={uploadTarget?.allowed_extensions} />
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
