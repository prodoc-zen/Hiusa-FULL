import { CheckCircle2 } from 'lucide-react';

export default function AlreadyAnsweredState({ windowTitle }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-14 text-center">
      <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-success-tint text-success-strong">
        <CheckCircle2 size={26} strokeWidth={1.75} aria-hidden="true" />
      </div>
      <div>
        <h2 className="text-lg font-bold text-ink">Thank you, your response is in.</h2>
        <p className="mt-1.5 text-sm leading-6 text-ink-muted">
          {windowTitle ? `You already answered "${windowTitle}". ` : 'You already answered this window. '}
          There is nothing else to do here until the next evaluation window opens.
        </p>
      </div>
    </div>
  );
}
