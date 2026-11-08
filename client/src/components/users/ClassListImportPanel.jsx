import { formatDisplayText } from '../../utils/displayText.js';
import { useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { Button } from '../ui';
import { applyClassList, previewClassList } from '../../services/userService';
import downloadBlob from '../../utils/downloadBlob';
import { buildCsv } from '../../utils/csv';

const labels = { new: 'New account', update: 'Update', unchanged: 'Unchanged', invalid: 'Invalid', duplicate: 'Duplicate' };
const firstError = (error) => Object.values(error?.response?.data?.errors || {}).flat()[0] || error?.response?.data?.message || 'Unable to process this CSV.';

export default function ClassListImportPanel() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [temporaryPasswords, setTemporaryPasswords] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const counts = preview?.rows?.reduce((totals, row) => ({ ...totals, [row.status]: (totals[row.status] || 0) + 1 }), {}) || {};

  const showPreview = async () => {
    if (!file) return;
    setBusy(true); setError(''); setResult(null);
    try { setPreview(await previewClassList(file)); } catch (requestError) { setError(firstError(requestError)); setPreview(null); } finally { setBusy(false); }
  };
  const apply = async () => {
    if (!file || !preview) return;
    setBusy(true); setError('');
    try {
      const { temporary_passwords: issued = [], ...summary } = await applyClassList(file, preview.hash, preview.preview_token);
      setResult(summary); setTemporaryPasswords((current) => [...current, ...issued]); setPreview(null); setFile(null);
    } catch (requestError) { setError(firstError(requestError)); } finally { setBusy(false); }
  };

  const downloadPasswords = () => {
    const csv = buildCsv(['school_id', 'name', 'temporary_password'], temporaryPasswords.map((entry) => [entry.school_id, entry.name, entry.password]));
    downloadBlob({ data: new Blob([csv], { type: 'text/csv' }), headers: {} }, 'hiusa-temporary-passwords.csv');
  };

  return <section className="rounded-card border border-line bg-surface p-5" aria-labelledby="class-list-title">
    <h2 id="class-list-title" className="text-base font-semibold text-ink">Import class list</h2>
    <p className="mt-1 text-sm text-ink-muted">Match students by school ID. Preview each row before creating accounts or updating academic details.</p>
    <p className="mt-4 text-xs leading-5 text-ink-muted-strong">CSV columns: <strong className="font-semibold">school_id, program, year_level, section</strong>. New students also need <strong className="font-semibold">first_name, last_name, email</strong>. Use a year number such as 1 or 2. Each new account gets a random temporary password, shown once after the import. Each student must set their own password at first sign-in.</p>
    <a href="data:text/csv;charset=utf-8,school_id%2Cfirst_name%2Clast_name%2Cemail%2Cprogram%2Cyear_level%2Csection%0A" download="hiusa-class-list-template.csv" className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">Download CSV template</a>
    <div className="mt-2 flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1 text-[13px] font-medium text-ink">Choose class list<input type="file" accept=".csv,text/csv" onChange={(event) => { setFile(event.target.files?.[0] || null); setPreview(null); setResult(null); setError(''); }} className="mt-1.5 block w-full rounded-control border border-line bg-surface p-2 text-sm font-normal text-ink" /></label><Button variant="secondary" onClick={showPreview} disabled={!file || busy} leftIcon={Upload}>{busy ? 'Processing...' : 'Preview'}</Button></div>
    {error && <p role="alert" className="mt-4 text-sm font-semibold text-danger-strong">{error}</p>}
    {result && <p role="status" className="mt-4 text-sm font-medium text-success-strong">Import complete: {result.created} created, {result.updated} updated, {result.unchanged} unchanged, {result.invalid} invalid, {result.duplicate} duplicate.</p>}
    {temporaryPasswords.length > 0 && <div role="region" aria-label="Temporary passwords" className="mt-4 border-t border-line pt-4 text-sm text-ink"><p className="font-semibold">Temporary passwords. Shown once. Give each student theirs; they must choose their own password at first sign-in.</p><p className="mt-1 text-xs text-ink-muted-strong">{temporaryPasswords.length} {temporaryPasswords.length === 1 ? 'account has' : 'accounts have'} a temporary password. Download the list now; it cannot be shown again once you dismiss this notice or leave the page.</p><div className="mt-3 flex flex-wrap gap-3"><Button variant="secondary" onClick={downloadPasswords} leftIcon={Download}>Download temporary passwords (CSV)</Button><Button variant="ghost" onClick={() => setTemporaryPasswords([])}>Dismiss</Button></div></div>}
    {preview && <div className="mt-5 border-t border-line pt-4"><ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">{Object.entries(labels).map(([key, label]) => <li key={key} className={(key === 'invalid' || key === 'duplicate') && counts[key] ? 'font-medium text-danger-strong' : 'text-ink-muted-strong'}>{label}: {counts[key] || 0}</li>)}</ul><div className="mt-3 max-h-80 overflow-auto rounded-card border border-line"><table className="w-full min-w-[680px] text-left text-sm"><caption className="sr-only">Class list preview</caption><thead className="sticky top-0 bg-subtle text-xs font-semibold text-ink-muted"><tr>{['Line', 'School ID', 'Student', 'Program', 'Year', 'Section', 'Result'].map((heading) => <th key={heading} scope="col" className={`px-3 py-2 ${heading === 'Line' ? 'text-right' : ''}`}>{heading}</th>)}</tr></thead><tbody className="divide-y divide-line-soft">{preview.rows.map((row) => <tr key={row.line}><td className="px-3 py-2 text-right tabular-nums">{row.line}</td><td className="px-3 py-2">{row.school_id}</td><td className="px-3 py-2">{formatDisplayText(row.first_name)} {formatDisplayText(row.last_name)}</td><td className="px-3 py-2">{row.program}</td><td className="px-3 py-2">{row.year_level}</td><td className="px-3 py-2">{row.section}</td><td className="px-3 py-2"><span className="font-medium">{labels[row.status]}</span>{row.reason && <span className="block text-xs text-ink-muted">{row.reason}</span>}</td></tr>)}</tbody></table></div><div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-ink-muted-strong">Only valid new and updated rows will be applied. Invalid and duplicate rows are skipped.</p><Button variant="secondary" onClick={apply} disabled={busy || !((counts.new || 0) + (counts.update || 0))}>{busy ? 'Applying...' : `Confirm and apply ${(counts.new || 0) + (counts.update || 0)} rows`}</Button></div></div>}
  </section>;
}
