import { useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '../ui';
import EngineBadge from './EngineBadge';
import { draftReviewNote } from '../../services/aiDraftService';
import { getApiErrorMessage } from '../../utils/apiError';
import { PRIVACY_CONSENT_RECORDED_EVENT } from '../../utils/privacyNotice';

// The badge names the engine in plain words; the built-in template reads as "Built-in rules".
const ENGINE_BADGE = { claude: 'Claude', groq: 'Groq', template: 'php-fallback' };

// Writes the remarks a reviewer must give with a decision. The reviewer has already chosen the decision, so this
// only puts words around what they marked. The text lands in the field through onDraft and is never sent from here.
// With text already in the field the button offers to reword it, and asks before it replaces anything.
export default function DraftNoteButton({ flow, recordId, decision, marks = [], reviewerNotes = '', value = '', onDraft, disabled = false, className = '' }) {
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');
  const [consentRefused, setConsentRefused] = useState(false);
  const [drafted, setDrafted] = useState(false);
  const [engine, setEngine] = useState(null);
  const hasText = value.trim() !== '';

  // The consent dialog opens over this when the server wants the privacy agreement first. Once the person agrees,
  // that refusal is out of date and should not stay under the button.
  useEffect(() => {
    if (!consentRefused) return undefined;
    const clear = () => {
      setError('');
      setConsentRefused(false);
    };
    window.addEventListener(PRIVACY_CONSENT_RECORDED_EVENT, clear);
    return () => window.removeEventListener(PRIVACY_CONSENT_RECORDED_EVENT, clear);
  }, [consentRefused]);

  async function run() {
    setAsking(false);
    setBusy(true);
    setError('');
    setConsentRefused(false);
    try {
      const { data } = await draftReviewNote({
        flow,
        record_id: recordId,
        decision,
        marks,
        reviewer_notes: reviewerNotes,
        ...(hasText ? { current_text: value.trim() } : {}),
      });
      const result = data?.data ?? data;
      const text = typeof result?.text === 'string' ? result.text.trim() : '';
      if (!text) throw new Error('The draft came back empty.');
      setEngine(result.engine || null);
      setDrafted(true);
      onDraft({ text, aiOutputId: result.ai_output_id ?? null, engine: result.engine ?? null });
    } catch (cause) {
      setConsentRefused(cause?.isPrivacyConsentRequired === true);
      setError(getApiErrorMessage(cause, 'Could not draft the remarks. What you typed is unchanged. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`space-y-2 ${className}`}>
      {asking ? (
        <div className="space-y-2 rounded-control border border-line bg-subtle px-3 py-2">
          <p className="text-sm text-ink">Your remarks will be replaced with a reworded version. Replace them?</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={run}>Replace my text</Button>
            <Button size="sm" variant="secondary" onClick={() => setAsking(false)}>Keep mine</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" leftIcon={busy ? undefined : Sparkles} disabled={disabled || busy} aria-busy={busy || undefined} onClick={() => (hasText ? setAsking(true) : run())}>
            {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
            {busy ? 'Drafting...' : hasText ? 'Improve my wording' : 'Draft the remarks'}
          </Button>
          {engine && !busy && !error && <EngineBadge engine={ENGINE_BADGE[engine] || engine} />}
        </div>
      )}
      {drafted && !busy && !error && <p className="text-xs text-ink-muted-strong">Draft. Read and edit before you send.</p>}
      {error && <p role="alert" className="text-sm font-semibold text-danger-strong">{error}</p>}
    </div>
  );
}
