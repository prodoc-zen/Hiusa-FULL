import { DrawnCheck } from '../../../../components/ui';

export default function ThankYouState() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-14 text-center">
      <DrawnCheck size="lg" label="Response submitted" />
      <div>
        <h2 className="text-xl font-bold text-ink">Your response is in. Thank you.</h2>
        <p className="mt-2 text-sm leading-6 text-ink-muted">
          Your answers were added to this window's results, anonymized and combined with everyone else's.
          Once the window closes, the aggregated results will help the team see how HIUSA is actually doing
          against the problems it set out to solve.
        </p>
      </div>
    </div>
  );
}
