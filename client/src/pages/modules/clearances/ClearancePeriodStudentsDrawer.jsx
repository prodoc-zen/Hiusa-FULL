import { useCallback, useEffect, useState } from 'react';
import { Drawer, EmptyState, ErrorState, Input, SkeletonText, StatusBadge } from '../../../components/ui';
import PaginationControls from '../../../components/PaginationControls';
import { getClearancePeriodStudents, updateClearanceSignature } from '../../../services/clearanceService';
import { listMeta, unwrapList } from '../../../services/pagination';
import notify from '../../../lib/notify';
import SignAction from './SignAction';
import { SAO_ROLE, clearanceStatusTone, humanizeRole } from './clearanceLabels';

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

  return (
    <Drawer open={Boolean(period)} title={period?.title} description={period ? `${period.academic_year} · SAO signature line` : undefined} onClose={onClose} width="max-w-lg">
      {period && (
        <div className="flex flex-col gap-4">
          <Input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search by name or school ID..." aria-label="Search students" />

          {loading && <SkeletonText lines={6} />}
          {!loading && error && <ErrorState description={error} onRetry={load} />}
          {!loading && !error && students.length === 0 && (
            <EmptyState kind={q ? 'filtered' : 'first-run'} query={q} title="No students found" description="No active student matches this search." />
          )}

          {!loading && !error && students.map((student) => (
            <div key={student.student_id} className="rounded-card border border-line p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-ink">{student.student_name || `Student ${student.student_id}`}</p>
                  <p className="text-xs font-medium text-ink-muted">{student.student_id}</p>
                </div>
                {student.is_complete && <StatusBadge tone="success" label="All cleared" />}
              </div>
              <div className="mt-2 flex flex-col gap-2">
                {student.signatures.map((signature) => (
                  signature.required_role === SAO_ROLE ? (
                    <div key={signature.id} className="flex items-center justify-between gap-2 border-t border-line-soft pt-2 first:border-t-0 first:pt-0">
                      <span className="text-xs font-semibold text-ink-muted">{humanizeRole(signature.required_role)}</span>
                      <SignAction
                        signatureId={signature.id}
                        status={signature.status}
                        roleLabel={humanizeRole(signature.required_role)}
                        onSign={(status, remarks) => handleSign(signature.id, status, remarks)}
                      />
                    </div>
                  ) : (
                    <div key={signature.id} className="flex items-center justify-between gap-2 border-t border-line-soft pt-2 first:border-t-0 first:pt-0">
                      <span className="text-xs font-semibold text-ink-muted">{humanizeRole(signature.required_role)}</span>
                      <StatusBadge status={signature.status} tone={clearanceStatusTone(signature.status)} />
                    </div>
                  )
                ))}
              </div>
            </div>
          ))}

          {!loading && !error && students.length > 0 && (
            <PaginationControls currentPage={meta.currentPage} totalItems={meta.total} pageSize={meta.perPage} onPageChange={setPage} label="students" />
          )}
        </div>
      )}
    </Drawer>
  );
}
