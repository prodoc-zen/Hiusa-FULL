// Static copy describing the evaluation instrument's fixed shape (section order
// and labels, Table 3 interpretation bands). These six sections and their
// labels are the same ones `server/config/evaluation.php` defines under
// `sections`; they are copied here (not fetched) because the questionnaire
// needs them before a window is even open, and there are only six of them, so
// the drift risk that rules out copying the ~90-item question bank does not
// apply here.

export const SECTION_ORDER = ['A', 'B', 'C', 'D', 'E', 'F'];

export const SECTION_META = {
  A: { label: 'Your profile', description: 'A few questions about you and your role.' },
  B: { label: 'Current process and problems encountered', description: 'How things work today, without HIUSA.' },
  C: { label: 'Mechanism or techniques of the proposed system', description: 'The AI and automation HIUSA proposes to use.' },
  D: { label: 'Key features of the proposed system', description: 'The features HIUSA actually ships.' },
  E: { label: 'Level of acceptability of the proposed system', description: 'Whether HIUSA works for you.' },
  F: { label: 'Your feedback', description: 'Anything else you want the team to know.' },
};

export const RESPONDENT_TYPE_LABEL = {
  student: 'Students',
  officer: 'Officers',
  adviser: 'Department heads',
};

// Table 3 (Likert Scale interpretation) from the capstone paper, mirrored from
// `server/config/evaluation.php`'s `likert_labels`. Only used to pick a badge
// tone for a label the API already computed and sent as text.
export function interpretationTone(label) {
  const key = String(label || '').toLowerCase();
  if (key.includes('strongly agreed') || key === 'agreed') return 'success';
  if (key.includes('undecided')) return 'warning';
  if (key.includes('disagreed')) return 'danger';
  return 'neutral';
}

export function respondentTypeLabel(type) {
  return RESPONDENT_TYPE_LABEL[type] || String(type || '');
}

export const RESPONDENT_TYPE_ORDER = ['student', 'officer', 'adviser'];

// The 5-point Likert scale is identical across every instrument in
// `server/config/evaluation.php` ($likertOptions); only the six section
// labels above and this scale are safe to copy client-side.
export const LIKERT_SCALE_LABELS = {
  1: 'Strongly Disagree',
  2: 'Disagree',
  3: 'Neutral',
  4: 'Agree',
  5: 'Strongly Agree',
};
