import { useState } from 'react';
import { Button, DataTable, Field, Input, StatusBadge } from '../ui';
import { applyStudentRegistry, previewStudentRegistry } from '../../services/studentRegistryService';
import { getApiErrorMessage } from '../../utils/apiError';

const SAO_HEADER = 'school_id,first_name,last_name,birth_date,college_code,record_type,position,program,year_level,section';
const DEAN_HEADER = 'school_id,first_name,last_name,birth_date,record_type,position,program,year_level,section';

const previewColumns = [
  {
    key: 'student',
    header: 'Person',
    render: (row) => (
      <span className="block min-w-0">
        <span className="block font-medium text-ink">{[row.first_name, row.last_name].filter(Boolean).join(' ') || 'No name'}</span>
        <span className="block text-xs text-ink-muted">Line {row.line}{row.school_id ? `, ID ${row.school_id}` : ''}</span>
      </span>
    ),
  },
  {
    key: 'program',
    header: 'Program or position',
    render: (row) => (row.record_type === 'employee' ? row.position : [row.program, row.year_level].filter(Boolean).join(', ')),
  },
  {
    key: 'status',
    header: 'Result',
    render: (row) => (
      <span className="block">
        <StatusBadge status={row.status} />
        {row.reason && <span className="mt-1 block text-xs text-ink-muted">{row.reason}</span>}
      </span>
    ),
  },
];

export default function StudentRecordsUpload({ collegeId, onSaved }) {
  const [file, setFile] = useState(null);
  const [fileKey, setFileKey] = useState(0);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(null);
  const [uploadError, setUploadError] = useState('');

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
      onSaved?.();
    } catch (requestError) {
      setUploadError(getApiErrorMessage(requestError, 'The records could not be saved.'));
    } finally {
      setBusy(null);
    }
  };

  const counts = preview?.counts;
  const savable = counts ? counts.created + counts.updated : 0;
  const template = `data:text/csv;charset=utf-8,${encodeURIComponent(`${collegeId ? DEAN_HEADER : SAO_HEADER}
`)}`;
  const columns = collegeId ? 'school_id, first_name, last_name, birth_date, program, year_level' : 'school_id, first_name, last_name, birth_date, college_code, program, year_level';

  return (
    <div className="flex flex-col gap-4">
      <Field label="CSV file" hint={`Columns: ${columns}. Optional: section, record_type (student or employee), position. Employees need no program or year level.`}>
        <Input key={fileKey} type="file" accept=".csv,text/csv" onChange={(event) => { setFile(event.target.files?.[0] || null); setPreview(null); setResult(null); setUploadError(''); }} />
      </Field>
      <a href={template} download="student-records-template.csv" className="inline-flex min-h-11 w-fit items-center rounded-control text-sm font-medium text-brand-700 hover:underline">
        Download a blank file
      </a>

      {uploadError && <p role="alert" className="rounded-control border border-danger-strong/20 bg-danger-tint px-3 py-2.5 text-sm font-medium text-danger-strong">{uploadError}</p>}
      {result && (
        <p role="status" className="rounded-control border border-success-strong/20 bg-success-tint px-3 py-2.5 text-sm font-medium text-success-strong">
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
          <p role="status" className="text-sm font-medium text-ink">
            {counts.created} new, {counts.updated} to update, {counts.unchanged + counts.claimed} left as they are, {counts.invalid + counts.duplicate} need fixing.
          </p>
          <DataTable
            caption="File check"
            columns={previewColumns}
            rows={preview.rows}
            rowKey={(row) => row.line}
            stickyHeader={false}
          />
          {preview.truncated && <p className="text-xs text-ink-muted">Only the first {preview.rows.length} rows are shown. The whole file is checked.</p>}
          {counts.invalid + counts.duplicate > 0 && <p className="text-sm text-ink-muted">Rows that need fixing are skipped. Fix them in the file and upload it again.</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={saveRecords} loading={busy === 'apply'} disabled={savable === 0}>
              {savable === 0 ? 'Nothing to save' : `Save ${savable} ${savable === 1 ? 'record' : 'records'}`}
            </Button>
            <Button variant="secondary" onClick={resetUpload} disabled={busy === 'apply'}>Choose another file</Button>
          </div>
        </div>
      )}
    </div>
  );
}
