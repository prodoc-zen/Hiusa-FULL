const PAGE_PATH = /^\/dashboard(?:[/?#]|$)/;
const BLOCKED_PARAMS = ['q', 'topic'];

function decoded(path) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

// An address in an answer becomes a link only when it opens a plain page: a deep link that
// starts a conversation (?q=, ?topic=) or reopens Ask AI is text, never a link.
export default function isSafePageHref(href) {
  if (typeof href !== 'string' || !PAGE_PATH.test(href) || href.includes('\\')) return false;
  let url;
  try {
    url = new URL(href, 'https://hiusa.invalid');
  } catch {
    return false;
  }
  if (url.origin !== 'https://hiusa.invalid') return false;
  const path = decoded(url.pathname).toLowerCase().replace(/\/+$/, '');
  if (!path.startsWith('/dashboard') || path === '/dashboard/ask-ai' || path.startsWith('/dashboard/ask-ai/')) return false;
  for (const key of url.searchParams.keys()) {
    if (BLOCKED_PARAMS.includes(decoded(key).toLowerCase())) return false;
  }
  return true;
}
