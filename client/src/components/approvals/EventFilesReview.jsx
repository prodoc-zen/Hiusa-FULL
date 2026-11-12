import { useState } from 'react';
import { Field, Select, Textarea } from '../ui';
import FileReviewList from '../reviews/FileReviewList';

// "Not checked" sends nothing, so a file the reviewer has not looked at is never recorded as accepted.
const MARKS = [
  ['', 'Not checked'],
  ['ok', 'Accepted'],
  ['needs_changes', 'Needs changes'],
];

const WORD = { ok: 'Accepted', needs_changes: 'Needs changes' };
const STAGE_LABEL = { dean: 'Department Head', sao: 'SAO' };

// "Department Head: Needs changes. The seal is missing." One sentence per mark, read the same on every screen.
export const describeReview = (review) => `${STAGE_LABEL[review.stage] ?? review.stage}: ${WORD[review.status] ?? review.status}.${review.note ? ` ${review.note}` : ''}`;

export const stageOfRequest = (request) => (request.required_role === 'SUPER_ADMIN' ? 'sao' : 'dean');

export const filesOf = (request) => (request.entity_type === 'event' ? request.summary?.requirement_files ?? [] : []);

// A file this step already accepted and the organization did not replace comes back accepted.
export function initialMarks(files, stage) {
  return Object.fromEntries(files
    .filter((file) => file.reviews?.some((review) => review.stage === stage && review.status === 'ok'))
    .map((file) => [file.id, 'ok']));
}

export const allAccepted = (files, marks) => files.every((file) => marks[file.id] === 'ok');

export const missingNote = (files, marks, notes) => files.some((file) => marks[file.id] === 'needs_changes' && !notes[file.id]?.trim());

// The files to send with the decision: only the ones the reviewer marked. Nothing marked sends nothing.
export function markedFiles(files, marks, notes) {
  const sent = files.filter((file) => marks[file.id]).map((file) => (
    marks[file.id] === 'needs_changes'
      ? { id: file.id, status: 'needs_changes', note: notes[file.id].trim() }
      : { id: file.id, status: 'ok' }
  ));
  return sent.length ? sent : undefined;
}

function worst(reviews) {
  if (reviews.some((review) => review.status === 'needs_changes')) return 'needs_changes';
  return reviews.length > 0 && reviews.every((review) => review.status === 'ok') ? 'ok' : '';
}

function badge(state) {
  return state ? { status: state, label: WORD[state] } : { status: 'pending', tone: 'neutral', label: 'Not checked' };
}

// The same per-file check organization applications use: one aligned row per file, and the reviewer of
// this step marks each one Accepted or Needs changes with a note. Everyone else reads the marks. A screen
// that already sits in a card passes framed={false} so the list is not a box inside a box.
export default function EventFilesReview({ files, actionable, marks, notes, onMark, onNote, framed = true }) {
  const [openId, setOpenId] = useState(null);

  return (
    <section aria-label="SAO event files" className="space-y-2">
      <h3 className="text-xs font-semibold text-ink-muted-strong">SAO event files</h3>
      <div className={framed ? 'overflow-hidden rounded-card border border-line' : 'overflow-hidden'}>
        <FileReviewList rows={files.map((file) => {
          const reviews = file.reviews ?? [];
          const mark = marks[file.id] ?? '';
          // Every note the file carries, from either step, reads beside the file. This step's earlier return
          // stays visible until the organization replaces the file.
          const lines = reviews.filter((review) => review.status === 'needs_changes' || review.note).map((review) => (
            <p key={review.stage} className="text-sm text-ink">{describeReview(review)}</p>
          ));
          const open = openId === file.id;
          const flagged = mark === 'needs_changes';
          const toggleLabel = open ? 'Close' : (mark ? 'Change' : 'Review');
          const name = file.requirement || file.original_name;

          return {
            id: file.id,
            name,
            status: badge(actionable ? mark : worst(reviews)),
            file: { name: file.original_name, url: file.open_url },
            actions: actionable ? [{ label: toggleLabel, ariaLabel: `${toggleLabel} ${name}`, expanded: open, onClick: () => setOpenId(open ? null : file.id) }] : [],
            expanded: lines.length > 0 || open || flagged,
            note: lines.length > 0 ? <div className="space-y-1">{lines}</div> : null,
            detail: actionable && (open || flagged) ? (
              <div className="space-y-2">
                <div className="sm:w-44">
                  <Select aria-label={`Review of ${name}`} value={mark} onChange={(event) => { setOpenId(file.id); onMark(file.id, event.target.value); }}>
                    {MARKS.map(([value, label]) => <option key={value || 'none'} value={value}>{label}</option>)}
                  </Select>
                </div>
                {flagged && (
                  <Field label="Note for the organization">
                    <Textarea rows={2} maxLength={1000} value={notes[file.id] || ''} onChange={(event) => onNote(file.id, event.target.value)} />
                  </Field>
                )}
              </div>
            ) : null,
          };
        })} />
      </div>
    </section>
  );
}
