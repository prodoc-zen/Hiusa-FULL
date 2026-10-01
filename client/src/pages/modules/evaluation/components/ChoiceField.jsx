import { useId, useRef } from 'react';
import { Check } from 'lucide-react';

export default function ChoiceField({ prompt, options, value, onChange, error, required }) {
  const baseId = useId();
  const refs = useRef([]);
  const selectedIndex = options.findIndex((option) => option.value === value);

  function choose(index) {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    refs.current[index]?.focus();
  }

  function handleKeyDown(event, index) {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      choose((index + 1) % options.length);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      choose((index - 1 + options.length) % options.length);
    } else if (event.key === 'Home') {
      event.preventDefault();
      choose(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      choose(options.length - 1);
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
        role="radiogroup"
        aria-labelledby={`${baseId}-legend`}
        aria-describedby={error ? errorId : undefined}
        aria-invalid={error ? true : undefined}
        className={`flex flex-wrap gap-2 ${error ? 'rounded-control ring-2 ring-danger/25' : ''}`}
      >
        {options.map((option, index) => {
          const isSelected = option.value === value;
          const tabbable = selectedIndex === -1 ? index === 0 : index === selectedIndex;
          return (
            <button
              key={option.value}
              ref={(el) => { refs.current[index] = el; }}
              type="button"
              role="radio"
              aria-checked={isSelected}
              tabIndex={tabbable ? 0 : -1}
              onClick={() => choose(index)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={`flex min-h-11 items-center gap-1.5 rounded-control border px-3.5 text-sm font-semibold transition-colors duration-150 ${
                isSelected
                  ? 'border-brand-600 bg-brand-50 text-navy-800'
                  : 'border-line bg-surface text-ink-muted hover:bg-subtle'
              }`}
            >
              {isSelected && <Check size={14} className="shrink-0 text-brand-700" aria-hidden="true" />}
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
