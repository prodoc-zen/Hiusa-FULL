import { formatDisplayText } from '../../../utils/displayText.js';
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, EmptyState, ErrorState, Input, SelectAllCheckbox, SkeletonTable, StatusBadge } from '../../../components/ui';
import Modal from '../../../components/Modal';
import PaginationControls from '../../../components/PaginationControls';
import { getClearancePeriodStudents, updateClearanceSignature } from '../../../services/clearanceService';
import { listMeta, unwrapList } from '../../../services/pagination';
import notify from '../../../lib/notify';
import SignAction from './SignAction';
import { TABLE, TBODY, TD, TH, THEAD, TR } from '../sao/responsiveTable';
import { SAO_ROLE, clearanceStageText, clearanceStatusTone, humanizeRole } from './clearanceLabels';

export default function ClearancePeriodStudentsDrawer({ period, onClose, onSignatureChanged }) {
  const [students, setStudents] = useState([]);
  const [meta, setMeta] = useState({ total: 0, currentPage: 1, lastPage: 1, perPage: 20 });
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(() => {
    if (!period) return undefined;
    setLoading(true);
    setError(null);
    return getClearancePeriodStudents(period.id, { q: q || undefined, page })
      .then((res) => {
        setStudents(unwrapList(res.data));
        setMeta(listMeta(res.data));
      })
      .catch(() => setError('Failed to load students for this period.'))
      .finally(() => setLoading(false));
  }, [period, q, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [q, period]);

  async function handleSign(signatureId, status, remarks) {
    await updateClearanceSignature(signatureId, { status, remarks });
    notify.success(status === 'cleared' ? 'Signature cleared.' : status === 'pending' ? 'Clearance reopened.' : 'Signature put on hold.');
    load();
    onSignatureChanged?.();
  }

  function signatureFor(student, role) {
    return student.signatures.find((signature) => signature.required_role === role);
  }

  function signatureStatus(signature) {
    return signature ? <StatusBadge status={signature.status} tone={clearanceStatusTone(signature.status)} /> : <span className="text-xs text-ink-muted">Not required</span>;
  }

  // The roster is paged, so select all covers the pending SAO lines on this page; a selection never reaches a row the SAO cannot see.
  const selectablePendingIds = students.map((student) => signatureFor(student, SAO_ROLE)).filter((signature) => signature?.status === 'pending').map((signature) => signature.id);
  const selectedPendingIds = selectablePendingIds.filter((id) => selectedIds.has(id));

  function toggleAll(checked) {
    setSelectedIds(checked ? new Set(selectablePendingIds) : new Set());
  }

  function toggleRow(id) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function confirmBulkClear() {
    setBulkBusy(true);
    const ids = selectedPendingIds;
    const results = await Promise.allSettled(ids.map((id) => updateClearanceSignature(id, { status: 'cleared' })));
    const failed = results.map((result, index) => ({ result, id: ids[index] })).filter(({ result }) => result.status === 'rejected');
    const clearedCount = ids.length - failed.length;
    if (failed.length === 0) {
      notify.success(`Cleared ${clearedCount} signature${clearedCount === 1 ? '' : 's'}.`);
    } else {
      const reason = failed[0].result.reason?.response?.data?.message;
      notify.error(`Cleared ${clearedCount} of ${ids.length} signatures. ${failed.length} could not be cleared${reason ? `: ${reason}` : '.'} The roster is up to date, so you can try the rest again.`);
    }
    setSelectedIds(new Set(failed.map(({ id }) => id)));
    setBulkOpen(false);
    setBulkBusy(false);
    load();
    if (clearedCount > 0) onSignatureChanged?.();
  }

  function studentCheckbox(student) {
    const signature = signatureFor(student, SAO_ROLE);
    const name = student.student_name || `Student ${student.student_id}`;
    if (signature?.status === 'pending') {
      return (
        <label className="inline-flex min-h-11 min-w-11 items-center justify-center">
          <input type="checkbox" aria-label={`Select ${name} for bulk clear`} checked={selectedIds.has(signature.id)} onChange={() => toggleRow(signature.id)} className="h-5 w-5 accent-brand-700" />
        </label>
      );
    }
    return selectablePendingIds.length > 0 ? <span aria-hidden="true" className="hidden h-11 w-11 shrink-0 md:block" /> : null;
  }

  function saoAction(student) {
    const signature = signatureFor(student, SAO_ROLE);
    return signature ? <SignAction signatureId={signature.id} status={signature.status} remarks={signature.remarks} roleLabel={humanizeRole(SAO_ROLE)} showStatus={false} onSign={(status, remarks) => handleSign(signature.id, status, remarks)} /> : null;
  }

  return (
    <Card bodyClassName="p-0">
      {period && <div className="border-b border-line p-4"><Button variant="secondary" size="sm" onClick={onClose}>Back to periods</Button><h2 className="mt-3 text-base font-semibold text-ink">{formatDisplayText(period.title)}</h2><p className="text-sm text-ink-muted">{period.academic_year} · Student clearance roster</p></div>}
      {period && (
        <div className="flex flex-col gap-4">
          <div className="p-4"><Input type="search" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Name or school ID" aria-label="Search students" /></div>

          {!loading && !error && selectablePendingIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-4">
              <SelectAllCheckbox label={`Select all pending (${selectablePendingIds.length})`} selected={selectedPendingIds.length} total={selectablePendingIds.length} onChange={toggleAll} />
              {selectedPendingIds.length > 0 && <Button size="sm" onClick={() => setBulkOpen(true)}>Clear {selectedPendingIds.length} selected</Button>}
            </div>
          )}

          {loading && <SkeletonTable rows={5} columns={4} className="mx-4" />}
          {!loading && error && <ErrorState description={error} onRetry={load} />}
          {!loading && !error && students.length === 0 && (
            <EmptyState kind={q ? 'filtered' : 'first-run'} query={q} onClearFilters={() => setQ('')} title="No students in this period" description={q ? 'No student in this period matches this search.' : 'Opening a period adds a signature line for every active student.'} />
          )}

          {!loading && !error && students.length > 0 && <div className="border-y border-line">
            <table className={TABLE}>
              <caption className="sr-only">Student clearance signatures</caption>
              <thead className={THEAD}><tr>
                <th scope="col" className={TH}>Student</th>
                <th scope="col" className={TH}>Progress</th>
                {(period.required_roles || []).map((role) => <th scope="col" key={role} className={TH}>{humanizeRole(role)}</th>)}
                <th scope="col" className={`${TH} text-right`}>Actions</th>
              </tr></thead>
              <tbody className={TBODY}>{students.map((student) => <tr key={student.student_id} className={TR}>
                <td data-label="Student" className={TD}><div className="flex items-center gap-1">{studentCheckbox(student)}<div><span className="block font-medium text-ink">{student.student_name || `Student ${student.student_id}`}</span><span className="block text-xs text-ink-muted">{student.student_id}</span></div></div></td>
                <td data-label="Progress" className={TD}><div><span className="block text-ink">{student.signatures.filter((signature) => signature.status === 'cleared').length} of {student.signatures.length}</span><span className="block text-xs text-ink-muted">{clearanceStageText(student)}</span></div></td>
                {(period.required_roles || []).map((role) => <td key={role} data-label={humanizeRole(role)} className={TD}>{signatureStatus(signatureFor(student, role))}</td>)}
                <td data-label="Actions" className={`${TD} md:text-right`}>{saoAction(student)}</td>
              </tr>)}</tbody>
            </table>
          </div>}

          {!loading && !error && students.length > 0 && (
            <div className="p-4"><PaginationControls currentPage={meta.currentPage} totalItems={meta.total} pageSize={meta.perPage} onPageChange={setPage} label="students" /></div>
          )}
        </div>
      )}
      <Modal
        open={bulkOpen}
        title="Clear selected signatures"
        description={`Clear ${selectedPendingIds.length} pending signature${selectedPendingIds.length === 1 ? '' : 's'}? Every student affected will be notified.`}
        onClose={bulkBusy ? undefined : () => setBulkOpen(false)}
        maxWidth="max-w-md"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setBulkOpen(false)} disabled={bulkBusy}>Cancel</Button>
            <Button onClick={confirmBulkClear} loading={bulkBusy}>Clear selected</Button>
          </>
        )}
      />
    </Card>
  );
}
