import { formatDisplayText } from '../../../utils/displayText.js';
import { RichTextBody } from '../../../components/RichText';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Building2, ImagePlus, Search } from 'lucide-react';
import { Button, EmptyState, ErrorState, SkeletonCard } from '../../../components/ui';
import { getSystemColleges, uploadSystemCollegeLogo } from '../../../services/systemAdministrationService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { resolveAssetUrl } from '../../../utils/assetUrl';

function CollegeCard({ college, uploading, onUpload }) {
  const fileInput = useRef(null);
  const name = formatDisplayText(college.name);

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
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <Button to={`/dashboard/super-admin/organizations?status=active&search=${encodeURIComponent(college.name)}`} variant="ghost" size="sm" aria-label={`View organizations of ${name}`}>View organizations</Button>
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" aria-label={`Logo file for ${name}`} className="sr-only" tabIndex={-1} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onUpload(college, file); }} />
        <Button variant="secondary" size="sm" leftIcon={ImagePlus} loading={uploading} onClick={() => fileInput.current?.click()} aria-label={`Upload logo for ${name}`}>Upload logo</Button>
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

  const term = search.trim().toLowerCase();
  const visible = colleges.filter((college) => [college.name, college.code].some((value) => String(value || '').toLowerCase().includes(term)));

  return (
    <div className="space-y-5">
      <p className="max-w-[75ch] text-sm font-medium text-ink-muted">Colleges are a fixed list managed in the system. You can update each college's logo and open its organizations.</p>
      {error && !loading ? <ErrorState description={error} onRetry={load} /> : (
        <>
          <label className="flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-ink-muted"><Search size={17} aria-hidden="true" /><input aria-label="Search colleges" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search college name or code" className="w-full bg-transparent text-sm outline-none" /></label>
          {uploadError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{uploadError}</p>}
          {notice && <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
          {loading ? (
            <section aria-label="Loading colleges" className="grid gap-3 md:grid-cols-2"><SkeletonCard /><SkeletonCard /></section>
          ) : visible.length ? (
            <section className="grid gap-3 md:grid-cols-2">{visible.map((college) => <CollegeCard key={college.id} college={college} uploading={uploadingId === college.id} onUpload={upload} />)}</section>
          ) : (
            <EmptyState kind={colleges.length ? 'filtered' : 'first-run'} icon={Building2} title="No colleges found" description={colleges.length ? 'No colleges match your search.' : 'The college list is empty. Colleges are added by the system administrators.'} />
          )}
        </>
      )}
    </div>
  );
}
