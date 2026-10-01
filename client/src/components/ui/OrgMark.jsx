const SIZES = { sm: 'h-8 w-8', md: 'h-10 w-10', lg: 'h-14 w-14' };
// [fits three letters, fits five letters]
const TEXT = { sm: ['text-xs', 'text-[9px]'], md: ['text-sm', 'text-[11px]'], lg: ['text-lg', 'text-sm'] };

function abbreviate(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'ORG';
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
  return parts.map((part) => part[0]).slice(0, 3).join('').toUpperCase();
}

export default function OrgMark({ name, logoUrl, acronym, size = 'md', className = '' }) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={name || 'Organization logo'}
        className={`shrink-0 rounded-control border border-line object-cover ${SIZES[size]} ${className}`}
      />
    );
  }

  // "PSITS-CCS" style acronyms show their first segment so the mark never overflows.
  const mark = (acronym || abbreviate(name)).split(/[\s/-]/)[0].slice(0, 5);

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-control border border-line bg-navy-950 font-extrabold leading-none text-white ${SIZES[size]} ${TEXT[size][mark.length > 3 ? 1 : 0]} ${className}`}
      role="img"
      aria-label={name || 'Organization'}
    >
      {mark}
    </span>
  );
}
