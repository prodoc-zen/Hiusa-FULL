// An officer books venues only when their position allows it. A user stored before the flag existed keeps the page.
export function readCanBookVenues() {
  try {
    return JSON.parse(localStorage.getItem('user'))?.can_book_venues !== false;
  } catch {
    return true;
  }
}

// A view-only seat (an adviser who oversees) reads every record and changes none; the server refuses its writes.
export function readViewOnly() {
  try {
    return JSON.parse(localStorage.getItem('user'))?.view_only === true;
  } catch {
    return false;
  }
}

// The org modules the active profile may open; null means all of them.
export function readUserModules() {
  try {
    const modules = JSON.parse(localStorage.getItem('user'))?.modules;
    return Array.isArray(modules) ? modules : null;
  } catch {
    return null;
  }
}
