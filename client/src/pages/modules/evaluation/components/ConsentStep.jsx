import { ShieldCheck } from 'lucide-react';
import { Button, Card } from '../../../../components/ui';

export default function ConsentStep({ instrumentLabel, windowTitle, onConsent, onDecline }) {
  return (
    <Card className="mx-auto max-w-2xl">
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-control bg-brand-50 text-brand-600">
            <ShieldCheck size={22} aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-ink">Before you begin: {windowTitle}</h2>
            <p className="mt-1 text-sm font-medium text-ink-muted">{instrumentLabel}</p>
          </div>
        </div>

        <p className="text-sm leading-6 text-ink-muted">
          This is part of the research behind HIUSA. Your answers help the team understand how student
          body organizations currently run their work, and whether HIUSA is actually a good fit for that
          work. Here is exactly what that means for you.
        </p>

        <ul className="flex flex-col gap-3">
          <li className="flex gap-3 rounded-control border border-line bg-subtle p-3.5 text-sm text-ink">
            <span className="font-bold text-brand-700">What we collect</span>
            <span className="text-ink-muted">
              Your answers to this questionnaire: a short profile (your role and organization), how things
              work today, and how acceptable HIUSA's features are to you. We do not collect anything else.
            </span>
          </li>
          <li className="flex gap-3 rounded-control border border-line bg-subtle p-3.5 text-sm text-ink">
            <span className="font-bold text-brand-700">How it is reported</span>
            <span className="text-ink-muted">
              Results are always aggregated and anonymized. No individual response is ever shown on its
              own, and results for a small group are withheld entirely until enough people have answered.
              Only the research team can see raw responses.
            </span>
          </li>
          <li className="flex gap-3 rounded-control border border-line bg-subtle p-3.5 text-sm text-ink">
            <span className="font-bold text-brand-700">Your participation</span>
            <span className="text-ink-muted">
              Taking part is voluntary. You can stop at any time, for any reason, without it affecting your
              account or your organization in any way.
            </span>
          </li>
        </ul>

        <div className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onDecline}>Not right now</Button>
          <Button variant="primary" onClick={onConsent}>I consent, let's begin</Button>
        </div>
      </div>
    </Card>
  );
}
