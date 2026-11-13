import { formatDisplayText, humanizeIdentifier } from '../../../utils/displayText.js';
import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { getElectionVoters } from '../../../services/electionService';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import SegmentedControl from '../../../components/ui/SegmentedControl';
import HiusaSelect from '../../../components/ui/Select';
import StatusBadge from '../../../components/ui/StatusBadge';
import PaginationControls from '../../../components/PaginationControls';

const EMPTY_SUMMARY = { eligible_total: 0, voted_count: 0, turnout_percent: 0 };

export default function ManageVotersPage() {
  const { election } = useOutletContext();
  const [voters, setVoters] = useState([]);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');
  const [round, setRound] = useState(1);
  const [total, setTotal] = useState(0);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    setPage(1);
    setRound(1);
  }, [election?.id]);

  useEffect(() => {
    setPage(1);
  }, [election]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filterStatus, round]);

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
        // Search and the vote filter run on the server, so `total` is the
        // filtered count while `summary` stays the whole election's.
        const payload = await getElectionVoters(election.id, {
          page,
          ...(round === 2 ? { round: 2 } : {}),
          ...(debouncedSearch ? { search: debouncedSearch } : {}),
          ...(filterStatus !== 'All' ? { vote: filterStatus === 'Voted' ? 'voted' : 'not_voted' } : {}),
        });
        if (cancelled) return;
        setVoters(Array.isArray(payload?.data) ? payload.data : []);
        setSummary({ ...EMPTY_SUMMARY, ...(payload?.summary ?? {}) });
        setTotal(Number(payload?.total) || 0);
        setPerPage(Number(payload?.per_page) || 10);
      } catch {
        if (!cancelled) {
          setVoters([]);
          setSummary(EMPTY_SUMMARY);
          setTotal(0);
          setError('Failed to load voters.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [election, page, round, debouncedSearch, filterStatus, retryKey]);

  if (!election) {
    return (
      <EmptyState title="Election not found" description="Go back and choose an election." />
    );
  }

  const hasRunoff = Boolean(election.runoff_starts_at);
  const eligibleTotal = summary.eligible_total;
  const votedCount = summary.voted_count;
  const notVotedCount = Math.max(0, eligibleTotal - votedCount);
  const filtersActive = Boolean(search) || filterStatus !== 'All';
  const clearFilters = () => { setSearch(''); setFilterStatus('All'); };

  const columns = [
    { key: 'name', header: 'Name', render: (voter) => <span className="font-medium">{formatDisplayText(voter.first_name)} {formatDisplayText(voter.last_name)}</span> },
    { key: 'school_id', header: 'School ID', render: (voter) => <span className="text-ink-muted-strong">{voter.school_id}</span> },
    { key: 'role', header: 'Role', render: (voter) => humanizeIdentifier(voter.role) },
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
        description="Try another search or vote status."
        onClearFilters={clearFilters}
      />
    );

  return (
    <div className="space-y-4">
      {hasRunoff && (
        <SegmentedControl
          options={[{ value: 1, label: 'First round' }, { value: 2, label: 'Runoff' }]}
          value={round}
          onChange={setRound}
        />
      )}

      {!loading && !error && (
        <p className="text-sm text-ink-muted-strong">
          <span className="tabular-nums">{votedCount}</span> of <span className="tabular-nums">{eligibleTotal}</span> eligible {eligibleTotal === 1 ? 'voter has' : 'voters have'} voted ({summary.turnout_percent}% turnout). <span className="tabular-nums">{notVotedCount}</span> still to vote.
        </p>
      )}

      <DataTable
        caption={`Voters for ${formatDisplayText(election.title)}`}
        columns={columns}
        rows={voters}
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
            totalItems={total}
            pageSize={perPage}
            onPageChange={setPage}
            label="voters"
          />
        ) : null}
      />
    </div>
  );
}
