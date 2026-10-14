import { formatDisplayText } from '../../../utils/displayText.js';
import { useCallback, useEffect, useState } from 'react';
import { Drawer, EmptyState, ErrorState, Input, SkeletonText, StatusBadge } from '../../../components/ui';
import PaginationControls from '../../../components/PaginationControls';
import { getClearancePeriodStudents, updateClearanceSignature } from '../../../services/clearanceService';
import { listMeta, unwrapList } from '../../../services/pagination';
import notify from '../../../lib/notify';
import SignAction from './SignAction';
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
    notify.success(status === 'cleared' ? 'Signature cleared.' : 'Signature put on hold.');
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
    <Drawer open={Boolean(period)} title={formatDisplayText(period?.title)} description={period ? `${period.academic_year} · SAO signature line` : undefined} onClose={onClose} width="max-w-5xl">
      {period && (
        <div className="flex flex-col gap-4">
          <Input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search by name or school ID..." aria-label="Search students" />

          {loading && <SkeletonText lines={6} />}
          {!loading && error && <ErrorState description={error} onRetry={load} />}
          {!loading && !error && students.length === 0 && (
            <EmptyState kind={q ? 'filtered' : 'first-run'} query={q} onClearFilters={() => setQ('')} title="No students in this period" description={q ? 'No student in this period matches this search.' : 'Opening a period adds a signature line for every active student. None are on this one yet.'} />
          )}

          {!loading && !error && students.length > 0 && <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[650px] text-left text-sm">
              <caption className="sr-only">Student clearance signatures</caption>
              <thead className="bg-subtle text-xs font-bold text-ink-muted"><tr>
                <th scope="col" className="px-3 py-3">Student</th>
                <th scope="col" className="px-3 py-3">Progress</th>
                {(period.required_roles || []).map((role) => <th scope="col" key={role} className="px-3 py-3">{humanizeRole(role)}</th>)}
                <th scope="col" className="px-3 py-3 text-right">Actions</th>
              </tr></thead>
              <tbody className="divide-y divide-line">{students.map((student) => <tr key={student.student_id} className="align-middle">
                <td className="px-3 py-3"><span className="block font-bold text-ink">{student.student_name || `Student ${student.student_id}`}</span><span className="text-xs text-ink-muted">{student.student_id}</span></td>
                <td className="px-3 py-3"><span className="font-semibold text-ink">{student.signatures.filter((signature) => signature.status === 'cleared').length} of {student.signatures.length}</span><span className="block text-xs text-ink-muted">{clearanceStageText(student)}</span></td>
                {(period.required_roles || []).map((role) => <td key={role} className="px-3 py-3">{signatureStatus(signatureFor(student, role))}</td>)}
                <td className="px-3 py-3 text-right">{saoAction(student)}</td>
              </tr>)}</tbody>
            </table>
          </div>}

          {!loading && !error && students.length > 0 && (
            <PaginationControls currentPage={meta.currentPage} totalItems={meta.total} pageSize={meta.perPage} onPageChange={setPage} label="students" />
          )}
        </div>
      )}
    </Drawer>
  );
}
