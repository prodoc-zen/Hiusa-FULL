import { formatDisplayText } from '../../../utils/displayText.js';
import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { getElectionVoters } from '../../../services/electionService';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import HiusaSelect from '../../../components/ui/Select';
import StatusBadge from '../../../components/ui/StatusBadge';
import PaginationControls from '../../../components/PaginationControls';

const EMPTY_SUMMARY = { eligible_total: 0, voted_count: 0, turnout_percent: 0 };

function roleLabel(role) {
  const text = String(role || '').replaceAll('_', ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export default function ManageVotersPage() {
  const { election } = useOutletContext();
  const [voters, setVoters] = useState([]);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    setPage(1);
  }, [election]);

  useEffect(() => {
    if (!election) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        // The endpoint is paginated, so it answers with a Laravel paginator
        // envelope ({ data, total, per_page, ... }) plus an organization-wide
        // `summary`. The rows live under `data`; the headline counts must come
        // from `summary` because this page holds only one page of voters.
        const payload = await getElectionVoters(election.id, { page });
        if (cancelled) return;
        setVoters(Array.isArray(payload?.data) ? payload.data : []);
        setSummary({ ...EMPTY_SUMMARY, ...(payload?.summary ?? {}) });
        setPerPage(Number(payload?.per_page) || 10);
      } catch {
        if (!cancelled) {
          setVoters([]);
          setSummary(EMPTY_SUMMARY);
          setError('Failed to load voters.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [election, page, retryKey]);

  if (!election) {
    return (
      <EmptyState title="Election not found" description="Go back and choose an election." />
    );
  }

  const filtered = voters.filter((voter) => {
    const fullName = `${voter.first_name} ${voter.last_name}`.toLowerCase();
    const matchesSearch = fullName.includes(search.toLowerCase()) || String(voter.school_id || '').includes(search);
    const matchesFilter =
      filterStatus === 'All' ||
      (filterStatus === 'Voted' && voter.has_voted) ||
      (filterStatus === 'Not Yet' && !voter.has_voted);
    return matchesSearch && matchesFilter;
  });

  const eligibleTotal = summary.eligible_total;
  const votedCount = summary.voted_count;
  const notVotedCount = Math.max(0, eligibleTotal - votedCount);
  const filtersActive = Boolean(search) || filterStatus !== 'All';
  const clearFilters = () => { setSearch(''); setFilterStatus('All'); };

  const columns = [
    { key: 'name', header: 'Name', render: (voter) => <span className="font-medium">{formatDisplayText(voter.first_name)} {formatDisplayText(voter.last_name)}</span> },
    { key: 'school_id', header: 'School ID', render: (voter) => <span className="text-ink-muted-strong">{voter.school_id}</span> },
    { key: 'role', header: 'Role', render: (voter) => roleLabel(voter.role) },
    { key: 'email', header: 'Email', render: (voter) => <span className="break-all text-ink-muted-strong">{voter.email}</span> },
    { key: 'vote', header: 'Vote', render: (voter) => (voter.has_voted ? <StatusBadge label="Voted" tone="success" /> : <span className="text-ink-muted">Not yet</span>) },
  ];

  const filters = (
    <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end">
      <Field label="Search voters">
        <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or school ID" />
      </Field>
      <Field label="Vote">
        <HiusaSelect value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)}>
          <option value="All">All voters</option>
          <option value="Voted">Voted</option>
          <option value="Not Yet">Not yet voted</option>
        </HiusaSelect>
      </Field>
      {filtersActive && <button type="button" onClick={clearFilters} className="min-h-10 self-end rounded-control text-left text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">Clear</button>}
    </div>
  );

  const emptyState = eligibleTotal === 0
    ? <EmptyState title="No voters yet" description="No eligible voters are registered in this organization yet." />
    : (
      <EmptyState
        kind="filtered"
        title="No voters match"
        description={eligibleTotal > perPage ? 'Search and filters apply to the current page only.' : 'Try another search or vote status.'}
        onClearFilters={clearFilters}
      />
    );

  return (
    <div className="space-y-4">
      {!loading && !error && (
        <p className="text-sm text-ink-muted-strong">
          <span className="tabular-nums">{votedCount}</span> of <span className="tabular-nums">{eligibleTotal}</span> eligible {eligibleTotal === 1 ? 'voter has' : 'voters have'} voted ({summary.turnout_percent}% turnout). <span className="tabular-nums">{notVotedCount}</span> still to vote.
        </p>
      )}

      <DataTable
        caption={`Voters for ${formatDisplayText(election.title)}`}
        columns={columns}
        rows={filtered}
        rowKey={(voter) => voter.school_id}
        loading={loading}
        error={error}
        onRetry={() => setRetryKey((key) => key + 1)}
        filters={filters}
        filtersActive={filtersActive}
        onClearFilters={clearFilters}
        emptyState={emptyState}
        pagination={!loading && !error ? (
          <PaginationControls
            currentPage={page}
            totalItems={eligibleTotal}
            pageSize={perPage}
            onPageChange={setPage}
            label="voters"
          />
        ) : null}
      />
    </div>
  );
}
