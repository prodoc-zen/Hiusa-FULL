import { useLayoutEffect, useRef, useState } from 'react';

export default function SegmentedControl({ options, value, onChange, className = '' }) {
  const refs = useRef([]);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });
  const activeIndex = options.findIndex((option) => option.value === value);

  useLayoutEffect(() => {
    const node = refs.current[activeIndex];
    if (node) {
      setIndicator({ left: node.offsetLeft, width: node.offsetWidth });
    }
  }, [activeIndex, options]);

  function selectOption(index) {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    refs.current[index]?.focus();
  }

  function handleKeyDown(event, index) {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      selectOption((index + 1) % options.length);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      selectOption((index - 1 + options.length) % options.length);
    } else if (event.key === 'Home') {
      event.preventDefault();
      selectOption(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      selectOption(options.length - 1);
    }
  }

  return (
    <div role="radiogroup" className={`relative inline-flex items-center gap-0.5 rounded-control border border-line bg-subtle p-1 ${className}`}>
      <span
        className="pointer-events-none absolute inset-y-1 rounded-[4px] bg-surface shadow-card transition-transform duration-[180ms] ease-out"
        style={{ width: `${indicator.width}px`, transform: `translateX(${indicator.left}px)` }}
        aria-hidden="true"
      />
      {options.map((option, index) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => { refs.current[index] = el; }}
            type="button"
            role="radio"
            aria-checked={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => selectOption(index)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`relative z-10 h-8 rounded-[4px] px-3 text-xs font-bold transition-colors duration-150 ${isActive ? 'text-ink' : 'text-ink-muted hover:text-ink'}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
