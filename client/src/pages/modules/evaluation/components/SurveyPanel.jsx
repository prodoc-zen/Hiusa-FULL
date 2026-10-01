import { useCallback, useEffect, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { EmptyState, ErrorState, SkeletonCard } from '../../../../components/ui';
import { getCurrentEvaluation, submitEvaluationResponse } from '../../../../services/evaluationService';
import { getApiErrorMessage } from '../../../../utils/apiError';
import notify from '../../../../lib/notify';
import { clearDraft, loadDraft, saveDraft } from '../evaluationDraft';
import ConsentStep from './ConsentStep';
import QuestionnaireForm from './QuestionnaireForm';
import ThankYouState from './ThankYouState';
import AlreadyAnsweredState from './AlreadyAnsweredState';

export default function SurveyPanel({ user }) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [consented, setConsented] = useState(false);
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [declined, setDeclined] = useState(false);

  const load = useCallback(() => {
    setState({ status: 'loading', data: null, error: null });
    getCurrentEvaluation()
      .then((res) => setState({ status: 'ready', data: res.data, error: null }))
      .catch((err) => setState({ status: 'error', data: null, error: getApiErrorMessage(err, 'Unable to load the evaluation survey.') }));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (state.status !== 'ready' || !state.data?.window || state.data.responded) return;
    const stored = loadDraft(user?.id, state.data.window.id);
    setConsented(Boolean(stored?.consented));
    setAnswers(stored?.answers || {});
    setDeclined(false);
    // Only runs when a fresh, un-answered window loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, state.data?.window?.id]);

  function persist(nextConsented, nextAnswers) {
    if (!state.data?.window) return;
    saveDraft(user?.id, state.data.window.id, { consented: nextConsented, answers: nextAnswers });
  }

  function handleConsent() {
    setConsented(true);
    persist(true, answers);
  }

  function handleAnswersChange(next) {
    setAnswers(next);
    persist(true, next);
  }

  async function handleSubmit(finalAnswers) {
    setSubmitting(true);
    setSubmitError('');
    try {
      await submitEvaluationResponse({ consent: true, answers: finalAnswers });
      clearDraft(user?.id, state.data.window.id);
      setJustSubmitted(true);
      notify.success('Your evaluation response was submitted.');
    } catch (error) {
      if (error.response?.status === 409) {
        clearDraft(user?.id, state.data.window.id);
        setState((prev) => ({ ...prev, data: { ...prev.data, responded: true } }));
        notify.info('You had already answered this window.');
      } else {
        setSubmitError(getApiErrorMessage(error, 'Unable to submit your response. Please try again.'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (state.status === 'loading') {
    return <SkeletonCard />;
  }

  if (state.status === 'error') {
    return <ErrorState description={state.error} onRetry={load} />;
  }

  const { data } = state;

  if (!data.window) {
    return (
      <EmptyState
        kind="first-run"
        icon={ClipboardList}
        title="No evaluation window is open right now"
        description="When the SAO opens a new evaluation window, you'll be invited here to share how HIUSA is working for you. Nothing to do for now."
      />
    );
  }

  if (justSubmitted) {
    return <ThankYouState />;
  }

  if (data.responded) {
    return <AlreadyAnsweredState windowTitle={data.window.title} />;
  }

  if (!consented) {
    if (declined) {
      return (
        <EmptyState
          kind="first-run"
          icon={ClipboardList}
          title="No problem"
          description={`"${data.window.title}" stays open until it closes. Come back any time before then if you change your mind.`}
          action={(
            <button
              type="button"
              onClick={() => setDeclined(false)}
              className="text-sm font-bold text-brand-700 hover:text-brand-800"
            >
              Actually, let's begin
            </button>
          )}
        />
      );
    }

    return (
      <ConsentStep
        windowTitle={data.window.title}
        instrumentLabel={data.instrument.label}
        onConsent={handleConsent}
        onDecline={() => setDeclined(true)}
      />
    );
  }

  return (
    <QuestionnaireForm
      items={data.instrument.items}
      answers={answers}
      onAnswersChange={handleAnswersChange}
      onSubmit={handleSubmit}
      submitting={submitting}
      submitError={submitError}
    />
  );
}
