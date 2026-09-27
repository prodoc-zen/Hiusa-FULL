import { cloneElement, useId, useRef, useState } from 'react';

const SIDE_CLASSES = {
  top: 'bottom-full left-1/2 mb-2 -translate-x-1/2',
  bottom: 'top-full left-1/2 mt-2 -translate-x-1/2',
  left: 'right-full top-1/2 mr-2 -translate-y-1/2',
  right: 'left-full top-1/2 ml-2 -translate-y-1/2',
};

export default function Tooltip({ content, children, side = 'top' }) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef(null);
  const id = useId();

  function show() {
    timerRef.current = window.setTimeout(() => setVisible(true), 300);
  }

  function hide() {
    window.clearTimeout(timerRef.current);
    setVisible(false);
  }

  return (
    <span className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {cloneElement(children, { 'aria-describedby': visible ? id : children.props['aria-describedby'] })}
      {visible && (
        <span
          role="tooltip"
          id={id}
          className={`pointer-events-none absolute z-50 whitespace-nowrap rounded-control bg-navy-950 px-2.5 py-1.5 text-xs font-semibold text-white shadow-raised transition-opacity duration-150 ease-out ${SIDE_CLASSES[side]}`}
        >
          {content}
        </span>
      )}
    </span>
  );
}
