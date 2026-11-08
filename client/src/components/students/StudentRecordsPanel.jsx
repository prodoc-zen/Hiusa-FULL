import { useCallback, useEffect, useRef, useState } from 'react';
import { GraduationCap } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, Field, Input, Select, StatusBadge } from '../ui';
import PaginationControls from '../PaginationControls';
import { applyStudentRegistry, getStudentRegistry, previewStudentRegistry } from '../../services/studentRegistryService';
import { getApiErrorMessage } from '../../utils/apiError';

const PAGE_SIZE = 20;

const SAO_HEADER = 'school_id,first_name,last_name,birth_date,college_code,program,year_level,section';
const DEAN_HEADER = 'school_id,first_name,last_name,birth_date,program,year_level,section';

const previewColumns = [
  {
    key: 'student',
    header: 'Student',
    render: (row) => (
      <span className="block min-w-0">
        <span className="block font-semibold text-ink">{[row.first_name, row.last_name].filter(Boolean).join(' ') || 'No name'}</span>
        <span className="block text-xs font-medium text-ink-muted">Line {row.line}{row.school_id ? `, ID ${row.school_id}` : ''}</span>
      </span>
    ),
  },
  { key: 'program', header: 'Program', render: (row) => [row.program, row.year_level].filter(Boolean).join(', ') || 'None' },
  {
    key: 'status',
    header: 'Result',
    render: (row) => (
      <span className="block">
        <StatusBadge status={row.status} />
        {row.reason && <span className="mt-1 block text-xs font-medium text-ink-muted">{row.reason}</span>}
      </span>
    ),
  },
];

export default function StudentRecordsPanel({ collegeId }) {
  const [file, setFile] = useState(null);
  const [fileKey, setFileKey] = useState(0);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(null);
  const [uploadError, setUploadError] = useState('');

  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0 });
  const [summary, setSummary] = useState({ total: 0, claimed: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [claimed, setClaimed] = useState('');
  const [page, setPage] = useState(1);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const current = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const data = await getStudentRegistry({
        page,
        per_page: PAGE_SIZE,
        ...(query && { q: query }),
        ...(claimed && { claimed }),
        ...(collegeId && { college_id: collegeId }),
      });
      if (current !== requestId.current) return;
      setRows(data.data);
      setMeta({ total: data.total });
      setSummary(data.summary);
    } catch (requestError) {
      if (current !== requestId.current) return;
      setError(getApiErrorMessage(requestError, 'The student records could not be loaded.'));
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, [page, query, claimed, collegeId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const resetUpload = () => {
    setFile(null);
    setPreview(null);
    setFileKey((key) => key + 1);
  };

  const checkFile = async () => {
    if (!file) return;
    setBusy('preview');
    setUploadError('');
    setResult(null);
    try {
      setPreview(await previewStudentRegistry(file));
    } catch (requestError) {
      setPreview(null);
      setUploadError(getApiErrorMessage(requestError, 'That file could not be read.'));
    } finally {
      setBusy(null);
    }
  };

  const saveRecords = async () => {
    setBusy('apply');
    setUploadError('');
    try {
      setResult(await applyStudentRegistry(file, preview.hash, preview.preview_token));
      resetUpload();
      setPage(1);
      load();
    } catch (requestError) {
      setUploadError(getApiErrorMessage(requestError, 'The records could not be saved.'));
    } finally {
      setBusy(null);
    }
  };

  const counts = preview?.counts;
  const savable = counts ? counts.created + counts.updated : 0;
  const template = `data:text/csv;charset=utf-8,${encodeURIComponent(`${collegeId ? DEAN_HEADER : SAO_HEADER}\n`)}`;
  const columns = collegeId ? 'school_id, first_name, last_name, birth_date, program, year_level' : 'school_id, first_name, last_name, birth_date, college_code, program, year_level';
  const filtersActive = Boolean(query || claimed);

  const tableColumns = [
    {
      key: 'student',
      header: 'Student',
      render: (row) => (
        <span className="block min-w-0">
          <span className="block font-semibold text-ink">{row.name}</span>
          <span className="block text-xs font-medium text-ink-muted">ID {row.school_id}</span>
        </span>
      ),
    },
    ...(collegeId ? [] : [{ key: 'college', header: 'College', render: (row) => row.college?.code || 'None' }]),
    { key: 'program', header: 'Program', render: (row) => [row.program, row.year_level, row.section].filter(Boolean).join(', ') },
    {
      key: 'claimed',
      header: 'Account',
      render: (row) => (row.claimed
        ? <StatusBadge status="claimed" label="Signed up" />
        : <StatusBadge status="unclaimed" label="Not yet" />),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Upload student records"
        description="Students are matched against these records when they sign up. Birth dates are only used for that check and are never shown."
      >
        <div className="flex flex-col gap-4">
          <Field label="CSV file" hint={`Columns: ${columns}. Section is optional.`}>
            <Input key={fileKey} type="file" accept=".csv,text/csv" onChange={(event) => { setFile(event.target.files?.[0] || null); setPreview(null); setResult(null); setUploadError(''); }} />
          </Field>
          <a href={template} download="student-records-template.csv" className="inline-flex min-h-11 w-fit items-center text-sm font-bold text-brand-700 hover:text-navy-950">
            Download a blank file
          </a>

          {uploadError && <p role="alert" className="rounded-control border border-danger-strong/20 bg-danger-tint px-3 py-2.5 text-sm font-semibold text-danger-strong">{uploadError}</p>}
          {result && (
            <p role="status" className="rounded-control border border-success-strong/20 bg-success-tint px-3 py-2.5 text-sm font-semibold text-success-strong">
              Saved: {result.created} added, {result.updated} updated.
              {result.invalid + result.duplicate > 0 && ` ${result.invalid + result.duplicate} rows were skipped.`}
            </p>
          )}

          {!preview && (
            <div>
              <Button variant="secondary" onClick={checkFile} loading={busy === 'preview'} disabled={!file}>Check file</Button>
            </div>
          )}

          {preview && (
            <div className="flex flex-col gap-4">
              <p role="status" className="text-sm font-semibold text-ink">
                {counts.created} new, {counts.updated} to update, {counts.unchanged + counts.claimed} left as they are, {counts.invalid + counts.duplicate} need fixing.
              </p>
              <DataTable
                caption="File check"
                columns={previewColumns}
                rows={preview.rows}
                rowKey={(row) => row.line}
                stickyHeader={false}
              />
              {preview.truncated && <p className="text-xs font-medium text-ink-muted">Only the first {preview.rows.length} rows are shown. The whole file is checked.</p>}
              {counts.invalid + counts.duplicate > 0 && <p className="text-sm font-medium text-ink-muted">Rows that need fixing are skipped. Fix them in the file and upload it again.</p>}
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={saveRecords} loading={busy === 'apply'} disabled={savable === 0}>
                  {savable === 0 ? 'Nothing to save' : `Save ${savable} ${savable === 1 ? 'record' : 'records'}`}
                </Button>
                <Button variant="secondary" onClick={resetUpload} disabled={busy === 'apply'}>Choose another file</Button>
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card
        title="Student records"
        description={summary.total > 0 ? `${summary.claimed} of ${summary.total} have signed up.` : 'No records loaded yet.'}
        bodyClassName="p-0"
      >
        <DataTable
          caption="Student records"
          columns={tableColumns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          onRetry={load}
          filtersActive={filtersActive}
          stickyHeader={false}
          filters={(
            <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-end">
              <Field label="Search" className="sm:flex-1">
                <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or school ID" />
              </Field>
              <Field label="Account" className="sm:w-48">
                <Select value={claimed} onChange={(event) => { setClaimed(event.target.value); setPage(1); }}>
                  <option value="">All students</option>
                  <option value="claimed">Signed up</option>
                  <option value="unclaimed">Not yet</option>
                </Select>
              </Field>
            </div>
          )}
          emptyState={filtersActive ? undefined : (
            <EmptyState
              kind="first-run"
              icon={GraduationCap}
              title="No student records yet"
              description="Upload a CSV above. Students whose school ID and birth date match a record can then create their own account."
            />
          )}
          pagination={<PaginationControls currentPage={page} totalItems={meta.total} pageSize={PAGE_SIZE} onPageChange={setPage} label="students" />}
        />
      </Card>
    </div>
  );
}
