import { useState } from 'react';
import {
  Award,
  BarChart3,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileText,
  Plus,
  Search,
  Shield,
  ShieldCheck,
  Timer,
  TrendingUp,
  UserPlus,
  Users,
  Vote,
  X,
} from 'lucide-react';

/* ── Mock Data ──────────────────────────────────── */

const votingStats = [
  { label: 'Eligible Voters', value: '1,500', helper: 'Verified voter list', tone: 'blue', icon: Users },
  { label: 'Votes Cast', value: '978', helper: '65.2% turnout', tone: 'green', icon: Vote },
  { label: 'Election Window', value: '1d 4h', helper: 'Remaining time', tone: 'amber', icon: Timer },
  { label: 'Flagged Attempts', value: '0', helper: 'Duplicate vote checks', tone: 'red', icon: Shield },
];

const toneClasses = {
  blue: { card: 'border-[#0B8ED0]/20', icon: 'bg-[#E6F6FD] text-[#0B8ED0]', badge: 'bg-[#E6F6FD] text-[#0B8ED0]' },
  green: { card: 'border-emerald-200', icon: 'bg-emerald-50 text-emerald-600', badge: 'bg-emerald-50 text-emerald-700' },
  amber: { card: 'border-amber-200', icon: 'bg-amber-50 text-amber-600', badge: 'bg-amber-50 text-amber-700' },
  red: { card: 'border-red-200', icon: 'bg-red-50 text-red-600', badge: 'bg-red-50 text-red-700' },
};

const elections = [
  { name: 'SSC General Elections 2026', status: 'Active', start: '2026-06-22 08:00', end: '2026-06-24 17:00', positions: 6, candidates: 18, voters: 1500 },
  { name: 'College Representatives Election', status: 'Draft', start: '2026-07-10 08:00', end: '2026-07-12 17:00', positions: 4, candidates: 0, voters: 800 },
  { name: 'Department Officers 2025', status: 'Closed', start: '2025-12-01 08:00', end: '2025-12-03 17:00', positions: 5, candidates: 15, voters: 1200 },
];

const electionStatusBadge = {
  Active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Draft: 'bg-amber-50 text-amber-700 border-amber-200',
  Closed: 'bg-slate-100 text-slate-500 border-slate-200',
};

const candidates = [
  { name: 'Alyssa Mariano', position: 'President', party: 'Forward HIUSA', votes: 382, status: 'Approved', platform: 'Transparency, digital innovation, inclusive governance' },
  { name: 'Daniel Reyes', position: 'President', party: 'Student First', votes: 341, status: 'Approved', platform: 'Student welfare, academic support, sustainability' },
  { name: 'Mika Santos', position: 'Vice President', party: 'Forward HIUSA', votes: 415, status: 'Approved', platform: 'Community engagement, event reform, officer accountability' },
  { name: 'Carlo Lim', position: 'Secretary', party: 'Independent', votes: 296, status: 'Approved', platform: 'Record transparency, meeting efficiency, digital archives' },
  { name: 'James Cruz', position: 'Treasurer', party: 'Student First', votes: 310, status: 'Approved', platform: 'Budget clarity, audit automation, expense tracking' },
  { name: 'Sofia Tan', position: 'PRO', party: 'Forward HIUSA', votes: 275, status: 'Pending', platform: 'Social media outreach, branding, event marketing' },
];

const candidateStatusBadge = {
  Approved: 'bg-emerald-50 text-emerald-700',
  Pending: 'bg-amber-50 text-amber-700',
  Rejected: 'bg-red-50 text-red-700',
};

const positions = ['President', 'Vice President', 'Secretary', 'Treasurer', 'PRO', 'Auditor'];

const positionResults = positions.map((pos) => {
  const positionCandidates = candidates.filter(c => c.position === pos);
  const totalVotes = positionCandidates.reduce((sum, c) => sum + c.votes, 0);
  return { position: pos, candidates: positionCandidates, totalVotes };
}).filter(p => p.candidates.length > 0);

const voterList = [
  { id: 'STU-2026-001', name: 'Ana Garcia', year: '3rd Year', section: 'CS-3A', hasVoted: true },
  { id: 'STU-2026-002', name: 'Ben Torres', year: '2nd Year', section: 'IT-2B', hasVoted: true },
  { id: 'STU-2026-003', name: 'Clara Dela Cruz', year: '4th Year', section: 'CS-4A', hasVoted: false },
  { id: 'STU-2026-004', name: 'David Lim', year: '1st Year', section: 'IT-1A', hasVoted: true },
  { id: 'STU-2026-005', name: 'Eva Mendoza', year: '3rd Year', section: 'CS-3B', hasVoted: false },
  { id: 'STU-2026-006', name: 'Franco Reyes', year: '2nd Year', section: 'CS-2A', hasVoted: true },
];

const securityFeatures = [
  { label: 'One Student, One Vote', desc: 'Duplicate vote prevention with ID verification', icon: ShieldCheck },
  { label: 'Election Period Lock', desc: 'Voting only allowed within the designated time window', icon: Timer },
  { label: 'Tamper-Proof Tallying', desc: 'Secure, auditable vote counting with checksums', icon: CheckCircle2 },
  { label: 'Voter Anonymity', desc: 'Ballot choices are not linked to voter identity', icon: Shield },
];

const electionChecklist = [
  { text: 'Candidate filing and approval', done: true },
  { text: 'Voter eligibility sync', done: true },
  { text: 'Secure ballot preview & testing', done: true },
  { text: 'Election period configuration', done: true },
  { text: 'Real-time monitoring dashboard', done: false },
  { text: 'Result release after voting closes', done: false },
];

/* ── Components ─────────────────────────────────── */

export default function ElectionsPage() {
  const [activeTab, setActiveTab] = useState('setup');
  const [showElectionForm, setShowElectionForm] = useState(false);
  const [showCandidateForm, setShowCandidateForm] = useState(false);

  const tabs = [
    { key: 'setup', label: 'Set Up Elections', icon: FileText },
    { key: 'candidates', label: 'Manage Candidates', icon: UserPlus },
    { key: 'results', label: 'View Results', icon: BarChart3 },
  ];

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {votingStats.map((stat) => {
          const tone = toneClasses[stat.tone];
          return (
            <article
              key={stat.label}
              className={`group rounded-xl border bg-white p-5 shadow-sm transition hover:shadow-md ${tone.card}`}
            >
              <div className="mb-3 flex items-center justify-between">
                <div className={`grid h-10 w-10 place-items-center rounded-lg transition ${tone.icon}`}>
                  <stat.icon size={19} />
                </div>
              </div>
              <p className="text-sm font-semibold text-slate-500">{stat.label}</p>
              <p className="mt-1 text-2xl font-black text-[#0F172A]">{stat.value}</p>
              <span className={`mt-3 inline-flex rounded-full px-3 py-1 text-xs font-bold ${tone.badge}`}>
                {stat.helper}
              </span>
            </article>
          );
        })}
      </section>

      {/* Tab navigation */}
      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-bold transition-all ${
              activeTab === tab.key
                ? 'bg-[#0B8ED0] text-white shadow-lg shadow-[#0B8ED0]/20'
                : 'bg-white text-slate-600 border border-[#DDE7EF] hover:bg-[#EEF6FB]'
            }`}
          >
            <tab.icon size={15} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ━━━ TAB: Set Up Elections ━━━ */}
      {activeTab === 'setup' && (
        <div className="space-y-4">
          <section className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-[#DDE7EF] p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-bold text-[#0F172A]">Elections</h2>
                <p className="text-sm font-medium text-slate-500">Create and manage election periods</p>
              </div>
              <button
                onClick={() => setShowElectionForm(true)}
                className="flex h-10 items-center gap-2 rounded-lg bg-[#0B8ED0] px-4 text-[13px] font-bold text-white hover:bg-[#0878B7] transition"
              >
                <Plus size={16} />
                Create Election
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left">
                <thead className="bg-[#F8FBFD] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Election</th>
                    <th className="px-5 py-3">Period</th>
                    <th className="px-5 py-3">Positions</th>
                    <th className="px-5 py-3">Candidates</th>
                    <th className="px-5 py-3">Voters</th>
                    <th className="px-5 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5EDF3] text-sm">
                  {elections.map((el) => (
                    <tr key={el.name} className="transition hover:bg-[#F8FBFD]">
                      <td className="px-5 py-4 font-bold text-[#0F172A]">{el.name}</td>
                      <td className="px-5 py-4 font-medium text-slate-600">
                        <div className="flex items-center gap-1.5">
                          <Clock size={13} className="text-slate-400" />
                          <span className="text-xs">{el.start} — {el.end}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 font-bold text-[#0F172A]">{el.positions}</td>
                      <td className="px-5 py-4 font-bold text-[#0F172A]">{el.candidates}</td>
                      <td className="px-5 py-4 font-bold text-[#0F172A]">{el.voters.toLocaleString()}</td>
                      <td className="px-5 py-4">
                        <span className={`rounded-full border px-3 py-1 text-xs font-bold ${electionStatusBadge[el.status]}`}>
                          {el.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Security & Checklist side-by-side */}
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
              <h3 className="text-base font-bold text-[#0F172A] mb-4">Voting Security</h3>
              <div className="space-y-3">
                {securityFeatures.map(({ label, desc, icon: Icon }) => (
                  <div key={label} className="flex items-start gap-3 rounded-lg bg-[#F8FBFD] p-3.5">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#E6F6FD] text-[#0B8ED0]">
                      <Icon size={17} />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-[#0F172A]">{label}</p>
                      <p className="text-xs font-medium text-slate-500">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
              <h3 className="text-base font-bold text-[#0F172A] mb-4">Election Checklist</h3>
              <div className="space-y-3">
                {electionChecklist.map((item) => (
                  <div key={item.text} className="flex items-center gap-3">
                    <div className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${item.done ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                      <CheckCircle2 size={14} />
                    </div>
                    <span className={`text-sm font-medium ${item.done ? 'text-[#0F172A]' : 'text-slate-400'}`}>
                      {item.text}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-5 rounded-lg bg-[#E6F6FD] p-3.5">
                <p className="text-sm font-bold text-[#0878B7]">4 of 6 steps completed</p>
                <div className="mt-2 h-2 rounded-full bg-[#0B8ED0]/20 overflow-hidden">
                  <div className="h-full w-[66%] rounded-full bg-gradient-to-r from-[#0B8ED0] to-[#16C7F3]" />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ━━━ TAB: Manage Candidates ━━━ */}
      {activeTab === 'candidates' && (
        <div className="space-y-4">
          <section className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-[#DDE7EF] p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-bold text-[#0F172A]">Candidates</h2>
                <p className="text-sm font-medium text-slate-500">Manage candidate profiles and approvals</p>
              </div>
              <div className="flex gap-2">
                <div className="flex h-10 items-center gap-2 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-3">
                  <Search size={15} className="text-slate-400" />
                  <input type="text" placeholder="Search candidates..." className="w-[150px] bg-transparent text-[13px] outline-none placeholder:text-slate-400" />
                </div>
                <button
                  onClick={() => setShowCandidateForm(true)}
                  className="flex h-10 items-center gap-2 rounded-lg bg-[#0B8ED0] px-4 text-[13px] font-bold text-white hover:bg-[#0878B7] transition"
                >
                  <UserPlus size={16} />
                  <span className="hidden sm:inline">Add Candidate</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left">
                <thead className="bg-[#F8FBFD] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Candidate</th>
                    <th className="px-5 py-3">Position</th>
                    <th className="px-5 py-3">Party</th>
                    <th className="px-5 py-3">Platform</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5EDF3] text-sm">
                  {candidates.map((c) => (
                    <tr key={`${c.position}-${c.name}`} className="transition hover:bg-[#F8FBFD]">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#0B8ED0] to-[#16C7F3] text-xs font-black text-white">
                            {c.name.split(' ').map(n => n[0]).join('')}
                          </div>
                          <span className="font-bold text-[#0F172A]">{c.name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 font-medium text-slate-600">{c.position}</td>
                      <td className="px-5 py-4">
                        <span className="rounded-full bg-[#F8FBFD] border border-[#DDE7EF] px-2.5 py-1 text-xs font-bold text-slate-600">
                          {c.party}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-xs font-medium text-slate-500 max-w-[200px] truncate">{c.platform}</td>
                      <td className="px-5 py-4">
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${candidateStatusBadge[c.status]}`}>
                          {c.status}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex gap-2">
                          {c.status === 'Pending' && (
                            <>
                              <button className="rounded-md bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition">
                                Approve
                              </button>
                              <button className="rounded-md bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-100 transition">
                                Reject
                              </button>
                            </>
                          )}
                          <button className="rounded-md bg-[#F8FBFD] border border-[#DDE7EF] px-3 py-1.5 text-xs font-bold text-slate-500 hover:bg-[#EEF6FB] transition">
                            <Eye size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Candidate cards by position */}
          <section>
            <h3 className="mb-4 text-base font-bold text-[#0F172A]">Candidates by Position</h3>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {positions.map((pos) => {
                const posCandidates = candidates.filter(c => c.position === pos);
                if (posCandidates.length === 0) return null;
                return (
                  <div key={pos} className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
                    <div className="mb-3 flex items-center justify-between">
                      <h4 className="text-sm font-bold text-[#0F172A]">{pos}</h4>
                      <span className="rounded-full bg-[#E6F6FD] px-2.5 py-0.5 text-[11px] font-bold text-[#0B8ED0]">
                        {posCandidates.length} candidate{posCandidates.length > 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="space-y-2.5">
                      {posCandidates.map((c) => (
                        <div key={c.name} className="flex items-start gap-3 rounded-lg bg-[#F8FBFD] p-3">
                          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#0B8ED0] to-[#16C7F3] text-[10px] font-black text-white">
                            {c.name.split(' ').map(n => n[0]).join('')}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-[#0F172A]">{c.name}</p>
                            <p className="text-[11px] font-medium text-slate-400">{c.party}</p>
                            <p className="mt-1 text-[11px] font-medium text-slate-500 line-clamp-2">{c.platform}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {/* ━━━ TAB: View Results ━━━ */}
      {activeTab === 'results' && (
        <div className="space-y-4">
          {/* Turnout card */}
          <div className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-bold text-[#0F172A]">SSC General Elections 2026 — Live Results</h2>
                <p className="text-sm font-medium text-slate-500">Results update in real-time during the voting period</p>
              </div>
              <div className="flex gap-2">
                <button className="flex h-10 items-center gap-2 rounded-lg border border-[#DDE7EF] px-4 text-[13px] font-bold text-slate-600 hover:bg-[#EEF6FB] transition">
                  <Download size={15} />
                  Export
                </button>
                <button className="flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-[13px] font-bold text-white hover:bg-emerald-700 transition">
                  <Award size={15} />
                  Publish Results
                </button>
              </div>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg bg-[#F8FBFD] p-4">
                <p className="text-sm font-semibold text-slate-500">Total Votes Cast</p>
                <p className="mt-1 text-2xl font-black text-[#0F172A]">978</p>
              </div>
              <div className="rounded-lg bg-[#F8FBFD] p-4">
                <p className="text-sm font-semibold text-slate-500">Voter Turnout</p>
                <p className="mt-1 text-2xl font-black text-[#0B8ED0]">65.2%</p>
              </div>
              <div className="rounded-lg bg-[#F8FBFD] p-4">
                <p className="text-sm font-semibold text-slate-500">Time Remaining</p>
                <p className="mt-1 text-2xl font-black text-amber-600">1d 4h</p>
              </div>
            </div>
          </div>

          {/* Results by position */}
          <section className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
            <div className="border-b border-[#DDE7EF] p-5">
              <h2 className="text-lg font-bold text-[#0F172A]">Results by Position</h2>
              <p className="text-sm font-medium text-slate-500">Real-time vote tally and progress bars</p>
            </div>

            <div className="divide-y divide-[#E5EDF3]">
              {positionResults.map(({ position, candidates: posCands, totalVotes }) => (
                <div key={position} className="p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-base font-bold text-[#0F172A]">{position}</h3>
                    <span className="text-xs font-bold text-slate-400">{totalVotes} total votes</span>
                  </div>
                  <div className="space-y-3">
                    {posCands.sort((a, b) => b.votes - a.votes).map((c, i) => {
                      const pct = totalVotes > 0 ? ((c.votes / totalVotes) * 100).toFixed(1) : 0;
                      const isLeading = i === 0;
                      return (
                        <div key={c.name} className="flex items-center gap-4">
                          <div className="flex items-center gap-3 w-[180px] shrink-0">
                            <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-black text-white ${isLeading ? 'bg-gradient-to-br from-emerald-500 to-emerald-600' : 'bg-gradient-to-br from-[#0B8ED0] to-[#16C7F3]'}`}>
                              {c.name.split(' ').map(n => n[0]).join('')}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-[#0F172A] truncate">{c.name}</p>
                              <p className="text-[11px] font-medium text-slate-400">{c.party}</p>
                            </div>
                          </div>
                          <div className="flex-1">
                            <div className="h-7 rounded-lg bg-[#F8FBFD] overflow-hidden">
                              <div
                                className={`h-full rounded-lg transition-all duration-700 flex items-center px-3 text-xs font-bold text-white ${isLeading ? 'bg-gradient-to-r from-emerald-500 to-emerald-600' : 'bg-gradient-to-r from-[#0B8ED0] to-[#16C7F3]'}`}
                                style={{ width: `${Math.max(pct, 8)}%` }}
                              >
                                {pct}%
                              </div>
                            </div>
                          </div>
                          <div className="w-[70px] shrink-0 text-right">
                            <span className="text-sm font-black text-[#0F172A]">{c.votes}</span>
                          </div>
                          <div className="w-[70px] shrink-0">
                            {isLeading ? (
                              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700 flex items-center gap-1 w-fit">
                                <TrendingUp size={10} /> Leading
                              </span>
                            ) : (
                              <span className="rounded-full bg-[#E6F6FD] px-2.5 py-1 text-[10px] font-bold text-[#0B8ED0]">
                                Active
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Voter eligibility and ballot preview side-by-side */}
          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            {/* Voter eligibility list */}
            <div className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-[#DDE7EF] p-5">
                <div>
                  <h3 className="text-base font-bold text-[#0F172A]">Voter Eligibility</h3>
                  <p className="text-sm font-medium text-slate-500">Verified list of eligible voters</p>
                </div>
                <div className="flex h-9 items-center gap-2 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-3">
                  <Search size={14} className="text-slate-400" />
                  <input type="text" placeholder="Search voters..." className="w-[120px] bg-transparent text-[12px] outline-none placeholder:text-slate-400" />
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[500px] text-left">
                  <thead className="bg-[#F8FBFD] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-5 py-3">Student ID</th>
                      <th className="px-5 py-3">Name</th>
                      <th className="px-5 py-3">Year / Section</th>
                      <th className="px-5 py-3">Voted</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5EDF3] text-sm">
                    {voterList.map((v) => (
                      <tr key={v.id} className="transition hover:bg-[#F8FBFD]">
                        <td className="px-5 py-3 font-mono text-xs font-bold text-slate-500">{v.id}</td>
                        <td className="px-5 py-3 font-semibold text-[#0F172A]">{v.name}</td>
                        <td className="px-5 py-3 font-medium text-slate-600">{v.year} · {v.section}</td>
                        <td className="px-5 py-3">
                          {v.hasVoted ? (
                            <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-600">
                              <CheckCircle2 size={14} /> Yes
                            </span>
                          ) : (
                            <span className="text-xs font-bold text-slate-400">Not yet</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Ballot preview */}
            <div className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-[#E6F6FD] text-[#0B8ED0]">
                  <FileText size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#0F172A]">Ballot Preview</h3>
                  <p className="text-xs font-medium text-slate-500">Preview the voter's ballot experience</p>
                </div>
              </div>

              <div className="rounded-lg border border-dashed border-[#DDE7EF] bg-[#F8FBFD] p-5">
                <p className="text-center text-xs font-bold uppercase tracking-widest text-[#0B8ED0] mb-4">
                  Official Ballot — SSC Elections 2026
                </p>
                {positions.slice(0, 3).map((pos) => {
                  const posCands = candidates.filter(c => c.position === pos);
                  if (posCands.length === 0) return null;
                  return (
                    <div key={pos} className="mb-4">
                      <p className="text-xs font-bold text-slate-600 mb-2">{pos}</p>
                      <div className="space-y-1.5">
                        {posCands.map((c) => (
                          <label key={c.name} className="flex items-center gap-3 rounded-md bg-white border border-[#DDE7EF] p-2.5 cursor-pointer hover:border-[#0B8ED0]/30 transition">
                            <div className="h-4 w-4 rounded-full border-2 border-[#DDE7EF]" />
                            <span className="text-sm font-semibold text-[#0F172A]">{c.name}</span>
                            <span className="text-[11px] font-medium text-slate-400">({c.party})</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
                <p className="text-center text-[11px] font-medium text-slate-400 mt-4">
                  This is a preview. Actual ballot is only accessible during voting period.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ━━━ Create Election Modal ━━━ */}
      {showElectionForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#0F172A]">Create Election</h2>
              <button onClick={() => setShowElectionForm(false)} className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-[#EEF6FB]"><X size={18} /></button>
            </div>
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setShowElectionForm(false); }}>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Election Name</label>
                <input type="text" placeholder="e.g. SSC General Elections 2026" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Description</label>
                <textarea rows={3} placeholder="Election details..." className="w-full rounded-lg border border-[#DDE7EF] px-3 py-2.5 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Start Date & Time</label>
                  <input type="datetime-local" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">End Date & Time</label>
                  <input type="datetime-local" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Positions to Fill</label>
                <div className="flex flex-wrap gap-2">
                  {positions.map((pos) => (
                    <label key={pos} className="flex items-center gap-2 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-3 py-2 cursor-pointer hover:border-[#0B8ED0]/30 transition">
                      <input type="checkbox" defaultChecked className="rounded border-slate-300 text-[#0B8ED0]" />
                      <span className="text-xs font-bold text-slate-600">{pos}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Voter Eligibility</label>
                <div className="grid grid-cols-2 gap-2">
                  {['All Students', '1st Year', '2nd Year', '3rd Year', '4th Year', 'Officers Only'].map((opt) => (
                    <label key={opt} className="flex items-center gap-2 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-3 py-2 cursor-pointer hover:border-[#0B8ED0]/30 transition">
                      <input type="checkbox" defaultChecked={opt === 'All Students'} className="rounded border-slate-300 text-[#0B8ED0]" />
                      <span className="text-xs font-bold text-slate-600">{opt}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Initial Status</label>
                <select className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]">
                  <option>Draft</option>
                  <option>Active</option>
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowElectionForm(false)} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD]">Cancel</button>
                <button type="submit" className="h-11 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7] transition">Create Election</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ━━━ Add Candidate Modal ━━━ */}
      {showCandidateForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#0F172A]">Add Candidate</h2>
              <button onClick={() => setShowCandidateForm(false)} className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-[#EEF6FB]"><X size={18} /></button>
            </div>
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setShowCandidateForm(false); }}>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Full Name</label>
                <input type="text" placeholder="e.g. Alyssa Mariano" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Position</label>
                  <select className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]">
                    {positions.map(p => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Party</label>
                  <input type="text" placeholder="e.g. Forward HIUSA" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Platform / Bio</label>
                <textarea rows={3} placeholder="Candidate's platform statement..." className="w-full rounded-lg border border-[#DDE7EF] px-3 py-2.5 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 resize-none" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowCandidateForm(false)} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD]">Cancel</button>
                <button type="submit" className="h-11 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7] transition">Add Candidate</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
