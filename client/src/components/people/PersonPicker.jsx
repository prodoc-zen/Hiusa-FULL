import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { Avatar, Button, Input } from '../ui';
import { searchPeople } from '../../services/peopleService';
import { getApiErrorMessage } from '../../utils/apiError';
import { visibleSchoolId } from '../../utils/schoolId';

const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;

// Where the person belongs (an organization if they are in one, else their college), then the email
// that tells two people with the same name apart.
function defaultDetail(person) {
  return [person.organizations?.[0]?.name || person.college, person.email].filter(Boolean).join(' · ');
}

export default function PersonPicker({
  label = 'Find a person',
  scope,
  organizationId,
  role,
  onSelect,
  excludeIds = [],
  search = searchPeople,
  describe = defaultDetail,
  placeholder = 'Type a name or email',
  value,
  hint,
  error,
  disabled = false,
  className = '',
}) {
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const listId = `${baseId}-list`;
  const optionId = (index) => `${baseId}-option-${index}`;
  const requestRef = useRef(0);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('idle');
  const [failure, setFailure] = useState('');
  const [active, setActive] = useState(-1);
  const [internal, setInternal] = useState(null);
  const [retry, setRetry] = useState(0);

  const selected = value !== undefined ? value : internal;
  const trimmed = query.trim();
  const excluded = excludeIds.map(String).join(',');

  useEffect(() => {
    requestRef.current += 1;
    const request = requestRef.current;

    if (trimmed.length < MIN_CHARS) {
      setStatus('idle');
      setResults([]);
      return undefined;
    }

    setStatus('loading');
    const timer = setTimeout(async () => {
      try {
        const params = { q: trimmed };
        if (scope) params.scope = scope;
        if (organizationId) params.organization_id = organizationId;
        if (role) params.role = role;
        const people = await search(params);
        if (request !== requestRef.current) return;
        const hidden = excluded ? excluded.split(',') : [];
        setResults(people.filter((person) => !hidden.includes(String(person.school_id))));
        setActive(-1);
        setStatus('done');
      } catch (err) {
        if (request !== requestRef.current) return;
        setFailure(getApiErrorMessage(err, 'Could not search. Try again.'));
        setStatus('error');
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [trimmed, scope, organizationId, role, excluded, retry, search]);

  const choose = useCallback((person) => {
    setInternal(person);
    setQuery('');
    setResults([]);
    setOpen(false);
    setActive(-1);
    onSelect?.(person);
  }, [onSelect]);

  const remove = () => {
    setInternal(null);
    onSelect?.(null);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((current) => (results.length ? (current + 1) % results.length : -1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => (results.length ? (current <= 0 ? results.length - 1 : current - 1) : -1));
    } else if (event.key === 'Enter' && open && results[active]) {
      event.preventDefault();
      choose(results[active]);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
    }
  };

  const labelClass = 'text-[13px] font-medium text-ink';

  if (selected) {
    return (
      <div className={`flex flex-col gap-1.5 ${className}`}>
        <span id={`${baseId}-label`} className={labelClass}>{label}</span>
        <div
          role="group"
          aria-labelledby={`${baseId}-label`}
          className="flex min-h-14 items-center gap-3 rounded-control border border-line bg-surface px-3 py-2"
        >
          <Avatar name={selected.name} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{selected.name}</p>
            <p className="truncate text-xs text-ink-muted">{describe(selected)}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={remove} disabled={disabled} aria-label={`Remove ${selected.name}`}>
            Remove
          </Button>
        </div>
      </div>
    );
  }

  const showList = open && trimmed.length >= MIN_CHARS;
  const describedBy = [error ? `${inputId}-error` : hint ? `${inputId}-hint` : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={`relative flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={inputId} className={labelClass}>{label}</label>
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-soft" aria-hidden="true" />
        <Input
          id={inputId}
          type="text"
          role="combobox"
          data-autofocus
          autoComplete="off"
          className="pl-10"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          placeholder={placeholder}
          value={query}
          disabled={disabled}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={handleKeyDown}
        />
        {status === 'loading' && showList && (
          <Loader2 size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin text-ink-muted" aria-hidden="true" />
        )}
      </div>

      <div
        id={listId}
        role="listbox"
        aria-label={`${label} results`}
        hidden={!showList}
        className="absolute left-0 right-0 top-full z-[60] mt-1 max-h-72 overflow-y-auto rounded-control border border-line bg-surface shadow-card"
      >
        {status === 'loading' && <p role="status" className="px-3 py-3 text-sm text-ink-muted">Searching...</p>}
        {status === 'error' && (
          <div className="flex items-center justify-between gap-3 px-3 py-3">
            <p role="alert" className="text-sm text-danger-strong">{failure}</p>
            <Button variant="secondary" size="sm" onMouseDown={(event) => event.preventDefault()} onClick={() => setRetry((count) => count + 1)}>
              Try again
            </Button>
          </div>
        )}
        {status === 'done' && results.length === 0 && (
          <p role="status" className="px-3 py-3 text-sm text-ink-muted">No one matches &quot;{trimmed}&quot;</p>
        )}
        {status === 'done' && results.map((person, index) => (
          <div
            key={person.school_id}
            id={optionId(index)}
            role="option"
            aria-selected={index === active}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(person)}
            onMouseEnter={() => setActive(index)}
            className={`flex min-h-14 cursor-pointer items-center gap-3 px-3 py-2 ${index === active ? 'bg-subtle' : ''}`}
          >
            <Avatar name={person.name} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{person.name}</p>
              <p className="truncate text-xs text-ink-muted">{describe(person)}</p>
            </div>
            {visibleSchoolId(person.school_id) !== null && <span className="shrink-0 text-xs text-ink-muted">{visibleSchoolId(person.school_id)}</span>}
          </div>
        ))}
      </div>

      {hint && !error && <p id={`${inputId}-hint`} className="text-xs text-ink-muted">{hint}</p>}
      {error && <p id={`${inputId}-error`} role="alert" className="text-xs font-semibold text-danger-strong">{error}</p>}
    </div>
  );
}
