import { formatDisplayText } from '../../../utils/displayText.js';
import { RichTextBody } from '../../../components/RichText';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Building2, ImagePlus, UserPlus } from 'lucide-react';
import { Button, EmptyState, ErrorState, Field, Input, SkeletonCard, StatusBadge } from '../../../components/ui';
import { getSystemColleges, uploadSystemCollegeLogo } from '../../../services/systemAdministrationService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { resolveAssetUrl } from '../../../utils/assetUrl';
import { AssignDepartmentHeadModal, ManageDepartmentHeadModal, summarizeHead } from './DepartmentHeadDialogs';

function CollegeCard({ college, uploading, onUpload, onAssign, onManage }) {
  const fileInput = useRef(null);
  const name = formatDisplayText(college.name);
  const head = college.department_head;
  const headIsActive = head?.account_status === 'active';

  return (
    <article className="rounded-card border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-[#EEF6FB] text-[#0F2F62]" style={college.color ? { borderLeft: `4px solid ${college.color}` } : undefined}>
          {college.logo_url ? <img src={resolveAssetUrl(college.logo_url)} alt="" className="h-full w-full object-cover" /> : <Building2 size={19} aria-hidden="true" />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-base font-bold text-ink">{name}</h2>
          <p className="mt-1 text-xs font-medium text-ink-muted">{college.code || 'No code'} · {college.organizations_count} {college.organizations_count === 1 ? 'organization' : 'organizations'} · {college.is_active ? 'Active' : 'Inactive'}</p>
          {college.description && <RichTextBody value={college.description} className="mt-2 break-words text-xs text-ink-muted" />}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-ink-muted">Department Head</p>
          {head ? (
            <>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="break-words text-sm font-bold text-ink">{formatDisplayText(head.name)}</span>
                <StatusBadge status={head.account_status} />
              </div>
              <p className="mt-0.5 break-all text-xs font-medium text-ink-muted">{head.email}</p>
            </>
          ) : <p className="mt-1 text-sm font-medium text-ink-muted">No Department Head yet</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {head && <Button variant={headIsActive ? 'primary' : 'secondary'} size="sm" className="max-md:min-h-[44px]" onClick={() => onManage(college)} aria-label={`Manage Department Head of ${name}`}>Manage</Button>}
          {!headIsActive && <Button size="sm" className="max-md:min-h-[44px]" leftIcon={UserPlus} onClick={() => onAssign(college)} aria-label={`Assign Department Head to ${name}`}>Assign Department Head</Button>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <Button to={`/dashboard/super-admin/organizations?status=active&search=${encodeURIComponent(college.name)}`} variant="ghost" size="sm" className="max-md:min-h-[42px]" aria-label={`View organizations of ${name}`}>View organizations</Button>
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" aria-label={`Logo file for ${name}`} className="sr-only" tabIndex={-1} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onUpload(college, file); }} />
        <Button variant="secondary" size="sm" className="max-md:min-h-[42px]" leftIcon={ImagePlus} loading={uploading} onClick={() => fileInput.current?.click()} aria-label={`Upload logo for ${name}`}>Upload logo</Button>
      </div>
    </article>
  );
}

export default function SystemCollegesPage() {
  const [colleges, setColleges] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploadingId, setUploadingId] = useState(null);
  const [notice, setNotice] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [assigning, setAssigning] = useState(null);
  const [managing, setManaging] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setColleges(await getSystemColleges());
      setError('');
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Unable to load colleges.'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function upload(college, file) {
    setUploadingId(college.id);
    setNotice('');
    setUploadError('');
    try {
      const saved = await uploadSystemCollegeLogo(college.id, file);
      setColleges((current) => current.map((item) => (item.id === college.id ? { ...item, logo_url: saved?.logo_url ?? item.logo_url } : item)));
      setNotice(`Logo updated for ${formatDisplayText(college.name)}.`);
    } catch (cause) {
      setUploadError(getApiErrorMessage(cause, 'Could not upload the logo.'));
    } finally {
      setUploadingId(null);
    }
  }

  function headChanged(collegeId, user, message) {
    if (user) setColleges((current) => current.map((item) => (item.id === collegeId ? { ...item, department_head: summarizeHead(user) } : item)));
    setUploadError('');
    setNotice(message);
  }

  const term = search.trim().toLowerCase();
  const visible = colleges.filter((college) => [college.name, college.code].some((value) => String(value || '').toLowerCase().includes(term)));

  return (
    <div className="space-y-5">
      <p className="max-w-[75ch] text-sm font-medium text-ink-muted">Colleges are a fixed list managed in the system. You can update each college's logo, open its organizations and assign its Department Head.</p>
      {error && !loading ? <ErrorState description={error} onRetry={load} /> : (
        <>
          <Field label="Search colleges" className="max-w-md"><Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="College name or code" /></Field>
          {uploadError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{uploadError}</p>}
          {notice && <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
          {loading ? (
            <section aria-label="Loading colleges" className="grid gap-3 md:grid-cols-2"><SkeletonCard /><SkeletonCard /></section>
          ) : visible.length ? (
            <section className="grid gap-3 md:grid-cols-2">{visible.map((college) => <CollegeCard key={college.id} college={college} uploading={uploadingId === college.id} onUpload={upload} onAssign={setAssigning} onManage={setManaging} />)}</section>
          ) : (
            <EmptyState kind={colleges.length ? 'filtered' : 'first-run'} icon={Building2} title="No colleges found" description={colleges.length ? 'No colleges match your search.' : 'The college list is empty. Colleges are added by the system administrators.'} />
          )}
        </>
      )}
      {assigning && <AssignDepartmentHeadModal college={assigning} onClose={() => setAssigning(null)} onAssigned={(user, message) => headChanged(assigning.id, user, message)} />}
      {managing?.department_head && <ManageDepartmentHeadModal college={managing} head={managing.department_head} onClose={() => setManaging(null)} onChanged={(user, message) => headChanged(managing.id, user, message)} />}
    </div>
  );
}
