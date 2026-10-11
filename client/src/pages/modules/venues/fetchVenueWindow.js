import { getVenueBookings } from '../../../services/venueService';
import { listMeta, unwrapList } from '../../../services/pagination';

const PER_PAGE = 100;
const MAX_PAGES = 50;

async function fetchEveryPage(params) {
  const items = [];
  let meta;
  let page = 1;
  do {
    const response = await getVenueBookings({ ...params, page, per_page: PER_PAGE });
    meta = listMeta(response.data);
    items.push(...unwrapList(response.data));
    page += 1;
  } while (page <= meta.lastPage && page <= MAX_PAGES);
  return { items, total: meta.total };
}

// Every pending and approved booking that touches the window, however many pages the server needs.
// `truncated` is only set when the page ceiling stopped the walk, so a short list is never silent.
export async function fetchWindowBookings({ from, to, venueId }) {
  const results = await Promise.all(['pending', 'approved'].map((status) => fetchEveryPage({ from, to, status, venue_id: venueId || undefined })));
  const items = results.flatMap((result) => result.items);
  const total = results.reduce((sum, result) => sum + result.total, 0);
  return { items, truncated: total > items.length ? { shown: items.length, total } : null };
}
