import { formatDisplayText } from '../../utils/displayText.js';
import { useState } from 'react';
import { Check, CheckCircle2, Copy, Download, TriangleAlert } from 'lucide-react';
import { importUsers } from '../../services/userService';
import { getApiErrorMessage } from '../../utils/apiError';
import downloadBlob from '../../utils/downloadBlob';
import { buildCsv } from '../../utils/csv';
import notify from '../../lib/notify';
import { Button, Drawer } from '../ui';

const TEMPLATE = [
  'school_id,first_name,last_name,email,role,program,year_level,section,contact_number',
  '20260001,Juan,Dela Cruz,juan.delacruz@example.edu,Student,,1,,',
].join('\n');

function downloadTemplate() {
  downloadBlob({ data: new Blob([`${TEMPLATE}\n`], { type: 'text/csv' }), headers: {} }, 'hiusa-member-import-template.csv');
}

const CREDENTIAL_HEADER = ['school_id', 'name', 'email', 'temporary_password'];
const credentialRow = (item) => [item.school_id, item.name, item.email, item.temporary_password];

/**
 * Enroll a roster from a CSV file: check first (nothing is written), fix any
 * flagged rows, then import every row at once.
 */
export default function UserImportDrawer({ open, onClose, onImported }) {
  const [file, setFile] = useState(null);
  const [check, setCheck] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [issued, setIssued] = useState(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setFile(null);
    setCheck(null);
    setBusy('');
    setError('');
    setIssued(null);
    setCopied(false);
  }

  function close() {
    reset();
    onClose();
  }

  function finish() {
    reset();
    onImported();
  }

  async function copyAll() {
    const text = buildCsv(CREDENTIAL_HEADER, issued.map(credentialRow));
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  function downloadCredentials() {
    downloadBlob({ data: new Blob([`${buildCsv(CREDENTIAL_HEADER, issued.map(credentialRow))}\r\n`], { type: 'text/csv' }), headers: {} }, 'hiusa-temporary-passwords.csv');
  }

  async function run(dryRun) {
    setBusy(dryRun ? 'check' : 'import');
    setError('');
    try {
      const result = await importUsers(file, dryRun);
      if (dryRun) {
        setCheck(result);
      } else if (result.credentials?.length) {
        setIssued(result.credentials);
        setCheck(null);
        setFile(null);
      } else {
        notify.success(`${result.summary.total} member account${result.summary.total === 1 ? '' : 's'} created`, { description: 'They can set a password with Forgot password, using the email in the file.' });
        reset();
        onImported();
      }
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'The file could not be checked. Try again.'));
      if (cause?.response?.data?.rows) setCheck(cause.response.data);
    } finally {
      setBusy('');
    }
  }

  const problems = check?.rows?.filter((row) => row.status === 'error') ?? [];
  const ready = check && check.summary.invalid === 0;

  return (
    <Drawer
      open={open}
      onClose={issued ? finish : close}
      title={issued ? 'Temporary passwords' : 'Import members'}
      description={issued ? 'Hand each member their password. They must change it when they first sign in.' : 'Add a whole roster at once from a CSV file.'}
      width="max-w-lg"
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          {issued ? (
            <Button onClick={finish}>Done</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={close}>Cancel</Button>
              {ready ? (
                <Button loading={busy === 'import'} onClick={() => run(false)}>Import {check.summary.total} member{check.summary.total === 1 ? '' : 's'}</Button>
              ) : (
                <Button disabled={!file} loading={busy === 'check'} onClick={() => run(true)}>Check file</Button>
              )}
            </>
          )}
        </div>
      )}
    >
      {issued ? (
        <div className="space-y-4">
          <p role="status" className="flex items-start gap-2 text-sm font-semibold text-warning-strong"><TriangleAlert size={18} className="mt-0.5 shrink-0" aria-hidden="true" /> {issued.length} member account{issued.length === 1 ? '' : 's'} created. These passwords are shown only once. Copy or download them before you leave.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" leftIcon={copied ? Check : Copy} onClick={copyAll}>{copied ? 'Copied' : 'Copy all'}</Button>
            <Button variant="secondary" leftIcon={Download} onClick={downloadCredentials}>Download CSV</Button>
          </div>
          <ul className="divide-y divide-line-soft rounded-control border border-line">
            {issued.map((item) => (
              <li key={item.school_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">{formatDisplayText(item.name)}</p>
                  <p className="truncate text-xs font-medium text-ink-muted">{item.email}</p>
                </div>
                <code className="font-mono text-sm text-ink">{item.temporary_password}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : (
      <div className="space-y-5">
        <div className="text-sm leading-6 text-ink-muted-strong">
          <p>Required columns: <span className="font-semibold text-ink">school_id, first_name, last_name, email, role</span>. Roles can be Student or SBO Officer; admin accounts are added one at a time. Write year_level as a number, such as 1.</p>
          <p className="mt-2">Passwords never go in the file. If email is off, you get a temporary password for each member after the import. Otherwise each member sets one with Forgot password, using the email you list.</p>
          <Button variant="secondary" className="mt-3" onClick={downloadTemplate}><Download size={15} aria-hidden="true" /> Download template</Button>
        </div>

        <div>
          <label htmlFor="member-import-file" className="text-[13px] font-medium text-ink">CSV file</label>
          <input
            id="member-import-file"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => { setFile(event.target.files?.[0] ?? null); setCheck(null); setError(''); }}
            className="mt-1.5 block w-full rounded-control border border-line bg-surface text-sm text-ink file:mr-3 file:h-11 file:border-0 file:bg-subtle file:px-4 file:text-sm file:font-semibold file:text-brand-700"
          />
        </div>

        {error && !check && <p role="alert" className="text-sm font-semibold text-danger-strong">{error}</p>}

        {check && (
          <section aria-label="File check" className="space-y-3">
            {ready ? (
              <p className="flex items-start gap-2 text-sm font-semibold text-success-strong"><CheckCircle2 size={18} className="mt-0.5 shrink-0" aria-hidden="true" /> All {check.summary.total} rows are ready to import.</p>
            ) : (
              <p className="flex items-start gap-2 text-sm font-semibold text-danger-strong"><TriangleAlert size={18} className="mt-0.5 shrink-0" aria-hidden="true" /> {check.summary.invalid} of {check.summary.total} rows need fixing. Nothing was imported. Correct the file and check it again.</p>
            )}
            {problems.length > 0 && (
              <ul className="divide-y divide-line-soft rounded-control border border-line">
                {problems.map((row) => (
                  <li key={row.row} className="px-3 py-2.5">
                    <p className="text-sm font-semibold text-ink">Row {row.row}{row.name ? `: ${formatDisplayText(row.name)}` : ''}</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs font-medium text-ink-muted">
                      {row.errors.map((message) => <li key={message}>{message}</li>)}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
      )}
    </Drawer>
  );
}
