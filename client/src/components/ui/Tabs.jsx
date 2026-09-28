import { useId, useLayoutEffect, useRef, useState } from 'react';

export default function Tabs({ tabs, value, onChange, className = '' }) {
  const baseId = useId();
  const refs = useRef([]);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  useLayoutEffect(() => {
    const activeIndex = tabs.findIndex((tab) => tab.key === value);
    const node = refs.current[activeIndex];
    if (node) {
      setIndicator({ left: node.offsetLeft, width: node.offsetWidth });
    }
  }, [value, tabs]);

  function focusTab(index) {
    const tab = tabs[index];
    if (!tab) return;
    onChange(tab.key);
    refs.current[index]?.focus();
  }

  function handleKeyDown(event, index) {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      focusTab((index + 1) % tabs.length);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusTab((index - 1 + tabs.length) % tabs.length);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusTab(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusTab(tabs.length - 1);
    }
  }

  return (
    <div className={`overflow-x-auto overflow-y-clip ${className}`}>
      <div role="tablist" className="relative flex w-max min-w-full items-center gap-1 border-b border-line">
        {tabs.map((tab, index) => {
          const isActive = tab.key === value;
          return (
            <button
              key={tab.key}
              ref={(el) => { refs.current[index] = el; }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.key}`}
              aria-selected={isActive}
              aria-controls={tab.panelId || undefined}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onChange(tab.key)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={`relative flex h-11 shrink-0 items-center gap-2 whitespace-nowrap px-4 text-sm font-bold transition-colors duration-150 ${isActive ? 'text-brand-700' : 'text-ink-muted hover:text-ink'}`}
            >
              {tab.icon && <tab.icon size={16} aria-hidden="true" />}
              {tab.label}
            </button>
          );
        })}
        <span
          className="pointer-events-none absolute -bottom-px h-0.5 rounded-full bg-brand-600 transition-transform duration-[180ms] ease-out"
          style={{ width: `${indicator.width}px`, transform: `translateX(${indicator.left}px)` }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
