import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy } from 'lucide-react';
import { Button, Drawer, ErrorState, SkeletonText } from '../ui';
import EngineBadge from './EngineBadge';
import { engineName } from './engineName';
import notify from '../../lib/notify';
import { manilaDate, peso } from '../../lib/format';
import { draftSemesterNarrative, recordAiOutcome } from '../../services/aiDraftService';
import { getApiErrorMessage } from '../../utils/apiError';

const SECTIONS = [
  ['accomplishments', 'Accomplishments'],
  ['implementation', 'Implementation'],
  ['evaluation', 'Evaluation'],
  ['next_semester_plan', 'Next semester plan'],
];

// The recorded facts the draft was written from, in the words an officer would check them against.
function factLines(facts) {
  const lines = [];
  const events = Array.isArray(facts?.events) ? facts.events : [];
  if (events.length === 0) lines.push('No events were recorded.');
  events.forEach((event) => {
    const parts = [event.status, manilaDate(event.date, 'long')];
    if (event.attendance != null) parts.push(`${event.attendance} attended`);
    if (event.budget_allocated != null) parts.push(`budget used ${peso(event.budget_used)} of ${peso(event.budget_allocated)}`);
    lines.push(`${event.title}: ${parts.join(', ')}`);
  });
  if (facts?.tasks) lines.push(`Tasks: ${facts.tasks.completed} completed, ${facts.tasks.overdue} overdue, ${facts.tasks.open} open`);
  (facts?.elections || []).forEach((election) => lines.push(`Election ${election.title}: ${election.ballots} ballots from ${election.voters} voters`));
  if (facts?.merchandise) lines.push(`Merchandise: ${facts.merchandise.orders} orders, ${facts.merchandise.claimed} claimed`);
  if (facts?.announcements) lines.push(`Announcements posted: ${facts.announcements.posted}`);
  if (facts?.finance) lines.push(`Money: income ${peso(facts.finance.income)}, expenses ${peso(facts.finance.expense)}, closing balance ${peso(facts.finance.closing_balance)}`);
  (facts?.upcoming_events || []).forEach((event) => lines.push(`Upcoming: ${event.title}, ${manilaDate(event.date, 'long')}`));
  if (Array.isArray(facts?.officers) && facts.officers.length > 0) lines.push(`Officers: ${facts.officers.map((officer) => `${officer.name} (${officer.position})`).join(', ')}`);

  return lines;
}

export default function SemesterNarrativeDrawer({ open, semesterId, onClose }) {
  const [state, setState] = useState({ loading: false, error: '', draft: null });
  const recorded = useRef(false);
  const request = useRef(0);

  const load = useCallback(() => {
    const current = ++request.current;
    recorded.current = false;
    setState({ loading: true, error: '', draft: null });
    draftSemesterNarrative(semesterId)
      .then((draft) => { if (current === request.current) setState({ loading: false, error: '', draft }); })
      .catch((error) => { if (current === request.current) setState({ loading: false, error: getApiErrorMessage(error, 'Could not draft the narrative. Try again in a moment.'), draft: null }); });
  }, [semesterId]);

  useEffect(() => {
    if (open) load();
    return () => { request.current += 1; };
  }, [open, load]);

  // The first outcome wins: a copied section counts as accepted, a closed drawer with nothing copied as discarded.
  const record = (draft, finalText) => {
    if (!draft || recorded.current) return;
    recorded.current = true;
    recordAiOutcome(draft.ai_output_id, finalText).catch(() => {});
  };

  const close = () => {
    record(state.draft, null);
    onClose();
  };

  const copy = async (key, label) => {
    const { draft } = state;
    try {
      await navigator.clipboard.writeText(draft.sections[key]);
    } catch {
      notify.error('Could not copy this section. Select the text and copy it instead.');
      return;
    }
    notify.success(`${label} copied.`);
    record(draft, draft.text);
  };

  const { loading, error, draft } = state;
  const lines = draft ? factLines(draft.facts) : [];

  return (
    <Drawer open={open} onClose={close} title="Draft the narrative" description={draft?.facts?.semester} width="max-w-lg">
      <div className="space-y-4">
        {loading && <SkeletonText lines={8} />}
        {!loading && error && <ErrorState description={error} onRetry={load} />}
        {draft && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <EngineBadge engine={engineName(draft.engine)} />
              <p className="text-xs text-ink-muted-strong">Draft. Read and edit before you send.</p>
            </div>
            {SECTIONS.map(([key, label]) => (
              <section key={key} className="border-t border-line pt-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-ink">{label}</h3>
                  <Button size="sm" variant="secondary" leftIcon={Copy} onClick={() => copy(key, label)} aria-label={`Copy ${label}`}>Copy</Button>
                </div>
                <p className="mt-2 whitespace-pre-line break-words text-sm leading-6 text-ink">{draft.sections[key]}</p>
              </section>
            ))}
            <details className="group border-t border-line pt-3 text-xs">
              <summary className="inline-flex min-h-8 pointer-coarse:min-h-[42px] cursor-pointer list-none items-center gap-1.5 rounded-control font-medium text-ink-muted-strong hover:text-ink [&::-webkit-details-marker]:hidden">
                <span aria-hidden="true" className="inline-block transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none">&rsaquo;</span>
                Facts used
              </summary>
              <ul className="mt-1.5 space-y-1 border-l-2 border-line pl-3 leading-5 text-ink-muted-strong">
                {lines.map((line, index) => <li key={index} className="break-words">{line}</li>)}
              </ul>
            </details>
          </>
        )}
      </div>
    </Drawer>
  );
}
