import { useCallback, useEffect, useRef, useState } from 'react';
import { GraduationCap } from 'lucide-react';
import { Card, DataTable, EmptyState, Field, Input, Select, StatusBadge } from '../ui';
import StudentRecordsUpload from './StudentRecordsUpload';
import PaginationControls from '../PaginationControls';
import { getStudentRegistry } from '../../services/studentRegistryService';
import { getApiErrorMessage } from '../../utils/apiError';

const PAGE_SIZE = 20;

const TYPES = {
  student: { label: 'Students', one: 'Student', empty: 'No student records yet', all: 'All students' },
  employee: { label: 'Employees', one: 'Employee', empty: 'No employee records yet', all: 'All employees' },
};

export default function StudentRecordsPanel({ collegeId }) {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0 });
  const [summary, setSummary] = useState({ total: 0, claimed: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [claimed, setClaimed] = useState('');
  const [recordType, setRecordType] = useState('student');
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
        record_type: recordType,
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
  }, [page, query, claimed, recordType, collegeId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const clearFilters = () => {
    setSearch('');
    setQuery('');
    setClaimed('');
    setPage(1);
  };

  const filtersActive = Boolean(query || claimed);
  const type = TYPES[recordType];
  const isEmployee = recordType === 'employee';

  const tableColumns = [
    {
      key: 'person',
      header: type.one,
      render: (row) => (
        <span className="block min-w-0">
          <span className="block font-medium text-ink">{row.name}</span>
          <span className="block text-xs text-ink-muted">ID {row.school_id}</span>
        </span>
      ),
    },
    ...(collegeId ? [] : [{ key: 'college', header: 'College', render: (row) => row.college?.code }]),
    isEmployee
      ? { key: 'position', header: 'Position', render: (row) => row.position }
      : { key: 'program', header: 'Program', render: (row) => [row.program, row.year_level, row.section].filter(Boolean).join(', ') },
    {
      key: 'claimed',
      header: 'Account',
      render: (row) => (row.claimed
        ? <StatusBadge status="claimed" label={isEmployee ? 'Has account' : 'Signed up'} />
        : <span className="text-ink-muted">Not yet</span>),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Upload school records"
        description="Students are matched against these records when they sign up, and office staff are picked from them when you invite them. Birth dates are only used for that check and are never shown."
      >
        <StudentRecordsUpload collegeId={collegeId} onSaved={() => { setPage(1); load(); }} />
      </Card>

      <Card
        title={`${type.one} records`}
        description={summary.total > 0 ? `${summary.claimed} of ${summary.total} ${isEmployee ? 'have an account' : 'have signed up'}.` : 'No records loaded yet.'}
        bodyClassName="p-0"
      >
        <DataTable
          caption={`${type.one} records`}
          columns={tableColumns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          onRetry={load}
          filtersActive={filtersActive}
          onClearFilters={clearFilters}
          stickyHeader={false}
          filters={(
            <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-end">
              <Field label="Search" className="sm:flex-1">
                <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or school ID" />
              </Field>
              <Field label="Show" className="sm:w-40">
                <Select value={recordType} onChange={(event) => { setRecordType(event.target.value); setPage(1); }}>
                  {Object.entries(TYPES).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
                </Select>
              </Field>
              <Field label="Account" className="sm:w-48">
                <Select value={claimed} onChange={(event) => { setClaimed(event.target.value); setPage(1); }}>
                  <option value="">{type.all}</option>
                  <option value="claimed">Signed up</option>
                  <option value="unclaimed">Not yet</option>
                </Select>
              </Field>
              {filtersActive && (
                <button type="button" onClick={clearFilters} className="inline-flex min-h-11 items-center rounded-control text-sm font-medium text-brand-700 hover:underline sm:self-end">Clear</button>
              )}
            </div>
          )}
          emptyState={filtersActive ? undefined : (
            <EmptyState
              kind="first-run"
              icon={GraduationCap}
              title={type.empty}
              description={isEmployee
                ? 'Upload a CSV above with record_type set to employee. You can then invite office staff from these records.'
                : 'Upload a CSV above. Students whose school ID and birth date match a record can then create their own account.'}
            />
          )}
          pagination={<PaginationControls currentPage={page} totalItems={meta.total} pageSize={PAGE_SIZE} onPageChange={setPage} label={type.label.toLowerCase()} />}
        />
      </Card>
    </div>
  );
}
