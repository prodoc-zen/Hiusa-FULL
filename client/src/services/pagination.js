// The server paginates most list endpoints as a Laravel paginator envelope
// ({ data: [...], current_page, last_page, per_page, total }) while a handful of
// small, fixed lists (organizations, sbo-positions) stay a bare array. Every
// screen that renders a list or a count derived from one must go through these
// two helpers instead of guessing at the shape - see ManageVotersPage for why:
// reading an envelope with Array.isArray() silently produces an empty list, and
// counting array.length instead of `total` silently under-reports once a list
// paginates.

const DEFAULT_PER_PAGE = 20;

export function unwrapList(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.data)) return payload.data;
  return [];
}

export function listMeta(payload) {
  const items = unwrapList(payload);
  const isEnvelope = Boolean(payload) && typeof payload === 'object' && !Array.isArray(payload) && payload.current_page !== undefined;

  if (isEnvelope) {
    return {
      total: Number(payload.total ?? items.length),
      currentPage: Number(payload.current_page ?? 1),
      lastPage: Number(payload.last_page ?? 1),
      perPage: Number(payload.per_page ?? DEFAULT_PER_PAGE),
    };
  }

  return {
    total: items.length,
    currentPage: 1,
    lastPage: 1,
    perPage: items.length || DEFAULT_PER_PAGE,
  };
}

export function normalizeList(payload) {
  const items = unwrapList(payload);
  return { items, ...listMeta(payload) };
}

// Some list endpoints have no server-side filter that matches what a screen
// needs (e.g. events has no `?status=` filter, so "upcoming events" can only be
// computed client-side). For those cases - always a dropdown source or a
// dashboard aggregate, never the browsable table itself, which should page
// normally - this fetches every page and concatenates the rows. `fetchPage`
// must resolve to a bare array or a paginator envelope (whatever the caller
// already unwraps the axios response to), given `{ ...params, page, per_page }`.
export async function fetchAllPages(fetchPage, params = {}, { perPage = 100, maxPages = 50 } = {}) {
  const first = await fetchPage({ ...params, page: 1, per_page: perPage });
  const items = unwrapList(first);
  const meta = listMeta(first);

  if (meta.lastPage <= 1) return items;

  const remainingPages = Math.min(meta.lastPage, maxPages) - 1;
  const rest = await Promise.all(
    Array.from({ length: remainingPages }, (_, index) =>
      fetchPage({ ...params, page: index + 2, per_page: perPage }).then(unwrapList)
    )
  );

  return [...items, ...rest.flat()];
}
