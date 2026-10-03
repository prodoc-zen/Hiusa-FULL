import FieldIcon from '../FieldIcon.jsx';
import { useState } from 'react';
import { FileUp, Upload } from 'lucide-react';
import { applyClassList, previewClassList } from '../../services/userService';

const labels = { new: 'New account', update: 'Update', unchanged: 'Unchanged', invalid: 'Invalid', duplicate: 'Duplicate' };
const firstError = (error) => Object.values(error?.response?.data?.errors || {}).flat()[0] || error?.response?.data?.message || 'Unable to process this CSV.';

export default function ClassListImportPanel() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
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
    try { setResult(await applyClassList(file, preview.hash, preview.preview_token)); setPreview(null); setFile(null); } catch (requestError) { setError(firstError(requestError)); } finally { setBusy(false); }
  };

  return <section className="rounded-3xl border border-[#DDE7EF] bg-white p-5 shadow-sm" aria-labelledby="class-list-title">
    <div className="flex items-start gap-3"><span className="status-icon status-info"><FileUp size={20} /></span><div><h2 id="class-list-title" className="text-lg font-extrabold">Import class list</h2><p className="mt-1 text-sm text-slate-500">Match students by school ID. Preview each row before creating accounts or updating academic details.</p></div></div>
    <p className="mt-4 text-xs leading-5 text-slate-600">CSV columns: <strong>school_id, program, year_level, section</strong>. New students also need <strong>first_name, last_name, email</strong>. Use a year number such as 1 or 2. The first password for a new account is the last four digits of its school ID followed by <strong>-uclm</strong>; share it privately and have the student change it.</p>
    <a href="data:text/csv;charset=utf-8,school_id%2Cfirst_name%2Clast_name%2Cemail%2Cprogram%2Cyear_level%2Csection%0A" download="hiusa-class-list-template.csv" className="mt-2 inline-block text-xs font-bold text-[#0878B7] hover:underline">Download CSV template</a>
    <div className="mt-4 flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1 text-xs font-bold text-slate-700"><FieldIcon label="Choose class list" />Choose class list<input type="file" accept=".csv,text/csv" onChange={(event) => { setFile(event.target.files?.[0] || null); setPreview(null); setResult(null); setError(''); }} className="mt-1 block w-full rounded-xl border border-[#DDE7EF] p-2 text-sm" /></label><button type="button" onClick={showPreview} disabled={!file || busy} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[#0878B7] px-5 text-sm font-bold text-white disabled:opacity-50"><Upload size={16} />{busy ? 'Processing…' : 'Preview'}</button></div>
    {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {result && <p role="status" className="mt-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">Import complete: {result.created} created, {result.updated} updated, {result.unchanged} unchanged, {result.invalid} invalid, {result.duplicate} duplicate.</p>}
    {preview && <div className="mt-5"><div className="flex flex-wrap gap-2">{Object.entries(labels).map(([key, label]) => <span key={key} className="status-chip" data-tone={key === 'invalid' || key === 'duplicate' ? 'danger' : key === 'new' || key === 'update' ? 'info' : 'neutral'}>{label}: {counts[key] || 0}</span>)}</div><div className="mt-3 max-h-80 overflow-auto rounded-xl border border-[#DDE7EF]"><table className="w-full min-w-[680px] text-left text-xs"><thead className="sticky top-0 bg-[#F8FBFD] text-slate-600"><tr>{['Line', 'School ID', 'Student', 'Program', 'Year', 'Section', 'Result'].map((heading) => <th key={heading} className="px-3 py-2">{heading}</th>)}</tr></thead><tbody className="divide-y divide-[#DDE7EF]">{preview.rows.map((row) => <tr key={row.line}><td className="px-3 py-2">{row.line}</td><td className="px-3 py-2">{row.school_id}</td><td className="px-3 py-2">{row.first_name} {row.last_name}</td><td className="px-3 py-2">{row.program}</td><td className="px-3 py-2">{row.year_level}</td><td className="px-3 py-2">{row.section}</td><td className="px-3 py-2"><span className="font-bold">{labels[row.status]}</span>{row.reason && <span className="block text-slate-500">{row.reason}</span>}</td></tr>)}</tbody></table></div><div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-600">Only valid new and updated rows will be applied. Invalid and duplicate rows are skipped.</p><button type="button" onClick={apply} disabled={busy || !((counts.new || 0) + (counts.update || 0))} className="min-h-11 rounded-full bg-[#0F2F62] px-5 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Applying…' : `Confirm and apply ${(counts.new || 0) + (counts.update || 0)} rows`}</button></div></div>}
  </section>;
}
