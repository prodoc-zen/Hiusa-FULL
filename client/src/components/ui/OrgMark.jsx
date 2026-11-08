const SIZES = { sm: 'h-8 w-8', md: 'h-10 w-10', lg: 'h-14 w-14' };
// Never below 12px. MAX is how many letters fit the box at that size.
const TEXT = { sm: 'text-xs', md: 'text-sm', lg: 'text-sm' };
const MAX = { sm: 3, md: 4, lg: 4 };

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
  const mark = (acronym || abbreviate(name)).split(/[\s/-]/)[0].slice(0, MAX[size]);

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-control border border-line bg-navy-950 font-semibold leading-none text-white ${SIZES[size]} ${TEXT[size]} ${className}`}
      role="img"
      aria-label={name || 'Organization'}
    >
      {mark}
    </span>
  );
}
