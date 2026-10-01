import { useId } from 'react';
import { Check } from 'lucide-react';

export default function CheckboxGroup({ prompt, options, value, onChange, error, required }) {
  const baseId = useId();
  const selected = Array.isArray(value) ? value : [];

  function toggle(optionValue) {
    if (selected.includes(optionValue)) {
      onChange(selected.filter((entry) => entry !== optionValue));
    } else {
      onChange([...selected, optionValue]);
    }
  }

  const errorId = `${baseId}-error`;

  return (
    <fieldset className="flex flex-col gap-2.5">
      <legend id={`${baseId}-legend`} className="text-sm font-semibold leading-6 text-ink">
        {prompt}
        {required && <span className="ml-0.5 text-danger" aria-hidden="true">*</span>}
      </legend>
      <div
        aria-describedby={error ? errorId : undefined}
        className={`flex flex-wrap gap-2 ${error ? 'rounded-control ring-2 ring-danger/25' : ''}`}
      >
        {options.map((option) => {
          const isChecked = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              role="checkbox"
              aria-checked={isChecked}
              onClick={() => toggle(option.value)}
              className={`flex min-h-11 items-center gap-1.5 rounded-control border px-3.5 text-sm font-semibold transition-colors duration-150 ${
                isChecked
                  ? 'border-brand-600 bg-brand-50 text-navy-800'
                  : 'border-line bg-surface text-ink-muted hover:bg-subtle'
              }`}
            >
              <span
                className={`grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border ${isChecked ? 'border-brand-600 bg-brand-600' : 'border-line-soft bg-surface'}`}
                aria-hidden="true"
              >
                {isChecked && <Check size={11} className="text-white" />}
              </span>
              {option.label}
            </button>
          );
        })}
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-xs font-semibold text-danger-strong">{error}</p>
      )}
    </fieldset>
  );
}
