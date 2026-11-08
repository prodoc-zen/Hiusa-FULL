import { formatDisplayText } from '../../../utils/displayText.js';
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, EmptyState, ErrorState, Input, SkeletonTable, StatusBadge } from '../../../components/ui';
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

          {loading && <SkeletonTable rows={5} columns={4} className="mx-4" />}
          {!loading && error && <ErrorState description={error} onRetry={load} />}
          {!loading && !error && students.length === 0 && (
            <EmptyState kind={q ? 'filtered' : 'first-run'} query={q} onClearFilters={() => setQ('')} title="No students in this period" description={q ? 'No student in this period matches this search.' : 'Opening a period adds a signature line for every active student. None are on this one yet.'} />
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
                <td data-label="Student" className={TD}><div><span className="block font-medium text-ink">{student.student_name || `Student ${student.student_id}`}</span><span className="block text-xs text-ink-muted">{student.student_id}</span></div></td>
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
    </Card>
  );
}
